import { errorMessage } from '../utils/error.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import type { UsageData } from '../types/index.js';

export const USAGE_FILE = path.join(TMP_DIR, 'usage.json');

export function createEmpty(): UsageData {
  return { version: 1, agents: {}, totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 } };
}

export function load(): UsageData {
  if (!existsSync(USAGE_FILE)) return createEmpty();
  try {
    return JSON.parse(readFileSync(USAGE_FILE, 'utf8')) as UsageData;
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not load usage data: ${message}`);
    return createEmpty();
  }
}

export function save(data: UsageData): boolean {
  return atomicWriteJSON(USAGE_FILE, data, 'usage data');
}
