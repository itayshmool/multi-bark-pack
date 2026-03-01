/**
 * OpenAI Codex CLI Backend
 * Implements the backend interface for Codex CLI
 */

const { execSync } = require('child_process');

const EXEC_OPTS = { encoding: 'utf8', timeout: 10000 };

module.exports = function createCodexBackend(config = {}) {
    return {
        // --- Identity ---
        name: 'codex',
        displayName: 'Codex',

        // --- Availability ---
        async isInstalled() {
            try {
                execSync('which codex', EXEC_OPTS);
                return true;
            } catch {
                return false;
            }
        },

        async getVersion() {
            try {
                const output = execSync('codex --version', EXEC_OPTS);
                return output.trim();
            } catch {
                return null;
            }
        },

        // --- Models ---
        models: ['default', 'o3', 'o4-mini'],
        defaultModel: 'default',

        validateModel(model) {
            // Codex has many models, be permissive
            return typeof model === 'string' && model.length > 0;
        },

        // --- Session Management ---
        canResume: true,

        generateSessionId() {
            // Codex generates thread_id on first run, we'll extract it from output
            // For now, return null - the server will use the thread_id from first response
            return null;
        },

        // --- Command Building ---
        buildCommand(opts) {
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
            } = opts;

            const modelFlag = model && model !== 'default' ? `-m ${model}` : '';
            const mcpFlag = mcpConfigFile ? `--mcp-config "${mcpConfigFile}"` : '';

            // Build the shell script
            // Codex doesn't support system prompts via CLI, prepend to prompt if needed
            let script = '#!/bin/bash\n';

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

        extractSessionId(output) {
            // Extract thread_id from output
            // Look for either:
            // 1. Raw JSON: {"type":"thread.started","thread_id":"..."}
            // 2. Processed format from stream-display.js: "🧵 Session: ..."
            try {
                const lines = output.split('\n');
                for (const line of lines) {
                    // Check for processed format first (from stream-display.js)
                    if (line.includes('🧵 Session:')) {
                        const match = line.match(/🧵 Session:\s*(\S+)/);
                        if (match && match[1]) {
                            return match[1];
                        }
                    }
                    // Check for raw JSON format
                    if (line.includes('thread.started')) {
                        const data = JSON.parse(line);
                        if (data.thread_id) {
                            return data.thread_id;
                        }
                    }
                }
            } catch {}
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
        },
    };
};
