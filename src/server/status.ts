/**
 * Status — classify agents, build status text, update pinned status message.
 */

import { errorMessage } from '../utils/error.js';
import { getAgentFiles } from '../utils/agent-files.js';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Agent, AgentClassification } from '../types/index.js';
import { EXEC_OPTS, DEFAULT_BACKEND } from './config.js';
import {
  getAgents,
  getAdapters,
  getStatusMsgs,
  setStatusMsg,
  saveState,
} from './state.js';

export function timeSince(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TMUX_CACHE_TTL_MS = 5000;
let _tmuxCache: Set<string> | null = null;
let _tmuxCacheTime = 0;

function getTmuxSessions(): Set<string> {
  const now = Date.now();
  if (_tmuxCache && now - _tmuxCacheTime < TMUX_CACHE_TTL_MS) return _tmuxCache;

  const sessions = new Set<string>();
  try {
    const tmuxOut = execSync('tmux ls -F "#{session_name}" 2>/dev/null', EXEC_OPTS).toString();
    for (const line of tmuxOut.split('\n')) {
      const name = line.trim();
      if (name) sessions.add(name);
    }
  } catch {
    // tmux ls fails if no sessions exist
  }
  _tmuxCache = sessions;
  _tmuxCacheTime = now;
  return sessions;
}

/** Reset tmux cache (for testing). */
export function _resetTmuxCache(): void {
  _tmuxCache = null;
  _tmuxCacheTime = 0;
}

export function classifyAgents(): AgentClassification[] {
  const aliveSessions = getTmuxSessions();

  const agents = getAgents();
  const ranked: AgentClassification[] = [];
  for (const [, agent] of agents) {
    const files = getAgentFiles(agent.id);

    const tmuxAlive = aliveSessions.has(agent.tmuxSession);

    let emoji: string;
    let status: AgentClassification['status'];
    let priority: number;
    if (!tmuxAlive) {
      emoji = '⚫';
      status = 'nap';
      priority = 3;
    } else if (existsSync(files.running)) {
      emoji = '🔵';
      status = 'run';
      priority = 1;
    } else if (existsSync(files.done)) {
      const exitCode = readFileSync(files.done, 'utf8').trim();
      if (exitCode !== '0') {
        emoji = '🔴';
        status = 'yelp';
        priority = 0;
      } else {
        emoji = '🟢';
        status = 'idle';
        priority = 2;
      }
    } else if (existsSync(files.progress)) {
      emoji = '🔵';
      status = 'run';
      priority = 1;
    } else {
      emoji = '🟢';
      status = 'idle';
      priority = 2;
    }

    ranked.push({ priority, emoji, status, agent });
  }
  ranked.sort((a, b) => a.priority - b.priority);
  return ranked;
}

export function getGitSummary(): string | null {
  try {
    const branch = execSync('git branch --show-current 2>/dev/null', EXEC_OPTS).toString().trim();
    const porcelain = execSync('git status --porcelain 2>/dev/null', EXEC_OPTS).toString().trim();
    const changed = porcelain ? porcelain.split('\n').length : 0;
    const parts = [`📂${branch}`];
    if (changed > 0) parts.push(`✏️${changed}`);
    return parts.join(' ');
  } catch {
    return null;
  }
}

export function buildStatusText(): string {
  const ranked = classifyAgents();
  if (ranked.length === 0) return '🐾 No pups yet';

  const agents = getAgents();

  // Count by status for the summary line
  const counts: Record<string, number> = {};
  for (const { status } of ranked) counts[status] = (counts[status] || 0) + 1;

  // Summary line: icons only, git info on same line
  const parts: string[] = [];
  if (counts.yelp) parts.push(`🔴${counts.yelp}`);
  if (counts.run) parts.push(`🔵${counts.run}`);
  if (counts.idle) parts.push(`🟢${counts.idle}`);
  if (counts.nap) parts.push(`⚫${counts.nap}`);
  const git = getGitSummary();
  const summary = `🐾 ${parts.join(' ')}${git ? ` · ${git}` : ''}`;

  const lines = [summary];
  for (const { emoji, status, agent } of ranked) {
    const backendTag =
      agent.backend && agent.backend !== DEFAULT_BACKEND ? ` [${agent.backend}]` : '';
    const modelTag = agent.model && agent.model !== 'sonnet' ? ` [${agent.model}]` : '';
    const projectTag = agent.cwd ? ` 📂${path.basename(agent.cwd)}` : '';
    const parentTag = agent.parentId ? ` ↳${agents.get(agent.parentId)?.name || '?'}` : '';
    const approvalTag = agent.approvalPending ? ' ⏳approval' : '';

    // Activity context: running agents show phase + elapsed; idle/error show time-ago
    let activityTag = '';
    const files = getAgentFiles(agent.id);
    if (status === 'run') {
      try {
        const phase = existsSync(files.phase) ? readFileSync(files.phase, 'utf8').trim() : '';
        const timerMatch = existsSync(files.progress)
          ? readFileSync(files.progress, 'utf8').match(/⏱\s*(\S+)/)
          : null;
        const elapsed = timerMatch ? timerMatch[1] : '';
        if (phase || elapsed) {
          activityTag = ` ${phase}${elapsed ? ` ${elapsed}` : ''}`;
        }
      } catch { /* ignore */ }
    } else if (status === 'idle' || status === 'yelp') {
      try {
        if (existsSync(files.done)) {
          const mtime = statSync(files.done).mtime;
          activityTag = ` ${timeSince(mtime)}`;
        }
      } catch { /* ignore */ }
    }

    lines.push(
      `${emoji} *${agent.name}*${parentTag}${activityTag}${backendTag}${modelTag}${projectTag}${approvalTag}`,
    );
  }

  return lines.join('\n');
}

let statusUpdatePending = false;
let statusUpdateRunning = false;

export async function updatePinnedStatus(): Promise<void> {
  const adapters = getAdapters();
  if (adapters.length === 0) return;

  // If already running, mark pending and return — the running call will re-run with fresh state
  if (statusUpdateRunning) {
    statusUpdatePending = true;
    return;
  }

  statusUpdateRunning = true;
  try {
    const text = buildStatusText();
    const statusMsgs = getStatusMsgs();

    await Promise.all(adapters.filter(a => a.isReady()).map(async (adapter) => {
      try {
        const existingId = statusMsgs[adapter.name];
        if (existingId) {
          const edited = await adapter.edit(existingId, text);
          if (edited) return;
          try { await adapter.unpin(existingId); } catch { /* ignore */ }
          setStatusMsg(adapter.name, null);
        }
        const msgId = await adapter.send(text);
        if (!msgId) return;
        await adapter.pin(msgId);
        setStatusMsg(adapter.name, msgId);
        console.log(`  📌 Pinned new status message (${adapter.name})`);
      } catch (e: unknown) {
        const msg = errorMessage(e);
        console.log(`  ⚠️ Could not update pinned status (${adapter.name}): ${msg}`);
      }
    }));
    saveState();
  } finally {
    statusUpdateRunning = false;
    // If someone called while we were running, re-run with latest state
    if (statusUpdatePending) {
      statusUpdatePending = false;
      updatePinnedStatus();
    }
  }
}
