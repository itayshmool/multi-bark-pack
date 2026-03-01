/**
 * Claude Code CLI Backend
 * Implements the backend interface for Claude Code CLI
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

const EXEC_OPTS = { encoding: 'utf8', timeout: 5000 };

module.exports = function createClaudeCodeBackend(config = {}) {
    return {
        // --- Identity ---
        name: 'claude-code',
        displayName: 'Claude Code',

        // --- Availability ---
        async isInstalled() {
            try {
                execSync('which claude', EXEC_OPTS);
                return true;
            } catch {
                return false;
            }
        },

        async getVersion() {
            try {
                const output = execSync('claude --version', EXEC_OPTS);
                return output.trim();
            } catch {
                return null;
            }
        },

        // --- Models ---
        models: ['opus', 'sonnet', 'haiku'],
        defaultModel: 'sonnet',

        validateModel(model) {
            return this.models.includes(model);
        },

        // --- Session Management ---
        canResume: true,

        generateSessionId() {
            return crypto.randomUUID();
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

            // Build claude CLI arguments
            const claudeArgs = isResume
                ? `--resume ${sessionId} ${modelFlag}`
                : `--session-id ${sessionId} ${modelFlag} --system-prompt "$(cat '${systemPromptFile}')"`;

            // Build the shell script
            let script = '#!/bin/bash\n';
            script += `cat "${promptFile}" | claude -p --dangerously-skip-permissions ${claudeArgs} ${mcpFlag} --output-format stream-json --verbose --include-partial-messages 2>/dev/null | node "${streamParserScript}" ${agentId} "${tmpDir}"\n`;

            return {
                script,
                env: {}, // Claude Code doesn't need special env vars (CLAUDECODE is deleted at server level)
            };
        },

        // --- Output Parsing ---
        streamParserName: 'claude',

        extractSessionId(output) {
            // Claude Code: we provide the session ID, so nothing to extract
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
        },
    };
};
