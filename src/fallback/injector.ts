/**
 * Context Injector
 * Builds context prompts for fallback sessions
 */

import * as historyManager from '../history/index.js';
import * as summarizer from '../history/summarizer.js';
import config from './config.js';
import type { AgentHistory, Agent, ContextPromptOptions } from '../types/index.js';

interface ContextSummary {
  hasSummary: boolean;
  summaryLength: number;
  turnCount: number;
  totalTurns: number;
  cwd: string | null;
  lastError: AgentHistory['lastError'];
}

/**
 * Build context prompt for injecting into new session
 */
export function buildContextPrompt(history: AgentHistory, options: ContextPromptOptions = {}): string {
  return summarizer.buildContextPrompt(history, options);
}

/**
 * Build minimal context when full context is too large
 */
export function buildMinimalContext(history: AgentHistory): string {
  return summarizer.buildMinimalContext(history);
}

/**
 * Inject context into agent for fallback
 * Sets agent.fallbackContext which will be prepended to next prompt
 */
export function injectContext(agent: Agent, contextType: 'full' | 'minimal' = 'full'): void {
  const history = historyManager.load(agent.id, agent.backend);

  if (history.totalTurns === 0 && !history.summary) {
    // No history to inject
    agent.fallbackContext = null;
    return;
  }

  if (contextType === 'minimal') {
    agent.fallbackContext = buildMinimalContext(history);
  } else {
    agent.fallbackContext = buildContextPrompt(history);
  }

  // Check if context is within reasonable limits
  const maxTokens = config.history.maxContextTokens;
  const tokens = summarizer.estimateTokens(agent.fallbackContext);
  if (tokens > maxTokens) {
    // Fall back to minimal context
    console.log(`  📦 Context too large (${tokens} tokens > ${maxTokens}), using minimal`);
    agent.fallbackContext = buildMinimalContext(history);
  }
}

/**
 * Get context for displaying to user (for debugging)
 */
export function getContextSummary(agentId: string): ContextSummary {
  const history = historyManager.load(agentId);
  return {
    hasSummary: !!history.summary,
    summaryLength: history.summary?.text?.length || 0,
    turnCount: history.turns.length,
    totalTurns: history.totalTurns,
    cwd: history.cwd,
    lastError: history.lastError,
  };
}

/**
 * Clear fallback context from agent
 * Call this after context has been used
 */
export function clearContext(agent: Agent): void {
  delete agent.fallbackContext;
}

/**
 * Check if agent has pending fallback context
 */
export function hasContext(agent: Agent): boolean {
  return !!agent.fallbackContext;
}
