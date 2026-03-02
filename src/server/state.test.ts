import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

vi.mock('../utils/atomic-write.js', () => ({
  atomicWriteJSON: vi.fn(() => true),
}));

import { atomicWriteJSON } from '../utils/atomic-write.js';
import { readdirSync } from 'node:fs';
import {
  getAgents,
  setAgent,
  deleteAgent,
  getAgentByName,
  getMsgAgent,
  setMsgAgent,
  genId,
  saveState,
  saveStateNow,
  isShuttingDown,
  setShuttingDown,
  getAllAgentsWithStatus,
} from './state.js';

describe('state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('saveState debounce', () => {
    it('does not write to disk immediately', () => {
      saveState();
      expect(atomicWriteJSON).not.toHaveBeenCalled();
    });

    it('writes to disk after debounce interval', () => {
      saveState();
      vi.advanceTimersByTime(600);
      expect(atomicWriteJSON).toHaveBeenCalled();
    });

    it('coalesces multiple rapid calls into one write', () => {
      saveState();
      saveState();
      saveState();
      vi.advanceTimersByTime(600);
      // 3 files per flush: agents.json, routing.json, status.json
      const callCount = (atomicWriteJSON as any).mock.calls.length;
      expect(callCount).toBe(3);
    });

    it('resets debounce timer on subsequent calls', () => {
      saveState();
      vi.advanceTimersByTime(300);
      saveState(); // restart the timer
      vi.advanceTimersByTime(300);
      expect(atomicWriteJSON).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(atomicWriteJSON).toHaveBeenCalled();
    });
  });

  describe('saveStateNow', () => {
    it('writes to disk immediately', () => {
      saveStateNow();
      expect(atomicWriteJSON).toHaveBeenCalled();
    });

    it('cancels pending debounced save', () => {
      saveState(); // schedule debounced
      saveStateNow(); // flush immediately
      const callCountAfterNow = (atomicWriteJSON as any).mock.calls.length;
      vi.advanceTimersByTime(600);
      // No additional writes after the timer fires
      expect((atomicWriteJSON as any).mock.calls.length).toBe(callCountAfterNow);
    });
  });

  describe('saveState uses atomicWriteJSON', () => {
    it('persists retryCount for agents', () => {
      const agent = { id: 'r1', name: 'Retry', backend: 'claude-code', retryCount: 3, status: 'active' } as any;
      setAgent('r1', agent);
      saveStateNow();

      const agentsCall = (atomicWriteJSON as any).mock.calls.find(
        (c: any[]) => typeof c[2] === 'string' && c[2] === 'agents',
      );
      expect(agentsCall).toBeDefined();
      const saved = agentsCall[1] as Record<string, any>;
      expect(saved['r1'].retryCount).toBe(3);
    });
  });

  describe('genId', () => {
    it('returns a 6-char hex string', () => {
      const id = genId();
      expect(id).toMatch(/^[0-9a-f]{6}$/);
    });
  });

  describe('getAllAgentsWithStatus', () => {
    it('uses single readdirSync instead of per-agent existsSync', () => {
      const a1 = { id: 'aaa', name: 'Chase', backend: 'claude-code', status: 'active' } as any;
      const a2 = { id: 'bbb', name: 'Marshall', backend: 'claude-code', status: 'active' } as any;
      setAgent('aaa', a1);
      setAgent('bbb', a2);
      (readdirSync as any).mockReturnValue(['aaa.running']);

      const result = getAllAgentsWithStatus();
      expect(readdirSync).toHaveBeenCalled();
      const running = result.filter(a => a.isRunning);
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('aaa');
    });
  });

  describe('name index (getAgentByName)', () => {
    it('returns agent by lowercase name after setAgent', () => {
      const agent = { id: 'abc', name: 'Chase', backend: 'claude-code' } as any;
      setAgent('abc', agent);
      expect(getAgentByName('chase')).toBe(agent);
      expect(getAgentByName('Chase')).toBe(agent);
    });

    it('returns undefined for unknown name', () => {
      expect(getAgentByName('unknown')).toBeUndefined();
    });

    it('removes from index on deleteAgent', () => {
      const agent = { id: 'def', name: 'Marshall', backend: 'claude-code' } as any;
      setAgent('def', agent);
      expect(getAgentByName('marshall')).toBe(agent);

      deleteAgent('def');
      expect(getAgentByName('marshall')).toBeUndefined();
    });
  });
});
