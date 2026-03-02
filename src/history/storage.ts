/**
 * History Storage Module
 * JSON file storage for agent conversation history with in-memory cache.
 * Disk is only read on first access per agent; subsequent reads are served from cache.
 */

import { errorMessage } from '../utils/error.js';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import type { AgentHistory } from '../types/index.js';

const cache = new Map<string, AgentHistory>();

export function getHistoryPath(agentId: string): string {
  return path.join(TMP_DIR, `${agentId}.history.json`);
}

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

export function load(agentId: string, backend: string = 'claude-code'): AgentHistory {
  const cached = cache.get(agentId);
  if (cached) return cached;

  const historyPath = getHistoryPath(agentId);

  if (!existsSync(historyPath)) {
    const empty = createEmptyHistory(agentId, backend);
    cache.set(agentId, empty);
    return empty;
  }

  try {
    const data = readFileSync(historyPath, 'utf8');
    const history = JSON.parse(data) as AgentHistory;
    cache.set(agentId, history);
    return history;
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not load history for ${agentId}: ${message}`);
    const empty = createEmptyHistory(agentId, backend);
    cache.set(agentId, empty);
    return empty;
  }
}

export function save(agentId: string, history: AgentHistory): boolean {
  cache.set(agentId, history);
  return atomicWriteJSON(getHistoryPath(agentId), history, `history for ${agentId}`);
}

export function remove(agentId: string): boolean {
  cache.delete(agentId);
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

export function exists(agentId: string): boolean {
  if (cache.has(agentId)) return true;
  return existsSync(getHistoryPath(agentId));
}

/** Clear the in-memory cache (for testing or manual reset). */
export function clearCache(): void {
  cache.clear();
}
