/**
 * Summary Generator
 * Creates conversation summaries for context preservation
 */

import type { AgentHistory, HistoryTurn, ContextPromptOptions } from '../types/index.js';

/**
 * Build context injection prompt from history
 */
export function buildContextPrompt(history: AgentHistory, options: ContextPromptOptions = {}): string {
  const parts: string[] = [];

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
    .flatMap((t: HistoryTurn) => t.filesModified || [])
    .filter((f: string, i: number, a: string[]) => a.indexOf(f) === i);
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
export function buildMinimalContext(history: AgentHistory): string {
  const parts: string[] = [];

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

// estimateTokens moved to utils/tokens.ts
export { estimateTokens } from '../utils/tokens.js';
