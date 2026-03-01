/**
 * Shared agent execution infrastructure — build system prompt, prepare run,
 * execute in tmux, poll for completion, deliver response.
 */

import { errorMessage } from '../utils/error.js';
import { splitMessage } from '../utils/text.js';
import { shellEscape } from '../utils/shell.js';
import { getAgentFiles } from '../utils/agent-files.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import type {
  Agent,
  Adapter,
  Backend,
  BackendsProvider,
  HistoryManagerProvider,
  UsageTrackerProvider,
  TimelineProvider,
  SkillsManagerProvider,
} from '../types/index.js';
import { TMP_DIR, PROJECTS_DIR, EXEC_OPTS, MAX_SUB_AGENTS, DEFAULT_BACKEND, AGENT_TIMEOUT, REPO_PATH, REPO_NAME } from './config.js';
import { MCP_CONFIG_FILE } from '../config/paths.js';
import {
  saveState,
  isShuttingDown,
  setMsgAgent,
} from './state.js';
import { getAgentIcon } from './naming.js';
import { broadcastAgents, broadcastToWS, broadcastChatMessage } from './websocket.js';
import { ensureTmuxSession } from './tmux.js';
import { getPolicyRulesForPrompt } from './approval.js';
import type { ViolationRecord } from '../types/index.js';

// Lazily injected dependencies
let _backends: BackendsProvider | null = null;
let _historyManager: HistoryManagerProvider | null = null;
let _usageTracker: UsageTrackerProvider | null = null;
let _timeline: TimelineProvider | null = null;
let _skillsManager: SkillsManagerProvider | null = null;

export function initExecution(deps: {
  backends: BackendsProvider;
  historyManager: HistoryManagerProvider;
  usageTracker: UsageTrackerProvider;
  timeline: TimelineProvider;
  skillsManager: SkillsManagerProvider;
}): void {
  _backends = deps.backends;
  _historyManager = deps.historyManager;
  _usageTracker = deps.usageTracker;
  _timeline = deps.timeline;
  _skillsManager = deps.skillsManager;
}

export const MAX_MSG_LEN = 4096;

export interface ResponseMeta {
  durationMs: number;
  toolCount: number;
  costUsd: number | null;
  backend: string;
  exitCode: number;
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m${String(secs % 60).padStart(2, '0')}s`;
}

export function buildResponseFooter(meta: ResponseMeta): string {
  const status = meta.exitCode === 0 ? '✅' : '❌';
  const exitTag = meta.exitCode !== 0 ? ` exit ${meta.exitCode}` : '';
  const parts = [`${status}${exitTag}`, formatDuration(meta.durationMs)];
  if (meta.toolCount > 0) parts.push(`🔧 ${meta.toolCount} tools`);
  if (meta.costUsd !== null && meta.costUsd > 0) parts.push(`$${meta.costUsd < 0.01 ? meta.costUsd.toFixed(4) : meta.costUsd.toFixed(2)}`);
  parts.push(meta.backend);
  return `\n\n━\n${parts.join(' · ')}`;
}

export function buildDoneReceipt(agent: Agent, meta: ResponseMeta): string {
  const icon = getAgentIcon(agent);
  const status = meta.exitCode === 0 ? '✅' : '❌';
  const parts = [formatDuration(meta.durationMs)];
  if (meta.toolCount > 0) parts.push(`🔧 ${meta.toolCount}`);
  if (meta.costUsd !== null && meta.costUsd > 0) parts.push(`$${meta.costUsd < 0.01 ? meta.costUsd.toFixed(4) : meta.costUsd.toFixed(2)}`);
  return `${icon} ${agent.name} ${status} ${parts.join(' · ')}`;
}

export function buildSystemPrompt(agent: Agent, isResume: boolean): string {
  const cwdFile = path.join(TMP_DIR, `${agent.id}.cwd`);
  const sendDir = path.join(TMP_DIR, `${agent.id}-send`);

  const sections: string[] = [
    `<identity>\n` +
      `You are ${agent.name}, a loyal bark-pack pup — a good boy (or girl) who also happens to be an autonomous coding agent. ` +
      `You live to fetch code, dig up bugs, and bring your human the good results. ` +
      `Work independently: sniff through the codebase, implement changes, run tests, and report back with tail wags.\n` +
      `</identity>`,

    `<personality>\n` +
      `You have the personality of an enthusiastic, slightly dorky engineering dog. ` +
      `Sprinkle in dog puns and metaphors naturally — "sniffed out the bug", "fetched the data", "buried that dead code", "rolled over the tests — all pass!" — but keep it light and don't overdo it. ` +
      `You're funny but you're also a *serious professional pup* who gets the job done. Results first, tail wags second.\n` +
      `</personality>`,

