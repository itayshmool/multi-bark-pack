import { describe, it, expect, vi } from 'vitest';
import {
  classifyFailure,
  isTimedOut,
  isRecoverable,
  getRecommendedStrategy,
  getFailureInfo,
  isTmuxAlive,
  FAILURE_PATTERNS,
  FAILURE_INFO,
} from './detector.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('classifyFailure', () => {
  it('returns null for exit code 0 (string)', () => {
    expect(classifyFailure('output', '0')).toBeNull();
  });

  it('returns null for exit code 0 (number)', () => {
    expect(classifyFailure('output', 0)).toBeNull();
  });

  it('returns crash for tmux dead + null exit code', () => {
    const result = classifyFailure('', null, false);
    expect(result?.type).toBe('crash');
    expect(result?.strategy).toBe('reset');
  });

  it('detects contextWindow patterns', () => {
    const result = classifyFailure('Error: context_length_exceeded', 1);
    expect(result?.type).toBe('contextWindow');
    expect(result?.strategy).toBe('reset');
    expect(result?.recoverable).toBe(true);
  });

  it('detects "maximum context length" pattern', () => {
    const result = classifyFailure('maximum context length reached', 1);
    expect(result?.type).toBe('contextWindow');
  });

  it('detects rateLimit patterns', () => {
    const result = classifyFailure('Error: rate_limit exceeded', 1);
    expect(result?.type).toBe('rateLimit');
    expect(result?.strategy).toBe('retry');
  });

  it('detects 429 rate limit', () => {
    const result = classifyFailure('HTTP 429 Too Many Requests', 1);
    expect(result?.type).toBe('rateLimit');
  });

  it('detects auth patterns', () => {
    const result = classifyFailure('Error: unauthorized access', 1);
    expect(result?.type).toBe('auth');
    expect(result?.recoverable).toBe(false);
    expect(result?.strategy).toBe('notify');
  });

  it('detects 401 auth error', () => {
    const result = classifyFailure('HTTP 401 Unauthorized', 1);
    expect(result?.type).toBe('auth');
  });

  it('detects timeout patterns', () => {
    const result = classifyFailure('request timed out after 30s', 1);
    expect(result?.type).toBe('timeout');
    expect(result?.strategy).toBe('retry');
  });

  it('detects serverError patterns', () => {
    const result = classifyFailure('HTTP 500 Internal Server Error', 1);
    expect(result?.type).toBe('serverError');
    expect(result?.strategy).toBe('switch');
  });

  it('detects 503 service unavailable', () => {
    const result = classifyFailure('503 Service Unavailable', 1);
    expect(result?.type).toBe('serverError');
  });

  it('detects overloaded patterns', () => {
    const result = classifyFailure('server overloaded, try again later', 1);
    expect(result?.type).toBe('overloaded');
    expect(result?.strategy).toBe('switch');
  });

  it('returns unknown for non-zero exit code with unrecognized output', () => {
    const result = classifyFailure('something went wrong', 1);
    expect(result?.type).toBe('unknown');
    expect(result?.strategy).toBe('retry');
  });

  it('is case-insensitive for pattern matching', () => {
    const result = classifyFailure('RATE_LIMIT exceeded', 1);
    expect(result?.type).toBe('rateLimit');
  });

  it('returns the matching pattern in matchedPattern field', () => {
    const result = classifyFailure('context_length_exceeded error', 1);
    expect(result?.matchedPattern).toBe('context_length_exceeded');
  });

  it('includes correct strategy for each failure type', () => {
    expect(classifyFailure('context window full', 1)?.strategy).toBe('reset');
    expect(classifyFailure('rate limit hit', 1)?.strategy).toBe('retry');
    expect(classifyFailure('unauthorized', 1)?.strategy).toBe('notify');
    expect(classifyFailure('request timeout', 1)?.strategy).toBe('retry');
    expect(classifyFailure('500 error', 1)?.strategy).toBe('switch');
  });

  it('all FAILURE_PATTERNS values are already lowercase (Fix #12)', () => {
    for (const [type, patterns] of Object.entries(FAILURE_PATTERNS)) {
      for (const pattern of patterns) {
        expect(pattern).toBe(pattern.toLowerCase());
      }
    }
  });
});

describe('isTimedOut', () => {
  it('returns false when within timeout', () => {
    expect(isTimedOut(Date.now() - 1000, 5000)).toBe(false);
  });

  it('returns true when past timeout', () => {
    expect(isTimedOut(Date.now() - 10000, 5000)).toBe(true);
  });

  it('returns true when exactly at timeout boundary', () => {
    const now = Date.now();
    expect(isTimedOut(now - 5001, 5000)).toBe(true);
  });
});

describe('isRecoverable', () => {
  it('returns true for contextWindow', () => {
    expect(isRecoverable('contextWindow')).toBe(true);
  });

  it('returns true for rateLimit', () => {
    expect(isRecoverable('rateLimit')).toBe(true);
  });

  it('returns false for auth', () => {
    expect(isRecoverable('auth')).toBe(false);
  });

  it('returns true for unknown failure types (default)', () => {
    expect(isRecoverable('nonexistent')).toBe(true);
  });
});

describe('getRecommendedStrategy', () => {
  it('returns reset for contextWindow', () => {
    expect(getRecommendedStrategy('contextWindow')).toBe('reset');
  });

  it('returns retry for rateLimit', () => {
    expect(getRecommendedStrategy('rateLimit')).toBe('retry');
  });

  it('returns notify for auth', () => {
    expect(getRecommendedStrategy('auth')).toBe('notify');
  });

  it('returns switch for serverError', () => {
    expect(getRecommendedStrategy('serverError')).toBe('switch');
  });

  it('returns retry for unknown types (default)', () => {
    expect(getRecommendedStrategy('nonexistent')).toBe('retry');
  });
});

describe('getFailureInfo', () => {
  it('returns correct info for known types', () => {
    const info = getFailureInfo('rateLimit');
    expect(info.strategy).toBe('retry');
    expect(info.retryable).toBe(true);
    expect(info.backoffMultiplier).toBe(2);
  });

  it('returns unknown info as fallback', () => {
    const info = getFailureInfo('nonexistent');
    expect(info.strategy).toBe('retry');
    expect(info.message).toBe('Unknown error');
  });
});
