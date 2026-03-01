#!/usr/bin/env node
// Reads stream-json from claude -p on stdin
// Writes clean status to .progress file (for WhatsApp live editing)
// Writes final result to .out file + creates .done marker

import fs from 'node:fs';
import path from 'node:path';
// Use shared tool icons and icon resolver from config
import { getToolIcon } from './config/tools.js';

const agentId = process.argv[2];
const tmpDir = process.argv[3];
if (!agentId || !tmpDir) {
  console.error('Usage: stream-display.js <agent-id> <tmp-dir>');
  process.exit(1);
}

const progressFile = path.join(tmpDir, `${agentId}.progress`);
const outFile = path.join(tmpDir, `${agentId}.out`);
const doneMarker = path.join(tmpDir, `${agentId}.done`);
const sessionFile = path.join(tmpDir, `${agentId}.session`);
const usageFile = path.join(tmpDir, `${agentId}.usage`);
const violationFile = path.join(tmpDir, `${agentId}.violation`);
const eventsFile = path.join(tmpDir, `${agentId}.events`);
const phaseFile = path.join(tmpDir, `${agentId}.phase`);

// --- State ---
let fullText = '';
let progressText = '';
const tools: string[] = [];
let lastWrite = 0;
const startTime = Date.now();
const MAX_FULL_TEXT = 512 * 1024;   // 512KB — keep tail for final output
const MAX_PROGRESS_TEXT = 8 * 1024; // 8KB — only used for thinking preview
// Tunable via env (set in the tmux session by the backend's buildCommand)
const THROTTLE_MS = parseInt(process.env.STREAM_THROTTLE_MS || '800', 10);
const THINKING_PREVIEW_LEN = parseInt(process.env.STREAM_THINKING_PREVIEW_LEN || '200', 10);
// --- Structured events (JSONL) ---
// Compact events emitted for the server to poll and broadcast via timeline/WebSocket
interface StreamEvent {
  t: 'tool' | 'think' | 'text' | 'error' | 'session';
  ts: number;
  e: number;
  n?: string;
  i?: string;
  a?: string;
  x?: string;
}

try { fs.unlinkSync(eventsFile); } catch { /* ignore */ }
try { fs.unlinkSync(phaseFile); } catch { /* ignore */ }

function appendEvent(evt: StreamEvent): void {
  fs.appendFileSync(eventsFile, JSON.stringify(evt) + '\n');
}

function emitToolEvent(toolName: string, argsPreview?: string): void {
  appendEvent({
    t: 'tool', ts: Date.now(), e: Date.now() - startTime,
    n: toolName, i: getToolIcon(toolName),
    a: argsPreview ? argsPreview.substring(0, 200) : undefined,
  });
}

let thinkBatchTimer: ReturnType<typeof setTimeout> | null = null;
let thinkBatch = '';

function emitThinkingBatched(text: string): void {
  thinkBatch += text;
  if (!thinkBatchTimer) {
    thinkBatchTimer = setTimeout(() => {
      if (thinkBatch) {
        appendEvent({
          t: 'think', ts: Date.now(), e: Date.now() - startTime,
          x: thinkBatch.slice(-300),
        });
        thinkBatch = '';
      }
      thinkBatchTimer = null;
    }, 2000);
  }
}

// --- Phase detection from tool sequence ---
const ANALYSIS_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ListDir', 'Search', 'WebFetch']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const RUN_TOOLS = new Set(['Bash']);

function detectPhase(): string {
  if (tools.length === 0) return '🧠 Planning';
  const last5 = tools.slice(-5);
  const normalized = last5.map(normalizeToolName);
  const analysisCount = normalized.filter(t => ANALYSIS_TOOLS.has(t)).length;
  const writeCount = normalized.filter(t => WRITE_TOOLS.has(t)).length;
  const runCount = normalized.filter(t => RUN_TOOLS.has(t)).length;
  if (writeCount > 0 && writeCount >= analysisCount) return '✏️ Implementing';
  if (runCount > 0 && normalized[normalized.length - 1] === 'Bash') return '💻 Running';
  if (analysisCount > runCount + writeCount) return '🔍 Analyzing';
  return '⚙️ Working';
}

// --- Tool name normalization (cross-backend) ---
// Maps backend-specific tool names to canonical names used in policy rules.
// Gemini uses snake_case (`shell`, `read_file`), Cursor may use camelCase variants.
const TOOL_NAME_ALIASES: Record<string, string> = {
  shell: 'Bash', run_command: 'Bash', execute_command: 'Bash', terminal: 'Bash',
  read_file: 'Read', read: 'Read',
  write_file: 'Write', write: 'Write',
  edit_file: 'Edit', edit: 'Edit',
  search_replace: 'Edit', multi_edit: 'MultiEdit', multiEdit: 'MultiEdit',
  list_directory: 'ListDir', list_dir: 'ListDir',
  search: 'Grep', find_files: 'Glob',
  web_fetch: 'WebFetch',
};

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? TOOL_NAME_ALIASES[name.toLowerCase()] ?? name;
}

