/**
 * Cursor CLI Backend
 * Implements the backend interface for Cursor Agent CLI
 */

const { execSync } = require('child_process');

const EXEC_OPTS = { encoding: 'utf8', timeout: 10000 };

module.exports = function createCursorBackend(config = {}) {
    return {
        // --- Identity ---
        name: 'cursor',
        displayName: 'Cursor',

        // --- Availability ---
        async isInstalled() {
            try {
                execSync('which cursor-agent', EXEC_OPTS);
                return true;
            } catch {
                return false;
            }
        },

        async getVersion() {
            try {
                const output = execSync('cursor-agent --version', EXEC_OPTS);
                return output.trim();
            } catch {
                return null;
            }
        },

        // --- Models ---
        models: ['auto', 'opus-4.6-thinking', 'opus-4.5', 'sonnet-4.5', 'sonnet-4.6', 'gpt-5.3-codex'],
        defaultModel: 'auto',

        validateModel(model) {
            // Cursor has many models, be permissive
            return typeof model === 'string' && model.length > 0;
        },

        // --- Session Management ---
        canResume: true,

        generateSessionId() {
            // Cursor uses create-chat to generate session IDs
            try {
                const output = execSync('cursor-agent create-chat', EXEC_OPTS);
                return output.trim();
            } catch {
                // Fallback to UUID if create-chat fails
                return require('crypto').randomUUID();
            }
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

            const modelFlag = `--model ${model || this.defaultModel}`;
            const mcpFlag = mcpConfigFile ? `--mcp-config "${mcpConfigFile}"` : '';

            // Cursor uses --resume for both new and continued sessions
            // For new sessions, we pre-create the chat ID with create-chat
            const resumeFlag = `--resume ${sessionId}`;

            // Build the shell script
            // Note: Cursor doesn't support --system-prompt, so we ignore systemPromptFile
            // The server will prepend system instructions to the first prompt
            let script = '#!/bin/bash\n';
            script += `cat "${promptFile}" | cursor-agent -p -f ${resumeFlag} ${modelFlag} ${mcpFlag} --output-format stream-json --stream-partial-output 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;

            return {
                script,
                env: {},
            };
        },

        // --- Output Parsing ---
        streamParserName: 'cursor',

        extractSessionId(output) {
            // Cursor: we provide the session ID via create-chat, so nothing to extract
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
