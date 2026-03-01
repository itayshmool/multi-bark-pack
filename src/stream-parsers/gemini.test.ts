import { describe, it, expect } from 'vitest';
import geminiParser from './gemini.js';

describe('gemini parser', () => {
  describe('parseLine', () => {
    it('returns null for empty line', () => {
      expect(geminiParser.parseLine('')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(geminiParser.parseLine('bad json')).toBeNull();
    });

    it('parses init with session_id', () => {
      const line = JSON.stringify({
        type: 'init',
        session_id: 'gemini-sess-123',
        model: 'gemini-2.5-pro',
      });
      const result = geminiParser.parseLine(line);
      expect(result).toEqual({ type: 'init', sessionId: 'gemini-sess-123' });
    });

    it('skips user message echo (returns null)', () => {
      const line = JSON.stringify({
        type: 'message',
        role: 'user',
        content: 'fix the bug',
      });
      expect(geminiParser.parseLine(line)).toBeNull();
    });

    it('parses assistant message with content', () => {
      const line = JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: 'I found the issue.',
      });
      const result = geminiParser.parseLine(line);
      expect(result).toEqual({ type: 'text', text: 'I found the issue.' });
    });

    it('parses tool_use event', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 'tool-1',
      });
      const result = geminiParser.parseLine(line);
      expect(result?.type).toBe('tool');
      expect(result?.name).toBe('read_file');
      expect(result?.icon).toBe('📖');
    });

    it('parses tool_result success', () => {
      const line = JSON.stringify({
        type: 'tool_result',
        status: 'success',
        output: 'file contents here',
      });
      const result = geminiParser.parseLine(line);
      expect(result?.type).toBe('result');
      expect(result?.text).toBe('file contents here');
      expect(result?.isError).toBe(false);
    });

    it('parses tool_result failure', () => {
      const line = JSON.stringify({
        type: 'tool_result',
        status: 'error',
        output: 'file not found',
      });
      const result = geminiParser.parseLine(line);
      expect(result?.isError).toBe(true);
    });

    it('parses final result', () => {
      const line = JSON.stringify({
        type: 'result',
        status: 'success',
      });
      const result = geminiParser.parseLine(line);
      expect(result).toEqual({ type: 'result', text: '', isError: false });
    });

    it('returns null for unrecognized event types', () => {
      const line = JSON.stringify({ type: 'ping' });
      expect(geminiParser.parseLine(line)).toBeNull();
    });
  });
});
