import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '0'),
}));

vi.mock('./state.js', () => ({
  getAgents: vi.fn(() => new Map()),
  getAdapters: vi.fn(() => []),
  getStatusMsgs: vi.fn(() => ({})),
  setStatusMsg: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock('../utils/agent-files.js', () => ({
  getAgentFiles: vi.fn((id: string) => ({
    running: `/tmp/${id}.running`,
    done: `/tmp/${id}.done`,
    progress: `/tmp/${id}.progress`,
  })),
}));

vi.mock('./config.js', () => ({
  EXEC_OPTS: { encoding: 'utf8', timeout: 5000 },
  DEFAULT_BACKEND: 'claude-code',
}));

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getAgents } from './state.js';
import { classifyAgents, timeSince, _resetTmuxCache } from './status.js';

describe('status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetTmuxCache();
  });

  describe('tmux session cache', () => {
    it('calls tmux ls only once for multiple classifyAgents calls within TTL', () => {
      (execSync as any).mockReturnValue('bark-Chase\nbark-Marshall\n');
      (getAgents as any).mockReturnValue(new Map());

      classifyAgents();
      classifyAgents();
      classifyAgents();

      const tmuxCalls = (execSync as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('tmux ls'),
      );
      expect(tmuxCalls).toHaveLength(1);
    });

    it('refreshes cache after TTL expires', () => {
      (execSync as any).mockReturnValue('bark-Chase\n');
      (getAgents as any).mockReturnValue(new Map());

      classifyAgents();
      _resetTmuxCache(); // simulate TTL expiry
      classifyAgents();

      const tmuxCalls = (execSync as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('tmux ls'),
      );
      expect(tmuxCalls).toHaveLength(2);
    });

    it('correctly classifies running agents', () => {
      (execSync as any).mockReturnValue('bark-Chase\n');
      const agent = {
        id: 'abc', name: 'Chase', tmuxSession: 'bark-Chase',
        backend: 'claude-code', model: 'sonnet', status: 'active',
      };
      (getAgents as any).mockReturnValue(new Map([['abc', agent]]));
      (existsSync as any).mockImplementation((p: string) =>
        p.includes('.running'),
      );

      const result = classifyAgents();
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('run');
    });
  });

  describe('timeSince', () => {
    it('returns seconds for recent dates', () => {
      const recent = new Date(Date.now() - 30000);
      expect(timeSince(recent)).toBe('30s ago');
    });

    it('returns minutes for older dates', () => {
      const fiveMinAgo = new Date(Date.now() - 300000);
      expect(timeSince(fiveMinAgo)).toBe('5m ago');
    });
  });

  describe('updatePinnedStatus (Fix #10: parallel adapter updates)', () => {
    it('calls adapters in parallel via Promise.all', async () => {
      const { updatePinnedStatus } = await import('./status.js');
      const { getAdapters, getStatusMsgs } = await import('./state.js');

      const callOrder: string[] = [];
      const adapter1 = {
        name: 'slack',
        isReady: () => true,
        edit: vi.fn(async () => { callOrder.push('slack-edit'); return true; }),
        send: vi.fn(async () => null),
        pin: vi.fn(async () => {}),
      };
      const adapter2 = {
        name: 'telegram',
        isReady: () => true,
        edit: vi.fn(async () => { callOrder.push('tg-edit'); return true; }),
        send: vi.fn(async () => null),
        pin: vi.fn(async () => {}),
      };

      (getAdapters as any).mockReturnValue([adapter1, adapter2]);
      (getStatusMsgs as any).mockReturnValue({ slack: 'msg1', telegram: 'msg2' });

      await updatePinnedStatus();

      expect(adapter1.edit).toHaveBeenCalled();
      expect(adapter2.edit).toHaveBeenCalled();
    });
  });
});