// --- Policy engine (lightweight, loaded from env) ---
interface PolicyRuleCompact { tool: string; pattern?: string; action: string; }
interface PolicyConfig { defaultAction: string; rules: PolicyRuleCompact[]; barkignore: string[]; }

let policyConfig: PolicyConfig = { defaultAction: 'block', rules: [], barkignore: [] };
let compiledPolicyRules: Array<{ tool: RegExp; pattern: RegExp | null; action: string }> = [];
const violations: Array<{ tool: string; args: string; action: string; timestamp: number }> = [];

// Tool argument accumulation (for Claude Code input_json_delta)
let currentToolName = '';
let currentToolInput = '';

try {
  const rawPolicy = process.env.BARK_POLICY_RULES;
  if (rawPolicy) {
    policyConfig = JSON.parse(rawPolicy);
    compiledPolicyRules = (policyConfig.rules || []).map(r => ({
      tool: new RegExp(`^${r.tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      pattern: r.pattern ? new RegExp(r.pattern, 'i') : null,
      action: r.action,
    }));
  }
} catch { /* ignore parse errors — no policy enforcement */ }

function evaluateToolPolicy(toolName: string, toolArgs: string): string {
  for (const rule of compiledPolicyRules) {
    if (!rule.tool.test(toolName)) continue;
    if (rule.pattern && !rule.pattern.test(toolArgs)) continue;
    return rule.action;
  }
  return policyConfig.defaultAction;
}

function checkAndRecordViolation(rawToolName: string, toolArgs: string): void {
  if (compiledPolicyRules.length === 0) return;
  const toolName = normalizeToolName(rawToolName);
  const action = evaluateToolPolicy(toolName, toolArgs);
  if (action === 'require_approval' || action === 'block') {
    violations.push({ tool: toolName, args: toolArgs.substring(0, 2048), action, timestamp: Date.now() });
    fs.writeFileSync(violationFile, JSON.stringify(violations));
  }
}

function flushCurrentTool(): void {
  if (currentToolName) {
    checkAndRecordViolation(currentToolName, currentToolInput);
    currentToolName = '';
    currentToolInput = '';
  }
}

function formatElapsed(): string {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m${String(secs % 60).padStart(2, '0')}s`;
}

function buildStatus(): string {
  const lines: string[] = [];
  const elapsed = formatElapsed();
  const phase = detectPhase();

  // Phase header
  lines.push(phase);

  // Tool chain with compact count
  if (tools.length > 0) {
    const recent = tools.slice(-5).map(t => `${getToolIcon(t)} ${t}`).join(' → ');
    const countTag = tools.length > 5 ? ` (+${tools.length - 5})` : '';
    lines.push(recent + countTag);
  }

  // Thinking preview — 💭 prefix instead of _italic_ (underscores in code break Markdown)
  if (progressText) {
    let preview = progressText.slice(-THINKING_PREVIEW_LEN).trim();
    const firstSpace = preview.indexOf(' ');
    if (firstSpace > 0 && preview.length >= THINKING_PREVIEW_LEN) {
      preview = preview.substring(firstSpace + 1);
    }
    lines.push(`💭 ${preview.replace(/\n/g, ' ')}`);
  }

  // Footer: elapsed only (backend already shown in message prefix by formatAgentMessage)
  lines.push(`⏱ ${elapsed}`);
  return lines.join('\n');
}

function capBuffers(): void {
  if (fullText.length > MAX_FULL_TEXT) fullText = fullText.slice(-MAX_FULL_TEXT);
  if (progressText.length > MAX_PROGRESS_TEXT) progressText = progressText.slice(-MAX_PROGRESS_TEXT);
}

function writeProgress(): void {
  const status = buildStatus();
  fs.writeFileSync(progressFile, status);
  fs.writeFileSync(phaseFile, detectPhase());
  lastWrite = Date.now();
}

interface StreamEventData {
  type: string;
  event?: {
    type?: string;
    delta?: { type?: string; thinking?: string; text?: string; partial_json?: string };
    content_block?: { type?: string; name?: string };
  };
  // Codex fields
  thread_id?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number;
    status?: string;
  };
  usage?: { input_tokens: number; output_tokens: number } | null;
  // Gemini fields
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  status?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  stats?: {
    models?: Record<string, { tokens?: { prompt?: number; candidates?: number } }>;
  } | null;
  // Cursor fields
  subtype?: string;
  text?: string;
  message?: {
    content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>;
  };
  tool_call?: {
    shellToolCall?: { command?: string };
    readToolCall?: { path?: string };
    editToolCall?: { path?: string };
    writeToolCall?: { path?: string };
    [key: string]: unknown;
  };
  // Result fields (shared)
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number | null;
}

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const data: StreamEventData = JSON.parse(line);

      // ═══════════════════════════════════════════════════════════
      // CLAUDE CODE FORMAT
      // ═══════════════════════════════════════════════════════════
      if (data.type === 'stream_event') {
        const event = data.event;

        // Thinking streaming
        if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          progressText += event.delta.thinking;
          emitThinkingBatched(event.delta.thinking || '');
          process.stdout.write('\x1b[2m' + event.delta.thinking + '\x1b[0m'); // dim in tmux
        }

        // Text streaming - also used as live "thinking" preview
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
          progressText += event.delta.text;
          process.stdout.write(event.delta.text || '');
        }

        // Accumulate tool input JSON for policy checking
        if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          currentToolInput += event.delta.partial_json || '';
        }

        // Tool use - track it
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          flushCurrentTool();
          const toolName = event.content_block.name || 'tool';
          currentToolName = toolName;
          currentToolInput = '';
          tools.push(toolName);
          emitToolEvent(toolName);
          process.stdout.write(`\n${getToolIcon(toolName)} ${toolName}\n`);
          writeProgress();
        }

        // Tool use block ends — flush accumulated input for policy check
        if (event?.type === 'content_block_stop') {
          flushCurrentTool();
        }

        // Thinking block starts
        if (event?.type === 'content_block_start' && event.content_block?.type === 'thinking') {
          process.stdout.write('\n💭 ');
        }
      }

      // Final result (Claude Code only — no status/subtype fields)
      if (data.type === 'result' && !data.status && !data.subtype) {
        const finalText = data.result || fullText;
        fs.writeFileSync(outFile, finalText);
        fs.writeFileSync(doneMarker, String(data.is_error ? 1 : 0));
        if (data.usage || data.total_cost_usd) {
          fs.writeFileSync(usageFile, JSON.stringify({
            costUsd: data.total_cost_usd || null,
            usage: data.usage || null,
          }));
        }
        process.stdout.write('\n✅ Done\n');
      }

      // ═══════════════════════════════════════════════════════════
      // CODEX FORMAT
      // ═══════════════════════════════════════════════════════════
      if (data.type === 'thread.started') {
        process.stdout.write(`🧵 Session: ${data.thread_id}\n`);
        if (data.thread_id) {
          fs.writeFileSync(sessionFile, data.thread_id);
          appendEvent({ t: 'session', ts: Date.now(), e: Date.now() - startTime, x: data.thread_id });
        }
      }

      if (data.type === 'item.completed' && data.item) {
        const item = data.item;

        // Reasoning/thinking
        if (item.type === 'reasoning') {
          progressText += item.text || '';
          emitThinkingBatched(item.text || '');
          process.stdout.write('\x1b[2m' + (item.text || '') + '\x1b[0m');
          writeProgress();
        }

        // Agent message (response)
        if (item.type === 'agent_message') {
          fullText += (item.text || '') + '\n';
          progressText += item.text || '';
          process.stdout.write(item.text || '');
          writeProgress();
        }

        // Command execution (tool use)
        if (item.type === 'command_execution') {
          tools.push('Bash');
          emitToolEvent('Bash', item.command);
          checkAndRecordViolation('Bash', item.command || '');
          process.stdout.write(`\n💻 Bash: ${item.command || ''}\n`);
          if (item.aggregated_output) {
            process.stdout.write(item.aggregated_output + '\n');
          }
          writeProgress();
        }
      }

      if (data.type === 'turn.completed') {
        fs.writeFileSync(outFile, fullText || '(no output)');
        fs.writeFileSync(doneMarker, '0');
        // Write usage data if present (Codex)
        if (data.usage) {
          fs.writeFileSync(usageFile, JSON.stringify({
            costUsd: null,
            usage: data.usage,
          }));
        }
        process.stdout.write('\n✅ Done\n');
      }

      // ═══════════════════════════════════════════════════════════
      // GEMINI FORMAT
      // ═══════════════════════════════════════════════════════════
      if (data.type === 'init' && data.session_id) {
        process.stdout.write(`🧵 Session: ${data.session_id}\n`);
        fs.writeFileSync(sessionFile, data.session_id);
        appendEvent({ t: 'session', ts: Date.now(), e: Date.now() - startTime, x: data.session_id });
      }

      if (data.type === 'message' && data.role === 'assistant') {
        const text = data.content || '';
        fullText += text;
        progressText += text;
        process.stdout.write(text);
        writeProgress();
      }

      // Gemini tool use
      if (data.type === 'tool_use' && data.tool_name) {
        const toolName = data.tool_name;
        tools.push(toolName);
        const argsStr = data.parameters ? JSON.stringify(data.parameters) : '';
        emitToolEvent(toolName, argsStr);
        checkAndRecordViolation(toolName, argsStr);
        process.stdout.write(`\n${getToolIcon(toolName)} ${toolName}\n`);
        writeProgress();
      }

      if (data.type === 'result' && data.status) {
        // Gemini result format
        fs.writeFileSync(outFile, fullText || '(no output)');
        fs.writeFileSync(doneMarker, data.status === 'success' ? '0' : '1');
        // Write usage data if present (Gemini)
        if (data.stats) {
          const modelStats = data.stats.models ? Object.values(data.stats.models)[0] : null;
          const tokens = modelStats?.tokens;
          fs.writeFileSync(usageFile, JSON.stringify({
            costUsd: null,
            usage: tokens ? { input_tokens: tokens.prompt || 0, output_tokens: tokens.candidates || 0 } : null,
            geminiStats: data.stats,
          }));
        }
        process.stdout.write('\n✅ Done\n');
      }

      // ═══════════════════════════════════════════════════════════
      // CURSOR FORMAT
      // ═══════════════════════════════════════════════════════════
      if (data.type === 'system' && data.subtype === 'init') {
        process.stdout.write(`🧵 Session: ${data.session_id}\n`);
        if (data.session_id) {
          fs.writeFileSync(sessionFile, data.session_id);
          appendEvent({ t: 'session', ts: Date.now(), e: Date.now() - startTime, x: data.session_id });
        }
      }

      if (data.type === 'thinking' && data.subtype === 'delta') {
        progressText += data.text || '';
        emitThinkingBatched(data.text || '');
        process.stdout.write('\x1b[2m' + (data.text || '') + '\x1b[0m');
      }

      // Cursor tool_call events (native format with *ToolCall keys)
      if (data.type === 'tool_call' && data.subtype === 'started' && data.tool_call) {
        const tc = data.tool_call;
        let toolName = 'tool';
        let argsStr = '';
        if (tc.shellToolCall) {
          toolName = 'Bash';
          argsStr = (tc.shellToolCall as { command?: string }).command || '';
        } else if (tc.readToolCall) { toolName = 'Read'; argsStr = JSON.stringify(tc.readToolCall);
        } else if (tc.editToolCall) { toolName = 'Edit'; argsStr = JSON.stringify(tc.editToolCall);
        } else if (tc.writeToolCall) { toolName = 'Write'; argsStr = JSON.stringify(tc.writeToolCall);
        } else {
          for (const key of Object.keys(tc)) {
            if (key.endsWith('ToolCall')) {
              toolName = key.replace('ToolCall', '');
              toolName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
              argsStr = JSON.stringify(tc[key]);
              break;
            }
          }
        }
        tools.push(toolName);
        emitToolEvent(toolName, argsStr);
        checkAndRecordViolation(toolName, argsStr);
        process.stdout.write(`\n${getToolIcon(toolName)} ${toolName}\n`);
        writeProgress();
      }

      if (data.type === 'assistant' && data.message?.content) {
        // Extract text from content array
        for (const block of data.message.content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text;
            progressText += block.text;
            process.stdout.write(block.text);
          }
          if (block.type === 'tool_use') {
            const toolName = block.name || 'tool';
            tools.push(toolName);
            const argsStr = block.input ? JSON.stringify(block.input) : '';
            checkAndRecordViolation(toolName, argsStr);
            process.stdout.write(`\n${getToolIcon(toolName)} ${toolName}\n`);
          }
        }
        writeProgress();
      }

      if (data.type === 'result' && data.subtype) {
        // Cursor result format
        const finalText = data.result || fullText;
        fs.writeFileSync(outFile, finalText);
        fs.writeFileSync(doneMarker, data.is_error ? '1' : '0');
        process.stdout.write('\n✅ Done\n');
      }

    } catch (_e) {
      // skip
    }
  }

  capBuffers();

  // Throttled progress updates
  if (Date.now() - lastWrite > THROTTLE_MS) {
    writeProgress();
  }
});

process.stdin.on('end', () => {
  flushCurrentTool();
  if (!fs.existsSync(doneMarker)) {
    fs.writeFileSync(outFile, fullText || '(no output)');
    fs.writeFileSync(doneMarker, '1');
  }
});
