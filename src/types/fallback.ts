export type FailureType =
  | 'contextWindow'
  | 'rateLimit'
  | 'auth'
  | 'timeout'
  | 'serverError'
  | 'overloaded'
  | 'crash'
  | 'unknown';

export type FallbackStrategy = 'retry' | 'reset' | 'switch' | 'notify';

export interface FailureInfo {
  type: FailureType;
  recoverable: boolean;
  strategy: FallbackStrategy;
  retryable: boolean;
  backoffMultiplier?: number;
  message: string;
  matchedPattern?: string;
}

export interface FallbackResult {
  success: boolean;
  reason?: string;
  strategy?: FallbackStrategy;
  action?: string;
  notifyUser?: boolean;
  oldSessionId?: string;
  newSessionId?: string;
  oldBackend?: string;
  newBackend?: string;
  contextInjected?: boolean;
  delay?: number;
}

