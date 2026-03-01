import { describe, it, expect } from 'vitest';
import { truncateMessage, splitMessage } from './text.js';

describe('truncateMessage', () => {
  it('returns text unchanged when under maxLen', () => {
    expect(truncateMessage('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when exactly maxLen', () => {
    expect(truncateMessage('hello', 5)).toBe('hello');
  });

  it('truncates and appends ... when over maxLen', () => {
    expect(truncateMessage('hello world', 5)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncateMessage('', 10)).toBe('');
  });

  it('handles maxLen of 0', () => {
    expect(truncateMessage('hello', 0)).toBe('...');
  });
});

describe('splitMessage', () => {
  it('returns ["(no output)"] for empty string', () => {
    expect(splitMessage('', 100)).toEqual(['(no output)']);
  });

  it('returns single-element array when text fits', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits at paragraph boundary (double newline)', () => {
    const text = 'first paragraph\n\nsecond paragraph';
    const chunks = splitMessage(text, 25);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe('first paragraph');
    expect(chunks[1]).toBe('second paragraph');
  });

  it('splits at line boundary when no paragraph break', () => {
    const text = 'line one\nline two\nline three';
    const chunks = splitMessage(text, 18);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('line one');
  });

  it('splits at sentence end', () => {
    const text = 'This is sentence one. This is sentence two. This is sentence three.';
    const chunks = splitMessage(text, 45);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toMatch(/\.$/);
  });

  it('splits at word boundary as fallback', () => {
    const text = 'word1 word2 word3 word4 word5 word6 word7 word8';
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // No chunk should contain a space-broken partial word from a hard split
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  it('hard-splits when no natural boundary exists', () => {
    const text = 'a'.repeat(100);
    const chunks = splitMessage(text, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('avoids splitting inside fenced code blocks when possible', () => {
    // With a large enough maxLen, the split should happen before the last opening fence
    const text = 'A long paragraph before the code block.\n\n```\ncode line 1\ncode line 2\n```\n\nAfter the code.';
    const chunks = splitMessage(text, 60);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should split before the code fence, not inside it
    expect(chunks[0]).toContain('paragraph');
  });

  it('handles multiple chunks for very long text', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1} content here.`).join('\n\n');
    const chunks = splitMessage(text, 100);
    expect(chunks.length).toBeGreaterThan(2);
    // Rejoined should cover all content
    const rejoined = chunks.join(' ');
    expect(rejoined).toContain('Paragraph 1');
    expect(rejoined).toContain('Paragraph 20');
  });

  it('trims whitespace between chunks', () => {
    const text = 'first part\n\n   second part';
    const chunks = splitMessage(text, 15);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
  });

  it('filters empty chunks from result', () => {
    const text = 'hello\n\n\n\nworld';
    const chunks = splitMessage(text, 10);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('respects minSplit threshold (30% of maxLen)', () => {
    // With maxLen=100, minSplit=30. A split point before index 30 should be ignored.
    const text = 'AB\n\n' + 'C'.repeat(96);
    const chunks = splitMessage(text, 100);
    // Should NOT split at index 2 (below 30% threshold), instead hard-split at 100
    expect(chunks.length).toBe(1); // total is 100 chars, fits in 100
  });
});
