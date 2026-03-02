import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentHistory, HistoryTurn } from '../types/index.js';

const mockHistory = (): AgentHistory => ({
  version: 1,
  agentId: 'test-agent',
  backend: 'claude-code',
  created: '2025-01-01T00:00:00.000Z',
  summary: null,
  turns: [],
  totalTurns: 0,
  lastError: null,
  cwd: null,
});

vi.mock('./storage.js', () => ({
  load: vi.fn(() => mockHistory()),
  save: vi.fn(),
  remove: vi.fn(() => true),
  exists: vi.fn(() => false),
}));

import * as storage from './storage.js';
import {
  addUserTurn,
  addAssistantTurn,
  shouldGenerateSummary,
  extractToolsFromOutput,
  getContext,
  updateSummary,
  recordError,
  load,
  clear,
} from './index.js';

describe('history manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storage.load as any).mockImplementation(() => mockHistory());
  });

  describe('addUserTurn', () => {
    it('adds turn with role user', () => {
      const result = addUserTurn('test-agent', 'fix the bug');
      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].role).toBe('user');
      expect(result.turns[0].content).toBe('fix the bug');
    });

    it('increments totalTurns', () => {
      const result = addUserTurn('test-agent', 'hello');
      expect(result.totalTurns).toBe(1);
    });

    it('truncates long content', () => {
      const longContent = 'a'.repeat(3000);
      const result = addUserTurn('test-agent', longContent);
      expect(result.turns[0].content.length).toBeLessThan(3000);
      expect(result.turns[0].content).toContain('... [truncated]');
    });

    it('includes attached files', () => {
      const result = addUserTurn('test-agent', 'check this', [{ filename: 'img.png', filepath: '/tmp/img.png', type: 'image' }]);
      expect(result.turns[0].files).toHaveLength(1);
      expect(result.turns[0].files![0].filepath).toBe('/tmp/img.png');
    });

    it('caps turns array at MAX_TURNS', () => {
      const history = mockHistory();
      // Pre-fill with 10 turns
      for (let i = 0; i < 10; i++) {
        history.turns.push({ id: i + 1, timestamp: '', role: 'user' as const, content: `msg ${i}` });
      }
      history.totalTurns = 10;
      (storage.load as any).mockReturnValue(history);

      const result = addUserTurn('test-agent', 'new message');
      expect(result.turns.length).toBeLessThanOrEqual(10);
      expect(result.totalTurns).toBe(11);
    });

    it('saves to storage after update', () => {
      addUserTurn('test-agent', 'hello');
      expect(storage.save).toHaveBeenCalledWith('test-agent', expect.any(Object));
    });
  });

  describe('addAssistantTurn', () => {
    it('adds turn with role assistant', () => {
      const { history } = addAssistantTurn('test-agent', 'I fixed it');
      expect(history.turns).toHaveLength(1);
      expect(history.turns[0].role).toBe('assistant');
    });

    it('includes tools and filesModified', () => {
      const { history } = addAssistantTurn('test-agent', 'done', {
        tools: ['Bash', 'Read'],
        filesModified: ['src/index.ts'],
      });
      expect(history.turns[0].tools).toEqual(['Bash', 'Read']);
      expect(history.turns[0].filesModified).toEqual(['src/index.ts']);
    });

    it('includes exitCode', () => {
      const { history } = addAssistantTurn('test-agent', 'done', { exitCode: 0 });
      expect(history.turns[0].exitCode).toBe(0);
    });

    it('updates cwd when provided', () => {
      const { history } = addAssistantTurn('test-agent', 'done', { cwd: '/projects/repo' });
      expect(history.cwd).toBe('/projects/repo');
    });

    it('clears lastError on exitCode 0', () => {
      const h = mockHistory();
      (h as AgentHistory).lastError = { type: 'timeout', message: 'timed out', timestamp: '' };
      (storage.load as any).mockReturnValue(h);

      const { history } = addAssistantTurn('test-agent', 'done', { exitCode: 0 });
      expect(history.lastError).toBeNull();
    });

    it('returns needsSummary=true when threshold reached', () => {
      const h = mockHistory();
      h.totalTurns = 4; // will become 5 after adding
      (storage.load as any).mockReturnValue(h);

      const { needsSummary } = addAssistantTurn('test-agent', 'done');
      expect(needsSummary).toBe(true);
    });

    it('returns needsSummary=false below threshold', () => {
      const h = mockHistory();
      h.totalTurns = 2; // will become 3
      (storage.load as any).mockReturnValue(h);

      const { needsSummary } = addAssistantTurn('test-agent', 'done');
      expect(needsSummary).toBe(false);
    });

    it('caps turns at MAX_TURNS', () => {
      const h = mockHistory();
      for (let i = 0; i < 10; i++) {
        h.turns.push({ id: i + 1, timestamp: '', role: 'assistant' as const, content: `r ${i}` });
      }
      h.totalTurns = 10;
      (storage.load as any).mockReturnValue(h);

      const { history } = addAssistantTurn('test-agent', 'new response');
      expect(history.turns.length).toBeLessThanOrEqual(10);
    });
  });

  describe('shouldGenerateSummary', () => {
    it('returns true when no summary and turns >= SUMMARY_INTERVAL', () => {
      const h = mockHistory();
      h.totalTurns = 5;
      expect(shouldGenerateSummary(h)).toBe(true);
    });

    it('returns false when no summary and turns < SUMMARY_INTERVAL', () => {
      const h = mockHistory();
      h.totalTurns = 3;
      expect(shouldGenerateSummary(h)).toBe(false);
    });

    it('returns true when turns since last summary >= SUMMARY_INTERVAL', () => {
      const h = mockHistory();
      h.totalTurns = 10;
      (h as AgentHistory).summary = { text: 'Summary', updatedAt: '', turnsCovered: 5 };
      expect(shouldGenerateSummary(h)).toBe(true);
    });

    it('returns false when turns since last summary < SUMMARY_INTERVAL', () => {
      const h = mockHistory();
      h.totalTurns = 7;
      (h as AgentHistory).summary = { text: 'Summary', updatedAt: '', turnsCovered: 5 };
      expect(shouldGenerateSummary(h)).toBe(false);
    });
  });

  describe('extractToolsFromOutput', () => {
    it('extracts tool from output containing icon + name', () => {
      const output = '💻 Bash: running npm test';
      const tools = extractToolsFromOutput(output);
      expect(tools).toContain('Bash');
    });

    it('extracts multiple tools', () => {
      const output = '📖 Read file.ts\n✏️ Edit file.ts\n💻 Bash npm test';
      const tools = extractToolsFromOutput(output);
      expect(tools).toContain('Read');
      expect(tools).toContain('Edit');
      expect(tools).toContain('Bash');
    });

    it('returns empty array when no tools found', () => {
      const tools = extractToolsFromOutput('Just regular text output');
      expect(tools).toEqual([]);
    });
  });

  describe('getContext', () => {
    it('returns summary text', () => {
      const h = mockHistory();
      (h as AgentHistory).summary = { text: 'We worked on login', updatedAt: '', turnsCovered: 5 };
      (storage.load as any).mockReturnValue(h);

      const ctx = getContext('test-agent');
      expect(ctx.summary).toBe('We worked on login');
    });

    it('returns recent turns (last 5)', () => {
      const h = mockHistory();
      for (let i = 0; i < 8; i++) {
        h.turns.push({ id: i + 1, timestamp: '', role: 'user' as const, content: `msg ${i}` });
      }
      (storage.load as any).mockReturnValue(h);

      const ctx = getContext('test-agent');
      expect(ctx.recentTurns).toHaveLength(5);
    });

    it('returns unique files modified', () => {
      const h = mockHistory();
      h.turns.push({ id: 1, timestamp: '', role: 'assistant' as const, content: 'done', filesModified: ['a.ts', 'b.ts'] });
      h.turns.push({ id: 2, timestamp: '', role: 'assistant' as const, content: 'done', filesModified: ['b.ts', 'c.ts'] });
      (storage.load as any).mockReturnValue(h);

      const ctx = getContext('test-agent');
      expect(ctx.filesModified).toEqual(expect.arrayContaining(['a.ts', 'b.ts', 'c.ts']));
      expect(ctx.filesModified).toHaveLength(3);
    });
  });

  describe('updateSummary', () => {
    it('sets summary text and turnsCovered', () => {
      const h = mockHistory();
      h.totalTurns = 8;
      (storage.load as any).mockReturnValue(h);

      const result = updateSummary('test-agent', 'We fixed the login bug');
      expect(result.summary?.text).toBe('We fixed the login bug');
      expect(result.summary?.turnsCovered).toBe(8);
    });
  });

  describe('recordError', () => {
    it('sets lastError with type, message, timestamp', () => {
      const result = recordError('test-agent', 'timeout', 'Request timed out');
      expect(result.lastError?.type).toBe('timeout');
      expect(result.lastError?.message).toBe('Request timed out');
      expect(result.lastError?.timestamp).toBeDefined();
    });
  });
});
