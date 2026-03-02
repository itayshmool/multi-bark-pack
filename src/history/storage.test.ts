import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  unlinkSync: vi.fn(),
}));

vi.mock('../utils/atomic-write.js', () => ({
  atomicWriteJSON: vi.fn(() => true),
}));

import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import { load, save, remove, exists, clearCache } from './storage.js';

const AGENT_ID = 'test-agent';

describe('history storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (existsSync as any).mockReturnValue(false);
    (readFileSync as any).mockReturnValue('{}');
    (atomicWriteJSON as any).mockReturnValue(true);
    clearCache();
  });

  describe('in-memory cache', () => {
    it('reads from disk only on first load', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({
        version: 1, agentId: AGENT_ID, backend: 'claude-code',
        created: '', summary: null, turns: [], totalTurns: 0, lastError: null, cwd: null,
      }));

      load(AGENT_ID);
      load(AGENT_ID);
      load(AGENT_ID);

      expect(readFileSync).toHaveBeenCalledTimes(1);
    });

    it('serves cached data on subsequent loads', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({
        version: 1, agentId: AGENT_ID, backend: 'claude-code',
        created: '', summary: null, turns: [], totalTurns: 5, lastError: null, cwd: null,
      }));

      const first = load(AGENT_ID);
      const second = load(AGENT_ID);
      expect(second.totalTurns).toBe(5);
      expect(second).toBe(first); // same object reference
    });

    it('updates cache on save so next load skips disk', () => {
      // First load creates empty history in cache (file does not exist)
      const history = load(AGENT_ID);
      expect(history.totalTurns).toBe(0);

      // Mutate and save — should update cache
      history.totalTurns = 10;
      save(AGENT_ID, history);

      // Clear mock call counts
      vi.clearAllMocks();

      // Second load should return the cached (mutated) version without reading disk
      const cached = load(AGENT_ID);
      expect(cached.totalTurns).toBe(10);
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('evicts cache on remove', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({
        version: 1, agentId: AGENT_ID, backend: 'claude-code',
        created: '', summary: null, turns: [], totalTurns: 0, lastError: null, cwd: null,
      }));

      load(AGENT_ID);
      remove(AGENT_ID);

      // Next load should hit disk again
      load(AGENT_ID);
      expect(readFileSync).toHaveBeenCalledTimes(2);
    });

    it('clearCache forces all subsequent loads from disk', () => {
      load(AGENT_ID); // cached as empty
      clearCache();

      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({
        version: 1, agentId: AGENT_ID, backend: 'claude-code',
        created: '', summary: null, turns: [], totalTurns: 99, lastError: null, cwd: null,
      }));

      const result = load(AGENT_ID);
      expect(result.totalTurns).toBe(99);
    });
  });

  describe('exists', () => {
    it('returns true when cache has agent', () => {
      load(AGENT_ID); // loads empty into cache
      save(AGENT_ID, load(AGENT_ID)); // mark as cached+saved
      // exists should check cache first
      expect(exists(AGENT_ID)).toBe(true);
    });
  });
});
