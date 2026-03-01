/**
 * Failure Detector
 * Classifies agent failures for fallback decisions
 */

import { execSync } from 'node:child_process';
import { shellEscape } from '../utils/shell.js';
import type { FailureType, FallbackStrategy, FailureInfo } from '../types/index.js';

/**
 * Failure patterns to detect in output
 */
export const FAILURE_PATTERNS: Record<string, string[]> = {
  contextWindow: [
    'context_length_exceeded',
    'maximum context length',
    'context window',
    'token limit exceeded',
    'prompt is too long',
    'input too long',
    'exceeds the model',
  ],
  rateLimit: [
    'rate_limit',
    'rate limit exceeded',
    'too many requests',
    'rate-limit',
    '429',
    'throttl',
    'quota exceeded',
  ],
  auth: [
    'authentication',
    'unauthorized',
    'invalid api key',
    'api key',
    '401',
    'forbidden',
    '403',
  ],
  timeout: [
    'timeout',
    'timed out',
    'deadline exceeded',
    'request timeout',
  ],
  serverError: [
    '500',
    '502',
    '503',
    '504',
    'internal server error',
    'service unavailable',
    'bad gateway',
  ],
  overloaded: [
    'overloaded',
    'capacity',
    'try again later',
    'server busy',
  ],
};

interface FailureInfoEntry {
  recoverable: boolean;
  strategy: FallbackStrategy;
  retryable: boolean;
  backoffMultiplier?: number;
  message: string;
}

/**
 * Failure type metadata
 */
export const FAILURE_INFO: Record<string, FailureInfoEntry> = {
  contextWindow: {
    recoverable: true,
    strategy: 'reset',  // Need new session with compressed context
    retryable: false,
    message: 'Context window full',
  },
  rateLimit: {
    recoverable: true,
    strategy: 'retry',  // Wait and retry
    retryable: true,
    backoffMultiplier: 2,
    message: 'Rate limited',
  },
  auth: {
    recoverable: false,
    strategy: 'notify',  // Can't recover without user intervention
    retryable: false,
    message: 'Authentication error',
  },
  timeout: {
    recoverable: true,
    strategy: 'retry',
    retryable: true,
    message: 'Request timed out',
  },
  serverError: {
    recoverable: true,
    strategy: 'switch',  // Try different backend
    retryable: true,
    message: 'Server error',
  },
  overloaded: {
    recoverable: true,
    strategy: 'switch',  // Try different backend
    retryable: true,
    backoffMultiplier: 3,
    message: 'Server overloaded',
  },
  crash: {
    recoverable: true,
    strategy: 'reset',  // Restart with context
    retryable: false,
    message: 'Agent crashed',
  },
  unknown: {
    recoverable: true,
    strategy: 'retry',  // Try once more
    retryable: true,
    message: 'Unknown error',
  },
};

interface ClassifiedFailure extends FailureInfoEntry {
  type: string;
  matchedPattern?: string;
}

/**
 * Classify failure from output and status
 */
export function classifyFailure(output: string, exitCode: string | number | null, tmuxAlive: boolean = true): ClassifiedFailure | null {
  // No failure if exit code is 0
  if (exitCode === '0' || exitCode === 0) {
    return null;
  }

  // Crash detection - tmux died without completing
  if (!tmuxAlive && exitCode === null) {
    return {
      type: 'crash',
      ...FAILURE_INFO.crash,
    };
  }

  // Parse output for known patterns
  if (output) {
    const outputLower = output.toLowerCase();

    for (const [type, patterns] of Object.entries(FAILURE_PATTERNS)) {
      for (const pattern of patterns) {
        if (outputLower.includes(pattern)) {
          return {
            type,
            ...FAILURE_INFO[type],
            matchedPattern: pattern,
          };
        }
      }
    }
  }

  // Unknown failure
  return {
    type: 'unknown',
    ...FAILURE_INFO.unknown,
  };
}

/**
 * Check if tmux session is alive
 */
export function isTmuxAlive(tmuxSession: string): boolean {
  try {
    execSync(`tmux has-session -t ${shellEscape(tmuxSession)} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect timeout condition
 */
export function isTimedOut(startTime: number, timeoutMs: number): boolean {
  return Date.now() - startTime > timeoutMs;
}

/**
 * Get recommended strategy for failure type
 */
export function getRecommendedStrategy(failureType: string): FallbackStrategy {
  return FAILURE_INFO[failureType]?.strategy || 'retry';
}

/**
 * Check if failure is recoverable
 */
export function isRecoverable(failureType: string): boolean {
  return FAILURE_INFO[failureType]?.recoverable ?? true;
}

/**
 * Get failure info
 */
export function getFailureInfo(failureType: string): FailureInfoEntry {
  return FAILURE_INFO[failureType] || FAILURE_INFO.unknown;
}
