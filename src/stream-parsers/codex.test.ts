import { describe, it, expect } from 'vitest';
import codexParser from './codex.js';

describe('codex parser', () => {
  describe('parseLine', () => {
    it('returns null for empty line', () => {
      expect(codexParser.parseLine('')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(codexParser.parseLine('not json')).toBeNull();
    });

    it('parses thread.started with thread_id', () => {
      const line = JSON.stringify({
        type: 'thread.started',
        thread_id: 'thread-abc',
      });
      const result = codexParser.parseLine(line);
      expect(result).toEqual({ type: 'init', sessionId: 'thread-abc' });
    });

    it('parses item.completed reasoning', () => {
      const line = JSON.stringify({
        type: 'item.completed',
        item: { type: 'reasoning', text: 'Let me analyze this...' },
      });
      const result = codexParser.parseLine(line);
      expect(result).toEqual({ type: 'thinking', text: 'Let me analyze this...' });
    });

    it('parses item.completed agent_message', () => {
      const line = JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Fixed the bug.' },
      });
      const result = codexParser.parseLine(line);
      expect(result).toEqual({ type: 'text', text: 'Fixed the bug.' });
    });

    it('parses item.completed command_execution', () => {
      const line = JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', command: 'npm test' },
      });
      const result = codexParser.parseLine(line);
      expect(result).toEqual({ type: 'tool', name: 'Bash', icon: '💻' });
    });

    it('parses item.started command_execution', () => {
      const line = JSON.stringify({
        type: 'item.started',
        item: { type: 'command_execution', command: 'ls -la' },
      });
      const result = codexParser.parseLine(line);
      expect(result).toEqual({ type: 'tool', name: 'Bash', icon: '💻' });
    });

    it('parses turn.completed with usage', () => {
      const line = JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 200, output_tokens: 100 },
      });
      const result = codexParser.parseLine(line);
      expect(result).toEqual({
        type: 'result',
        text: '',
        isError: false,
        usage: { input_tokens: 200, output_tokens: 100 },
      });
    });

    it('returns null for unrecognized event types', () => {
      const line = JSON.stringify({ type: 'unknown_event' });
      expect(codexParser.parseLine(line)).toBeNull();
    });
  });
});
