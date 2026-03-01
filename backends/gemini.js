/**
 * Google Gemini CLI Backend
 * Implements the backend interface for Gemini CLI
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

const EXEC_OPTS = { encoding: 'utf8', timeout: 10000 };

module.exports = function createGeminiBackend(config = {}) {
    return {
        // --- Identity ---
        name: 'gemini',
        displayName: 'Gemini',

        // --- Availability ---
        async isInstalled() {
            try {
                execSync('which gemini', EXEC_OPTS);
                return true;
            } catch {
                return false;
            }
        },

        async getVersion() {
            try {
                const output = execSync('gemini --version', EXEC_OPTS);
                return output.trim();
            } catch {
                return null;
            }
        },

        // --- Models ---
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        defaultModel: 'gemini-2.5-pro',

        validateModel(model) {
            // Gemini has many models, be permissive
            return typeof model === 'string' && model.length > 0;
        },

        // --- Session Management ---
        canResume: true,

        generateSessionId() {
            // Gemini generates session_id on first run
            // We'll extract it from the init message in the output
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

            const modelFlag = model ? `-m ${model}` : '';

            // Build the shell script
            // Gemini doesn't support system prompts via CLI, prepend to prompt if needed
            let script = '#!/bin/bash\n';
            // Pass through GEMINI_API_KEY if set in server environment
            if (process.env.GEMINI_API_KEY) {
                script += `export GEMINI_API_KEY="${process.env.GEMINI_API_KEY}"\n`;
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

        extractSessionId(output) {
            // Extract session_id from first-run output
            // Look for: {"type":"init","session_id":"..."}
            try {
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.includes('"type":"init"')) {
                        const data = JSON.parse(line);
                        if (data.session_id) {
                            return data.session_id;
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
