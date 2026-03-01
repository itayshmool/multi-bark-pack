/**
 * Policy engine + approval state machine.
 *
 * Loads bark-policy.json (block-by-default), evaluates tool calls against rules,
 * manages approval requests, and resolves approve/deny replies from chat.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, TMP_DIR } from '../config/paths.js';
import type {
  Agent,
  Adapter,
  ApprovalPolicy,
  ApprovalRequest,
  PolicyAction,
  PolicyRule,
  ViolationRecord,
} from '../types/index.js';
import { setMsgAgent, saveState } from './state.js';
import { deliverResponse } from './execution.js';
import { updatePinnedStatus } from './status.js';
import { broadcastAgents } from './websocket.js';

const POLICY_FILE = path.join(ROOT_DIR, 'bark-policy.json');
const POLICY_DEFAULT_FILE = path.join(ROOT_DIR, 'bark-policy.default.json');
const AUDIT_LOG_FILE = path.join(TMP_DIR, 'approval.log');

const DEFAULT_POLICY: ApprovalPolicy = {
  defaultAction: 'block',
  approvalTimeout: 300_000,
  rules: [],
  barkignore: [],
};

let _policy: ApprovalPolicy = { ...DEFAULT_POLICY };
let _compiledRules: Array<{ tool: RegExp; pattern: RegExp | null; action: PolicyAction }> = [];
let _compiledIgnore: RegExp[] = [];
let _approvalTimer: ReturnType<typeof setInterval> | null = null;
let _getAgentsFn: (() => Map<string, Agent>) | null = null;
let _getAdaptersFn: (() => Adapter[]) | null = null;

// ── Bootstrap ────────────────────────────────────────────────────

export function initApproval(deps: {
  getAgents: () => Map<string, Agent>;
  getAdapters: () => Adapter[];
}): void {
  _getAgentsFn = deps.getAgents;
  _getAdaptersFn = deps.getAdapters;
  loadPolicy();
  startTimeoutChecker();
}

export function loadPolicy(): void {
  try {
    if (fs.existsSync(POLICY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf-8'));
      const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
      const validRules = validateRules(rawRules);
      _policy = {
        defaultAction: isValidAction(raw.defaultAction) ? raw.defaultAction : DEFAULT_POLICY.defaultAction,
        approvalTimeout: typeof raw.approvalTimeout === 'number' ? raw.approvalTimeout : DEFAULT_POLICY.approvalTimeout,
        rules: validRules,
        barkignore: Array.isArray(raw.barkignore) ? raw.barkignore.filter((g: unknown) => typeof g === 'string') : [],
      };
      const skipped = rawRules.length - validRules.length;
      const skippedMsg = skipped > 0 ? ` (${skipped} invalid rules skipped)` : '';
      console.log(`  🛡️ Loaded approval policy (${_policy.rules.length} rules, default: ${_policy.defaultAction})${skippedMsg}`);
    } else if (fs.existsSync(POLICY_DEFAULT_FILE)) {
      fs.copyFileSync(POLICY_DEFAULT_FILE, POLICY_FILE);
      console.log('  🛡️ Created bark-policy.json from bark-policy.default.json (edit to customize)');
      loadPolicy();
      return;
    } else {
      _policy = { ...DEFAULT_POLICY };
      console.log('  🛡️ No bark-policy.json — using default policy (block)');
    }
  } catch (e) {
    console.error(`  ⚠️ Failed to parse bark-policy.json, using defaults:`, e);
    _policy = { ...DEFAULT_POLICY };
  }
  compileRules();
}

// ── Schema validation ────────────────────────────────────────────

function isValidAction(action: unknown): action is PolicyAction {
  return action === 'auto_approve' || action === 'require_approval' || action === 'block';
}

function validateRules(rules: unknown[]): PolicyRule[] {
  const valid: PolicyRule[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') {
      console.warn(`  ⚠️ Rule #${i}: not an object — skipped`);
      continue;
    }
    if (typeof r.tool !== 'string' || !r.tool) {
      console.warn(`  ⚠️ Rule #${i}: missing or invalid 'tool' — skipped`);
      continue;
    }
    if (!isValidAction(r.action)) {
      console.warn(`  ⚠️ Rule #${i}: invalid action '${String(r.action)}' — skipped`);
      continue;
    }
    if (r.pattern !== undefined && typeof r.pattern !== 'string') {
      console.warn(`  ⚠️ Rule #${i}: pattern must be a string — skipped`);
      continue;
    }
    if (typeof r.pattern === 'string') {
      try {
        new RegExp(r.pattern);
      } catch {
        console.warn(`  ⚠️ Rule #${i}: invalid regex pattern '${r.pattern}' — skipped`);
        continue;
      }
    }
    valid.push({ tool: r.tool, pattern: r.pattern as string | undefined, action: r.action });
  }
  return valid;
}

// ── Rule compilation ─────────────────────────────────────────────

function compileRules(): void {
  _compiledRules = [];
  for (const r of _policy.rules) {
    try {
      _compiledRules.push({
        tool: new RegExp(`^${escapeRegex(r.tool)}$`, 'i'),
        pattern: r.pattern ? new RegExp(r.pattern, 'i') : null,
        action: r.action,
      });
    } catch (e) {
      console.warn(`  ⚠️ Failed to compile rule for tool '${r.tool}': ${e}`);
    }
  }

  _compiledIgnore = [];
  for (const glob of _policy.barkignore) {
    try {
      const re = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^/]*')
        .replace(/§§/g, '.*')
        .replace(/\?/g, '.');
      _compiledIgnore.push(new RegExp(`(^|/)${re}$`, 'i'));
    } catch (e) {
      console.warn(`  ⚠️ Failed to compile barkignore pattern '${glob}': ${e}`);
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Policy evaluation ────────────────────────────────────────────

export function getPolicy(): ApprovalPolicy {
  return _policy;
}

export function evaluatePolicy(toolName: string, toolArgs: string = ''): PolicyAction {
  for (const rule of _compiledRules) {
    if (!rule.tool.test(toolName)) continue;
    if (rule.pattern && !rule.pattern.test(toolArgs)) continue;
    return rule.action;
  }
  return _policy.defaultAction;
}

export function matchesBarkignore(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return _compiledIgnore.some(re => re.test(normalized));
}

/**
 * Returns the policy rules formatted for system prompt injection.
 * Designed to be explicit and actionable for the LLM — concrete
 * command lists, approval flow examples, and strict constraints.
 */
