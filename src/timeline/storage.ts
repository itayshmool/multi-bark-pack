import { errorMessage } from '../utils/error.js';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import type { TimelineEvent } from '../types/index.js';

export const TIMELINE_FILE = path.join(TMP_DIR, 'timeline.jsonl');

// Rotation config
const MAX_FILE_SIZE = parseInt(process.env.TIMELINE_MAX_FILE_SIZE as string, 10) || 5 * 1024 * 1024; // 5MB default
const MAX_ROTATED_FILES = parseInt(process.env.TIMELINE_MAX_ROTATED_FILES as string, 10) || 3;

function rotatedPath(n: number): string {
  return path.join(TMP_DIR, `timeline.${n}.jsonl`);
}

export function load(): TimelineEvent[] {
  if (!existsSync(TIMELINE_FILE)) return [];
  try {
    const lines = readFileSync(TIMELINE_FILE, 'utf8').split('\n').filter(l => l.trim());
    const events: TimelineEvent[] = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line) as TimelineEvent); } catch { /* skip malformed lines */ }
    }
    return events;
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not load timeline: ${message}`);
    return [];
  }
}

export function append(event: TimelineEvent): void {
  try {
    appendFileSync(TIMELINE_FILE, JSON.stringify(event) + '\n');
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not append timeline event: ${message}`);
  }
}

export function rotate(): void {
  if (!existsSync(TIMELINE_FILE)) return;
  try {
    const stats = statSync(TIMELINE_FILE);
    if (stats.size < MAX_FILE_SIZE) return;

    // Shift existing rotated files: timeline.2.jsonl -> timeline.3.jsonl, etc.
    // Delete the oldest if at max
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const from = i === 1 ? TIMELINE_FILE : rotatedPath(i - 1);
      const to = rotatedPath(i);
      if (i === MAX_ROTATED_FILES) {
        // Delete the oldest rotated file to make room
        try { unlinkSync(to); } catch { /* ignore */ }
      }
      if (existsSync(from)) {
        renameSync(from, to);
      }
    }
    // TIMELINE_FILE has been renamed to timeline.1.jsonl — create fresh
    writeFileSync(TIMELINE_FILE, '');
    console.log(`  📋 Timeline: rotated log (was ${(stats.size / 1024).toFixed(0)}KB)`);
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not rotate timeline: ${message}`);
  }
}

export function trim(maxLines: number): void {
  if (!existsSync(TIMELINE_FILE)) return;
  try {
    const lines = readFileSync(TIMELINE_FILE, 'utf8').split('\n').filter(l => l.trim());
    if (lines.length <= maxLines) return;
    const trimmed = lines.slice(-maxLines);
    const tmpPath = `${TIMELINE_FILE}.tmp`;
    writeFileSync(tmpPath, trimmed.join('\n') + '\n');
    renameSync(tmpPath, TIMELINE_FILE);
  } catch (err) {
    const message = errorMessage(err);
    console.log(`  ⚠️ Could not trim timeline: ${message}`);
  }
}

export function clear(): void {
  try { unlinkSync(TIMELINE_FILE); } catch { /* ignore */ }
  // Also clean up rotated files
  for (let i = 1; i <= MAX_ROTATED_FILES; i++) {
    try { unlinkSync(rotatedPath(i)); } catch { /* ignore */ }
  }
}
