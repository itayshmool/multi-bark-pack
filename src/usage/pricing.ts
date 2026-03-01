/**
 * Cost Estimation
 * Estimates USD cost from token counts when backends don't report cost directly.
 * Claude Code reports cost natively — this is for Codex and Gemini.
 *
 * Pricing is approximate and may drift from actual provider pricing.
 * Update the tables below when providers change rates.
 */

import type { Pricing } from '../types/index.js';

// Pricing per 1M tokens (USD)
export const PRICING: Record<string, Pricing | null> = {
  'claude-code': null, // Reports cost directly via total_cost_usd
  cursor: null,        // No token data available
  codex: {
    inputPer1M: 2.50,
    cachedInputPer1M: 1.25,
    outputPer1M: 10.00,
  },
  gemini: {
    inputPer1M: 1.25,
    outputPer1M: 10.00,
  },
};

interface EstimateResult {
  costUsd: number;
  estimated: true;
}

interface UsageTokens {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
}

/**
 * Estimate cost in USD from token counts
 */
export function estimateCost(backend: string, usage: UsageTokens): EstimateResult | null {
  const pricing = PRICING[backend];
  if (!pricing || !usage) return null;

  const input = usage.input_tokens || 0;
  const cached = usage.cached_input_tokens || 0;
  const output = usage.output_tokens || 0;

  // Cached tokens are cheaper (Codex reports them separately)
  const nonCachedInput = Math.max(0, input - cached);

  let cost = 0;
  cost += (nonCachedInput / 1_000_000) * pricing.inputPer1M;
  if (pricing.cachedInputPer1M && cached > 0) {
    cost += (cached / 1_000_000) * pricing.cachedInputPer1M;
  }
  cost += (output / 1_000_000) * pricing.outputPer1M;

  return { costUsd: Math.round(cost * 10000) / 10000, estimated: true };
}
