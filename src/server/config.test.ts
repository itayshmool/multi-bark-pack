import { describe, it, expect } from 'vitest';
import { parseOwners } from './config.js';

describe('parseOwners', () => {
  it('returns null for undefined input', () => {
    expect(parseOwners(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOwners('')).toBeNull();
  });

  it('returns DANGER-ALL for "DANGER-ALL"', () => {
    expect(parseOwners('DANGER-ALL')).toBe('DANGER-ALL');
  });

  it('returns Set with single owner', () => {
    const result = parseOwners('user123');
    expect(result).toBeInstanceOf(Set);
    expect((result as Set<string>).has('user123')).toBe(true);
    expect((result as Set<string>).size).toBe(1);
  });

  it('returns Set with multiple comma-separated owners', () => {
    const result = parseOwners('user1, user2, user3');
    expect(result).toBeInstanceOf(Set);
    const set = result as Set<string>;
    expect(set.has('user1')).toBe(true);
    expect(set.has('user2')).toBe(true);
    expect(set.has('user3')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('trims whitespace from owners', () => {
    const result = parseOwners('  user1 , user2  ');
    const set = result as Set<string>;
    expect(set.has('user1')).toBe(true);
    expect(set.has('user2')).toBe(true);
  });
});
