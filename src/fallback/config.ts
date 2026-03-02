/**
 * Fallback Configuration
 */

import type { FallbackStrategy } from '../types/index.js';
import { AGENT_TIMEOUT } from '../server/config.js';
import { MAX_TURNS, SUMMARY_INTERVAL } from '../history/index.js';

export interface FallbackNotifications {
  silent: string[];
  subtle: string[];
  explicit: string[];
}

export interface FallbackRetryConfig {
  maxAttempts: number;
  backoffMs: number[];
}

export interface FallbackTimeoutConfig {
  commandMs: number;
  pollIntervalMs: number;
}

export interface FallbackHistoryConfig {
  maxTurns: number;
  summaryIntervalTurns: number;
  maxContextTokens: number;
}

export interface FallbackFullConfig {
  enabled: boolean;
  strategyOrder: string[];
  retry: FallbackRetryConfig;
  timeout: FallbackTimeoutConfig;
  backendPriority: string[];
  history: FallbackHistoryConfig;
  notifications: FallbackNotifications;
}

const config: FallbackFullConfig = {
  // Master switch
  enabled: process.env.FALLBACK_ENABLED !== 'false',

  // Strategy execution order (configurable via FALLBACK_STRATEGY_ORDER=retry,reset,switch)
  strategyOrder: (process.env.FALLBACK_STRATEGY_ORDER || 'retry,reset,switch')
    .split(',')
    .map(s => s.trim()),

  // Retry settings
  retry: {
    maxAttempts: parseInt(process.env.FALLBACK_MAX_RETRIES || '3', 10),
    backoffMs: (process.env.FALLBACK_BACKOFF_MS || '5000,15000,30000')
      .split(',')
      .map(s => parseInt(s.trim(), 10)),
  },

  // Timeout settings
  timeout: {
    commandMs: AGENT_TIMEOUT,
    pollIntervalMs: parseInt(process.env.FALLBACK_POLL_INTERVAL_MS || '2000', 10),
  },

  // Backend fallback priority
  backendPriority: (process.env.FALLBACK_BACKEND_PRIORITY || 'claude-code,cursor,codex,gemini')
    .split(',')
    .map(s => s.trim()),

  // History settings
  history: {
    maxTurns: MAX_TURNS,
    summaryIntervalTurns: SUMMARY_INTERVAL,
    maxContextTokens: parseInt(process.env.FALLBACK_MAX_CONTEXT_TOKENS || '4000', 10),
  },

  // Notification settings
  notifications: {
    silent: ['retry'],           // No notification
    subtle: ['reset', 'switch'], // Edit current message
    explicit: ['failed'],        // New message
  },
};

export default config;
