import { describe, it, expect } from 'vitest';
import cursorParser from './cursor.js';

describe('cursor parser', () => {
  describe('parseLine', () => {
    it('returns null for empty/whitespace line', () => {
      expect(cursorParser.parseLine('')).toBeNull();
      expect(cursorParser.parseLine('   ')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(cursorParser.parseLine('not json')).toBeNull();
    });

    it('parses thinking delta', () => {
      const line = JSON.stringify({
        type: 'thinking',
        subtype: 'delta',
        text: 'Analyzing the code...',
      });
      const result = cursorParser.parseLine(line);
      expect(result).toEqual({ type: 'thinking', text: 'Analyzing the code...' });
    });

    it('parses tool_call started with shellToolCall', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { shellToolCall: { command: 'ls' } },
      });
      const result = cursorParser.parseLine(line);
      expect(result?.type).toBe('tool');
      expect(result?.name).toBe('Bash');
      expect(result?.icon).toBe('💻');
    });

    it('parses tool_call started with readToolCall', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { readToolCall: { path: '/tmp/file' } },
      });
      const result = cursorParser.parseLine(line);
      expect(result?.name).toBe('Read');
      expect(result?.icon).toBe('📖');
    });

    it('parses tool_call started with editToolCall', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { editToolCall: { path: '/tmp/file' } },
      });
      const result = cursorParser.parseLine(line);
      expect(result?.name).toBe('Edit');
      expect(result?.icon).toBe('✏️');
    });

    it('parses tool_call with unknown *ToolCall property', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { customToolCall: {} },
      });
      const result = cursorParser.parseLine(line);
      expect(result?.name).toBe('Custom');
    });

    it('parses assistant text message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Here is the fix.' }],
        },
      });
      const result = cursorParser.parseLine(line);
      expect(result).toEqual({ type: 'text', text: 'Here is the fix.' });
    });

    it('parses result with session_id', () => {
      const line = JSON.stringify({
        type: 'result',
        result: 'Done',
        is_error: false,
        session_id: 'sess-123',
      });
      const result = cursorParser.parseLine(line);
      expect(result?.type).toBe('result');
      expect(result?.text).toBe('Done');
      expect(result?.isError).toBe(false);
      expect(result?.sessionId).toBe('sess-123');
    });

    it('parses system init event', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'init-sess-456',
      });
      const result = cursorParser.parseLine(line);
      expect(result).toEqual({ type: 'init', sessionId: 'init-sess-456' });
    });

    it('returns null for unrecognized event types', () => {
      const line = JSON.stringify({ type: 'heartbeat' });
      expect(cursorParser.parseLine(line)).toBeNull();
    });
  });
});
