/**
 * Pack management and pup naming.
 */

import { errorMessage } from '../utils/error.js';
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Agent, Pack, PacksData } from '../types/index.js';
import { PACKS_FILE } from './config.js';
import { getAgents, getDeletedAgents } from './state.js';
import { broadcastToWS } from './websocket.js';

// --- Module-level state ---
let packsData: PacksData = { activePack: 'paw-patrol', packs: {} };
let pupBaseIndex = 0;

export function loadPacks(): void {
  if (existsSync(PACKS_FILE)) {
    try {
      packsData = JSON.parse(readFileSync(PACKS_FILE, 'utf8')) as PacksData;
      console.log(
        `  Loaded ${Object.keys(packsData.packs).length} packs, active: ${packsData.activePack}`,
      );
    } catch (e: unknown) {
      const msg = errorMessage(e);
      console.log(`  ⚠️ Could not load packs: ${msg}`);
    }
  }
}

export function savePacks(): void {
  writeFileSync(PACKS_FILE, JSON.stringify(packsData, null, 2));
  broadcastPacks();
}

export function getActivePack(): Pack | undefined {
  return packsData.packs[packsData.activePack] || Object.values(packsData.packs)[0];
}

export function getAgentIcon(agent: Agent): string {
  if (agent.packId && packsData.packs[agent.packId]) {
    const pack = packsData.packs[agent.packId];
    // Check for per-name icon
    if (pack.icons && pack.names) {
      const baseName = agent.name.includes('-') ? agent.name.split('-').pop()! : agent.name;
      const nameIndex = pack.names.findIndex(n => n === baseName || n === agent.name);
      if (nameIndex >= 0 && pack.icons[nameIndex]) {
        return pack.icons[nameIndex];
      }
    }
    return pack.icon || '🐕';
  }
  return '🐕';
}

export function getPacks(): PacksData {
  return packsData;
}

export function getActivePackId(): string {
  return packsData.activePack;
}

export function setActivePack(packId: string): boolean {
  if (!packsData.packs[packId]) return false;
  packsData.activePack = packId;
  pupBaseIndex = 0; // Reset index when switching packs
  savePacks();
  return true;
}

export function createPack(pack: Partial<Pack> & { id?: string }): Pack | null {
  if (!pack.id || !pack.name || !pack.names || !pack.adjectives) return null;
  if (packsData.packs[pack.id]) return null; // Already exists
  packsData.packs[pack.id] = { ...pack, builtin: false } as Pack;
  savePacks();
  return packsData.packs[pack.id];
}

export function updatePack(
  packId: string,
  updates: Partial<Pack> & Record<string, unknown>,
): Pack | null {
  if (!packsData.packs[packId]) return null;
  // Can't change id or builtin status
  const { id: _id, builtin: _builtin, ...allowed } = updates;
  Object.assign(packsData.packs[packId], allowed);
  savePacks();
  return packsData.packs[packId];
}

export function deletePack(packId: string): boolean {
  const pack = packsData.packs[packId];
  if (!pack || pack.builtin) return false; // Can't delete builtin packs
  delete packsData.packs[packId];
  if (packsData.activePack === packId) {
    packsData.activePack = Object.keys(packsData.packs)[0] || 'paw-patrol';
  }
  savePacks();
  return true;
}

export function broadcastPacks(): void {
  broadcastToWS({ type: 'packs', packs: packsData });
}

export function nextPupName(): string {
  const pack = getActivePack();
  const names = pack?.names || [];
  const adjectives = pack?.adjectives || [];

  // Collect all names currently in use (active + deleted)
  const agents = getAgents();
  const deletedAgents = getDeletedAgents();
  const usedNames = new Set([
    ...[...agents.values()].map(a => a.name),
    ...[...deletedAgents.values()].map(a => a.name),
  ]);

  // Try each base name starting from pupBaseIndex
  for (let i = 0; i < names.length; i++) {
    const base = names[(pupBaseIndex + i) % names.length];
    if (!usedNames.has(base)) {
      pupBaseIndex = (pupBaseIndex + i + 1) % names.length;
      return base;
    }
  }

  // All bare names taken — pick a random adjective + random base
  for (let attempt = 0; attempt < 200; attempt++) {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const base = names[Math.floor(Math.random() * names.length)];
    const name = `${adj}-${base}`;
    if (!usedNames.has(name)) return name;
  }

  // Absolute fallback
  return `agent-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Sanitize agent name to prevent command injection.
 * Only allows alphanumeric, hyphens, and underscores.
 * Returns null if the name is empty after sanitization.
 */
export function sanitizeName(name: string | undefined | null): string | null {
  if (!name) return null;
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || null;
}
