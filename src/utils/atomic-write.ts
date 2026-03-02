import { errorMessage } from './error.js';
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';

let _counter = 0;

export function atomicWriteJSON(filePath: string, data: unknown, label: string = filePath): boolean {
  const tmpPath = `${filePath}.${Date.now()}${_counter++}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not save ${label}: ${message}`);
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    return false;
  }
}