export function getPolicyRulesForPrompt(): string | null {
  if (_policy.rules.length === 0 && _policy.barkignore.length === 0) return null;

  const sections: string[] = ['<approval_policy mandatory="true">'];

  const approved: string[] = [];
  const needApproval: string[] = [];
  const blocked: string[] = [];

  for (const rule of _policy.rules) {
    const desc = rule.pattern ? `${rule.tool} (${rule.pattern})` : rule.tool;
    if (rule.action === 'auto_approve') approved.push(desc);
    else if (rule.action === 'require_approval') needApproval.push(desc);
    else blocked.push(desc);
  }

  if (_policy.defaultAction === 'block') {
    sections.push(
      '<default_action>BLOCK — Only operations explicitly listed below are allowed. ' +
      'Everything else is FORBIDDEN — do not attempt unlisted operations.</default_action>',
    );
  } else if (_policy.defaultAction === 'require_approval') {
    sections.push(
      '<default_action>REQUIRE APPROVAL — Any operation not explicitly listed below requires you to ask the user first.</default_action>',
    );
  } else {
    sections.push(
      '<default_action>AUTO APPROVE — Operations run without asking unless explicitly restricted below.</default_action>',
    );
  }

  if (approved.length > 0) {
    sections.push(
      '<auto_approved>\n' +
      'Safe to run without asking:\n' +
      approved.map(r => `- ${r}`).join('\n') + '\n' +
      '</auto_approved>',
    );
  }

  if (needApproval.length > 0) {
    sections.push(
      '<require_approval>\n' +
      'You MUST follow this two-step flow for every operation below:\n' +
      '1. Propose — describe the exact command you want to run and WHY\n' +
      '2. Wait — do NOT execute until the user replies with approval (e.g. "yes", "approve", "go")\n\n' +
      'If the user says "no", "deny", or "stop" — abandon the operation and suggest alternatives.\n\n' +
      'Operations requiring approval:\n' +
      needApproval.map(r => `- ${r}`).join('\n') +
      '\n\n' +
      '<correct_example>\n' +
      'User: push the changes\n' +
      'You:  I\'d like to run `git push origin main` to push 3 commits. Shall I proceed?\n' +
      'User: yes\n' +
      'You:  [now executes git push]\n' +
      '</correct_example>\n\n' +
      '<wrong_example>\n' +
      'User: push the changes\n' +
      'You:  [immediately runs git push without asking]\n' +
      '</wrong_example>\n' +
      '</require_approval>',
    );
  }

  if (blocked.length > 0) {
    sections.push(
      '<blocked>\n' +
      'NEVER execute these. Strictly forbidden under any circumstances, even if the user asks. ' +
      'Explain that the operation is blocked by policy and suggest a safe alternative.\n\n' +
      blocked.map(r => `- ${r}`).join('\n') + '\n' +
      '</blocked>',
    );
  }

  if (_policy.barkignore.length > 0) {
    sections.push(
      '<protected_files>\n' +
      'NEVER read, write, edit, or include these files in commits. ' +
      'If asked to access them, refuse and explain they are protected by policy.\n\n' +
      _policy.barkignore.map(p => `- ${p}`).join('\n') + '\n' +
      '</protected_files>',
    );
  }

  sections.push('</approval_policy>');

  return sections.join('\n\n');
}

