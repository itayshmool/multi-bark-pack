export interface SecurityVerdict {
  allowed: boolean;
  category: string | null;
  reason: string | null;
  latencyMs: number;
}

export interface SecurityLogEntry {
  type: 'blocked' | 'error';
  text?: string;
  category?: string;
  reason?: string;
  latencyMs?: number;
  timestamp: string;
  message?: string;
}

export interface SecurityConfig {
  enabled: boolean;
  failOpen: boolean;
}
