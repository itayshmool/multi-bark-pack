/**
 * REST API routes — Express handlers for /api/*.
 */

import { errorMessage } from '../utils/error.js';
import { parseMessageTags } from '../utils/tags.js';
import path from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import express from 'express';
import type { Express, Request, Response } from 'express';
import type {
  Agent,
  BackendsProvider,
  HistoryManagerProvider,
  UsageTrackerProvider,
  TimelineProvider,
  SkillsManagerProvider,
} from '../types/index.js';
import { TMP_DIR, PROJECTS_DIR, DEFAULT_BACKEND, MAX_SUB_AGENTS } from './config.js';
import { ROOT_DIR, MCP_CONFIG_FILE } from '../config/paths.js';
import {
  getAgents,
  getDeletedAgents,
  getAllAgentsWithStatus,
  genId,
  saveState,
} from './state.js';
import {
  getPacks,
  getActivePack,
  setActivePack,
  createPack,
  updatePack,
  deletePack,
  nextPupName,
  sanitizeName,
  getActivePackId,
} from './naming.js';
import { broadcastAgents, broadcastChatMessage } from './websocket.js';
import { updatePinnedStatus } from './status.js';
import { getActiveSubAgents } from './delegation.js';
import { createTmuxSession } from './tmux.js';
import {
  findAgentByName,
  stopAgents,
  clearAgents,
  deleteAgents,
} from './agents.js';
import { runAgentCommandForUI } from './execution.js';

interface ApiDeps {
  backends: BackendsProvider;
  historyManager: HistoryManagerProvider;
  usageTracker: UsageTrackerProvider;
  timeline: TimelineProvider;
  skillsManager: SkillsManagerProvider;
}

let _deps: ApiDeps | null = null;

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

/**
 * Process an array of attachment file paths: classify each as image or file,
 * build prompt prefixes, and return structured info for history tracking.
 */
function processAttachments(attachments: string[]): {
  promptPrefix: string;
  images: string[];
  files: string[];
  infos: Array<{ filename: string; filepath: string; type: string }>;
} {
  const images: string[] = [];
  const files: string[] = [];
  const infos: Array<{ filename: string; filepath: string; type: string }> = [];
  let promptPrefix = '';

  for (const filepath of attachments) {
    if (!existsSync(filepath) || !filepath.startsWith(TMP_DIR)) continue;

    const filename = path.basename(filepath);
    const ext = path.extname(filename).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.includes(ext);

    infos.push({ filename, filepath, type: isImage ? 'image' : 'file' });

    if (isImage) {
      images.push(filepath);
      promptPrefix = `[Image attached: ${filepath}]\nUse the Read tool to view this image, then respond.\n\n${promptPrefix}`;
    } else {
      files.push(filepath);
      promptPrefix = `[File attached: ${filepath}]\nUse the Read tool to view this file.\n\n${promptPrefix}`;
    }
  }

  return { promptPrefix, images, files, infos };
}

