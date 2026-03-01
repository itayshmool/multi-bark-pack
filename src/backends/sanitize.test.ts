import { describe, it, expect } from 'vitest';
import { sanitizePath, sanitizeModel } from './sanitize.js';

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

  it('rejects paths with double quotes (shell escape breakout)', () => {
    expect(sanitizePath('/tmp/foo"$(whoami)"')).toBeNull();
  });

  it('rejects paths with single quotes', () => {
    expect(sanitizePath("/tmp/foo'bar")).toBeNull();
  });
});

describe('sanitizeModel for buildCommand', () => {
  it('allows simple model names', () => {
    expect(sanitizeModel('sonnet')).toBe('sonnet');
    expect(sanitizeModel('haiku')).toBe('haiku');
    expect(sanitizeModel('opus')).toBe('opus');
  });

  it('allows model names with dots, hyphens, underscores', () => {
    expect(sanitizeModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(sanitizeModel('gpt_4o')).toBe('gpt_4o');
    expect(sanitizeModel('claude-3.5-sonnet')).toBe('claude-3.5-sonnet');
  });

  it('allows model names with colons (provider:model)', () => {
    expect(sanitizeModel('anthropic:sonnet')).toBe('anthropic:sonnet');
  });

  it('rejects models with shell metacharacters', () => {
    expect(sanitizeModel('; rm -rf /')).toBeNull();
    expect(sanitizeModel('model$(whoami)')).toBeNull();
    expect(sanitizeModel('model`id`')).toBeNull();
    expect(sanitizeModel('model | cat /etc/passwd')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeModel('')).toBeNull();
  });
});
