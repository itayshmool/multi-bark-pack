/**
 * Core agent lifecycle — spawn, send, run, find, soft/hard delete, stop, clear, reborn, reset.
 */

import { errorMessage } from '../utils/error.js';
import { shellEscape } from '../utils/shell.js';
import { withLock } from '../utils/async-lock.js';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type {
  Agent,
  Adapter,
  BackendsProvider,
  HistoryManagerProvider,
  FallbackManagerProvider,
  TimelineProvider,
  SkillsManagerProvider,
} from '../types/index.js';
import { TMP_DIR, PROJECTS_DIR, EXEC_OPTS, DEFAULT_BACKEND, REPO_PATH } from './config.js';
import {
  getAgents,
  getDeletedAgents,
  getAgent,
  getAgentByName,
  setAgent,
  deleteAgent as removeAgentFromMap,
  setDeletedAgent,
  removeDeletedAgent,
  getMsgToAgent,
  setMsgAgent,
  deleteMsgAgent,
  genId,
  saveState,
} from './state.js';
import { nextPupName, sanitizeName, getAgentIcon, getActivePackId } from './naming.js';
import { createTmuxSession } from './tmux.js';
import { broadcastAgents } from './websocket.js';
import { updatePinnedStatus } from './status.js';
import {
  executeAgentCommand,
  formatAgentMessage,
  deliverResponse,
  buildDoneReceipt,
  formatDuration,
} from './execution.js';
import type { ResponseMeta } from './execution.js';
import { requestApproval } from './approval.js';

// Lazily injected dependencies
let _backends: BackendsProvider | null = null;
let _historyManager: HistoryManagerProvider | null = null;
let _fallbackManager: FallbackManagerProvider | null = null;
let _timeline: TimelineProvider | null = null;
let _skillsManager: SkillsManagerProvider | null = null;

export function initAgents(deps: {
  backends: BackendsProvider;
  historyManager: HistoryManagerProvider;
  fallbackManager: FallbackManagerProvider;
  timeline: TimelineProvider;
  skillsManager: SkillsManagerProvider;
}): void {
  _backends = deps.backends;
  _historyManager = deps.historyManager;
  _fallbackManager = deps.fallbackManager;
  _timeline = deps.timeline;
  _skillsManager = deps.skillsManager;
}

// --- Core Agent Functions (adapter-agnostic) ---

export async function spawnAgent(
  prompt: string,
  adapter: Adapter,
  parentId: string | null = null,
  reuseMsgId: string | null = null,
  replyToId: string | null = null,
  model: string | null = null,
  forceName: string | null = null,
  backendName: string | null = null,
): Promise<Agent | null> {
  // Validate requested backend is available
  if (backendName && !_backends!.isAvailable(backendName)) {
    await adapter.send(`❌ Backend "${backendName}" not available`, replyToId);
    return null;
  }

  const id = genId();
  const name = sanitizeName(forceName) || nextPupName();

  // Get backend (default if not specified)
  const backend = _backends!.get(backendName!) || _backends!.getDefault(DEFAULT_BACKEND);
  const sessionId = backend.generateSessionId();

  const tmuxSession = `bark-${name}`;

  // Create tmux session with a bash shell for the agent to work in
  try {
    createTmuxSession(tmuxSession, id, { startDir: REPO_PATH || undefined, echoName: name, backendName: backend.name });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.log(`  ⚠️ Could not create tmux session for ${name}: ${msg}`);
  }

  const agent: Agent = {
    id,
    name,
    sessionId,
    tmuxSession,
    backend: backend.name,
    model: model || backend.defaultModel,
    status: 'active',
    parentId,
    cwd: REPO_PATH || null,
    createdAt: new Date().toISOString(),
    source: adapter.name as Agent['source'],
    packId: getActivePackId(),
    skills: _skillsManager!.list(true).map(s => s.id),
    hasRun: false,
    retryCount: 0,
  };
  setAgent(id, agent);
  saveState();

  console.log(`  🐕 Spawned ${name} (tmux: ${tmuxSession})`);
  _timeline!.emit('spawn', {
    agentId: id,
    agentName: name,
    backend: backend.name,
    meta: { source: 'adapter' },
  });
  await updatePinnedStatus();

  let liveMsgId: string | null;
  const icon = getAgentIcon(agent);
  const thinkingMsg = `${icon} ${name} · ${backend.name}\n💭 thinking...`;
  if (reuseMsgId) {
    liveMsgId = reuseMsgId;
    await adapter.edit(reuseMsgId, thinkingMsg);
  } else {
    liveMsgId = await adapter.send(thinkingMsg, replyToId);
  }
  // Map both the user's original message AND the pup's response to this agent.
  // This way, Slack thread replies (which point to the thread parent = user's msg) route correctly.
  if (replyToId) setMsgAgent(replyToId, id);
  if (liveMsgId) setMsgAgent(liveMsgId, id);
  saveState();

  // Save user turn to history
  _historyManager!.addUserTurn(id, prompt);

  // Run first prompt, pass the live message ID for editing
  // Per-agent lock ensures only one command runs at a time
  withLock(`agent:${agent.id}`, () => runAgentCommand(agent, prompt, adapter, liveMsgId, replyToId));

  return agent;
}