/**
 * Serializes the policy rules into a compact JSON string for the
 * BARK_POLICY_RULES env var consumed by stream-display.ts.
 */
export function getPolicyRulesForEnv(): string {
  return JSON.stringify({
    defaultAction: _policy.defaultAction,
    rules: _policy.rules,
    barkignore: _policy.barkignore,
  });
}

// ── Approval state machine ───────────────────────────────────────

const APPROVE_WORDS = /^(approve|approved|yes|ok|y|proceed|go|do it|lgtm|sure|go ahead|sounds good|fine|absolutely|yep|yup)$/i;
const DENY_WORDS = /^(deny|denied|no|n|reject|rejected|stop|cancel|abort|nope|don't|nah|negative|block)$/i;

export function parseApprovalReply(text: string): 'approve' | 'deny' | null {
  const trimmed = text.trim();
  if (APPROVE_WORDS.test(trimmed)) return 'approve';
  if (DENY_WORDS.test(trimmed)) return 'deny';
  return null;
}

// ── Audit log ────────────────────────────────────────────────────

export function appendAuditLog(entry: {
  agentId: string;
  agentName: string;
  tool: string;
  args: string;
  action: string;
  decision: 'approved' | 'denied' | 'timeout';
  decidedBy?: string;
  latencyMs?: number;
}): void {
  try {
    const safe = { ...entry, args: entry.args.substring(0, 500) };
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...safe }) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, line);
  } catch {
    // best-effort logging
  }
}

// ── Approval request ─────────────────────────────────────────────

/**
 * Called when a violation is detected after a turn completes.
 * Holds the output and sends an approval request to chat.
 */
