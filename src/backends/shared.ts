/**
 * Shared backend utilities and metadata
 * Reduces duplication across backend implementations
 */

import { execSync } from 'node:child_process';

export const BACKEND_EXEC_OPTS = { encoding: 'utf8' as const, timeout: 10000 };

export function isCliInstalled(cli: string): boolean {
  try {
    execSync(`which ${cli}`, BACKEND_EXEC_OPTS);
    return true;
  } catch {
    return false;
  }
}

export function getCliVersion(versionCmd: string): string | null {
  try {
    return execSync(versionCmd, BACKEND_EXEC_OPTS).trim();
  } catch {
    return null;
  }
}

export interface BackendMeta {
  name: string;
  displayName: string;
  cli: string;
  models: string[];
  defaultModel: string;
}

export const BACKEND_METADATA: Record<string, BackendMeta> = {
  'claude-code': { name: 'claude-code', displayName: 'Claude Code', cli: 'claude', models: ['opus', 'sonnet', 'haiku'], defaultModel: 'sonnet' },
  cursor: { name: 'cursor', displayName: 'Cursor', cli: 'cursor-agent', models: ['auto', 'opus-4.6-thinking', 'opus-4.5', 'sonnet-4.5', 'sonnet-4.6', 'gpt-5.3-codex'], defaultModel: 'auto' },
  codex: { name: 'codex', displayName: 'Codex', cli: 'codex', models: ['default', 'o3', 'o4-mini'], defaultModel: 'default' },
  gemini: { name: 'gemini', displayName: 'Gemini', cli: 'gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], defaultModel: 'gemini-2.5-pro' },
};
