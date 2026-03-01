import { describe, it, expect } from 'vitest';
import { sanitizePath } from './sanitize.js';

describe('sanitizePath for buildCommand', () => {
  it('allows normal absolute paths', () => {
    expect(sanitizePath('/Users/guy/projects/repo')).toBe('/Users/guy/projects/repo');
  });

  it('allows paths with hyphens and underscores', () => {
    expect(sanitizePath('/tmp/my-project_v2')).toBe('/tmp/my-project_v2');
  });

  it('rejects paths with shell metacharacters', () => {
    expect(sanitizePath('/tmp/$(rm -rf /)')).toBeNull();
  });

  it('rejects paths with backticks', () => {
    expect(sanitizePath('/tmp/`whoami`')).toBeNull();
  });

  it('rejects paths with semicolons', () => {
    expect(sanitizePath('/tmp/foo; rm -rf /')).toBeNull();
  });

  it('rejects paths with pipes', () => {
    expect(sanitizePath('/tmp/foo | cat /etc/passwd')).toBeNull();
  });

  it('rejects paths with newlines', () => {
    expect(sanitizePath('/tmp/foo\nrm -rf /')).toBeNull();
  });

  it('allows paths with spaces', () => {
    expect(sanitizePath('/Users/guy/My Documents/repo')).toBe('/Users/guy/My Documents/repo');
  });

  it('allows paths with dots', () => {
    expect(sanitizePath('/Users/guy/.bark-tmp/file.txt')).toBe('/Users/guy/.bark-tmp/file.txt');
  });

  it('returns null for empty string', () => {
    expect(sanitizePath('')).toBeNull();
  });
});
