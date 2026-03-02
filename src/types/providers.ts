/**
 * Provider interfaces — shared type shapes for lazily-injected dependencies.
 *
 * Each interface captures the subset of a module's API that consumers actually use.
 * This eliminates duplicate inline type declarations across server modules.
 */

import type { Agent } from './agents.js';
import type { Adapter } from './adapters.js';
import type { Backend } from './backends.js';
import type { SecurityVerdict } from './security.js';

// ---------------------------------------------------------------------------
// BackendsProvider
// ---------------------------------------------------------------------------

export interface BackendsProvider {
  get(name: string): Backend | undefined;
  getDefault(name: string): Backend;
  isAvailable(name: string): boolean;
  list(): Array<{ name: string; [key: string]: unknown }>;
  formatCapabilityMatrix(): string;
}

// ---------------------------------------------------------------------------
// HistoryManagerProvider
// ---------------------------------------------------------------------------

export interface HistoryManagerProvider {
  addUserTurn(agentId: string, content: string, files?: unknown[]): unknown;
  addAssistantTurn(agentId: string, content: string, options?: Record<string, unknown>): unknown;
  extractToolsFromOutput(output: string): string[];
  recordError(agentId: string, errorType: string, errorMessage: string): unknown;
  clear(agentId: string): boolean;
  remove(agentId: string): boolean;
  getContext(agentId: string): {
    summary: string | null;
    cwd: string | null;
    filesModified: string[];
  };
  load(agentId: string): {
    turns: Array<{
      role: string;
      content: string;
      timestamp: string;
      tools?: string[];
      files?: Array<{ filename: string; filepath: string; type: string }>;
    }>;
  };
}

// ---------------------------------------------------------------------------
// UsageTrackerProvider
// ---------------------------------------------------------------------------

export interface UsageTrackerProvider {
  record(agentId: string, agentName: string, backend: string, usageData: unknown): void;
  getAll(): {
    totals: { costUsd: number; inputTokens: number; outputTokens: number; turns: number };
    agents: Record<
      string,
      {
        name: string;
        backend: string;
        totalCostUsd: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        turns: number;
        firstSeen: string;
        estimated?: boolean;
      }
    >;
  };
}

// ---------------------------------------------------------------------------
// TimelineProvider
// ---------------------------------------------------------------------------

export interface TimelineProvider {
  emit(type: string, opts: Record<string, unknown>): void;
  getAll(opts: Record<string, unknown>): unknown;
  getRecent(n: number): unknown[];
}

// ---------------------------------------------------------------------------
// SkillsManagerProvider
// ---------------------------------------------------------------------------

export interface SkillsManagerProvider {
  list(userInvocable?: boolean): Array<{ id: string }>;
  has(name: string): boolean;
  get(name: string): { name: string; description: string; tokens: number } | undefined;
  formatList(): string;
  buildSkillPrompt(skillIds: string[]): string | null;
}

// ---------------------------------------------------------------------------
// SecurityGuardProvider
// ---------------------------------------------------------------------------

export interface SecurityGuardProvider {
  isEnabled(): boolean;
  screen(text: string): Promise<SecurityVerdict>;
}

// ---------------------------------------------------------------------------
// FallbackManagerProvider
// ---------------------------------------------------------------------------

export interface FallbackManagerProvider {
  config: {
    timeout: { commandMs: number };
    enabled: boolean;
  };
  detector: {
    classifyFailure(
      output: string,
      exitCode: string,
      checkExitCode: boolean,
    ): { type: string } | null;
  };
  executeFallback(
    agent: Agent,
    failure: { type: string },
    adapter: Adapter,
    backends: unknown,
    extra: unknown,
  ): Promise<{ success: boolean; action?: string }>;
  buildNotification(
    agent: Agent,
    result: { success: boolean; action?: string },
    failure: { type: string },
  ): string | null;
}
