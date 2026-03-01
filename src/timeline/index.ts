import crypto from 'node:crypto';
import * as storage from './storage.js';
import type { TimelineEvent, TimelineEventType } from '../types/index.js';

const MAX_EVENTS = parseInt(process.env.TIMELINE_MAX_EVENTS || '500', 10);
const TRIM_INTERVAL = parseInt(process.env.TIMELINE_TRIM_INTERVAL || '100', 10);

let events: TimelineEvent[] = [];
let broadcastFn: ((msg: { type: string; event: TimelineEvent }) => void) | null = null;
let appendCount = 0;

interface MessageGeneratorArg {
  agentName: string | null;
  meta: Record<string, unknown> | null;
}

const MESSAGES: Record<string, (e: MessageGeneratorArg) => string> = {
  spawn: (e) => `Spawned ${e.agentName}`,
  delegate: (e) => `${(e.meta?.parentName as string) || '?'} delegated to ${e.agentName}`,
  reborn: (e) => `Reborn ${e.agentName}`,
  message_sent: (e) => `Sent to ${e.agentName}: ${((e.meta?.preview as string) || '').substring(0, 60)}`,
  response: (e) => `${e.agentName} responded (${(e.meta?.chars as string) || '?'} chars)`,
  timeout: (e) => `${e.agentName} timed out`,
  model_switch: (e) => `${e.agentName} switched to ${(e.meta?.model as string) || '?'}`,
  skill_inject: (e) => `Skills injected for ${e.agentName}`,
  cwd_change: (e) => `${e.agentName} moved to ${(e.meta?.cwd as string) || '?'}`,
  file_sent: (e) => `${e.agentName} sent file: ${(e.meta?.file as string) || '?'}`,
  stop: (e) => `Stopped: ${e.agentName}`,
  clear: (e) => `Cleared ${e.agentName}`,
  hard_delete: (e) => `Deleted ${e.agentName}`,
  reset: (e) => `Reset ${e.agentName}`,
  security_block: (e) => `Blocked [${(e.meta?.category as string) || 'unknown'}]`,
  server: (e) => (e.meta?.action as string) || 'Server event',
};

interface InitializeOptions {
  broadcast: (msg: { type: string; event: TimelineEvent }) => void;
}

export function initialize({ broadcast }: InitializeOptions): void {
  broadcastFn = broadcast;
  events = storage.load();
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }
  const count = events.length;
  if (count > 0) {
    console.log(`  📋 Timeline: loaded ${count} event(s)`);
  } else {
    console.log('  📋 Timeline: initialized (no events yet)');
  }
}

interface EmitOptions {
  agentId?: string | null;
  agentName?: string | null;
  backend?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
}

export function emit(type: TimelineEventType, { agentId = null, agentName = null, backend = null, message = null, meta = null }: EmitOptions = {}): void {
  const event: TimelineEvent = {
    id: 'evt_' + crypto.randomBytes(6).toString('hex'),
    type,
    agentId,
    agentName,
    backend,
    timestamp: new Date().toISOString(),
    message: message || (MESSAGES[type] ? MESSAGES[type]({ agentName, meta }) : type),
    meta,
  };

  events.push(event);
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }

  storage.append(event);
  appendCount++;
  if (appendCount >= TRIM_INTERVAL) {
    storage.trim(MAX_EVENTS);
    storage.rotate();
    appendCount = 0;
  }

  if (broadcastFn) {
    broadcastFn({ type: 'timeline_event', event });
  }
}

interface GetAllOptions {
  limit?: number;
  offset?: number;
  agentId?: string | null;
  agentName?: string | null;
  backend?: string | null;
  eventType?: TimelineEventType | null;
}

export function getAll({ limit = 100, offset = 0, agentId = null, agentName = null, backend = null, eventType = null }: GetAllOptions = {}): TimelineEvent[] {
  let filtered = events;
  if (agentId) filtered = filtered.filter(e => e.agentId === agentId);
  if (agentName) filtered = filtered.filter(e => e.agentName === agentName);
  if (backend) filtered = filtered.filter(e => e.backend === backend);
  if (eventType) filtered = filtered.filter(e => e.type === eventType);
  return filtered.slice(offset, offset + limit);
}

export function getRecent(n: number = 50): TimelineEvent[] {
  return events.slice(-n);
}
