import { describe, it, expect, vi } from 'vitest';

vi.mock('./shared.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    isCliInstalled: vi.fn(() => true),
    getCliVersion: vi.fn(() => '1.0.0'),
  };
});

import createCodexBackend from './codex.js';

describe('codex backend', () => {
  const backend = createCodexBackend();

  describe('factory', () => {
    it('returns backend with name codex', () => {
      expect(backend.name).toBe('codex');
    });

    it('returns backend with displayName Codex', () => {
      expect(backend.displayName).toBe('Codex');
    });

    it('generateSessionId returns empty string', () => {
      expect(backend.generateSessionId()).toBe('');
    });

    it('capabilities.systemPrompt is false', () => {
      expect(backend.capabilities.systemPrompt).toBe(false);
    });

    it('validateModel accepts any non-empty string', () => {
      expect(backend.validateModel('default')).toBe(true);
      expect(backend.validateModel('')).toBe(false);
    });
  });

  describe('buildCommand', () => {
    const baseOpts = {
      promptFile: '/tmp/test.prompt',
      sessionId: '',
      isResume: false,
      model: 'default',
      systemPromptFile: '/tmp/test.sysprompt',
      streamParserScript: '/tmp/stream-display.js',
      agentId: 'abc123',
      tmpDir: '/tmp',
    };

    it('includes codex exec for new session', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('codex exec');
      expect(script).not.toContain('resume');
    });

    it('includes codex exec resume for resumed session', () => {
      const { script } = backend.buildCommand({ ...baseOpts, isResume: true, sessionId: 'thread-123' });
      expect(script).toContain('codex exec resume "thread-123"');
    });

    it('includes --json flag', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--json');
    });

    it('includes --dangerously-bypass-approvals-and-sandbox', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('includes cd to cwd when provided', () => {
      const { script } = backend.buildCommand({ ...baseOpts, cwd: '/projects/repo' });
      expect(script).toContain('cd "/projects/repo"');
    });

    it('does not include model flag for "default" model', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).not.toContain('-m default');
    });

    it('includes model flag for non-default model', () => {
      const { script } = backend.buildCommand({ ...baseOpts, model: 'o3' });
      expect(script).toContain('-m o3');
    });
  });
});
