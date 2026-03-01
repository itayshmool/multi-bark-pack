import { describe, it, expect, vi } from 'vitest';

vi.mock('./shared.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    isCliInstalled: vi.fn(() => true),
    getCliVersion: vi.fn(() => '1.0.0'),
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => 'mock-session-id'),
}));

import createCursorBackend from './cursor.js';

describe('cursor backend', () => {
  const backend = createCursorBackend();

  describe('factory', () => {
    it('returns backend with name cursor', () => {
      expect(backend.name).toBe('cursor');
    });

    it('returns backend with displayName Cursor', () => {
      expect(backend.displayName).toBe('Cursor');
    });

    it('capabilities.systemPrompt is false', () => {
      expect(backend.capabilities.systemPrompt).toBe(false);
    });

    it('validateModel accepts any non-empty string', () => {
      expect(backend.validateModel('auto')).toBe(true);
      expect(backend.validateModel('any-model')).toBe(true);
      expect(backend.validateModel('')).toBe(false);
    });

    it('canResume is true', () => {
      expect(backend.canResume).toBe(true);
    });
  });

  describe('buildCommand', () => {
    const baseOpts = {
      promptFile: '/tmp/test.prompt',
      sessionId: 'cursor-sess-123',
      isResume: false,
      model: 'auto',
      systemPromptFile: '/tmp/test.sysprompt',
      streamParserScript: '/tmp/stream-display.js',
      agentId: 'abc123',
      tmpDir: '/tmp',
    };

    it('includes cursor-agent CLI', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('cursor-agent');
    });

    it('includes --resume for all sessions', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--resume cursor-sess-123');
    });

    it('includes -p -f flags', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('-p -f');
    });

    it('does not include --system-prompt args', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).not.toContain('--system-prompt');
    });

    it('includes cd to cwd when provided', () => {
      const { script } = backend.buildCommand({ ...baseOpts, cwd: '/projects/repo' });
      expect(script).toContain('cd "/projects/repo"');
    });

    it('includes --output-format stream-json', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--output-format stream-json');
    });
  });
});
