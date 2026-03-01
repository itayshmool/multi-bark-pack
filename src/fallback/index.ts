/**
 * Fallback Orchestrator
 * Manages automatic agent recovery with context preservation
 */

import config from './config.js';
import * as detector from './detector.js';
import * as injector from './injector.js';
import * as historyManager from '../history/index.js';
import type { Agent, Backend, FallbackResult, FallbackStrategy } from '../types/index.js';

interface BackendsManager {
  get(name: string): Backend | undefined;
  isAvailable(name: string): boolean;
}

interface FailureInput {
  type: string;
  message: string;
  recoverable: boolean;
  strategy: FallbackStrategy;
  retryable: boolean;
  backoffMultiplier?: number;
  matchedPattern?: string;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute fallback for a failed agent
 */
export async function executeFallback(
  agent: Agent,
  failure: FailureInput,
  adapter: unknown,
  backends: BackendsManager,
  resetAgentFn: (agent: Agent) => void,
): Promise<FallbackResult> {
  if (!config.enabled) {
    return { success: false, reason: 'Fallback disabled' };
  }

  if (!detector.isRecoverable(failure.type)) {
    return { success: false, reason: `${failure.type} is not recoverable` };
  }

  console.log(`  🔄 Starting fallback for ${agent.name} (${failure.type})`);

  // Record error in history
  historyManager.recordError(agent.id, failure.type, failure.message);

  // Try strategies in order
  for (const strategy of config.strategyOrder) {
    const result = await tryStrategy(strategy, agent, failure, adapter, backends, resetAgentFn);

    if (result.success) {
      console.log(`  ✅ Fallback ${strategy} succeeded for ${agent.name}`);
      return result;
    }

    console.log(`  ⚠️ Fallback ${strategy} failed for ${agent.name}: ${result.reason}`);
  }

  // All strategies failed
  return {
    success: false,
    reason: 'All fallback strategies exhausted',
    notifyUser: true,
  };
}

/**
 * Try a specific fallback strategy
 */
export async function tryStrategy(
  strategy: string,
  agent: Agent,
  failure: FailureInput,
  adapter: unknown,
  backends: BackendsManager,
  resetAgentFn: (agent: Agent) => void,
): Promise<FallbackResult> {
  switch (strategy) {
    case 'retry':
      return await retryStrategy(agent, failure);

    case 'reset':
      return await resetStrategy(agent, failure, backends, resetAgentFn);

    case 'switch':
      return await switchStrategy(agent, failure, backends, resetAgentFn);

    default:
      return { success: false, reason: `Unknown strategy: ${strategy}` };
  }
}

/**
 * Retry Strategy
 * Wait with exponential backoff and retry same session
 */
export async function retryStrategy(agent: Agent, failure: FailureInput): Promise<FallbackResult> {
  // Only retry for retryable failures
  if (!detector.getFailureInfo(failure.type).retryable) {
    return { success: false, reason: 'Not retryable' };
  }

  const backoffMs = config.retry.backoffMs;
  const maxAttempts = config.retry.maxAttempts;

  // Check retry count
  agent.retryCount = (agent.retryCount || 0) + 1;

  if (agent.retryCount > maxAttempts) {
    agent.retryCount = 0;  // Reset for next time
    return { success: false, reason: 'Max retries exceeded' };
  }

  // Calculate backoff delay
  const delayIndex = Math.min(agent.retryCount - 1, backoffMs.length - 1);
  let delay = backoffMs[delayIndex];

  // Apply multiplier for certain failure types
  const multiplier = detector.getFailureInfo(failure.type).backoffMultiplier || 1;
  delay *= multiplier;

  console.log(`  ⏳ Retry ${agent.retryCount}/${maxAttempts} for ${agent.name}, waiting ${delay}ms`);
  await sleep(delay);

  return {
    success: true,
    strategy: 'retry',
    action: 'retry_same_session',
    delay,
  };
}

/**
 * Reset Strategy
 * Create new session on same backend with context injected
 */
export async function resetStrategy(
  agent: Agent,
  failure: FailureInput,
  backends: BackendsManager,
  resetAgentFn: (agent: Agent) => void,
): Promise<FallbackResult> {
  const backend = backends.get(agent.backend);
  if (!backend) {
    return { success: false, reason: 'Backend not available' };
  }

  // Inject context for new session
  injector.injectContext(agent, 'full');

  // Generate new session ID
  const newSessionId = backend.generateSessionId();
  const oldSessionId = agent.sessionId;

  agent.sessionId = newSessionId;
  agent.hasRun = false;  // Forces new session flow
  agent.retryCount = 0;  // Reset retry counter

  console.log(`  🔄 Reset ${agent.name}: ${oldSessionId?.slice(0, 8)}... → ${newSessionId?.slice(0, 8)}...`);

  return {
    success: true,
    strategy: 'reset',
    action: 'new_session_same_backend',
    oldSessionId,
    newSessionId,
    contextInjected: true,
  };
}

/**
 * Switch Strategy
 * Switch to different backend with context injected
 */
export async function switchStrategy(
  agent: Agent,
  failure: FailureInput,
  backends: BackendsManager,
  resetAgentFn: (agent: Agent) => void,
): Promise<FallbackResult> {
  // Get next available backend
  const newBackend = getNextBackend(agent.backend, backends);

  if (!newBackend) {
    return { success: false, reason: 'No alternative backends available' };
  }

  // Inject context for new backend
  injector.injectContext(agent, 'full');

  // Switch backend
  const oldBackend = agent.backend;
  agent.backend = newBackend.name;
  agent.sessionId = newBackend.generateSessionId();
  agent.hasRun = false;
  agent.retryCount = 0;

  console.log(`  🔀 Switch ${agent.name}: ${oldBackend} → ${newBackend.name}`);

  return {
    success: true,
    strategy: 'switch',
    action: 'new_backend',
    oldBackend,
    newBackend: newBackend.name,
    contextInjected: true,
  };
}

/**
 * Get next backend in priority order
 * Skips current backend and unavailable backends
 */
export function getNextBackend(currentBackend: string, backends: BackendsManager): Backend | null {
  const priority = config.backendPriority;

  // Find backends after current in priority
  const currentIndex = priority.indexOf(currentBackend);
  const candidates = [
    ...priority.slice(currentIndex + 1),
    ...priority.slice(0, currentIndex),
  ];

  for (const name of candidates) {
    if (name === currentBackend) continue;

    const backend = backends.get(name);
    if (backend && backends.isAvailable(name)) {
      return backend;
    }
  }

  return null;
}

/**
 * Build notification message for fallback
 */
export function buildNotification(agent: Agent, result: FallbackResult, failure: FailureInput): string | null {
  const icon = injector.hasContext(agent) ? '🔄' : '⚡';

  switch (result.strategy) {
    case 'retry':
      return null;  // Silent

    case 'reset':
      return `${icon} ${agent.name} · context refreshed`;

    case 'switch':
      return `🔀 ${agent.name} → ${result.newBackend}`;

    default:
      if (!result.success) {
        return `❌ ${agent.name} · ${failure.message} — reply to retry or use /reset`;
      }
      return null;
  }
}

/**
 * Should notify user for this strategy?
 */
export function shouldNotify(strategy: string, result: FallbackResult): boolean {
  if (!result.success) {
    return config.notifications.explicit.includes('failed');
  }

  if (config.notifications.silent.includes(strategy)) {
    return false;
  }

  return config.notifications.subtle.includes(strategy) ||
         config.notifications.explicit.includes(strategy);
}

interface FallbackStatus {
  retryCount: number;
  hasContext: boolean;
  contextSummary: ReturnType<typeof injector.getContextSummary>;
}

/**
 * Get fallback status for agent
 */
export function getStatus(agent: Agent): FallbackStatus {
  return {
    retryCount: agent.retryCount || 0,
    hasContext: injector.hasContext(agent),
    contextSummary: injector.getContextSummary(agent.id),
  };
}

// Re-export sub-modules
export { config, detector, injector };
