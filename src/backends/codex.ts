/**
 * OpenAI Codex CLI Backend
 * Implements the backend interface for Codex CLI
 */

import type { Backend, BackendCapabilities, BuildCommandOpts, BuildCommandResult } from '../types/index.js';
import { isCliInstalled, getCliVersion, BACKEND_METADATA } from './shared.js';
import { sanitizePath, sanitizeModel } from './sanitize.js';

const META = BACKEND_METADATA['codex'];

export default function createCodexBackend(_config: Record<string, unknown> = {}): Backend {
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
      // Codex has many models, be permissive
      return typeof model === 'string' && model.length > 0;
    },

    // --- Session Management ---
    canResume: true,

    generateSessionId(): string {
      // Codex generates thread_id on first run, we'll extract it from output
      // For now, return empty string - the server will use the thread_id from first response
      return '';
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

      const safeModel = model && model !== 'default' ? sanitizeModel(model) : null;
      const modelFlag = safeModel ? `-m ${safeModel}` : '';
      const mcpFlag = mcpConfigFile ? `--mcp-config "${mcpConfigFile}"` : '';

      const safeCwd = cwd ? sanitizePath(cwd) : null;

      let script = '#!/bin/bash\n';
      if (safeCwd) script += `cd "${safeCwd}"\n`;

      if (isResume && sessionId) {
        // Resume existing session
        script += `cat "${promptFile}" | codex exec resume "${sessionId}" --json --dangerously-bypass-approvals-and-sandbox ${mcpFlag} ${modelFlag} - 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;
      } else {
        // New session
        script += `cat "${promptFile}" | codex exec --json --dangerously-bypass-approvals-and-sandbox ${mcpFlag} ${modelFlag} - 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;
      }

      return {
        script,
        env: {},
      };
    },

    // --- Output Parsing ---
    streamParserName: 'codex',

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
      systemPrompt: false,  // NOT SUPPORTED - server must prepend to prompt
      planning: true,
    } as BackendCapabilities,
  };
}