    `<response_format>\n` +
      `Your responses are delivered to a mobile chat app (WhatsApp/Telegram/Slack). The human reads on a phone screen.\n\n` +

      `*Structure & Length*\n` +
      `- Lead with the result or status — the human may only see the first message.\n` +
      `- Be concise: 1-3 short paragraphs when the task is simple. Don't pad with filler.\n` +
      `- For complex tasks, give enough detail to be useful — but never dump raw output or full files.\n` +
      `- Long responses are auto-split into multiple numbered messages — use blank lines between sections so splits are clean.\n` +
      `- Keep each logical section under ~500 chars so the auto-splitter can break cleanly.\n\n` +

      `*Always explain what you did and why*\n` +
      `- Don't just say "done" — briefly describe what you changed, why, and the outcome.\n` +
      `- For code changes: name the files edited, describe the change, show 1 key snippet (5-15 lines max).\n` +
      `- For investigations: state what you found, not just the raw data.\n` +
      `- For errors: explain what went wrong and what you'll try next.\n\n` +

      `*Formatting for mobile*\n` +
      `- Use Markdown: *bold* for emphasis, \`code\` for identifiers, \`\`\`code blocks\`\`\` for snippets.\n` +
      `- Use bullet points and numbered lists for structure — walls of text are unreadable on mobile.\n` +
      `- NO wide tables, ASCII art, or horizontal rules — they break on mobile screens.\n` +
      `- Avoid _italic_ with underscored text (breaks Markdown: _auth_module_ renders wrong). Use *bold* instead.\n\n` +

      `*End with status*\n` +
      `- Always end with clear status: what's done, what's next, or what input you need.\n` +
      `- A metadata footer (duration, cost, tools) is automatically appended — do NOT add your own stats.\n` +
      `- Sign off with a short dog-flavored one-liner when the task is complete.\n` +
      `</response_format>`,

    REPO_PATH
      ? `<workspace>\n` +
        `- You are working on the project at ${REPO_PATH}.\n` +
        `- All work MUST happen inside ${REPO_PATH}.\n` +
        `- Do NOT clone or switch to other repos.\n` +
        `- Use absolute paths — do NOT cd into project dirs before running commands.\n` +
        `- If a command fails, diagnose the error before retrying.\n` +
        `</workspace>`
      : `<workspace>\n` +
        `- All repo work MUST happen inside ${PROJECTS_DIR}/.\n` +
        `- Clone repos there. If a clone already exists, reuse it (git pull to update).\n` +
        `- Never reference or modify repos outside ${PROJECTS_DIR}/.\n` +
        `- Use absolute paths — do NOT cd into project dirs before running commands.\n` +
        `- If a command fails, diagnose the error before retrying.\n` +
        `</workspace>`,

    `<tracking>\n` +
      `- On first entering a project directory, write its absolute path to ${cwdFile} (once per project).\n` +
      `- To send files to the user, copy them to ${sendDir}/.\n` +
      `</tracking>`,

