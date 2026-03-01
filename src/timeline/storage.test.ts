import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAppendFile } = vi.hoisted(() => ({
  mockAppendFile: vi.fn(() => Promise.resolve()),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100 })),
}));

vi.mock('node:fs/promises', () => ({
  appendFile: mockAppendFile,
}));

vi.mock('../config/paths.js', () => ({
  TMP_DIR: '/tmp/bark',
}));

import { append, load } from './storage.js';
import type { TimelineEvent } from '../types/index.js';

const makeEvent = (type = 'spawn'): TimelineEvent => ({
  id: 'evt_test',
  type: type as any,
  agentId: 'abc',
  agentName: 'Chase',
  backend: 'claude-code',
  timestamp: new Date().toISOString(),
  message: 'test event',
  meta: null,
});

describe('timeline/storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('append (Fix #5: async instead of sync)', () => {
    it('uses async appendFile, not appendFileSync', () => {
      const event = makeEvent();
      append(event);
      expect(mockAppendFile).toHaveBeenCalledWith(
        expect.stringContaining('timeline.jsonl'),
        expect.stringContaining('"evt_test"'),
      );
    });

    it('does not block — returns immediately', () => {
      const event = makeEvent();
      append(event);
      expect(mockAppendFile).toHaveBeenCalledTimes(1);
    });

    it('handles errors gracefully via catch', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockAppendFile.mockRejectedValueOnce(new Error('disk full'));
      append(makeEvent());
      await new Promise(r => setTimeout(r, 10));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not append timeline event'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('load', () => {
    it('returns empty array when file does not exist', () => {
      const result = load();
      expect(result).toEqual([]);
    });
  });
});
