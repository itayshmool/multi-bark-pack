/**
 * Daily standup — gather status from all pups.
 */

import { errorMessage } from '../utils/error.js';
import { shellEscape } from '../utils/shell.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { exec, execSync } from 'node:child_process';
import type { Adapter, BackendsProvider } from '../types/index.js';
import { TMP_DIR, PROJECTS_DIR, EXEC_OPTS, REPO_PATH } from './config.js';
import { MCP_CONFIG_FILE } from '../config/paths.js';
import { classifyAgents } from './status.js';
import { updatePinnedStatus } from './status.js';
import { createTmuxSession, ensureTmuxSession } from './tmux.js';

// Lazily injected dependencies
let _backends: BackendsProvider | null = null;

export function initDaily(deps: {
  backends: BackendsProvider;
}): void {
  _backends = deps.backends;
}

export async function runDaily(adapter: Adapter): Promise<void> {
  const classified = classifyAgents();
  if (!classified.length) {
    await adapter.send('📋 *Daily Standup*\n\nNo active pups.');
    return;
  }

  const statusMsg = await adapter.send('📋 *Daily Standup*\n\n_Gathering reports..._');
  const lines: string[] = [];

  // Separate busy vs respondable (idle/yelp/nap — all can be asked via --resume)
  const busy = classified.filter(c => c.status === 'run');
  const idle = classified.filter(c => c.status !== 'run');

  console.log(`  📋 /daily: ${busy.length} busy, ${idle.length} to ask (idle+nap)`);

  // Busy pups: read state files, don't interrupt
  for (const { emoji, agent } of busy) {
    let context = '';
    const progressFile = path.join(TMP_DIR, `${agent.id}.progress`);
    const promptFile = path.join(TMP_DIR, `${agent.id}.prompt`);
    try {
      const progress = readFileSync(progressFile, 'utf8').trim();
      const toolLine = progress
        .split('\n')
        .find(
          l =>
            l.includes('→') ||
            l.includes('💻') ||
            l.includes('📖') ||
            l.includes('✏️'),
        );
      if (toolLine) context = ` — ${toolLine.trim()}`;
    } catch {
      // ignore
    }
    if (!context) {
      try {
        const prompt = readFileSync(promptFile, 'utf8').trim();
        const short = prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt;
        context = ` — working on: "${short}"`;
      } catch {
        // ignore
      }
    }
    const project = agent.cwd ? ` [${path.basename(agent.cwd)}]` : '';
    lines.push(`${emoji} *${agent.name}*${project} (busy)${context}`);
  }

  // Idle/yelp pups: ask for standup via --resume --model haiku (parallel)
  const PUP_TIMEOUT_MS = 40_000;

  interface PendingStandup {
    agent: { emoji: string; status: string; agent: typeof idle[0]['agent'] };
    doneFile: string;
    outFile: string;
    cleanupFiles: string[];
    resolve: (msg: string) => void;
    resolved: boolean;
    deadline: ReturnType<typeof setTimeout>;
  }

  const pending: PendingStandup[] = [];

  const standupPromises = idle.map(({ emoji, status, agent }) => {
    const project = agent.cwd ? ` [${path.basename(agent.cwd)}]` : '';
    return new Promise<string>(resolve => {
      const promptFile = path.join(TMP_DIR, `${agent.id}.standup.prompt`);
      const outFile = path.join(TMP_DIR, `${agent.id}.standup.out`);
      const doneFile = path.join(TMP_DIR, `${agent.id}.standup.done`);
      const progressFile = path.join(TMP_DIR, `${agent.id}.standup.progress`);
      const scriptFile = path.join(TMP_DIR, `${agent.id}.standup.sh`);

      const cleanupFiles = [promptFile, outFile, doneFile, progressFile, scriptFile];

      function finish(msg: string): void {
        if (entry.resolved) return;
        entry.resolved = true;
        clearTimeout(entry.deadline);
        for (const f of cleanupFiles) { try { unlinkSync(f); } catch { /* ignore */ } }
        resolve(msg);
      }

      for (const f of [outFile, doneFile]) { try { unlinkSync(f); } catch { /* ignore */ } }

      const standupPrompt =
        'Quick standup — answer from memory, no tool use. 2-3 lines max: what did you get done, what\'s left, any blockers?';
      writeFileSync(promptFile, standupPrompt);

      const backend =
        _backends!.get(agent.backend) || _backends!.getDefault(agent.backend);
      const __daily_dir = path.dirname(fileURLToPath(import.meta.url));
      const displayScript = path.join(__daily_dir, '..', 'stream-display.js');
      const { script } = backend.buildCommand({
        promptFile,
        sessionId: agent.sessionId,
        isResume: agent.hasRun,
        model: 'haiku',
        streamParserScript: displayScript,
        agentId: `${agent.id}.standup`,
        tmpDir: TMP_DIR,
        mcpConfigFile: existsSync(MCP_CONFIG_FILE) ? MCP_CONFIG_FILE : null,
        cwd: agent.cwd || REPO_PATH,
      });
      writeFileSync(scriptFile, script, { mode: 0o755 });

      const entry: PendingStandup = {
        agent: { emoji, status, agent },
        doneFile,
        outFile,
        cleanupFiles,
        resolve,
        resolved: false,
        deadline: setTimeout(() => {
          console.log(`  ⏰ /daily: ${agent.name} timed out`);
          finish(`${emoji} *${agent.name}*${project} (${status}): _timed out_`);
        }, PUP_TIMEOUT_MS),
      };
      pending.push(entry);

      if (!ensureTmuxSession(agent)) {
        finish(`${emoji} *${agent.name}*${project} (${status}): _couldn't reach_`);
        return;
      }

      const sendCmd = `tmux send-keys -t ${shellEscape(agent.tmuxSession)} "bash ${shellEscape(scriptFile)}" Enter`;
      exec(sendCmd, (err) => {
        if (err) {
          console.log(`  ❌ /daily: tmux error for ${agent.name}: ${errorMessage(err)}`);
          finish(`${emoji} *${agent.name}*${project} (${status}): _couldn't reach_`);
        } else {
          console.log(`  📤 /daily: sent standup prompt to ${agent.name}`);
        }
      });
    });
  });

  // Single shared poller: batch-check all pending pups every second
  if (pending.length > 0) {
    await new Promise<void>(resolvePoller => {
      const sharedPoll = setInterval(() => {
        let allDone = true;
        for (const entry of pending) {
          if (entry.resolved) continue;
          allDone = false;
          if (existsSync(entry.doneFile)) {
            let output = '';
            try { output = readFileSync(entry.outFile, 'utf8').trim(); } catch { /* ignore */ }
            const { emoji, agent } = entry.agent;
            const project = agent.cwd ? ` [${path.basename(agent.cwd)}]` : '';
            console.log(`  ✅ /daily: ${agent.name} responded (${output.length} chars)`);
            entry.resolved = true;
            clearTimeout(entry.deadline);
            for (const f of entry.cleanupFiles) { try { unlinkSync(f); } catch { /* ignore */ } }
            entry.resolve(`${emoji} *${agent.name}*${project}:\n${output || '_no response_'}`);
          }
        }
        if (allDone || pending.every(e => e.resolved)) {
          clearInterval(sharedPoll);
          resolvePoller();
        }
      }, 1000);
    });
  }

  const standupResults = await Promise.all(standupPromises);
  lines.push(...standupResults);

  const report = `📋 *Daily Standup*\n\n${lines.join('\n\n')}`;
  console.log(`  📋 /daily: report ready (${lines.length} entries)`);

  // Edit the initial message with the full report (10s timeout on API calls)
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms),
      ),
    ]);
  try {
    if (statusMsg) {
      await withTimeout(adapter.edit(statusMsg, report), 10_000);
    } else {
      await withTimeout(adapter.send(report), 10_000);
    }
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.log(`  ⚠️ /daily: edit failed (${msg}), sending new message`);
    try {
      await withTimeout(adapter.send(report), 10_000);
    } catch {
      // ignore
    }
  }

  // Refresh pinned status — pups that were napping are now awake
  updatePinnedStatus();
}
