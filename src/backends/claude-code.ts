/**
 * Claude Code CLI Backend
 * Implements the backend interface for Claude Code CLI
 */

import crypto from 'node:crypto';
import type { Backend, BackendCapabilities, BuildCommandOpts, BuildCommandResult } from '../types/index.js';
import { isCliInstalled, getCliVersion, BACKEND_METADATA } from './shared.js';
import { sanitizePath, sanitizeModel } from './sanitize.js';

const META = BACKEND_METADATA['claude-code'];

export default function createClaudeCodeBackend(_config: Record<string, unknown> = {}): Backend {
  return {
    // --- Identity ---
    name: META.name,
    displayName: META.displayName,

    // --- Availability ---
    async isInstalled(): Promise<boolean> {
      return isCliInstalled(META.cli);
    },

    async getVersion(): Promise<string | null> {
      return getCliVersion(`${META.cli} --version`);
    },

    // --- Models ---
    models: META.models,
    defaultModel: META.defaultModel,

    validateModel(model: string): boolean {
      return this.models.includes(model);
    },

    // --- Session Management ---
    canResume: true,

    generateSessionId(): string {
      return crypto.randomUUID();
    },

    // --- Command Building ---
    buildCommand(opts: BuildCommandOpts): BuildCommandResult {
      const {
        promptFile,
        sessionId,
        isResume,
        model,
        systemPromptFile,
        streamParserScript,
        agentId,
        tmpDir,
        mcpConfigFile,
        cwd,
      } = opts;

      const safeModel = sanitizeModel(model || this.defaultModel) || this.defaultModel;
      const modelFlag = `--model ${safeModel}`;
      const mcpFlag = mcpConfigFile ? `--mcp-config "${mcpConfigFile}"` : '';

      // Build claude CLI arguments
      const systemPromptArg = systemPromptFile
        ? ` --system-prompt "$(cat '${systemPromptFile}')"`
        : '';
      const claudeArgs = isResume
        ? `--resume ${sessionId} ${modelFlag}${systemPromptArg}`
        : `--session-id ${sessionId} ${modelFlag}${systemPromptArg}`;

      const safeCwd = cwd ? sanitizePath(cwd) : null;

      let script = '#!/bin/bash\n';
      if (safeCwd) script += `cd "${safeCwd}"\n`;
      script += `cat "${promptFile}" | claude -p --dangerously-skip-permissions ${claudeArgs} ${mcpFlag} --output-format stream-json --verbose --include-partial-messages 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;

      return {
        script,
        env: {}, // Claude Code doesn't need special env vars (CLAUDECODE is deleted at server level)
      };
    },

    // --- Output Parsing ---
    streamParserName: 'claude',

    // --- Session ID extraction ---
    extractSessionId(_output: string): string | null {
      return null;
    },

    // --- Capabilities ---
    capabilities: {
      streaming: true,
      sessionPersistence: true,
      workingDirectory: true,
      forceMode: true,
      systemPrompt: true,
      planning: true,
    } as BackendCapabilities,
  };
}
