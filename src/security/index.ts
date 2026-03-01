import { errorMessage } from '../utils/error.js';
import { execFile } from 'node:child_process';
import { SYSTEM_PROMPT } from './prompt.js';
import * as logger from './logger.js';
import type { SecurityVerdict, SecurityConfig } from '../types/index.js';

const ENABLED = process.env.SECURITY_GUARD_ENABLED === 'true';
const FAIL_OPEN = process.env.SECURITY_GUARD_FAIL_OPEN !== 'false';
const MAX_TEXT_LENGTH = parseInt(process.env.SECURITY_GUARD_MAX_TEXT_LEN || '4000', 10);
const TIMEOUT_MS = parseInt(process.env.SECURITY_GUARD_TIMEOUT_MS || '30000', 10);

let active = false;

export function initialize(): SecurityConfig {
  if (!ENABLED) {
    console.log('  🛡️ Security Guard: disabled');
    return { enabled: false, failOpen: FAIL_OPEN };
  }

  active = true;
  console.log(`  🛡️ Security Guard: enabled (via claude CLI, fail-open: ${FAIL_OPEN})`);
  return { enabled: true, failOpen: FAIL_OPEN };
}

export async function screen(text: string): Promise<SecurityVerdict> {
  if (!active) {
    return { allowed: true, category: null, reason: null, latencyMs: 0 };
  }

  const truncated = text.length > MAX_TEXT_LENGTH
    ? text.substring(0, MAX_TEXT_LENGTH) + '... [truncated]'
    : text;

  const prompt = `${SYSTEM_PROMPT}\n\n---\n\nMessage to screen:\n${truncated}`;
  const start = Date.now();

  try {
    const output = await runClaude(prompt);
    const latencyMs = Date.now() - start;
    const verdict = parseVerdict(output);

    if (!verdict.allowed) {
      logger.logBlocked({
        text: truncated,
        category: verdict.category ?? undefined,
        reason: verdict.reason ?? undefined,
        latencyMs,
        timestamp: new Date().toISOString(),
      });
    }

    return { ...verdict, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = errorMessage(err);
    console.log(`  ⚠️ Security Guard error (${latencyMs}ms): ${message}`);
    logger.logError(message);

    return {
      allowed: FAIL_OPEN,
      category: FAIL_OPEN ? null : 'error',
      reason: FAIL_OPEN ? null : 'Security check unavailable',
      latencyMs,
    };
  }
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    execFile('claude', ['-p', prompt, '--model', 'haiku', '--output-format', 'text'], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 64,
      env,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(err.killed ? 'Security check timed out' : (stderr || err.message)));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

interface Verdict {
  allowed: boolean;
  category: string | null;
  reason: string | null;
}

function parseVerdict(output: string): Verdict {
  try {
    const json = JSON.parse(output.trim()) as { allowed?: boolean; category?: string; reason?: string };
    return {
      allowed: json.allowed === true,
      category: json.category || null,
      reason: json.reason || null,
    };
  } catch {
    const lower = output.toLowerCase();
    if (lower.includes('"allowed": true') || lower.includes('"allowed":true')) {
      return { allowed: true, category: null, reason: null };
    }
    if (lower.includes('"allowed": false') || lower.includes('"allowed":false')) {
      const catMatch = output.match(/"category"\s*:\s*"([^"]+)"/);
      const reasonMatch = output.match(/"reason"\s*:\s*"([^"]+)"/);
      return {
        allowed: false,
        category: catMatch ? catMatch[1] : 'unknown',
        reason: reasonMatch ? reasonMatch[1] : 'Message flagged by security',
      };
    }
    console.log('  ⚠️ Security Guard: unparseable response, blocking message');
    logger.logBlocked({
      text: '(unparseable verdict)',
      category: 'parse_failure',
      reason: 'Security guard returned unparseable response — defaulting to deny',
      latencyMs: 0,
      timestamp: new Date().toISOString(),
    });
    return { allowed: false, category: 'parse_failure', reason: 'Security check returned unparseable response' };
  }
}

export function isEnabled(): boolean {
  return active;
}
