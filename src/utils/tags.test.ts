import { describe, it, expect } from 'vitest';
import { parseMessageTags } from './tags.js';

describe('parseMessageTags', () => {
  it('returns cleanBody unchanged when no tags', () => {
    const result = parseMessageTags('fix the login bug');
    expect(result.cleanBody).toBe('fix the login bug');
    expect(result.model).toBeUndefined();
    expect(result.backend).toBeUndefined();
  });

  it('extracts #haiku model tag', () => {
    const result = parseMessageTags('fix this #haiku');
    expect(result.model).toBe('haiku');
    expect(result.cleanBody).toBe('fix this');
  });

  it('extracts #sonnet model tag', () => {
    const result = parseMessageTags('#sonnet fix this');
    expect(result.model).toBe('sonnet');
    expect(result.cleanBody).toBe('fix this');
  });

  it('extracts #opus model tag', () => {
    const result = parseMessageTags('fix #opus this');
    expect(result.model).toBe('opus');
  });

  it('extracts #claude-code backend tag', () => {
    const result = parseMessageTags('fix this #claude-code');
    expect(result.backend).toBe('claude-code');
    expect(result.cleanBody).toBe('fix this');
  });

  it('extracts #cursor backend tag', () => {
    const result = parseMessageTags('#cursor fix this');
    expect(result.backend).toBe('cursor');
  });

  it('extracts #codex backend tag', () => {
    const result = parseMessageTags('fix #codex this');
    expect(result.backend).toBe('codex');
  });

  it('extracts #gemini backend tag', () => {
    const result = parseMessageTags('fix this #gemini');
    expect(result.backend).toBe('gemini');
  });

  it('extracts both model and backend from same message', () => {
    const result = parseMessageTags('#opus #cursor fix this bug');
    expect(result.model).toBe('opus');
    expect(result.backend).toBe('cursor');
    expect(result.cleanBody).toBe('fix this bug');
  });

  it('strips tags from cleanBody', () => {
    const result = parseMessageTags('do #haiku something #claude-code cool');
    expect(result.cleanBody).not.toContain('#haiku');
    expect(result.cleanBody).not.toContain('#claude-code');
  });

  it('handles case-insensitive tags', () => {
    const result = parseMessageTags('#OPUS fix this');
    expect(result.model).toBe('opus');
  });

  it('handles tags at different positions in text', () => {
    const r1 = parseMessageTags('#haiku at start');
    const r2 = parseMessageTags('in #haiku middle');
    const r3 = parseMessageTags('at end #haiku');
    expect(r1.model).toBe('haiku');
    expect(r2.model).toBe('haiku');
    expect(r3.model).toBe('haiku');
  });
});
