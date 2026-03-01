/**
 * Main server entry point.
 * Imports all modules, wires dependencies, starts the server.
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import http from 'node:http';
import express from 'express';
import { shellEscape } from '../utils/shell.js';

import { createWhatsAppAdapter } from '../adapters/whatsapp.js';
import { createTelegramAdapter } from '../adapters/telegram.js';
import { createSlackAdapter } from '../adapters/slack.js';

import * as backends from '../backends/index.js';
import * as historyManager from '../history/index.js';
import * as fallbackManager from '../fallback/index.js';
import * as skillsManager from '../skills/index.js';
import * as securityGuard from '../security/index.js';
import * as usageTracker from '../usage/index.js';
import * as timeline from '../timeline/index.js';

// Server modules
import {
  ensureDirectories,
  GROUP_NAME,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  WA_ENABLED,
  OWNER_IDS,
  ENABLED_BACKENDS,
  DEFAULT_BACKEND,
  UI_PORT,
  API_SECRET,
  EXEC_OPTS,
  TMP_DIR,
  REPO_PATH,
  REPO_NAME,
} from './config.js';
import {
  loadState,
  getAgents,
  getAdapters,
  addAdapter,
  getStatusMsgs,
  setStatusMsg,
  isShuttingDown,
  setShuttingDown,
  saveStateNow,
  initState,
} from './state.js';
import { loadPacks, getActivePack } from './naming.js';
import { setupAuth } from './auth.js';
import {
  setupWebSocketUpgrade,
  broadcastToWS,
  broadcastAgents,
  initWebSocket,
} from './websocket.js';
import { setupApiRoutes } from './api.js';
import { updatePinnedStatus } from './status.js';
import { onMessage, initRouting } from './routing.js';
import { initExecution } from './execution.js';
import { initAgents } from './agents.js';
import { initCommands } from './commands.js';
import { initDaily } from './daily.js';
import { initApproval } from './approval.js';

// --- Wire Dependencies ---

// state.ts needs broadcastAgents
initState({ broadcastAgents });

// websocket.ts needs timeline
initWebSocket({ timeline });

// execution.ts needs backends, historyManager, usageTracker, timeline, skillsManager
initExecution({
  backends: backends as unknown as Parameters<typeof initExecution>[0]['backends'],
  historyManager: historyManager as unknown as Parameters<typeof initExecution>[0]['historyManager'],
  usageTracker: usageTracker as unknown as Parameters<typeof initExecution>[0]['usageTracker'],
  timeline: timeline as unknown as Parameters<typeof initExecution>[0]['timeline'],
  skillsManager: skillsManager as unknown as Parameters<typeof initExecution>[0]['skillsManager'],
});

// agents.ts needs backends, historyManager, fallbackManager, timeline, skillsManager
initAgents({
  backends: backends as unknown as Parameters<typeof initAgents>[0]['backends'],
  historyManager: historyManager as unknown as Parameters<typeof initAgents>[0]['historyManager'],
  fallbackManager: fallbackManager as unknown as Parameters<typeof initAgents>[0]['fallbackManager'],
  timeline: timeline as unknown as Parameters<typeof initAgents>[0]['timeline'],
  skillsManager: skillsManager as unknown as Parameters<typeof initAgents>[0]['skillsManager'],
});

// daily.ts needs backends
initDaily({
  backends: backends as unknown as Parameters<typeof initDaily>[0]['backends'],
});

// routing.ts needs securityGuard, timeline
initRouting({
  securityGuard: securityGuard as unknown as Parameters<typeof initRouting>[0]['securityGuard'],
  timeline: timeline as unknown as Parameters<typeof initRouting>[0]['timeline'],
});

// approval.ts needs getAgents and adapter access for timeout checking
initApproval({
  getAgents,
  getAdapters,
});

// commands.ts needs backends, skillsManager, usageTracker, destroyAllAdapters, getPackNames
initCommands({
  backends: backends as unknown as Parameters<typeof initCommands>[0]['backends'],
  skillsManager: skillsManager as unknown as Parameters<typeof initCommands>[0]['skillsManager'],
  usageTracker: usageTracker as unknown as Parameters<typeof initCommands>[0]['usageTracker'],
  destroyAllAdapters,
  getPackNames: () => {
    const pack = getActivePack();
    return pack?.names || [];
  },
});

// --- Express + HTTP Server ---
const app = express();
app.use(express.json({ limit: '50mb' }));

const httpServer = http.createServer(app);

// Auth (login page, middleware)
setupAuth(app);

// API routes
setupApiRoutes(app, {
  backends: backends as unknown as Parameters<typeof setupApiRoutes>[1]['backends'],
  historyManager: historyManager as unknown as Parameters<typeof setupApiRoutes>[1]['historyManager'],
  usageTracker: usageTracker as unknown as Parameters<typeof setupApiRoutes>[1]['usageTracker'],
  timeline: timeline as unknown as Parameters<typeof setupApiRoutes>[1]['timeline'],
  skillsManager: skillsManager as unknown as Parameters<typeof setupApiRoutes>[1]['skillsManager'],
});

// WebSocket upgrade handler
setupWebSocketUpgrade(httpServer);

// --- Adapter Lifecycle ---

async function destroyAllAdapters(): Promise<void> {
  for (const adapter of getAdapters()) {
    try {
      await adapter.destroy();
    } catch {
      // ignore
    }
  }
}

// --- Graceful shutdown ---

process.on('SIGINT', async () => {
  if (isShuttingDown()) return;
  setShuttingDown(true);
  console.log('\nShutting down...');

  // Kill agent tmux sessions
  for (const [, agent] of getAgents()) {
    if (agent.tmuxSession) {
      try {
        execSync(
          `tmux kill-session -t ${shellEscape(agent.tmuxSession)} 2>/dev/null`,
          EXEC_OPTS,
        );
      } catch {
        // ignore
      }
    }
  }

  saveStateNow();

  // Send goodbye on all adapters then destroy
  for (const adapter of getAdapters()) {
    try {
      await adapter.sendGoodbye();
    } catch {
      // ignore
    }
  }
  await destroyAllAdapters();
  process.exit(0);
});

process.on('SIGTERM', () => process.kill(process.pid, 'SIGINT'));

// --- Startup ---

async function main(): Promise<void> {
  console.log('Starting multi-bark-pack...');
  if (REPO_PATH) {
    console.log(`  📁 Target repo: ${REPO_NAME} (${REPO_PATH})`);
  }
  ensureDirectories();
  loadState();
  loadPacks();

  // Initialize backends
  console.log('Initializing backends...');
  await backends.initialize({
    enabledBackends: ENABLED_BACKENDS,
    defaultBackend: DEFAULT_BACKEND,
  });

  // Initialize skills (load once at startup)
  console.log('Loading skills...');
  skillsManager.initialize();

  // Initialize security guard
  securityGuard.initialize();

  // Initialize usage tracker
  usageTracker.initialize();

  // Initialize activity timeline
  timeline.initialize({ broadcast: broadcastToWS });

  // Security warnings at startup
  for (const [platform, owners] of Object.entries(OWNER_IDS)) {
    if (owners === 'DANGER-ALL') {
      console.log(
        `  🚨 WARNING: ${platform} owner is set to DANGER-ALL — any sender can control agents!`,
      );
    }
  }
  if (!API_SECRET) {
    console.log(
      `  🚨 WARNING: API_SECRET not set — API and WebSocket are open to all. Set API_SECRET in .env.`,
    );
  }

  // Start Management UI HTTP server immediately (before adapters)
  httpServer.listen(UI_PORT, () => {
    console.log(`Management UI available at http://localhost:${UI_PORT}`);
    if (API_SECRET) {
      console.log(`  🔒 API authentication enabled (login at /login)`);
    } else {
      console.log(
        `  ⚠️  API authentication disabled — set API_SECRET in .env to secure`,
      );
    }
  });

  // Clean up stale .running markers from previous session
  try {
    const staleRunning = execSync(
      `ls "${TMP_DIR}"/*.running 2>/dev/null || true`,
      EXEC_OPTS,
    )
      .toString()
      .trim();
    if (staleRunning) {
      for (const f of staleRunning.split('\n')) {
        if (f.trim()) {
          try {
            unlinkSync(f.trim());
          } catch {
            // ignore
          }
        }
      }
      console.log('  🧹 Cleaned stale .running markers');
    }
  } catch {
    // ignore
  }

  // Initialize adapters based on config
  const statusMsgs = getStatusMsgs();

  if (WA_ENABLED) {
    console.log('Initializing WhatsApp adapter...');
    const wa = createWhatsAppAdapter({ groupName: GROUP_NAME });
    addAdapter(wa);
    await wa.initialize(onMessage);
    if (!statusMsgs.whatsapp) setStatusMsg('whatsapp', null);
  }

  if (TELEGRAM_TOKEN) {
    console.log('Initializing Telegram adapter...');
    const tg = createTelegramAdapter({
      token: TELEGRAM_TOKEN,
      chatId: TELEGRAM_CHAT_ID ?? undefined,
    });
    addAdapter(tg);
    await tg.initialize(onMessage);
    if (!statusMsgs.telegram) setStatusMsg('telegram', null);
  }

  if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
    console.log('Initializing Slack adapter...');
    const slack = createSlackAdapter({
      botToken: SLACK_BOT_TOKEN,
      appToken: SLACK_APP_TOKEN,
      owners: OWNER_IDS.slack,
    });
    addAdapter(slack);
    await slack.initialize(onMessage);
    if (!statusMsgs.slack) setStatusMsg('slack', null);
  }

  const adapters = getAdapters();
  if (adapters.length === 0) {
    console.error(
      'No adapters configured! Set WA_ENABLED=true (default), TELEGRAM_TOKEN, or SLACK_BOT_TOKEN + SLACK_APP_TOKEN.',
    );
    process.exit(1);
  }

  // Send startup message + fresh pinned status on all adapters
  const startMessages = [
    "🐾 Pack's up!",
    '🐕 Pups online!',
    "🦴 Who's a good bot?",
    '🚨 Paws ready!',
  ];
  const greeting =
    startMessages[Math.floor(Math.random() * startMessages.length)];
  for (const adapter of adapters) {
    if (adapter.isReady()) {
      try {
        await adapter.send(greeting);
      } catch {
        // ignore
      }
    }
  }
  await updatePinnedStatus();

  console.log(
    `bark-pack running with ${adapters.length} adapter(s): ${adapters.map(a => a.name).join(', ')}`,
  );
}

// Run main
main().catch(e => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