export function setupApiRoutes(app: Express, deps: ApiDeps): void {
  _deps = deps;

  // Serve static files from ui/
  app.use(express.static(path.join(ROOT_DIR, 'ui')));

  // REST API: Get all agents
  app.get('/api/agents', (_req: Request, res: Response) => {
    res.json(getAllAgentsWithStatus());
  });

  // REST API: Get single agent
  app.get('/api/agents/:id', (req: Request, res: Response) => {
    const agent =
      getAgents().get(req.params.id) || getDeletedAgents().get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({
      ...agent,
      isRunning: existsSync(path.join(TMP_DIR, `${agent.id}.running`)),
    });
  });

  // REST API: Get backends
  app.get('/api/backends', async (_req: Request, res: Response) => {
    const list = _deps!.backends.list();
    // Add version info
    const results: Array<Record<string, unknown>> = [];
    for (const b of list) {
      const backend = _deps!.backends.get(b.name);
      let version: string | null = null;
      if (backend) {
        try {
          version = await backend.getVersion();
        } catch {
          // ignore
        }
      }
      results.push({ ...b, installed: true, version });
    }
    res.json(results);
  });

  // REST API: Usage
  app.get('/api/usage', (_req: Request, res: Response) => {
    res.json(_deps!.usageTracker.getAll());
  });

  // REST API: Timeline
  app.get('/api/timeline', (req: Request, res: Response) => {
    const {
      limit = '100',
      offset = '0',
      agentId,
      agentName,
      backend,
      type,
    } = req.query as Record<string, string>;
    res.json(
      _deps!.timeline.getAll({
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        agentId: agentId || null,
        agentName: agentName || null,
        backend: backend || null,
        eventType: type || null,
      }),
    );
  });

  // REST API: Packs
  app.get('/api/packs', (_req: Request, res: Response) => {
    res.json(getPacks());
  });

  app.get('/api/packs/active', (_req: Request, res: Response) => {
    res.json(getActivePack());
  });

  app.put('/api/packs/active', (req: Request, res: Response) => {
    const { packId } = req.body as { packId?: string };
    if (!packId) return res.status(400).json({ error: 'packId required' });
    if (setActivePack(packId)) {
      res.json({ success: true, activePack: packId });
    } else {
      res.status(404).json({ error: 'Pack not found' });
    }
  });

  app.post('/api/packs', (req: Request, res: Response) => {
    const pack = createPack(req.body as Record<string, unknown>);
    if (pack) {
      res.json(pack);
    } else {
      res.status(400).json({ error: 'Invalid pack or ID already exists' });
    }
  });

  app.put('/api/packs/:id', (req: Request, res: Response) => {
    const pack = updatePack(req.params.id, req.body as Record<string, unknown>);
    if (pack) {
      res.json(pack);
    } else {
      res.status(404).json({ error: 'Pack not found' });
    }
  });

  app.delete('/api/packs/:id', (req: Request, res: Response) => {
    if (deletePack(req.params.id)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Pack not found or is builtin' });
    }
  });

  // REST API: Stop agent
  app.post('/api/agents/:id/stop', (req: Request, res: Response) => {
    const agent = getAgents().get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const result = stopAgents([agent.name]);
    broadcastAgents();
    res.json({ success: true, stopped: result.stopped });
  });

  // REST API: Clear (shelve) agent
  app.post('/api/agents/:id/clear', (req: Request, res: Response) => {
    const agent = getAgents().get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const result = clearAgents([agent.name]);
    broadcastAgents();
    res.json({ success: true, cleared: result.cleared });
  });

  // REST API: Delete agent permanently
  app.delete('/api/agents/:id', (req: Request, res: Response) => {
    const agent =
      getAgents().get(req.params.id) || getDeletedAgents().get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const result = deleteAgents([agent.name]);
    broadcastAgents();
    res.json({ success: true, deleted: result.deleted });
  });

  // REST API: Get agent message history
  app.get('/api/agents/:id/messages', (req: Request, res: Response) => {
    const agent = getAgents().get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const history = _deps!.historyManager.load(agent.id);
    const messages = (history.turns || []).map(turn => ({
      role: turn.role,
      content: turn.content,
      timestamp: turn.timestamp,
      tools: turn.tools || [],
      attachments: turn.files || [],
    }));
    res.json(messages);
  });

  // REST API: Upload files (base64)
  app.post(
    '/api/upload',
    express.json({ limit: '50mb' }),
    (req: Request, res: Response) => {
      const { files } = req.body as {
        files?: Array<{ name: string; data: string; type?: string }>;
      };
      if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'No files provided' });
      }

      const maxSize = 10 * 1024 * 1024; // 10MB
      const allowedExts = [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.pdf',
        '.txt',
        '.md',
        '.json',
        '.js',
        '.ts',
        '.py',
        '.sh',
        '.css',
        '.html',
      ];
      const results: Array<Record<string, unknown>> = [];

      for (const file of files) {
        if (!file.name || !file.data) continue;

        // Validate extension
        const ext = path.extname(file.name).toLowerCase();
        if (!allowedExts.includes(ext)) {
          return res
            .status(400)
            .json({ error: `File type not allowed: ${ext}` });
        }

        // Decode base64
        const buffer = Buffer.from(file.data, 'base64');
        if (buffer.length > maxSize) {
          return res
            .status(400)
            .json({ error: `File too large: ${file.name} (max 10MB)` });
        }

        // Save file
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filename = `upload-${Date.now()}-${safeName}`;
        const filepath = path.join(TMP_DIR, filename);
        writeFileSync(filepath, buffer);

        results.push({
          originalName: file.name,
          filename,
          filepath,
          type: file.type || 'application/octet-stream',
          size: buffer.length,
        });
      }

      res.json(results);
    },
  );

  // REST API: Serve uploaded files
  app.get('/api/files/:filename', (req: Request, res: Response) => {
    const filename = req.params.filename;
    // Security: prevent directory traversal
    if (
      filename.includes('..') ||
      filename.includes('/') ||
      filename.includes('\\')
    ) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(TMP_DIR, filename);
    if (!existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filepath);
  });

  // REST API: Send message to agent
  app.post('/api/agents/:id/message', async (req: Request, res: Response) => {
    const agent = getAgents().get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { content, attachments } = req.body as {
      content?: string;
      attachments?: string[];
    };
    const hasContent = content && content.trim();
    const hasAttachments =
      attachments && Array.isArray(attachments) && attachments.length > 0;

    if (!hasContent && !hasAttachments) {
      return res
        .status(400)
        .json({ error: 'Message content or attachments required' });
    }

    // Check if agent is already running
    const runningFile = path.join(TMP_DIR, `${agent.id}.running`);
    if (existsSync(runningFile)) {
      return res.status(409).json({ error: 'Agent is busy' });
    }

    // Build prompt with file context (following existing adapter pattern)
    let prompt = content ? content.trim() : '';

    // Add attachment context to prompt
    const { promptPrefix, infos: attachmentInfos } = hasAttachments
      ? processAttachments(attachments!)
      : { promptPrefix: '', infos: [] as Array<{ filename: string; filepath: string; type: string }> };
    if (promptPrefix) prompt = promptPrefix + prompt;

    // Extract model tags from message
    const msgTags = parseMessageTags(prompt);
    const model: string | null = msgTags.model || null;
    const cleanPrompt = msgTags.cleanBody;

    if (model) agent.model = model;

    // Save user turn to history (with attachments)
    _deps!.historyManager.addUserTurn(
      agent.id,
      cleanPrompt,
      attachmentInfos.length > 0 ? attachmentInfos : undefined,
    );

    // Broadcast the user message via WebSocket (with attachments for display)
    broadcastChatMessage(agent.id, {
      role: 'user',
      content: content ? content.trim() : '(file attachment)',
      attachments: attachmentInfos,
      timestamp: new Date().toISOString(),
    });

    // Run the command without an adapter (results come via WebSocket)
    runAgentCommandForUI(agent, cleanPrompt);

    res.json({ success: true });
  });

  // REST API: Create new agent
  app.post('/api/agents', async (req: Request, res: Response) => {
    const {
      name,
      message,
      backend: backendName,
      model,
      attachments,
      parentId,
      branch,
    } = req.body as {
      name?: string;
      message?: string;
      backend?: string;
      model?: string;
      attachments?: string[];
      parentId?: string;
      branch?: boolean;
    };
    const hasMessage = message && message.trim();
    const hasAttachments =
      attachments && Array.isArray(attachments) && attachments.length > 0;

    if (!hasMessage && !hasAttachments) {
      return res
        .status(400)
        .json({ error: 'Initial message or attachments required' });
    }

    // Validate delegation if parentId provided
    if (parentId) {
      const parent = getAgents().get(parentId);
      if (!parent) {
        return res.status(400).json({ error: 'Parent agent not found' });
      }
      if (parent.status !== 'active') {
        return res.status(400).json({ error: 'Parent agent is not active' });
      }
      if (parent.parentId) {
        return res
          .status(403)
          .json({
            error: 'Sub-agents cannot delegate further (max depth reached)',
          });
      }
      const existingSubs = getActiveSubAgents(parentId);
      if (existingSubs.length >= MAX_SUB_AGENTS) {
        return res.status(403).json({
          error: `Parent already has ${MAX_SUB_AGENTS} active sub-agents (max reached)`,
          existing: existingSubs.map(a => ({ id: a.id, name: a.name })),
        });
      }
    }

    // Validate backend if specified
    if (backendName && !_deps!.backends.isAvailable(backendName)) {
      return res
        .status(400)
        .json({ error: `Backend "${backendName}" not available` });
    }

    // Extract tags from message
    let cleanMessage = hasMessage ? message!.trim() : '';
    let requestedModel = model || null;
    let requestedBackend = backendName || null;

    const createTags = parseMessageTags(cleanMessage);
    cleanMessage = createTags.cleanBody;
    if (createTags.model) requestedModel = createTags.model;
    if (createTags.backend) requestedBackend = createTags.backend;

    // Legacy: also support bare #claude as alias for claude-code
    if (!requestedBackend && cleanMessage.includes('#claude')) {
      requestedBackend = 'claude-code';
      cleanMessage = cleanMessage.replace(/#claude/g, '').trim();
    }

    // Create the agent
    const id = genId();
    const agentName =
      sanitizeName(name?.trim()) || nextPupName();
    const backend =
      _deps!.backends.get(requestedBackend!) ||
      _deps!.backends.getDefault(DEFAULT_BACKEND);
    const sessionId = backend.generateSessionId();
    const tmuxSession = `bark-${agentName}`;

    // Create tmux session (start in parent's cwd if delegating)
    const parentCwd = parentId ? getAgents().get(parentId)?.cwd : null;
    const startDir =
      parentCwd && existsSync(parentCwd) ? parentCwd : PROJECTS_DIR;
    try {
      createTmuxSession(tmuxSession, id, { startDir, echoName: agentName });
    } catch (e: unknown) {
      const msg = errorMessage(e);
      console.log(
        `  ⚠️ Could not create tmux session for ${agentName}: ${msg}`,
      );
    }

    const agents = getAgents();
    const adapters = (await import('./state.js')).getAdapters();

    const agent: Agent = {
      id,
      name: agentName,
      sessionId,
      tmuxSession,
      backend: backend.name,
      model: requestedModel || backend.defaultModel,
      status: 'active',
      parentId: parentId || null,
      cwd: parentCwd && existsSync(parentCwd) ? parentCwd : null,
      createdAt: new Date().toISOString(),
      source: parentId ? 'delegation' : 'ui',
      packId: getActivePackId(),
      skills: _deps!.skillsManager.list(true).map(s => s.id),
      hasRun: false,
      retryCount: 0,
    };

    agents.set(id, agent);
    saveState();
    broadcastAgents();

    const parentAgent = parentId ? agents.get(parentId) : null;
    if (parentId) {
      console.log(
        `  🐕 Spawned ${agentName} (delegated by ${parentAgent?.name}) (tmux: ${tmuxSession})`,
      );
      _deps!.timeline.emit('delegate', {
        agentId: id,
        agentName,
        backend: backend.name,
        meta: { parentId, parentName: parentAgent?.name },
      });
      // Notify chat adapters about the delegation
      for (const adapter of adapters) {
        if (adapter.isReady()) {
          adapter
            .send(
              `🐕‍🦺 [${agentName}] spawned by ${parentAgent?.name}`,
            )
            .catch(() => {});
        }
      }
      updatePinnedStatus();
    } else {
      console.log(
        `  🐕 Spawned ${agentName} from UI (tmux: ${tmuxSession})`,
      );
      _deps!.timeline.emit('spawn', {
        agentId: id,
        agentName,
        backend: backend.name,
        meta: { source: 'ui' },
      });
    }

    // Inject parent context for delegated sub-agents
    let prompt = cleanMessage;
    if (parentId) {
      const parentCtx = _deps!.historyManager.getContext(parentId);
      const ctxParts: string[] = [];
      if (parentCtx.summary) {
        ctxParts.push(
          `[Context from ${parentAgent?.name || 'parent'}]\n${parentCtx.summary}`,
        );
      }
      if (parentCtx.cwd) {
        ctxParts.push(`[Working Directory]\n${parentCtx.cwd}`);
      }
      if (parentCtx.filesModified?.length > 0) {
        ctxParts.push(
          `[Files Modified]\n${parentCtx.filesModified.join('\n')}`,
        );
      }
      if (branch) {
        ctxParts.push(
          `[Git Instructions]\nYou share a repo with other pups. Create and checkout a new branch: bark/${agentName}. Do all work on this branch. When done, commit and open a PR.`,
        );
      } else {
        ctxParts.push(
          `[Git Instructions]\nYou share a repo with other pups. Be mindful of file conflicts — coordinate through small, focused commits.`,
        );
      }
      prompt = ctxParts.join('\n\n') + `\n\n[Delegated Task]\n${prompt}`;
    }

    // Add attachment context to prompt
    const { promptPrefix: attachPrefix, infos: attachmentInfos } = hasAttachments
      ? processAttachments(attachments!)
      : { promptPrefix: '', infos: [] as Array<{ filename: string; filepath: string; type: string }> };
    if (attachPrefix) prompt = attachPrefix + prompt;

    // Save user turn and run command
    _deps!.historyManager.addUserTurn(
      id,
      prompt,
      attachmentInfos.length > 0 ? attachmentInfos : undefined,
    );
    runAgentCommandForUI(agent, prompt);

    res.json(agent);
  });
}
