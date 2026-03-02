import { errorMessage } from '../utils/error.js';
import { execFile } from 'node:child_process';
import { SYSTEM_PROMPT } from './prompt.js';
import { prefilterScreen } from './prefilter.js';
import * as logger from './logger.js';
import type { SecurityVerdict, SecurityConfig } from '../types/index.js';

const ENABLED = process.env.SECURITY_GUARD_ENABLED === 'true';
const FAIL_OPEN = process.env.SECURITY_GUARD_FAIL_OPEN !== 'false';
const MAX_TEXT_LENGTH = parseInt(process.env.SECURITY_GUARD_MAX_TEXT_LEN || '4000', 10);
const TIMEOUT_MS = parseInt(process.env.SECURITY_GUARD_TIMEOUT_MS || '30000', 10);
const MAX_CONCURRENT = parseInt(process.env.SECURITY_GUARD_MAX_CONCURRENT || '2', 10);

let active = false;
let _inflight = 0;
const _queue: Array<{ resolve: (v: SecurityVerdict) => void; text: string }> = [];

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

  // Deterministic pre-filter catches obvious attacks before the LLM
  const pf = prefilterScreen(text);
  if (pf.blocked) {
    logger.logBlocked({
      text: text.substring(0, MAX_TEXT_LENGTH),
      category: pf.category ?? undefined,
      reason: `[prefilter] ${pf.reason}`,
      latencyMs: 0,
      timestamp: new Date().toISOString(),
    });
    return {
      allowed: false,
      category: pf.category,
      reason: pf.reason,
      latencyMs: 0,
    };
  }

  // Concurrency limiter: avoid spawning too many claude processes
  if (_inflight >= MAX_CONCURRENT) {
    return new Promise<SecurityVerdict>(resolve => {
      _queue.push({ resolve, text });
    });
  }

  return _runScreen(text);
}

async function _runScreen(text: string): Promise<SecurityVerdict> {
  _inflight++;
  try {
    return await _doScreen(text);
  } finally {
    _inflight--;
    if (_queue.length > 0) {
      const next = _queue.shift()!;
      _runScreen(next.text).then(next.resolve);
    }
  }
}

async function _doScreen(text: string): Promise<SecurityVerdict> {
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
  // Try strict JSON parse first
  try {
    const trimmed = output.trim();
    // Extract JSON object if wrapped in markdown or text
    const jsonMatch = trimmed.match(/\{[^{}]*"allowed"\s*:\s*(true|false)[^{}]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : trimmed;
    const json = JSON.parse(jsonStr) as { allowed?: boolean; category?: string; reason?: string };
    return {
      allowed: json.allowed === true,
      category: json.category || null,
      reason: json.reason || null,
    };
  } catch {
    const lower = output.toLowerCase();
    // When both appear, deny wins (security-conservative)
    const hasFalse = lower.includes('"allowed": false') || lower.includes('"allowed":false');
    if (hasFalse) {
      const catMatch = output.match(/"category"\s*:\s*"([^"]+)"/);
      const reasonMatch = output.match(/"reason"\s*:\s*"([^"]+)"/);
      return {
        allowed: false,
        category: catMatch ? catMatch[1] : 'unknown',
        reason: reasonMatch ? reasonMatch[1] : 'Message flagged by security',
      };
    }
    const hasTrue = lower.includes('"allowed": true') || lower.includes('"allowed":true');
    if (hasTrue) {
      return { allowed: true, category: null, reason: null };
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
