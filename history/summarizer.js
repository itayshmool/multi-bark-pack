/**
 * Summary Generator
 * Creates conversation summaries for context preservation
 */

const historyManager = require('./index');

/**
 * Summary prompt template
 */
const SUMMARY_PROMPT = `Summarize this conversation in under 150 words. Plain text, no markdown.

Cover exactly these points:
1. GOAL: What task was requested
2. DONE: What was completed (list modified files as paths)
3. STATUS: Current state (done / in-progress / blocked)
4. DECISIONS: Key choices made (if any)
5. NEXT: What remains to do (if anything)`;

/**
 * Build context injection prompt from history
 */
function buildContextPrompt(history, options = {}) {
    const parts = [];

    // Add summary if available
    if (history.summary?.text) {
        parts.push(`[Previous Context Summary]\n${history.summary.text}`);
    }

    // Add recent turns
    const recentTurns = history.turns.slice(-(options.maxRecentTurns || 5));
    if (recentTurns.length > 0) {
        parts.push('[Recent Conversation]');
        for (const turn of recentTurns) {
            const prefix = turn.role === 'user' ? 'User' : 'Assistant';
            // Truncate long content
            const content = turn.content.length > 500
                ? turn.content.substring(0, 500) + '...'
                : turn.content;
            parts.push(`${prefix}: ${content}`);
        }
    }

    // Add working directory
    if (history.cwd) {
        parts.push(`[Working Directory]\n${history.cwd}`);
    }

    // Add files modified
    const allFiles = recentTurns
        .flatMap(t => t.filesModified || [])
        .filter((f, i, a) => a.indexOf(f) === i);
    if (allFiles.length > 0) {
        parts.push(`[Files Modified]\n${allFiles.join('\n')}`);
    }

    // Add continuation instruction
    parts.push('[Continue from where you left off. Your previous session was reset — all context above is reconstructed from history. Do NOT repeat completed work.]');

    return parts.join('\n\n');
}

/**
 * Build minimal context (just summary + last message)
 * Used when even compressed context is too large
 */
function buildMinimalContext(history) {
    const parts = [];

    if (history.summary?.text) {
        parts.push(`[Context]\n${history.summary.text}`);
    }

    // Just the last turn
    if (history.turns.length > 0) {
        const lastTurn = history.turns[history.turns.length - 1];
        if (lastTurn.role === 'user') {
            parts.push(`[Last Request]\n${lastTurn.content}`);
        }
    }

    parts.push('[Session was reset. Continue from where you left off. Do NOT repeat completed work.]');

    return parts.join('\n\n');
}

/**
 * Parse summary from agent response
 * The agent's response to SUMMARY_PROMPT should be the summary itself
 */
function parseSummaryResponse(response) {
    // Clean up the response
    let summary = response.trim();

    // Remove any markdown code blocks if present
    summary = summary.replace(/```[\s\S]*?```/g, '');

    // Remove any leading "Summary:" or similar
    summary = summary.replace(/^(summary:?\s*)/i, '');

    // Truncate if too long
    if (summary.length > 1000) {
        summary = summary.substring(0, 1000) + '...';
    }

    return summary;
}

/**
 * Get the summary prompt to send to agent
 */
function getSummaryPrompt() {
    return SUMMARY_PROMPT;
}

/**
 * Estimate token count (rough approximation)
 * ~4 chars per token on average
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

/**
 * Check if context is within token limit
 */
function isWithinTokenLimit(context, maxTokens = 4000) {
    return estimateTokens(context) <= maxTokens;
}

module.exports = {
    buildContextPrompt,
    buildMinimalContext,
    parseSummaryResponse,
    getSummaryPrompt,
    estimateTokens,
    isWithinTokenLimit,
    SUMMARY_PROMPT,
};
