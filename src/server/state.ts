/**
 * Mutable server state — agents, routing, adapters, status messages.
 * All other modules import getters/setters from here.
 */

import { errorMessage } from '../utils/error.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Agent, Adapter } from '../types/index.js';
import {
  AGENTS_FILE,
  ROUTING_FILE,
  STATUS_FILE,
  TMP_DIR,
  DEFAULT_BACKEND,
} from './config.js';

// --- Agent State ---
const agents = new Map<string, Agent>();
const deletedAgents = new Map<string, Agent>();
const msgToAgent = new Map<string, string>(); // prefixed msg id -> agent id

// --- Adapter State ---
const adapters: Adapter[] = [];
const statusMsgs: Record<string, string | null> = {};

// --- Shutdown flag (used by execution polling + SIGINT handler) ---
let shuttingDown = false;

// --- Broadcast callback (set by websocket.ts via initState) ---
let _broadcastAgents: (() => void) | null = null;

export function initState(deps: { broadcastAgents: () => void }): void {
  _broadcastAgents = deps.broadcastAgents;
}

// --- Agents ---
export function getAgents(): Map<string, Agent> {
  return agents;
}

export function getAgent(id: string): Agent | undefined {
  return agents.get(id);
}

export function setAgent(id: string, agent: Agent): void {
  agents.set(id, agent);
}

export function deleteAgent(id: string): boolean {
  return agents.delete(id);
}

export function hasAgent(id: string): boolean {
  return agents.has(id);
}

// --- Deleted Agents ---
export function getDeletedAgents(): Map<string, Agent> {
  return deletedAgents;
}

export function getDeletedAgent(id: string): Agent | undefined {
  return deletedAgents.get(id);
}

export function setDeletedAgent(id: string, agent: Agent): void {
  deletedAgents.set(id, agent);
}

export function removeDeletedAgent(id: string): boolean {
  return deletedAgents.delete(id);
}

export function hasDeletedAgent(id: string): boolean {
  return deletedAgents.has(id);
}

// --- Message Routing ---
export function getMsgToAgent(): Map<string, string> {
  return msgToAgent;
}

export function getMsgAgent(msgId: string): string | undefined {
  return msgToAgent.get(msgId);
}

export function setMsgAgent(msgId: string, agentId: string): void {
  msgToAgent.set(msgId, agentId);
}

export function deleteMsgAgent(msgId: string): boolean {
  return msgToAgent.delete(msgId);
}

// --- Adapters ---
export function getAdapters(): Adapter[] {
  return adapters;
}

export function addAdapter(adapter: Adapter): void {
  adapters.push(adapter);
}

// --- Status Messages ---
export function getStatusMsgs(): Record<string, string | null> {
  return statusMsgs;
}

export function setStatusMsg(adapterName: string, msgId: string | null): void {
  statusMsgs[adapterName] = msgId;
}

// --- Shutdown ---
export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function setShuttingDown(val: boolean): void {
  shuttingDown = val;
}

// --- ID Generation ---
export function genId(): string {
  return crypto.randomBytes(3).toString('hex');
}

// --- Agent List with Status ---
export function getAllAgentsWithStatus(): Array<Agent & { isRunning: boolean }> {
  return [
    ...[...agents.values()].map(a => ({
      ...a,
      isRunning: existsSync(path.join(TMP_DIR, `${a.id}.running`)),
    })),
    ...[...deletedAgents.values()].map(a => ({ ...a, isRunning: false })),
  ];
}

// --- Persistence ---

export function saveState(): void {
  // Save agents (both active and deleted)
  const data: Record<string, Record<string, unknown>> = {};
  for (const map of [agents, deletedAgents]) {
    for (const [id, agent] of map) {
      data[id] = {
        id: agent.id,
        name: agent.name,
        backend: agent.backend || DEFAULT_BACKEND,
        sessionId: agent.sessionId,
        tmuxSession: agent.tmuxSession,
        status: agent.status,
        parentId: agent.parentId || null,
        createdAt: agent.createdAt,
        hasRun: agent.hasRun || false,
        model: agent.model || 'sonnet',
        cwd: agent.cwd || null,
        deletedAt: agent.deletedAt || null,
        source: agent.source || 'whatsapp',
      };
    }
  }
  writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));

  // Save routing map
  const routing: Record<string, string> = {};
  for (const [msgId, agentId] of msgToAgent) {
    routing[msgId] = agentId;
  }
  writeFileSync(ROUTING_FILE, JSON.stringify(routing, null, 2));

  // Save pinned status message IDs so we can unpin them after restart
  writeFileSync(STATUS_FILE, JSON.stringify(statusMsgs));

  // Broadcast to UI clients
  if (_broadcastAgents) _broadcastAgents();
}

export function loadState(): void {
  // Load agents
  if (existsSync(AGENTS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(AGENTS_FILE, 'utf8')) as Record<string, Agent>;
      for (const [id, agent] of Object.entries(data)) {
        // Backward compat: default source to whatsapp, backend to claude-code
        if (!agent.source) agent.source = 'whatsapp';
        if (!agent.backend) agent.backend = 'claude-code';
        if (!agent.model) agent.model = 'sonnet';
        if (!agent.cwd) agent.cwd = null;
        if (agent.status === 'active') {
          // Respect saved hasRun — /reset sets it to false with a new session UUID.
          // Default to true for backward compat (pre-reset agents without the field).
          if (agent.hasRun === undefined) agent.hasRun = true;
          agents.set(id, agent);
        } else if (agent.status === 'deleted') {
          deletedAgents.set(id, agent);
        }
      }
      console.log(`  Restored ${agents.size} active, ${deletedAgents.size} deleted`);
    } catch (e: unknown) {
      const msg = errorMessage(e);
      console.log(`  ⚠️ Could not load agents: ${msg}`);
    }
  }

  // Load routing map
  if (existsSync(ROUTING_FILE)) {
    try {
      const data = JSON.parse(readFileSync(ROUTING_FILE, 'utf8')) as Record<string, string>;
      for (const [msgId, agentId] of Object.entries(data)) {
        // Backward compat: old entries without prefix are assumed WhatsApp
        const prefixed =
          msgId.startsWith('wa:') || msgId.startsWith('tg:') || msgId.startsWith('slack:')
            ? msgId
            : 'wa:' + msgId;
        msgToAgent.set(prefixed, agentId);
      }
      console.log(`  Restored ${msgToAgent.size} message routes`);
    } catch (e: unknown) {
      const msg = errorMessage(e);
      console.log(`  ⚠️ Could not load routing: ${msg}`);
    }
  }

  // Load pinned status message IDs from previous session
  if (existsSync(STATUS_FILE)) {
    try {
      Object.assign(statusMsgs, JSON.parse(readFileSync(STATUS_FILE, 'utf8')));
      console.log(
        `  Restored pinned status IDs: ${
          Object.keys(statusMsgs)
            .filter(k => statusMsgs[k])
            .join(', ') || 'none'
        }`,
      );
    } catch {
      // ignore
    }
  }
}
