import { describe, it, expect } from 'vitest';
import { estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('rounds up (ceiling)', () => {
    expect(estimateTokens('ab')).toBe(1); // 2/4 = 0.5 -> ceil = 1
    expect(estimateTokens('abcde')).toBe(2); // 5/4 = 1.25 -> ceil = 2
  });

  it('handles long text', () => {
    const text = 'a'.repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});
