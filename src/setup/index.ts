#!/usr/bin/env node
import { errorMessage } from '../utils/error.js';
import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as checks from './checks.js';
import * as backends from './backends.js';
import * as adapters from './adapters.js';
import * as envWriter from './env-writer.js';
import { SETUP_SPAWN_ENV } from './shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

const PORT = 3334;
const app = express();
const server = http.createServer(app);

app.use(express.json());

// --- WebSocket ---
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set<WebSocket>();

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);
      ws.on('close', () => wsClients.delete(ws));
    });
  } else {
    socket.destroy();
  }
});

function broadcast(data: unknown): void {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// --- Static ---
app.use(express.static(path.join(ROOT_DIR, 'ui')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'ui', 'setup.html'));
});

// --- Prerequisites ---
app.get('/api/setup/prerequisites', (_req, res) => {
  res.json(checks.checkAll());
});

app.post('/api/setup/prerequisites/install', async (req, res) => {
  const { name } = req.body as { name: string };
  try {
    broadcast({ type: 'install_start', target: name });
    const result = await checks.installPrereq(name, (data) => {
      broadcast({ type: 'install_stream', target: name, data });
    });
    broadcast({ type: 'install_done', target: name, success: true });
    res.json(result);
  } catch (e) {
    const message = errorMessage(e);
    broadcast({ type: 'install_done', target: name, success: false, error: message });
    res.status(500).json({ error: message });
  }
});

// --- Backends ---
app.get('/api/setup/backends', (_req, res) => {
  res.json(backends.checkAll());
});

app.post('/api/setup/backends/:name/install', async (req, res) => {
  const { name } = req.params;
  try {
    broadcast({ type: 'install_start', target: `backend-${name}` });
    const result = await backends.installBackend(name, (data) => {
      broadcast({ type: 'install_stream', target: `backend-${name}`, data });
    });
    broadcast({ type: 'install_done', target: `backend-${name}`, success: true });
    res.json(result);
  } catch (e) {
    const message = errorMessage(e);
    broadcast({ type: 'install_done', target: `backend-${name}`, success: false, error: message });
    res.status(500).json({ error: message });
  }
});

app.post('/api/setup/backends/:name/test', (req, res) => {
  const { name } = req.params;
  res.json(backends.testBackend(name));
});

app.post('/api/setup/backends/:name/auth', async (req, res) => {
  const { name } = req.params;
  const { apiKey } = (req.body || {}) as { apiKey?: string };

  // Gemini: save API key
  if (name === 'gemini' && apiKey) {
    const result = backends.testGeminiKey(apiKey);
    if (result.success) {
      process.env.GEMINI_API_KEY = apiKey;
    }
    res.json(result);
    return;
  }

  // Codex: device auth flow
  if (name === 'codex') {
    try {
      broadcast({ type: 'auth_start', target: name });
      const result = await backends.startDeviceAuth(name, (data) => {
        broadcast({ type: 'auth_stream', target: name, data });
      });
      broadcast({ type: 'auth_done', target: name, success: true });
      res.json(result);
    } catch (e) {
      const message = errorMessage(e);
      broadcast({ type: 'auth_done', target: name, success: false, error: message });
      res.status(500).json({ error: message });
    }
    return;
  }

  res.json({ message: `${name} auth is handled externally. Check instructions.` });
});

// --- Adapters ---
app.get('/api/setup/adapters', (_req, res) => {
  res.json(adapters.getAdapterInfo());
});

app.post('/api/setup/adapters/:name/test', async (req, res) => {
  const { name } = req.params;
  const config = (req.body || {}) as Record<string, string>;
  const result = await adapters.testAdapter(name, config);
  res.json(result);
});

// --- Environment ---
app.get('/api/setup/env', (_req, res) => {
  res.json(envWriter.readEnvRedacted());
});

app.post('/api/setup/env', (req, res) => {
  try {
    const result = envWriter.writeEnv(req.body as Record<string, string>);
    res.json(result);
  } catch (e) {
    const message = errorMessage(e);
    res.status(500).json({ error: message });
  }
});

// --- Launch ---
app.post('/api/setup/launch', (_req, res) => {
  res.json({ message: 'Run `yarn start` or `node dist/server/index.js` to start the server.' });
  setTimeout(() => {
    console.log('\n  Setup complete. Starting main server...\n');
    const main = spawn('node', ['dist/server/index.js'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      detached: true,
      env: SETUP_SPAWN_ENV,
    });
    main.unref();
    process.exit(0);
  }, 1000);
});

// --- Start ---
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     bark-pack // setup wizard        ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  http://localhost:${PORT}              ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
