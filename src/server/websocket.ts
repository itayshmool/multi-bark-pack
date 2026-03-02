/**
 * WebSocket — client set, broadcast helpers, upgrade handler, connection handler.
 */

import WebSocket, { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TimelineProvider } from '../types/index.js';
import { API_SECRET } from './config.js';
import { getAllAgentsWithStatus } from './state.js';
import { isAuthenticated } from './auth.js';

// Lazily injected dependencies
let _timeline: TimelineProvider | null = null;

export function initWebSocket(deps: {
  timeline: TimelineProvider;
}): void {
  _timeline = deps.timeline;
}

// --- WebSocket State ---
export const wsClients = new Set<WebSocket>();
export const wss = new WebSocketServer({ noServer: true });

/** Broadcast an arbitrary JSON payload to all connected WS clients. */
export function broadcastToWS(data: unknown): void {
  if (wsClients.size === 0) return;
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    try {
      ws.send(msg);
    } catch {
      // ignore
    }
  }
}

/** Broadcast the full agent list (active + deleted) to all WS clients. */
export function broadcastAgents(): void {
  if (wsClients.size === 0) return;
  broadcastToWS({ type: 'agents', agents: getAllAgentsWithStatus() });
}

/** Broadcast a chat message event for a specific agent. */
export function broadcastChatMessage(agentId: string, message: unknown): void {
  broadcastToWS({
    type: 'agent_message',
    agentId,
    message,
  });
}

/** Register the WebSocket upgrade handler on the HTTP server. */
export function setupWebSocketUpgrade(httpServer: HttpServer): void {
  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    // Check API_SECRET if configured (cookie or query param)
    if (API_SECRET) {
      if (!isAuthenticated(request as unknown as { headers: Record<string, string | undefined> })) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    wsClients.add(ws);
    console.log(`  📡 UI client connected (${wsClients.size} total)`);

    // Send initial state
    ws.send(JSON.stringify({ type: 'agents', agents: getAllAgentsWithStatus() }));
    if (_timeline) {
      ws.send(JSON.stringify({ type: 'timeline_init', events: _timeline.getRecent(50) }));
    }

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`  📡 UI client disconnected (${wsClients.size} remaining)`);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });
  });
}