    `<images>\n` +
      `Users may send images from chat (WhatsApp/Telegram/Slack). When they do, the image is saved as a local file and referenced in the message.\n` +
      `- When you see "[Image attached]" with a file path, you MUST read/view that file using your file reading tool before responding.\n` +
      `- Supported image formats: JPEG (.jpg/.jpeg), PNG (.png), WebP (.webp), GIF (.gif).\n` +
      `- The message includes the file path and mimetype — use the path directly with your file reading tool.\n` +
      `- After viewing the image, respond based on its visual content together with any accompanying text from the user.\n` +
      `- If the image is unclear or you cannot determine what is being asked, describe what you see and ask for clarification.\n` +
      `</images>`,

    `<commits>\n` +
      `- Do NOT commit or push without the human explicitly asking. No sneaky pushes — bad dog.\n` +
      `- Sign every commit with:\n` +
      `  🐾 Paw-Printed-By: ${agent.name} <${agent.name.toLowerCase()}@bark-pack>\n` +
      `</commits>`,
  ];

  if (!agent.parentId) {
    sections.push(
      `<delegation>\n` +
        `Delegate clearly separable, independent tasks to sub-agents via the bark CLI. Sub-agents work autonomously — you will NOT get results back.\n\n` +
        '```bash\nbark delegate "task description"          # same branch\n' +
        'bark delegate "task description" --branch  # isolated branch + PR\n```\n\n' +
        `Rules: max ${MAX_SUB_AGENTS} active sub-agents, no further nesting, include all context (repo URL, branch, requirements).\n` +
        `</delegation>`,
    );
  }

  const policyPrompt = getPolicyRulesForPrompt();
  if (policyPrompt) {
    sections.push(policyPrompt);
  }

  if (!isResume && agent.skills && agent.skills.length > 0 && _skillsManager) {
    const skillContent = _skillsManager.buildSkillPrompt(agent.skills);
    if (skillContent) {
      sections.push(skillContent);
      console.log(`  ⚡ Injecting skills for ${agent.name}: ${agent.skills.join(', ')}`);
    }
  }

  return `<system_prompt>\n\n${sections.join('\n\n')}\n\n</system_prompt>`;
}

export function formatAgentMessage(
  agent: Agent,
  output: string,
  opts: { isProgress?: boolean } = {},
): string {
  const icon = getAgentIcon(agent);
  const isProgress = opts.isProgress ?? false;
  const prefix = isProgress
    ? `${icon} ${agent.name} · ${agent.backend}\n`
    : `${icon} ${agent.name}:\n\n`;
  const budget = MAX_MSG_LEN - prefix.length - 4;
  if (output.length <= budget) return prefix + output;
  const truncPrefix = isProgress
    ? prefix
    : `${icon} ${agent.name} (truncated):\n\n`;
  const truncBudget = MAX_MSG_LEN - truncPrefix.length - 4;
  return truncPrefix + output.substring(0, truncBudget) + '...';
}

export interface AgentRunFiles {
  scriptFile: string;
  outFile: string;
  doneFile: string;
  progressFile: string;
  runningFile: string;
  sendDir: string;
  cwdFile: string;
}

