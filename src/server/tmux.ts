/**
 * Tmux session management helpers.
 */

import { errorMessage } from '../utils/error.js';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Agent } from '../types/index.js';
import { EXEC_OPTS, PROJECTS_DIR } from './config.js';
import { setupTmuxEnv } from './delegation.js';

/**
 * Create a new tmux session for an agent.
 *
 * Handles the full creation flow:
 * 1. `tmux new-session` in the given start directory
 * 2. Optional echo banner (with agent name/id and optional suffix)
 * 3. `setupTmuxEnv()` for BARK_* env vars
 *
 * @param tmuxSession - tmux session name (e.g. "bark-Chase")
 * @param agentId - agent ID for env setup
 * @param opts.startDir - working directory for the session (defaults to PROJECTS_DIR)
 * @param opts.echoName - agent display name for the echo banner; if omitted, no echo is printed
 * @param opts.echoSuffix - optional suffix appended to the echo banner (e.g. "(restored)", "(reborn)")
 */
export function createTmuxSession(
  tmuxSession: string,
  agentId: string,
  opts: {
    startDir?: string;
    echoName?: string;
    echoSuffix?: string;
  } = {},
): void {
  const dir = opts.startDir || PROJECTS_DIR;
  execSync(
    `tmux new-session -d -s "${tmuxSession}" -c "${dir}"`,
    EXEC_OPTS,
  );
  if (opts.echoName) {
    const suffix = opts.echoSuffix ? ` ${opts.echoSuffix}` : '';
    execSync(
      `tmux send-keys -t "${tmuxSession}" "echo '=== 🐕 ${opts.echoName} (${agentId}) ===${suffix}'" Enter`,
      EXEC_OPTS,
    );
  }
  setupTmuxEnv(tmuxSession, agentId);
}

/** Ensure a tmux session exists for the agent, recreating it if necessary. */
export function ensureTmuxSession(agent: Agent): boolean {
  try {
    execSync(`tmux has-session -t "${agent.tmuxSession}" 2>/dev/null`, EXEC_OPTS);
    return true;
  } catch {
    try {
      const startDir = agent.cwd && existsSync(agent.cwd) ? agent.cwd : PROJECTS_DIR;
      createTmuxSession(agent.tmuxSession, agent.id, {
        startDir,
        echoName: agent.name,
        echoSuffix: '(restored)',
      });
      console.log(`  🔄 Recreated tmux session for ${agent.name}`);
      return true;
    } catch (e: unknown) {
      const msg = errorMessage(e);
      console.error(`  ❌ Could not create tmux session for ${agent.name}: ${msg}`);
      return false;
    }
  }
}
