/**
 * Backend Registry
 * Manages available LLM agent backends
 */

import createClaudeCodeBackend from './claude-code.js';
import createCursorBackend from './cursor.js';
import createCodexBackend from './codex.js';
import createGeminiBackend from './gemini.js';
import type { Backend, BackendCapabilities } from '../types/index.js';

type BackendFactory = (config: Record<string, unknown>) => Backend;

// Backend factory functions
const backendFactories: Record<string, BackendFactory> = {
  'claude-code': createClaudeCodeBackend,
  'cursor': createCursorBackend,
  'codex': createCodexBackend,
  'gemini': createGeminiBackend,
};

// Instantiated backends (cached)
const backends: Record<string, Backend> = {};

interface InitConfig {
  enabledBackends?: string[];
  defaultBackend?: string;
  [key: string]: unknown;
}

/**
 * Initialize all enabled backends
 */
export async function initialize(config: InitConfig = {}): Promise<Record<string, Backend>> {
  const enabledBackends = config.enabledBackends || ['claude-code'];
  const defaultBackend = config.defaultBackend || 'claude-code';

  for (const name of enabledBackends) {
    const factory = backendFactories[name];
    if (!factory) {
      console.log(`  ⚠️ Unknown backend: ${name}`);
      continue;
    }

    const backend = factory((config[name] as Record<string, unknown>) || {});
    const installed = await backend.isInstalled();

    if (installed) {
      backends[name] = backend;
      const version = await backend.getVersion();
      console.log(`  ✓ Backend ${backend.displayName} v${version || 'unknown'}`);
    } else {
      console.log(`  ✗ Backend ${backend.displayName} not installed`);
    }
  }

  if (!backends[defaultBackend]) {
    const fallback = Object.keys(backends)[0];
    if (fallback) {
      console.log(`  ⚠️ Default backend '${defaultBackend}' not available, using '${fallback}'`);
    } else {
      throw new Error('No backends available');
    }
  }

  return backends;
}

/**
 * Get a backend by name
 */
export function get(name: string): Backend | null {
  return backends[name] || null;
}

/**
 * Get the default backend
 */
export function getDefault(defaultName: string = 'claude-code'): Backend {
  return backends[defaultName] || backends[Object.keys(backends)[0]];
}

interface BackendListItem {
  name: string;
  displayName: string;
  models: string[];
  defaultModel: string;
  capabilities: BackendCapabilities;
}

/**
 * List all available backends
 */
export function list(): BackendListItem[] {
  return Object.values(backends).map(b => ({
    name: b.name,
    displayName: b.displayName,
    models: b.models,
    defaultModel: b.defaultModel,
    capabilities: b.capabilities,
  }));
}

/**
 * Check if a backend is available
 */
export function isAvailable(name: string): boolean {
  return !!backends[name];
}

interface CapabilityMatrix {
  capabilities: string[];
  backends: Record<string, BackendCapabilities>;
}

/**
 * Get capability matrix for all backends
 */
export function getCapabilityMatrix(): CapabilityMatrix {
  const allCapabilities = new Set<string>();
  const matrix: Record<string, BackendCapabilities> = {};

  for (const [name, backend] of Object.entries(backends)) {
    matrix[name] = backend.capabilities;
    for (const cap of Object.keys(backend.capabilities)) {
      allCapabilities.add(cap);
    }
  }

  return {
    capabilities: [...allCapabilities].sort(),
    backends: matrix,
  };
}

/**
 * Format capability matrix for display
 */
export function formatCapabilityMatrix(): string {
  const { capabilities: _capabilities, backends: matrix } = getCapabilityMatrix();
  const backendNames = Object.keys(matrix);

  if (backendNames.length === 0) {
    return 'No backends available';
  }

  const lines: string[] = ['*Backends*\n'];

  // Simple format for chat
  for (const name of backendNames) {
    const backend = backends[name];
    const caps = (Object.entries(backend.capabilities) as [string, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');
    lines.push(`✓ *${backend.displayName}*: ${backend.models.join(', ')}`);
    lines.push(`  _${caps}_`);
  }

  return lines.join('\n');
}
