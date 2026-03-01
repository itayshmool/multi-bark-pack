export interface UsageRecord {
  name: string;
  backend: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turns: number;
  firstSeen: string;
  lastSeen: string;
  estimated?: boolean;
}

export interface UsageTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
}

export interface UsageData {
  version: number;
  agents: Record<string, UsageRecord>;
  totals: UsageTotals;
}

export interface Pricing {
  inputPer1M: number;
  cachedInputPer1M?: number;
  outputPer1M: number;
}

