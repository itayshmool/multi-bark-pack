/**
 * Server configuration — env vars parsed into typed constants.
 */

import { mkdirSync } from 'node:fs';
import type { ServerConfig, ExecOpts, OwnerIds } from '../types/index.js';
import {
  TMP_DIR,
  PROJECTS_DIR,
  TOOLS_DIR,
  MCP_CONFIG_FILE,
  AGENTS_FILE,
  ROUTING_FILE,
  STATUS_FILE,
  PACKS_FILE,
} from '../config/paths.js';

// Re-export path constants for convenience
export {
  TMP_DIR,
  PROJECTS_DIR,
  TOOLS_DIR,
  MCP_CONFIG_FILE,
  AGENTS_FILE,
  ROUTING_FILE,
  STATUS_FILE,
  PACKS_FILE,
};

/** Parse a comma-separated owner env var into a Set, 'DANGER-ALL', or null. */
export function parseOwners(envVal: string | undefined): Set<string> | 'DANGER-ALL' | null {
  if (!envVal) return null;
  if (envVal === 'DANGER-ALL') return 'DANGER-ALL';
  return new Set(envVal.split(',').map(s => s.trim()).filter(Boolean));
}

// --- Parsed config constants ---

export const GROUP_NAME: string = process.env.WA_GROUP || 'bark-pack';
export const TELEGRAM_TOKEN: string | null = process.env.TELEGRAM_TOKEN || null;
export const TELEGRAM_CHAT_ID: string | null = process.env.TELEGRAM_CHAT_ID || null;
export const SLACK_BOT_TOKEN: string | null = process.env.SLACK_BOT_TOKEN || null;
export const SLACK_APP_TOKEN: string | null = process.env.SLACK_APP_TOKEN || null;
export const WA_ENABLED: boolean = process.env.WA_ENABLED !== 'false';

export const OWNER_IDS: OwnerIds = {
  whatsapp: parseOwners(process.env.WA_OWNER),
  telegram: parseOwners(process.env.TG_OWNER),
  slack: parseOwners(process.env.SLACK_OWNER),
};

export const WHISPER_MODEL: string =
  process.env.WHISPER_MODEL || '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin';
export const DEFAULT_BACKEND: string = process.env.DEFAULT_BACKEND || 'claude-code';
export const ENABLED_BACKENDS: string[] = (process.env.ENABLED_BACKENDS || 'claude-code')
  .split(',')
  .map(s => s.trim());
export const UI_PORT: number = parseInt(process.env.UI_PORT || '3333', 10);
export const API_SECRET: string | null = process.env.API_SECRET || null;

const SHELL_PATH: string = process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

/** Clean environment with CLAUDECODE removed and PATH augmented. */
export const cleanEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `/opt/homebrew/bin:${SHELL_PATH}` };
delete cleanEnv.CLAUDECODE;

/** Default options for child_process exec/execSync. */
export const EXEC_OPTS: ExecOpts = { env: cleanEnv, maxBuffer: 50 * 1024 * 1024 };

// --- Timeouts ---
export const AGENT_TIMEOUT: number = parseInt(process.env.AGENT_TIMEOUT || '600000', 10);

// --- Delegation limits ---
export const MAX_DELEGATION_DEPTH: number = parseInt(process.env.MAX_DELEGATION_DEPTH || '1', 10);
export const MAX_SUB_AGENTS: number = parseInt(process.env.MAX_SUB_AGENTS || '3', 10);

// --- Repo path (set by start.sh --path=) ---
export const REPO_PATH: string | null = process.env.BARK_REPO_PATH || null;
export const REPO_NAME: string | null = process.env.BARK_REPO_NAME || null;

/** Ensure required directories exist. */
export function ensureDirectories(): void {
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(PROJECTS_DIR, { recursive: true });
}

/** Build the full ServerConfig object (useful for testing). */
export function getConfig(): ServerConfig {
  return {
    groupName: GROUP_NAME,
    telegramToken: TELEGRAM_TOKEN,
    telegramChatId: TELEGRAM_CHAT_ID,
    slackBotToken: SLACK_BOT_TOKEN,
    slackAppToken: SLACK_APP_TOKEN,
    waEnabled: WA_ENABLED,
    ownerIds: OWNER_IDS,
    whisperModel: WHISPER_MODEL,
    defaultBackend: DEFAULT_BACKEND,
    enabledBackends: ENABLED_BACKENDS,
    uiPort: UI_PORT,
    apiSecret: API_SECRET,
    shellPath: SHELL_PATH,
    agentTimeout: AGENT_TIMEOUT,
    maxDelegationDepth: MAX_DELEGATION_DEPTH,
    maxSubAgents: MAX_SUB_AGENTS,
  };
}
