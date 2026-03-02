import { errorMessage } from '../utils/error.js';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import type { SecurityLogEntry } from '../types/index.js';

export const LOG_FILE = path.join(TMP_DIR, 'security.log');

export function logBlocked(entry: Omit<SecurityLogEntry, 'type'>): void {
  const line = JSON.stringify({
    type: 'blocked' as const,
    ...entry,
    text: entry.text?.substring(0, 500),
  });
  try {
    appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Security log write failed: ${message}`);
  }
}

export function logError(errMsg: string): void {
  const line = JSON.stringify({
    type: 'error' as const,
    message: errMsg,
    timestamp: new Date().toISOString(),
  });
  try {
    appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Security log write failed: ${message}`);
  }
}
