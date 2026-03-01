/**
 * Daily standup — gather status from all pups.
 */

import { errorMessage } from '../utils/error.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Adapter, BackendsProvider } from '../types/index.js';
import { TMP_DIR, PROJECTS_DIR, EXEC_OPTS, REPO_PATH } from './config.js';
import { MCP_CONFIG_FILE } from '../config/paths.js';
import { classifyAgents } from './status.js';
import { updatePinnedStatus } from './status.js';
import { createTmuxSession } from './tmux.js';

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
  const standupPromises = idle.map(({ emoji, status, agent }) => {
    const project = agent.cwd ? ` [${path.basename(agent.cwd)}]` : '';
    return new Promise<string>(resolve => {
      const promptFile = path.join(TMP_DIR, `${agent.id}.standup.prompt`);
      const outFile = path.join(TMP_DIR, `${agent.id}.standup.out`);
      const doneFile = path.join(TMP_DIR, `${agent.id}.standup.done`);
      const progressFile = path.join(TMP_DIR, `${agent.id}.standup.progress`);

      const scriptFile = path.join(TMP_DIR, `${agent.id}.standup.sh`);
      let resolved = false;
      let poll: ReturnType<typeof setInterval> | null = null;
      function done(msg: string): void {
        if (resolved) return;
        resolved = true;
        if (poll) clearInterval(poll);
        clearTimeout(hardDeadline);
        for (const f of [promptFile, outFile, doneFile, progressFile, scriptFile]) {
          try {
            unlinkSync(f);
          } catch {
            // ignore
          }
        }
        resolve(msg);
      }

      for (const f of [outFile, doneFile]) {
        try {
          unlinkSync(f);
        } catch {
          // ignore
        }
      }

      const standupPrompt =
        'Standup. Answer from memory only — no tool use, no research. Plain text, 3 lines max:\n1. Done: [what you completed]\n2. Next: [what\'s remaining]\n3. Blockers: [any blockers, or "none"]';
      writeFileSync(promptFile, standupPrompt);

      // Build standup command using backend
      const backend =
        _backends!.get(agent.backend) || _backends!.getDefault(agent.backend);
      const __daily_dir = path.dirname(fileURLToPath(import.meta.url));
      const displayScript = path.join(__daily_dir, '..', 'stream-display.js');
      const { script } = backend.buildCommand({
        promptFile,
        sessionId: agent.sessionId,
        isResume: agent.hasRun,
        model: 'haiku', // Force haiku for quick standups
        streamParserScript: displayScript,
        agentId: `${agent.id}.standup`,
        tmpDir: TMP_DIR,
        mcpConfigFile: existsSync(MCP_CONFIG_FILE) ? MCP_CONFIG_FILE : null,
        cwd: agent.cwd || REPO_PATH,
      });
      writeFileSync(scriptFile, script, { mode: 0o755 });

      // Hard deadline: resolve no matter what after PUP_TIMEOUT_MS
      const hardDeadline = setTimeout(() => {
        console.log(`  ⏰ /daily: ${agent.name} timed out`);
        done(`${emoji} *${agent.name}*${project} (${status}): _timed out_`);
      }, PUP_TIMEOUT_MS);

      // Ensure tmux session exists
      try {
        execSync(
          `tmux has-session -t "${agent.tmuxSession}" 2>/dev/null`,
          EXEC_OPTS,
        );
      } catch {
        try {
          const startDir =
            agent.cwd && existsSync(agent.cwd) ? agent.cwd : PROJECTS_DIR;
          createTmuxSession(agent.tmuxSession, agent.id, { startDir });
        } catch (e: unknown) {
          const msg = errorMessage(e);
          console.log(`  ❌ /daily: couldn't reach ${agent.name}: ${msg}`);
          done(
            `${emoji} *${agent.name}*${project} (${status}): _couldn't reach_`,
          );
          return;
        }
      }

      try {
        execSync(
          `tmux send-keys -t "${agent.tmuxSession}" "bash '${scriptFile}'" Enter`,
          EXEC_OPTS,
        );
        console.log(`  📤 /daily: sent standup prompt to ${agent.name}`);
      } catch (e: unknown) {
        const msg = errorMessage(e);
        console.log(`  ❌ /daily: tmux error for ${agent.name}: ${msg}`);
        done(
          `${emoji} *${agent.name}*${project} (${status}): _couldn't reach_`,
        );
        return;
      }

      // Poll every second for completion
      poll = setInterval(() => {
        if (existsSync(doneFile)) {
          let output = '';
          try {
            output = readFileSync(outFile, 'utf8').trim();
          } catch {
            // ignore
          }
          console.log(
            `  ✅ /daily: ${agent.name} responded (${output.length} chars)`,
          );
          done(
            `${emoji} *${agent.name}*${project}:\n${output || '_no response_'}`,
          );
        }
      }, 1000);
    });
  });

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
