/**
 * Delegation helpers — sub-agent queries, tmux environment setup.
 */

import { execSync } from 'node:child_process';
import type { Agent } from '../types/index.js';
import { EXEC_OPTS, API_SECRET, UI_PORT, TOOLS_DIR } from './config.js';
import { getAgents } from './state.js';

/** Get active sub-agents for a given parent. */
export function getActiveSubAgents(parentId: string): Agent[] {
  return [...getAgents().values()].filter(
    a => a.parentId === parentId && a.status === 'active',
  );
}

/** Set up BARK_* env vars in a tmux session so the `bark` CLI tool works. */
export function setupTmuxEnv(tmuxSession: string, agentId: string): void {
  try {
    const tokenExport = API_SECRET ? ` BARK_TOKEN='${API_SECRET}'` : '';
    execSync(
      `tmux send-keys -t "${tmuxSession}" "export BARK_AGENT_ID='${agentId}' BARK_API='http://localhost:${UI_PORT}'${tokenExport} PATH='${TOOLS_DIR}':\\"\\$PATH\\"" Enter`,
      EXEC_OPTS,
    );
  } catch {
    // ignore
  }
}