export function prepareAgentRun(
  agent: Agent,
  prompt: string,
  backend: Backend,
): AgentRunFiles {
  const files = getAgentFiles(agent.id);
  const __exec_dir = path.dirname(fileURLToPath(import.meta.url));
  const displayScript = path.join(__exec_dir, '..', 'stream-display.js');

  mkdirSync(files.sendDir, { recursive: true });

  const isResume = agent.hasRun;

  // Build and write system prompt
  const systemPrompt = buildSystemPrompt(agent, isResume);
  writeFileSync(files.sysprompt, systemPrompt);

  // For backends that don't support system prompts, prepend to first message
  let actualPrompt = prompt;
  if (!isResume && !backend.capabilities.systemPrompt) {
    actualPrompt = `[System Instructions]\n${systemPrompt}\n\n[User Message]\n${prompt}`;
  }

  // Inject fallback context if present (from reset/switch recovery)
  if (agent.fallbackContext) {
    actualPrompt = `${agent.fallbackContext}\n\n[New Message]\n${actualPrompt}`;
    delete agent.fallbackContext;
    console.log(`  📦 Injected fallback context for ${agent.name}`);
  }

  // Validate cwd still exists
  if (agent.cwd && !existsSync(agent.cwd)) {
    console.log(`  ⚠️ ${agent.name}'s cwd no longer exists: ${agent.cwd} — resetting`);
    agent.cwd = null;
  }

  // Write prompt and clean up previous output
  writeFileSync(files.prompt, actualPrompt);
  writeFileSync(files.running, '1');
  const violationPath = path.join(TMP_DIR, `${agent.id}.violation`);
  const eventsPath = path.join(TMP_DIR, `${agent.id}.events`);
  for (const f of [files.out, files.done, files.progress, violationPath, eventsPath, files.phase]) {
    try {
      unlinkSync(f);
    } catch {
      // ignore
    }
  }

  agent.hasRun = true;
  saveState();
  broadcastAgents();

  // Build command using backend
  const { script } = backend.buildCommand({
    promptFile: files.prompt,
    sessionId: agent.sessionId,
    isResume,
    model: agent.model,
    systemPromptFile: files.sysprompt,
    streamParserScript: displayScript,
    agentId: agent.id,
    tmpDir: TMP_DIR,
    mcpConfigFile: existsSync(MCP_CONFIG_FILE) ? MCP_CONFIG_FILE : null,
    cwd: agent.cwd || REPO_PATH,
  });
  writeFileSync(files.sh, script, { mode: 0o755 });

  return {
    scriptFile: files.sh,
    outFile: files.out,
    doneFile: files.done,
    progressFile: files.progress,
    runningFile: files.running,
    sendDir: files.sendDir,
    cwdFile: files.cwd,
  };
}

/**
 * Deliver agent output to the chat adapter. Long output is automatically
 * split into multiple messages at natural boundaries (paragraphs, lines)
 * instead of being silently truncated.
 */
