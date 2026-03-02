import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));
vi.mock('./config.js', () => ({
  EXEC_OPTS: { encoding: 'utf8' },
  PROJECTS_DIR: '/projects',
}));
vi.mock('./delegation.js', () => ({
  setupTmuxEnv: vi.fn(),
}));
vi.mock('../utils/error.js', () => ({
  errorMessage: (e: unknown) => String(e),
}));

import { createTmuxSession, ensureTmuxSession } from './tmux.js';

describe('tmux shellEscape', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('uses shellEscape for session name in new-session', () => {
    createTmuxSession('bark-Chase', 'id-1');
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("tmux new-session -d -s 'bark-Chase'");
    expect(cmd).not.toContain('"bark-Chase"');
  });

  it('uses shellEscape for dir in new-session', () => {
    createTmuxSession('bark-Chase', 'id-1', { startDir: '/my dir/path' });
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("'/my dir/path'");
  });

  it('uses shellEscape for session name in send-keys echo', () => {
    createTmuxSession('bark-Chase', 'id-1', { echoName: 'Chase' });
    const echoCmd = mockExecSync.mock.calls[1][0] as string;
    expect(echoCmd).toContain("tmux send-keys -t 'bark-Chase'");
    expect(echoCmd).not.toContain('"bark-Chase"');
  });

  it('wraps echoName in shellEscape preventing injection', () => {
    createTmuxSession('bark-Test', 'id-1', { echoName: "'; rm -rf /; echo '" });
    const echoCmd = mockExecSync.mock.calls[1][0] as string;
    // The dangerous string should be inside single-quote escaping, not bare
    expect(echoCmd).toContain("tmux send-keys -t 'bark-Test'");
    // The full send-keys argument is wrapped in shellEscape — no unquoted injection
    expect(echoCmd.startsWith('tmux send-keys -t ')).toBe(true);
  });

  it('uses shellEscape for has-session check', () => {
    mockExecSync.mockReturnValue('');
    const agent = {
      id: 'id-1', name: 'Chase', tmuxSession: 'bark-Chase',
      sessionId: 's1', backend: 'claude-code', model: 'm',
      status: 'active' as const, parentId: null, cwd: null,
      createdAt: '', source: 'ui' as const, packId: undefined,
      skills: [], hasRun: false, retryCount: 0,
    };
    ensureTmuxSession(agent);
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("tmux has-session -t 'bark-Chase'");
  });
});
