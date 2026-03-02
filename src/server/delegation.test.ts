import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));
vi.mock('./state.js', () => ({
  getAgents: () => new Map(),
}));
vi.mock('./config.js', () => ({
  EXEC_OPTS: { encoding: 'utf8' },
  API_SECRET: 'test-secret-123',
  UI_PORT: 3333,
  TOOLS_DIR: '/tools',
}));

import { setupTmuxEnv } from './delegation.js';

describe('setupTmuxEnv security', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('uses tmux setenv instead of send-keys for secrets', () => {
    setupTmuxEnv('bark-Chase', 'agent-1');
    const cmds = mockExecSync.mock.calls.map((c: unknown[]) => c[0] as string);
    const sendKeysCmd = cmds.find((c: string) => c.includes('send-keys'));
    if (sendKeysCmd) {
      expect(sendKeysCmd).not.toContain('test-secret-123');
    }
    const setenvCmds = cmds.filter((c: string) => c.includes('setenv'));
    expect(setenvCmds.length).toBeGreaterThan(0);
  });

  it('uses shellEscape for session name', () => {
    setupTmuxEnv('bark-Chase', 'agent-1');
    const cmds = mockExecSync.mock.calls.map((c: unknown[]) => c[0] as string);
    for (const cmd of cmds) {
      if (cmd.includes('tmux')) {
        expect(cmd).toContain("'bark-Chase'");
      }
    }
  });

  it('does not leak API_SECRET in send-keys commands', () => {
    setupTmuxEnv('bark-Chase', 'agent-1');
    const cmds = mockExecSync.mock.calls.map((c: unknown[]) => c[0] as string);
    const sendKeys = cmds.filter((c: string) => c.includes('send-keys'));
    for (const cmd of sendKeys) {
      expect(cmd).not.toContain('test-secret-123');
    }
  });
});