export async function requestApproval(
  agent: Agent,
  adapter: Adapter,
  violation: ViolationRecord,
  output: string,
  liveMsgId: string | null,
  replyToId: string | null,
): Promise<void> {
  const cmdPreview = violation.args.length > 120
    ? violation.args.substring(0, 117) + '...'
    : violation.args;

  let text: string;
  if (violation.action === 'block') {
    text =
      `🚫 [${agent.name}] attempted a BLOCKED operation:\n` +
      `\`${violation.tool}: ${cmdPreview}\`\n\n` +
      `This violates policy. The operation already executed — review required.\n` +
      `Reply *approve* to deliver the response, or *deny* to suppress it.`;
  } else {
    text =
      `⚠️ [${agent.name}] ran an operation that requires approval:\n` +
      `\`${violation.tool}: ${cmdPreview}\`\n\n` +
      `Reply *approve* to deliver the response, or *deny* to suppress it.`;
  }

  const approvalMsgId = await adapter.send(text, replyToId);

  agent.approvalPending = {
    messageId: approvalMsgId || '',
    tool: violation.tool,
    args: violation.args,
    action: violation.action === 'block' ? 'block' : 'require_approval',
    heldOutput: output,
    heldLiveMsgId: liveMsgId || '',
    replyToId: replyToId || null,
    requestedAt: Date.now(),
    adapterName: adapter.name,
  };

  if (approvalMsgId) setMsgAgent(approvalMsgId, agent.id);
  saveState();
  broadcastAgents();
  await updatePinnedStatus();
  console.log(`  🛡️ ${agent.name}: approval requested for ${violation.tool}`);
}

/**
 * Resolve an approval — called from routing or /approve /deny commands.
 */
export async function resolveApproval(
  agent: Agent,
  approved: boolean,
  adapter: Adapter,
  opts?: { auditDecision?: 'approved' | 'denied' | 'timeout' },
): Promise<void> {
  const pending = agent.approvalPending;
  if (!pending) return;

  const latencyMs = Date.now() - pending.requestedAt;

  if (approved) {
    console.log(`  ✅ ${agent.name}: approved — delivering held response`);
    await deliverResponse(
      adapter,
      agent,
      pending.heldOutput,
      pending.heldLiveMsgId || null,
      pending.replyToId,
    );
  } else {
    console.log(`  ❌ ${agent.name}: denied — suppressing response`);
    if (pending.heldLiveMsgId) {
      await adapter.edit(
        pending.heldLiveMsgId,
        `🚫 [${agent.name}] operation denied: \`${pending.tool}\``,
      );
    }
  }

  appendAuditLog({
    agentId: agent.id,
    agentName: agent.name,
    tool: pending.tool,
    args: pending.args,
    action: pending.action,
    decision: opts?.auditDecision ?? (approved ? 'approved' : 'denied'),
    latencyMs,
  });

  agent.approvalPending = null;
  saveState();
  broadcastAgents();
  await updatePinnedStatus();
}

// ── Timeout checker ──────────────────────────────────────────────

function findAdapterByName(name: string): Adapter | null {
  if (!_getAdaptersFn) return null;
  return _getAdaptersFn().find(a => a.name === name) ?? null;
}

function startTimeoutChecker(): void {
  if (_approvalTimer) clearInterval(_approvalTimer);

  _approvalTimer = setInterval(async () => {
    if (!_getAgentsFn || !_getAdaptersFn) return;
    const adapters = _getAdaptersFn();
    if (adapters.length === 0) return;

    const now = Date.now();
    for (const [, agent] of _getAgentsFn()) {
      if (!agent.approvalPending) continue;
      if (now - agent.approvalPending.requestedAt > _policy.approvalTimeout) {
        console.log(`  ⏰ ${agent.name}: approval timed out — auto-denying`);
        const adapter = findAdapterByName(agent.approvalPending.adapterName) ?? adapters[0];
        await resolveApproval(agent, false, adapter, { auditDecision: 'timeout' });
      }
    }
  }, 15_000);
}

export function stopApprovalTimers(): void {
  if (_approvalTimer) {
    clearInterval(_approvalTimer);
    _approvalTimer = null;
  }
}
