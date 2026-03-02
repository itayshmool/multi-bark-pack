/**
 * History Manager
 * API for managing agent conversation history
 */

import * as storage from './storage.js';
import { TOOL_ICONS } from '../config/tools.js';
import type {
  AgentHistory,
  HistoryTurn,
  HistoryFile,
  AddAssistantTurnResult,
  AddAssistantTurnOptions,
} from '../types/index.js';

// Configuration (exported for use by fallback/config)
export const MAX_TURNS = parseInt(process.env.HISTORY_MAX_TURNS || '10', 10);
export const SUMMARY_INTERVAL = parseInt(process.env.SUMMARY_INTERVAL_TURNS || '5', 10);
const MAX_CONTENT_LEN = parseInt(process.env.HISTORY_MAX_CONTENT_LEN || '2000', 10);

interface HistoryContext {
  summary: string | null;
  recentTurns: HistoryTurn[];
  cwd: string | null;
  totalTurns: number;
  filesModified: string[];
}

interface AssistantTurnOptions extends AddAssistantTurnOptions {
  cwd?: string;
}

/**
 * Load history for an agent
 */
export function load(agentId: string, backend?: string): AgentHistory {
  return storage.load(agentId, backend);
}

/**
 * Add a user turn to history
 */
export function addUserTurn(agentId: string, content: string, files: HistoryFile[] = []): AgentHistory {
  const history = storage.load(agentId);

  const turn: HistoryTurn = {
    id: history.totalTurns + 1,
    timestamp: new Date().toISOString(),
    role: 'user',
    content: truncateContent(content),
    files,
  };

  history.turns.push(turn);
  history.totalTurns++;

  if (history.turns.length > MAX_TURNS) {
    history.turns = history.turns.slice(-MAX_TURNS);
  }

  storage.save(agentId, history);
  return history;
}

/**
 * Add an assistant turn to history
 */
export function addAssistantTurn(agentId: string, content: string, options: AssistantTurnOptions = {}): AddAssistantTurnResult {
  const history = storage.load(agentId);

  const turn: HistoryTurn = {
    id: history.totalTurns + 1,
    timestamp: new Date().toISOString(),
    role: 'assistant',
    content: truncateContent(content),
    tools: options.tools || [],
    filesModified: options.filesModified || [],
    exitCode: options.exitCode,
  };

  history.turns.push(turn);
  history.totalTurns++;

  if (options.cwd) {
    history.cwd = options.cwd;
  }

  if (history.turns.length > MAX_TURNS) {
    history.turns = history.turns.slice(-MAX_TURNS);
  }

  if (options.exitCode === 0) {
    history.lastError = null;
  }

  storage.save(agentId, history);

  const needsSummary = shouldGenerateSummary(history);
  return { history, needsSummary };
}

/**
 * Record an error in history
 */
export function recordError(agentId: string, errorType: string, errorMessage: string): AgentHistory {
  const history = storage.load(agentId);

  history.lastError = {
    type: errorType,
    message: errorMessage,
    timestamp: new Date().toISOString(),
  };

  storage.save(agentId, history);
  return history;
}

/**
 * Update summary in history
 */
export function updateSummary(agentId: string, summaryText: string): AgentHistory {
  const history = storage.load(agentId);

  history.summary = {
    text: summaryText,
    updatedAt: new Date().toISOString(),
    turnsCovered: history.totalTurns,
  };

  storage.save(agentId, history);
  return history;
}

/**
 * Check if summary generation is needed
 */
export function shouldGenerateSummary(history: AgentHistory): boolean {
  if (!history.summary) {
    // No summary yet, generate after first few turns
    return history.totalTurns >= SUMMARY_INTERVAL;
  }

  // Check if enough new turns since last summary
  const turnsSinceSummary = history.totalTurns - history.summary.turnsCovered;
  return turnsSinceSummary >= SUMMARY_INTERVAL;
}

/**
 * Get context for fallback (summary + recent turns)
 */
export function getContext(agentId: string): HistoryContext {
  const history = storage.load(agentId);

  return {
    summary: history.summary?.text || null,
    recentTurns: history.turns.slice(-5),
    cwd: history.cwd,
    totalTurns: history.totalTurns,
    filesModified: getUniqueFiles(history.turns),
  };
}

/**
 * Clear history for an agent (on /reset)
 */
export function clear(agentId: string): boolean {
  return storage.remove(agentId);
}

/**
 * Delete history for an agent
 */
export function remove(agentId: string): boolean {
  return storage.remove(agentId);
}

// Helper: Truncate content to avoid huge history files
function truncateContent(content: string, maxLen: number = MAX_CONTENT_LEN): string {
  if (!content) return '';
  if (content.length <= maxLen) return content;
  return content.substring(0, maxLen) + '... [truncated]';
}

// Helper: Get unique files from turns
function getUniqueFiles(turns: HistoryTurn[]): string[] {
  const files = new Set<string>();
  for (const turn of turns) {
    if (turn.filesModified) {
      turn.filesModified.forEach(f => files.add(f));
    }
  }
  return Array.from(files);
}

// Pre-compiled regexes for tool extraction (avoids re-creating per call)
const TOOL_PATTERNS = Object.entries(TOOL_ICONS).map(([name, icon]) => ({
  name,
  regex: new RegExp(icon + '\\s*' + name),
}));

/**
 * Extract tools used from output.
 * Detects tool names by matching their icons (from config/tools.js) in output text.
 */
export function extractToolsFromOutput(output: string): string[] {
  const tools = new Set<string>();
  for (const { name, regex } of TOOL_PATTERNS) {
    if (regex.test(output)) {
      tools.add(name);
    }
  }
  return Array.from(tools);
}

// Re-export storage functions
export const exists = storage.exists;