export async function sendToAgent(
  agent: Agent,
  text: string,
  adapter: Adapter,
  reuseMsgId: string | null = null,
  replyToId: string | null = null,
  model: string | null = null,
): Promise<void> {
  if (model && model !== agent.model) {
    agent.model = model;
    saveState();
    console.log(`  🔄 ${agent.name} switched to ${model}`);
    _timeline!.emit('model_switch', {
      agentId: agent.id,
      agentName: agent.name,
      backend: agent.backend,
      meta: { model },
    });
  }
  console.log(`  📤 Sent to ${agent.name}: ${text.substring(0, 80)}`);
  _timeline!.emit('message_sent', {
    agentId: agent.id,
    agentName: agent.name,
    backend: agent.backend,
    meta: { preview: text.substring(0, 80) },
  });
  let liveMsgId: string | null;
  const icon = getAgentIcon(agent);
  const thinkingMsg = `${icon} ${agent.name} · ${agent.backend}\n💭 thinking...`;
  if (reuseMsgId) {
    liveMsgId = reuseMsgId;
    await adapter.edit(reuseMsgId, thinkingMsg);
  } else {
    liveMsgId = await adapter.send(thinkingMsg, replyToId);
  }
  if (replyToId) setMsgAgent(replyToId, agent.id);
  if (liveMsgId) setMsgAgent(liveMsgId, agent.id);
  saveState();

  // Save user turn to history
  _historyManager!.addUserTurn(agent.id, text);

  withLock(`agent:${agent.id}`, () => runAgentCommand(agent, text, adapter, liveMsgId, replyToId));
  await updatePinnedStatus();
}

