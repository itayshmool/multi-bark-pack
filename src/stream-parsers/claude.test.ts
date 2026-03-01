import { describe, it, expect } from 'vitest';
import claudeParser from './claude.js';

describe('claude parser', () => {
  describe('parseLine', () => {
    it('returns null for empty line', () => {
      expect(claudeParser.parseLine('')).toBeNull();
    });

    it('returns null for whitespace-only line', () => {
      expect(claudeParser.parseLine('   ')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(claudeParser.parseLine('not valid json')).toBeNull();
    });

    it('parses thinking_delta event', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Let me think...' },
        },
      });
      const result = claudeParser.parseLine(line);
      expect(result).toEqual({ type: 'thinking', text: 'Let me think...' });
    });

    it('parses text_delta event', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello world' },
        },
      });
      const result = claudeParser.parseLine(line);
      expect(result).toEqual({ type: 'text', text: 'Hello world' });
    });

    it('parses tool_use content_block_start', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Bash' },
        },
      });
      const result = claudeParser.parseLine(line);
      expect(result).toEqual({ type: 'tool', name: 'Bash', icon: '💻' });
    });

    it('parses thinking content_block_start', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'thinking' },
        },
      });
      const result = claudeParser.parseLine(line);
      expect(result).toEqual({ type: 'thinking_start' });
    });

    it('parses result with cost and usage', () => {
      const line = JSON.stringify({
        type: 'result',
        result: 'Task completed',
        is_error: false,
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.05,
      });
      const result = claudeParser.parseLine(line);
      expect(result).toEqual({
        type: 'result',
        text: 'Task completed',
        isError: false,
        usage: { input_tokens: 100, output_tokens: 50 },
        costUsd: 0.05,
      });
    });

    it('parses result with is_error=true', () => {
      const line = JSON.stringify({
        type: 'result',
        result: 'Error occurred',
        is_error: true,
      });
      const result = claudeParser.parseLine(line);
      expect(result?.isError).toBe(true);
    });

    it('returns null for unrecognized event types', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: { type: 'message_stop' },
      });
      expect(claudeParser.parseLine(line)).toBeNull();
    });

    it('returns correct tool icon for known tools', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Read' },
        },
      });
      const result = claudeParser.parseLine(line);
      expect(result?.icon).toBe('📖');
    });

    it('returns default icon for unknown tool name', () => {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'SomeCustomTool' },
        },
      });
      const result = claudeParser.parseLine(line);
      expect(result?.icon).toBe('🔧');
    });
  });

  describe('getToolIcon', () => {
    it('returns correct icons', () => {
      expect(claudeParser.getToolIcon('Bash')).toBe('💻');
      expect(claudeParser.getToolIcon('Read')).toBe('📖');
      expect(claudeParser.getToolIcon('Edit')).toBe('✏️');
      expect(claudeParser.getToolIcon('UnknownTool')).toBe('🔧');
    });
  });
});