export async function deliverResponse(
  adapter: Adapter,
  agent: Agent,
  output: string,
  liveMsgId: string | null,
  replyToId: string | null,
  meta?: ResponseMeta | null,
): Promise<string | null> {
  const icon = getAgentIcon(agent);
  const maxLen = adapter.capabilities?.maxMessageLength || MAX_MSG_LEN;
  const footer = meta ? buildResponseFooter(meta) : '';
  const footerLen = footer.length;

  // Build prefix helpers — chunk numbering computed after splitting
  function makePrefix(chunkIdx: number, total: number): string {
    const tag = total > 1 ? ` (${chunkIdx + 1}/${total})` : '';
    return `${icon} ${agent.name}${tag}:\n\n`;
  }

  // Fence-healing may add up to ~20 chars per chunk (closing + re-opening ```)
  const FENCE_HEAL_MARGIN = 30;

  // First pass: split without footer to determine chunk count
  const rawBudget = maxLen - makePrefix(0, 1).length - FENCE_HEAL_MARGIN;
  const firstBudget = rawBudget - footerLen;
  const rawChunks = splitMessage(output, Math.max(firstBudget, rawBudget - 80));

  // Re-split if first chunk + footer would overflow
  let chunks: string[];
  if (rawChunks.length === 1 && (makePrefix(0, 1).length + rawChunks[0].length + footerLen) <= maxLen) {
    chunks = rawChunks;
  } else {
    const adjustedBudget = maxLen - makePrefix(0, 2).length - footerLen - FENCE_HEAL_MARGIN;
    chunks = splitMessage(output, Math.max(adjustedBudget, 200));
  }

  const total = chunks.length;

  let responseMsgId = liveMsgId;

  if (liveMsgId && adapter.capabilities?.finalMessageBehavior === 'send') {
    // Telegram: edit progress into a receipt, send response as new messages
    const receipt = meta ? buildDoneReceipt(agent, meta) : `${icon} ${agent.name}: ✅`;
    await adapter.edit(liveMsgId, receipt);
    let replyTarget = replyToId || liveMsgId;
    for (let i = 0; i < total; i++) {
      const p = makePrefix(i, total);
      const f = i === total - 1 ? footer : '';
      const newMsgId = await adapter.send(p + chunks[i] + f, replyTarget);
      if (newMsgId) {
        if (i === 0) responseMsgId = newMsgId;
        setMsgAgent(newMsgId, agent.id);
        replyTarget = newMsgId;
      }
    }
    saveState();
  } else if (liveMsgId) {
    // WhatsApp/Slack: first chunk edits the thinking message, rest sent as new
    const p0 = makePrefix(0, total);
    const f0 = total === 1 ? footer : '';
    const edited = await adapter.edit(liveMsgId, p0 + chunks[0] + f0);
    if (!edited) {
      const newMsgId = await adapter.send(p0 + chunks[0] + f0);
      if (newMsgId) {
        responseMsgId = newMsgId;
        setMsgAgent(newMsgId, agent.id);
      }
    }
    for (let i = 1; i < total; i++) {
      const p = makePrefix(i, total);
      const f = i === total - 1 ? footer : '';
      const newMsgId = await adapter.send(p + chunks[i] + f, responseMsgId);
      if (newMsgId) {
        responseMsgId = newMsgId;
        setMsgAgent(newMsgId, agent.id);
      }
    }
    saveState();
  } else {
    // No live message — send all chunks fresh
    for (let i = 0; i < total; i++) {
      const p = makePrefix(i, total);
      const f = i === total - 1 ? footer : '';
      const newMsgId = await adapter.send(p + chunks[i] + f);
      if (newMsgId) {
        if (i === 0) responseMsgId = newMsgId;
        setMsgAgent(newMsgId, agent.id);
      }
    }
    saveState();
  }

  if (total > 1) {
    console.log(`  📨 ${agent.name} response split into ${total} messages`);
  }
  console.log(`  ✅ ${agent.name} responded`);

  return responseMsgId;
}

export interface ExecuteCallbacks {
  source?: string;
  pollInterval?: number;
  timeout?: number;
  onProgress?(agent: Agent, progress: string): Promise<void> | void;
  onComplete?(
    agent: Agent,
    output: string,
    exitCode: number,
    extra: AgentRunFiles & {
      toolsUsed: string[];
      lastProgress: string;
      violations: ViolationRecord[];
      durationMs: number;
      costUsd: number | null;
    },
  ): Promise<void> | void;
  onTimeout?(agent: Agent, extra: { durationMs: number; toolsUsed: string[]; lastProgress: string }): Promise<void> | void;
  onTmuxError?(agent: Agent, error: string): Promise<void> | void;
}

