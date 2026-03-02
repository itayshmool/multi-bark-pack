/**
 * Delegation helpers — sub-agent queries, tmux environment setup.
 */

import { execSync } from 'node:child_process';
import { shellEscape } from '../utils/shell.js';
import type { Agent } from '../types/index.js';
import { EXEC_OPTS, API_SECRET, UI_PORT, TOOLS_DIR } from './config.js';
import { getAgents } from './state.js';
import { getPolicyRulesForEnv } from './approval.js';

/** Get active sub-agents for a given parent. */
export function getActiveSubAgents(parentId: string): Agent[] {
  return [...getAgents().values()].filter(
    a => a.parentId === parentId && a.status === 'active',
  );
}

/** Set up BARK_* env vars in a tmux session so the `bark` CLI tool works. */
export function setupTmuxEnv(tmuxSession: string, agentId: string, backendName?: string): void {
  const escaped = shellEscape(tmuxSession);
  try {
    execSync(`tmux setenv -t ${escaped} BARK_AGENT_ID ${shellEscape(agentId)}`, EXEC_OPTS);
    execSync(`tmux setenv -t ${escaped} BARK_API ${shellEscape(`http://localhost:${UI_PORT}`)}`, EXEC_OPTS);
    if (API_SECRET) {
      execSync(`tmux setenv -t ${escaped} BARK_TOKEN ${shellEscape(API_SECRET)}`, EXEC_OPTS);
    }
    if (backendName) {
      execSync(`tmux setenv -t ${escaped} BARK_BACKEND ${shellEscape(backendName)}`, EXEC_OPTS);
    }
    const policyRules = getPolicyRulesForEnv();
    if (policyRules && policyRules !== '{}') {
      execSync(`tmux setenv -t ${escaped} BARK_POLICY_RULES ${shellEscape(policyRules)}`, EXEC_OPTS);
    }
    execSync(
      `tmux send-keys -t ${escaped} ${shellEscape(`export BARK_AGENT_ID=$BARK_AGENT_ID BARK_API=$BARK_API BARK_TOKEN=$BARK_TOKEN BARK_BACKEND=$BARK_BACKEND BARK_POLICY_RULES=$BARK_POLICY_RULES PATH=${TOOLS_DIR}:"$PATH"`)} Enter`,
      EXEC_OPTS,
    );
  } catch {
    // ignore
  }
}
