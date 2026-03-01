/**
 * Cursor CLI Backend
 * Implements the backend interface for Cursor Agent CLI
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { Backend, BackendCapabilities, BuildCommandOpts, BuildCommandResult } from '../types/index.js';
import { isCliInstalled, getCliVersion, BACKEND_EXEC_OPTS, BACKEND_METADATA } from './shared.js';
import { sanitizePath, sanitizeModel } from './sanitize.js';

const META = BACKEND_METADATA['cursor'];

export default function createCursorBackend(_config: Record<string, unknown> = {}): Backend {
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
      // Cursor has many models, be permissive
      return typeof model === 'string' && model.length > 0;
    },

    // --- Session Management ---
    canResume: true,

    generateSessionId(): string {
      // Cursor uses create-chat to generate session IDs
      try {
        const output = execSync('cursor-agent create-chat', BACKEND_EXEC_OPTS);
        return output.trim();
      } catch {
        // Fallback to UUID if create-chat fails
        return crypto.randomUUID();
      }
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

      // Cursor uses --resume for both new and continued sessions
      // For new sessions, we pre-create the chat ID with create-chat
      const resumeFlag = `--resume ${sessionId}`;

      const safeCwd = cwd ? sanitizePath(cwd) : null;

      let script = '#!/bin/bash\n';
      if (safeCwd) script += `cd "${safeCwd}"\n`;
      script += `cat "${promptFile}" | cursor-agent -p -f ${resumeFlag} ${modelFlag} ${mcpFlag} --output-format stream-json --stream-partial-output 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;

      return {
        script,
        env: {},
      };
    },

    // --- Output Parsing ---
    streamParserName: 'cursor',

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