export function runAgentCommand(
  agent: Agent,
  prompt: string,
  adapter: Adapter,
  liveMsgId: string | null = null,
  replyToId: string | null = null,
): void {
  executeAgentCommand(agent, prompt, {
    source: 'adapter',
    pollInterval: 2000,
    timeout: _fallbackManager!.config.timeout.commandMs,

    async onProgress(agent: Agent, progress: string) {
      if (liveMsgId) {
        const msg = formatAgentMessage(agent, progress, { isProgress: true });
        await adapter.edit(liveMsgId, msg);
      }
    },

    async onComplete(agent: Agent, output: string, exitCode: number, { sendDir, toolsUsed, lastProgress, violations, durationMs, costUsd }) {
      await updatePinnedStatus();

      const meta: ResponseMeta = {
        durationMs,
        toolCount: toolsUsed.length,
        costUsd,
        backend: agent.backend,
        exitCode,
      };

      // Check for failure and trigger fallback
      const failure = _fallbackManager!.detector.classifyFailure(
        output,
        String(exitCode),
        true,
      );
      if (failure && _fallbackManager!.config.enabled) {
        console.log(`  ⚠️ ${agent.name} failed: ${failure.type}`);
        const fallbackResult = await _fallbackManager!.executeFallback(
          agent,
          failure,
          adapter,
          _backends,
          null,
        );
        if (fallbackResult.success && fallbackResult.action !== 'retry_same_session') {
          const notification = _fallbackManager!.buildNotification(
            agent,
            fallbackResult,
            failure,
          );
          if (notification && liveMsgId) {
            await adapter.edit(liveMsgId, notification);
          }
          return;
        }
      }

      // Check for policy violations — hold response pending approval
      if (violations && violations.length > 0) {
        const worst = violations.find(v => v.action === 'block') || violations[0];
        await requestApproval(agent, adapter, worst, output, liveMsgId, replyToId);
        return;
      }

      const responseMsgId = await deliverResponse(
        adapter,
        agent,
        output,
        liveMsgId,
        replyToId,
        meta,
      );

      // Send any files the pup placed in its send directory
      try {
        if (existsSync(sendDir)) {
          const files = readdirSync(sendDir);
          for (const file of files) {
            const filePath = path.join(sendDir, file);
            try {
              const caption = `📎 ${agent.name}: ${file}`;
              await adapter.sendFile(filePath, caption, responseMsgId);
              console.log(`  📎 ${agent.name} sent file: ${file}`);
              _timeline!.emit('file_sent', {
                agentId: agent.id,
                agentName: agent.name,
                backend: agent.backend,
                meta: { file },
              });
            } catch (e: unknown) {
              const msg = errorMessage(e);
              console.log(`  ⚠️ ${agent.name} failed to send file ${file}: ${msg}`);
            }
            try {
              unlinkSync(filePath);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    },

    async onTimeout(agent: Agent, { durationMs, toolsUsed, lastProgress: lastProg }) {
      if (liveMsgId) {
        const icon = getAgentIcon(agent);
        const dur = formatDuration(durationMs);
        const toolLine = toolsUsed.length > 0
          ? `\n🔧 ${toolsUsed.length} tools · last: ${toolsUsed.slice(-3).join(' → ')}`
          : '';
        await adapter.edit(liveMsgId, `${icon} ${agent.name} ⏰ timed out · ${dur}${toolLine}\n💬 Reply to retry`);
      }
    },

    async onTmuxError(agent: Agent, error: string) {
      const icon = getAgentIcon(agent);
      adapter
        .send(`${icon} ${agent.name} ❌ tmux error: ${error.substring(0, 200)}`)
        .catch(() => {});
    },
  });
}

export function findAgentByName(nameQuery: string): Agent | null {
  // O(1) lookup via name index
  const byName = getAgentByName(nameQuery);
  if (byName) return byName;
  // Fallback: check by ID
  const byId = getAgent(nameQuery);
  return byId ?? null;
}

export function findDeletedByName(nameQuery: string): Agent | null {
  const q = nameQuery.toLowerCase();
  const deletedAgents = getDeletedAgents();
  let match: Agent | null = null;
  for (const [, agent] of deletedAgents) {
    if (agent.name.toLowerCase() === q || agent.id === q) {
      // Pick most recently deleted if multiple share a name
      if (!match || new Date(agent.deletedAt || 0) > new Date(match.deletedAt || 0)) {
        match = agent;
      }
    }
  }
  return match;
}

export function softDeleteAgent(agent: Agent): void {
  // Kill tmux session
  try {
    execSync(`tmux kill-session -t ${shellEscape(agent.tmuxSession)} 2>/dev/null`, EXEC_OPTS);
  } catch {
    // ignore
  }
  // Clean up temp files
  try {
    execSync(`rm -f ${shellEscape(path.join(TMP_DIR, agent.id))}.*`, EXEC_OPTS);
  } catch {
    // ignore
  }
  // Soft-delete: move from active to deleted (keep routing entries for reborn hint)
  agent.status = 'deleted';
  agent.deletedAt = new Date().toISOString();
  removeAgentFromMap(agent.id);
  setDeletedAgent(agent.id, agent);
  saveState();
  console.log(`  🗑️ Cleared ${agent.name} (${agent.id}) — moved to losts`);
  _timeline!.emit('clear', {
    agentId: agent.id,
    agentName: agent.name,
    backend: agent.backend,
  });
}

export function hardDeleteAgent(
  agent: Agent,
  fromMap: Map<string, Agent> = getAgents(),
): void {
  // Kill tmux session
  try {
    execSync(`tmux kill-session -t ${shellEscape(agent.tmuxSession)} 2>/dev/null`, EXEC_OPTS);
  } catch {
    // ignore
  }
  // Clean up temp files and history
  _historyManager!.remove(agent.id);
  try {
    execSync(`rm -f ${shellEscape(path.join(TMP_DIR, agent.id))}.*`, EXEC_OPTS);
  } catch {
    // ignore
  }
  // Remove routing entries pointing to this agent
  const msgToAgent = getMsgToAgent();
  for (const [msgId, agentId] of msgToAgent) {
    if (agentId === agent.id) deleteMsgAgent(msgId);
  }
  // Permanent delete: remove from whichever map it's in, free the name
  fromMap.delete(agent.id);
  saveState();
  console.log(`  ❌ Hard-deleted ${agent.name} (${agent.id}) — name freed`);
  _timeline!.emit('hard_delete', {
    agentId: agent.id,
    agentName: agent.name,
    backend: agent.backend,
  });
}

// --- Extracted command functions (shared by chat commands + REST API) ---

function resolveAgentNames(names: string[]): { agents: Agent[]; notFound: string[] } {
  if (names.length === 1 && names[0].toLowerCase() === 'pack') {
    return { agents: [...getAgents().values()], notFound: [] };
  }
  const agents: Agent[] = [];
  const notFound: string[] = [];
  for (const name of names) {
    const agent = findAgentByName(name);
    if (agent) agents.push(agent);
    else notFound.push(name);
  }
  return { agents, notFound };
}

export function stopAgents(
  names: string[],
): { stopped: string[]; notFound: string[] } {
  const { agents: resolved, notFound } = resolveAgentNames(names);
  const stopped: string[] = [];

  for (const agent of resolved) {
    const runningFile = path.join(TMP_DIR, `${agent.id}.running`);
    if (existsSync(runningFile)) {
      try { execSync(`tmux send-keys -t ${shellEscape(agent.tmuxSession)} C-c`, EXEC_OPTS); } catch { /* ignore */ }
      try { unlinkSync(runningFile); } catch { /* ignore */ }
      stopped.push(agent.name);
    }
  }

  if (stopped.length) {
    console.log(`  🛑 Stopped: ${stopped.join(', ')}`);
    _timeline!.emit('stop', { agentName: stopped.join(', ') });
  }
  updatePinnedStatus();
  return { stopped, notFound };
}

export function clearAgents(
  names: string[],
): { cleared: string[]; notFound: string[] } {
  const { agents: resolved, notFound } = resolveAgentNames(names);
  const cleared: string[] = [];

  for (const agent of resolved) {
    cleared.push(agent.name);
    softDeleteAgent(agent);
  }

  updatePinnedStatus();
  return { cleared, notFound };
}

export function deleteAgents(
  names: string[],
): { deleted: string[]; deletedFromLosts: string[]; notFound: string[] } {
  const deleted: string[] = [];
  const deletedFromLosts: string[] = [];

  if (names.length === 1 && names[0].toLowerCase() === 'pack') {
    for (const agent of [...getAgents().values()]) {
      deleted.push(agent.name);
      hardDeleteAgent(agent, getAgents());
    }
    for (const agent of [...getDeletedAgents().values()]) {
      deletedFromLosts.push(agent.name);
      hardDeleteAgent(agent, getDeletedAgents());
    }
  } else {
    const notFound: string[] = [];
    for (const name of names) {
      const agent = findAgentByName(name);
      if (agent) {
        deleted.push(agent.name);
        hardDeleteAgent(agent, getAgents());
      } else {
        const dead = findDeletedByName(name);
        if (dead) {
          deleted.push(dead.name);
          hardDeleteAgent(dead, getDeletedAgents());
        } else {
          notFound.push(name);
        }
      }
    }
    updatePinnedStatus();
    return { deleted, deletedFromLosts, notFound };
  }

  updatePinnedStatus();
  return { deleted, deletedFromLosts, notFound: [] };
}

export function rebornAgent(
  name: string,
): { success: boolean; error?: string; agent?: Agent } {
  const existing = findAgentByName(name);
  if (existing) {
    return {
      success: false,
      error: `*${existing.name}* is already alive! Clear them first if you want to reborn the old one.`,
    };
  }

  const dead = findDeletedByName(name);
  if (!dead) {
    return {
      success: false,
      error: `No deleted pup named "${name}". Use \`/losts\` to see available pups.`,
    };
  }

  dead.status = 'active';
  delete dead.deletedAt;
  dead.hasRun = true;
  removeDeletedAgent(dead.id);
  setAgent(dead.id, dead);

  dead.tmuxSession = `bark-${dead.name}`;
  try {
    const startDir = dead.cwd && existsSync(dead.cwd) ? dead.cwd : PROJECTS_DIR;
    createTmuxSession(dead.tmuxSession, dead.id, {
      startDir,
      echoName: dead.name,
      echoSuffix: '(reborn)',
    });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.log(`  Could not create tmux session for ${dead.name}: ${msg}`);
  }

  saveState();
  console.log(`  🐕 Reborn ${dead.name} (${dead.id}) with session ${dead.sessionId}`);
  _timeline!.emit('reborn', {
    agentId: dead.id,
    agentName: dead.name,
    backend: dead.backend,
  });
  updatePinnedStatus();
  return { success: true, agent: dead };
}

export function resetAgents(
  names: string[],
): { reset: string[]; notFound: string[] } {
  const { agents: resolved, notFound } = resolveAgentNames(names);
  const reset: string[] = [];

  for (const agent of resolved) {
    const backend =
      _backends!.get(agent.backend) || _backends!.getDefault(DEFAULT_BACKEND);
    agent.sessionId = backend.generateSessionId();
    agent.hasRun = false;
    agent.cwd = null;
    _historyManager!.clear(agent.id);
    try { execSync(`rm -f ${shellEscape(path.join(TMP_DIR, agent.id))}.*`, EXEC_OPTS); } catch { /* ignore */ }
    console.log(`  🔄 Reset ${agent.name} — new session ${agent.sessionId}`);
    _timeline!.emit('reset', {
      agentId: agent.id,
      agentName: agent.name,
      backend: agent.backend,
    });
    reset.push(agent.name);
  }
  saveState();

  updatePinnedStatus();
  return { reset, notFound };
}
