/**
 * History Storage Module
 * JSON file storage for agent conversation history
 */

import { errorMessage } from '../utils/error.js';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import type { AgentHistory } from '../types/index.js';

/**
 * Get history file path for an agent
 */
export function getHistoryPath(agentId: string): string {
  return path.join(TMP_DIR, `${agentId}.history.json`);
}

/**
 * Create empty history object for new agent
 */
export function createEmptyHistory(agentId: string, backend: string): AgentHistory {
  return {
    version: 1,
    agentId,
    backend,
    created: new Date().toISOString(),
    summary: null,
    turns: [],
    totalTurns: 0,
    lastError: null,
    cwd: null,
  };
}

/**
 * Load history for an agent
 * Returns empty history if file doesn't exist
 */
export function load(agentId: string, backend: string = 'claude-code'): AgentHistory {
  const historyPath = getHistoryPath(agentId);

  if (!existsSync(historyPath)) {
    return createEmptyHistory(agentId, backend);
  }

  try {
    const data = readFileSync(historyPath, 'utf8');
    return JSON.parse(data) as AgentHistory;
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not load history for ${agentId}: ${message}`);
    return createEmptyHistory(agentId, backend);
  }
}

/**
 * Save history for an agent (atomic write)
 */
export function save(agentId: string, history: AgentHistory): boolean {
  return atomicWriteJSON(getHistoryPath(agentId), history, `history for ${agentId}`);
}

/**
 * Delete history for an agent
 */
export function remove(agentId: string): boolean {
  const historyPath = getHistoryPath(agentId);
  try {
    if (existsSync(historyPath)) {
      unlinkSync(historyPath);
    }
    return true;
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not delete history for ${agentId}: ${message}`);
    return false;
  }
}

/**
 * Check if history exists for an agent
 */
export function exists(agentId: string): boolean {
  return existsSync(getHistoryPath(agentId));
}
