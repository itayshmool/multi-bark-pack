import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./shared.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    isCliInstalled: vi.fn(() => true),
    getCliVersion: vi.fn(() => '1.0.0'),
  };
});

import createGeminiBackend from './gemini.js';

describe('gemini backend', () => {
  const backend = createGeminiBackend();

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('factory', () => {
    it('returns backend with name gemini', () => {
      expect(backend.name).toBe('gemini');
    });

    it('returns backend with displayName Gemini', () => {
      expect(backend.displayName).toBe('Gemini');
    });

    it('generateSessionId returns empty string', () => {
      expect(backend.generateSessionId()).toBe('');
    });

    it('capabilities.systemPrompt is false', () => {
      expect(backend.capabilities.systemPrompt).toBe(false);
    });

    it('has correct models', () => {
      expect(backend.models).toContain('gemini-2.5-pro');
      expect(backend.models).toContain('gemini-2.5-flash');
    });
  });

  describe('buildCommand', () => {
    const baseOpts = {
      promptFile: '/tmp/test.prompt',
      sessionId: '',
      isResume: false,
      model: 'gemini-2.5-pro',
      systemPromptFile: '/tmp/test.sysprompt',
      streamParserScript: '/tmp/stream-display.js',
      agentId: 'abc123',
      tmpDir: '/tmp',
    };

    it('includes gemini CLI for new session', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('gemini');
      expect(script).not.toContain('--resume');
    });

    it('includes --resume for resumed session', () => {
      const { script } = backend.buildCommand({ ...baseOpts, isResume: true, sessionId: 'sess-456' });
      expect(script).toContain('--resume "sess-456"');
    });

    it('includes -y flag', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('-y');
    });

    it('includes --output-format stream-json', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--output-format stream-json');
    });

    it('includes cd to cwd when provided', () => {
      const { script } = backend.buildCommand({ ...baseOpts, cwd: '/projects/repo' });
      expect(script).toContain('cd "/projects/repo"');
    });

    it('includes model flag', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('-m gemini-2.5-pro');
    });

    it('exports GEMINI_API_KEY when set in env', () => {
      process.env.GEMINI_API_KEY = 'test-key-123';
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('export GEMINI_API_KEY=');
    });
  });
});