export function executeAgentCommand(
  agent: Agent,
  prompt: string,
  callbacks: ExecuteCallbacks,
): void {
  const backend =
    _backends!.get(agent.backend) || _backends!.getDefault(DEFAULT_BACKEND);
  if (!backend) {
    console.error(`  ❌ Backend ${agent.backend} not found`);
    return;
  }

  const files = prepareAgentRun(agent, prompt, backend);

  console.log(
    `  🔄 Running ${backend.displayName || backend.name} for ${agent.name}...`,
  );

  // Ensure tmux session exists
  if (!ensureTmuxSession(agent)) {
    if (existsSync(files.runningFile)) unlinkSync(files.runningFile);
    if (callbacks.onTmuxError) callbacks.onTmuxError(agent, 'Could not create tmux session');
    broadcastAgents();
    return;
  }

  // Execute in tmux
  try {
    execSync(
      `tmux send-keys -t ${shellEscape(agent.tmuxSession)} "bash ${shellEscape(files.scriptFile)}" Enter`,
      EXEC_OPTS,
    );
    _timeline!.emit('message_sent', {
      agentId: agent.id,
      agentName: agent.name,
      backend: agent.backend,
      meta: { source: callbacks.source || 'unknown' },
    });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.error(`  ❌ Failed to run command in tmux for ${agent.name}: ${msg}`);
    if (existsSync(files.runningFile)) unlinkSync(files.runningFile);
    if (callbacks.onTmuxError) callbacks.onTmuxError(agent, msg);
    broadcastAgents();
    return;
  }

  // Start polling
  const pollInterval = callbacks.pollInterval || 800;
  const timeout =
    callbacks.timeout || AGENT_TIMEOUT;
  const startTime = Date.now();
  let lastProgress = '';
  let lastProgressHash = '';
  let lastEventOffset = 0;
  const eventsPath = path.join(TMP_DIR, `${agent.id}.events`);

  const poll = async (): Promise<void> => {
    if (isShuttingDown()) return;

    // Check if done
    if (existsSync(files.doneFile)) {
      let output = '';
      try {
        output = readFileSync(files.outFile, 'utf8').trim();
      } catch {
        // ignore
      }
      if (!output) output = lastProgress || '(no output)';

      let exitCode = 0;
      try {
        exitCode = parseInt(readFileSync(files.doneFile, 'utf8').trim(), 10) || 0;
      } catch {
        // ignore
      }

      // Clean up running marker
      if (existsSync(files.runningFile)) unlinkSync(files.runningFile);

      // Update cwd
      if (existsSync(files.cwdFile)) {
        const newCwd = readFileSync(files.cwdFile, 'utf8').trim();
        if (newCwd && existsSync(newCwd)) {
          if (newCwd !== agent.cwd) {
            agent.cwd = newCwd;
            console.log(`  📂 ${agent.name} working in: ${newCwd}`);
            _timeline!.emit('cwd_change', {
              agentId: agent.id,
              agentName: agent.name,
              backend: agent.backend,
              meta: { cwd: newCwd },
            });
          }
        } else {
          agent.cwd = null;
        }
      }

      // Extract session ID from session file (for backends like Codex/Gemini)
      const sessionFile = path.join(TMP_DIR, `${agent.id}.session`);
      if (!agent.sessionId && existsSync(sessionFile)) {
        try {
          const extractedId = readFileSync(sessionFile, 'utf8').trim();
          if (extractedId) {
            agent.sessionId = extractedId;
            console.log(`  🔑 Extracted session ID for ${agent.name}: ${extractedId}`);
          }
        } catch {
          // ignore
        }
      }

      // Read violation records if any
      let violations: ViolationRecord[] = [];
      const violFile = path.join(TMP_DIR, `${agent.id}.violation`);
      if (existsSync(violFile)) {
        try {
          violations = JSON.parse(readFileSync(violFile, 'utf8'));
          unlinkSync(violFile);
        } catch { /* ignore */ }
      }

      // Record in history
      const toolsUsed = _historyManager!.extractToolsFromOutput(lastProgress || '');
      _historyManager!.addAssistantTurn(agent.id, output, {
        tools: toolsUsed,
        exitCode,
        cwd: agent.cwd,
      });

      // Record usage/cost data — capture costUsd for response metadata
      let turnCostUsd: number | null = null;
      const usageFile = path.join(TMP_DIR, `${agent.id}.usage`);
      if (existsSync(usageFile)) {
        try {
          const usageData = JSON.parse(readFileSync(usageFile, 'utf8'));
          turnCostUsd = usageData.costUsd ?? null;
          _usageTracker!.record(agent.id, agent.name, agent.backend, usageData);
          unlinkSync(usageFile);
          broadcastToWS({ type: 'usage_update', usage: _usageTracker!.getAll() });
        } catch {
          // ignore
        }
      }

      const durationMs = Date.now() - startTime;

      _timeline!.emit('response', {
        agentId: agent.id,
        agentName: agent.name,
        backend: agent.backend,
        meta: { chars: output.length, exitCode, durationMs, costUsd: turnCostUsd },
      });
      saveState();
      broadcastAgents();

      if (callbacks.onComplete) {
        await callbacks.onComplete(agent, output, exitCode, {
          ...files,
          toolsUsed,
          lastProgress,
          violations,
          durationMs,
          costUsd: turnCostUsd,
        });
      }
      return;
    }

    // Check timeout
    if (Date.now() - startTime > timeout) {
      const durationMs = Date.now() - startTime;
      const toolsUsed = _historyManager!.extractToolsFromOutput(lastProgress || '');
      console.log(`  ⏰ Agent ${agent.name} timed out`);
      _timeline!.emit('timeout', {
        agentId: agent.id,
        agentName: agent.name,
        backend: agent.backend,
        meta: { durationMs },
      });
      if (existsSync(files.runningFile)) unlinkSync(files.runningFile);
      _historyManager!.recordError(agent.id, 'timeout', 'Command timed out');
      broadcastAgents();

      if (callbacks.onTimeout) await callbacks.onTimeout(agent, { durationMs, toolsUsed, lastProgress });
      return;
    }

    // Read progress
    if (existsSync(files.progressFile)) {
      try {
        const progress = readFileSync(files.progressFile, 'utf8').trim();
        if (progress) {
          const progressHash = progress.length + progress.slice(-100);
          if (progressHash !== lastProgressHash) {
            lastProgressHash = progressHash;
            lastProgress = progress;
            if (callbacks.onProgress) await callbacks.onProgress(agent, progress);
          }
        }
      } catch {
        // ignore
      }
    }

    // Read structured events (JSONL) and emit to timeline
    if (existsSync(eventsPath)) {
      try {
        const eventsRaw = readFileSync(eventsPath, 'utf8');
        const eventLines = eventsRaw.split('\n').filter(Boolean);
        for (let i = lastEventOffset; i < eventLines.length; i++) {
          try {
            const evt = JSON.parse(eventLines[i]);
            const typeMap: Record<string, string> = {
              tool: 'tool_start', think: 'thinking', text: 'text_output',
              error: 'agent_error', session: 'session_init',
            };
            const evtType = typeMap[evt.t] || 'tool_start';
            _timeline!.emit(evtType as import('../types/index.js').TimelineEventType, {
              agentId: agent.id,
              agentName: agent.name,
              backend: agent.backend,
              meta: evt,
            });
          } catch { /* skip malformed line */ }
        }
        lastEventOffset = eventLines.length;
      } catch {
        // ignore
      }
    }

    setTimeout(poll, pollInterval);
  };

  setTimeout(poll, pollInterval);
}

/** Run an agent command for the UI (no external chat adapter). */
export function runAgentCommandForUI(agent: Agent, prompt: string): void {
  console.log(`  💬 UI message sent to ${agent.name}`);

  executeAgentCommand(agent, prompt, {
    source: 'ui',
    onProgress(agent: Agent, progress: string) {
      const toolsUsed = _historyManager!.extractToolsFromOutput(progress);
      broadcastToWS({
        type: 'agent_stream',
        agentId: agent.id,
        content: progress,
        tools: toolsUsed,
      });
    },
    onComplete(agent: Agent, output: string, _exitCode: number, { toolsUsed }) {
      broadcastChatMessage(agent.id, {
        role: 'assistant',
        content: output,
        timestamp: new Date().toISOString(),
        tools: toolsUsed,
        streaming: false,
      });
      broadcastToWS({ type: 'agent_stream_end', agentId: agent.id });
    },
    onTimeout(agent: Agent) {
      broadcastToWS({ type: 'agent_stream_end', agentId: agent.id });
    },
  });
}
