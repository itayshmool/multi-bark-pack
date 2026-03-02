import { describe, it, expect } from 'vitest';
import { estimateCost, PRICING } from './pricing.js';

describe('PRICING', () => {
  it('claude-code is null (reports cost directly)', () => {
    expect(PRICING['claude-code']).toBeNull();
  });

  it('cursor is null', () => {
    expect(PRICING.cursor).toBeNull();
  });

  it('codex has input and output pricing', () => {
    expect(PRICING.codex).toBeDefined();
    expect(PRICING.codex!.inputPer1M).toBeGreaterThan(0);
    expect(PRICING.codex!.outputPer1M).toBeGreaterThan(0);
  });

  it('gemini has input and output pricing', () => {
    expect(PRICING.gemini).toBeDefined();
    expect(PRICING.gemini!.inputPer1M).toBeGreaterThan(0);
    expect(PRICING.gemini!.outputPer1M).toBeGreaterThan(0);
  });
});

describe('estimateCost', () => {
  it('returns null for claude-code (no pricing table)', () => {
    expect(estimateCost('claude-code', { input_tokens: 100, output_tokens: 50 })).toBeNull();
  });

  it('returns null for cursor', () => {
    expect(estimateCost('cursor', { input_tokens: 100, output_tokens: 50 })).toBeNull();
  });

  it('returns null when usage is null/undefined', () => {
    expect(estimateCost('codex', null as any)).toBeNull();
  });

  it('calculates codex cost correctly with input/output tokens', () => {
    const result = estimateCost('codex', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(result).not.toBeNull();
    // 1M input * $2.50/M + 1M output * $10.00/M = $12.50
    expect(result!.costUsd).toBe(12.5);
  });

  it('calculates codex cost with cached input tokens', () => {
    const result = estimateCost('codex', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cached_input_tokens: 500_000,
    });
    expect(result).not.toBeNull();
    // 500K non-cached * $2.50/M + 500K cached * $1.25/M = $1.25 + $0.625 = $1.875
    expect(result!.costUsd).toBe(1.875);
  });

  it('calculates gemini cost correctly', () => {
    const result = estimateCost('gemini', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(result).not.toBeNull();
    // 1M input * $1.25/M + 1M output * $10.00/M = $11.25
    expect(result!.costUsd).toBe(11.25);
  });

  it('rounds to 4 decimal places', () => {
    const result = estimateCost('codex', { input_tokens: 1, output_tokens: 1 });
    expect(result).not.toBeNull();
    const str = result!.costUsd.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it('returns estimated: true flag', () => {
    const result = estimateCost('codex', { input_tokens: 100, output_tokens: 50 });
    expect(result!.estimated).toBe(true);
  });

  it('handles zero tokens', () => {
    const result = estimateCost('codex', { input_tokens: 0, output_tokens: 0 });
    expect(result).not.toBeNull();
    expect(result!.costUsd).toBe(0);
  });
});
