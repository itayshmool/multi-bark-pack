/**
 * Google Gemini CLI Backend
 * Implements the backend interface for Gemini CLI
 */

import type { Backend, BackendCapabilities, BuildCommandOpts, BuildCommandResult } from '../types/index.js';
import { isCliInstalled, getCliVersion, BACKEND_METADATA } from './shared.js';
import { sanitizePath, sanitizeModel } from './sanitize.js';

const META = BACKEND_METADATA['gemini'];

export default function createGeminiBackend(_config: Record<string, unknown> = {}): Backend {
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
      // Gemini has many models, be permissive
      return typeof model === 'string' && model.length > 0;
    },

    // --- Session Management ---
    canResume: true,

    generateSessionId(): string {
      // Gemini generates session_id on first run
      // We'll extract it from the init message in the output
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

      const safeModel = model ? sanitizeModel(model) : null;
      const modelFlag = safeModel ? `-m ${safeModel}` : '';

      const safeCwd = cwd ? sanitizePath(cwd) : null;

      let script = '#!/bin/bash\n';
      if (safeCwd) script += `cd "${safeCwd}"\n`;
      // Pass through GEMINI_API_KEY via single-quoted export (safe from shell expansion)
      if (process.env.GEMINI_API_KEY) {
        script += `export GEMINI_API_KEY='${process.env.GEMINI_API_KEY.replace(/'/g, "'\\''")}';\n`;
      }

      if (isResume && sessionId) {
        // Resume existing session by UUID
        // -p "" forces non-interactive mode (process stdin and exit)
        script += `cat "${promptFile}" | gemini -y -p "" --output-format stream-json --resume "${sessionId}" ${modelFlag} 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;
      } else {
        // New session
        // -p "" forces non-interactive mode (process stdin and exit)
        script += `cat "${promptFile}" | gemini -y -p "" --output-format stream-json ${modelFlag} 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;
      }

      return {
        script,
        env: {},
      };
    },

    // --- Output Parsing ---
    streamParserName: 'gemini',

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
