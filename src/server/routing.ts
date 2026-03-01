/**
 * Message router — main onMessage handler for all adapters.
 * Handles owner filtering, voice transcription, media downloads,
 * command dispatch, security screening, tag parsing, and routing.
 */

import type { NormalizedMessage, Adapter, SecurityGuardProvider, TimelineProvider } from '../types/index.js';
import { OWNER_IDS } from './config.js';
import { getAgents, getDeletedAgents, getMsgAgent, setMsgAgent, hasAgent, hasDeletedAgent } from './state.js';
import { transcribeAudio } from './voice.js';
import { handleCommand } from './commands.js';
import { findAgentByName, spawnAgent, sendToAgent } from './agents.js';
import { parseMessageTags } from '../utils/tags.js';
import { parseApprovalReply, resolveApproval } from './approval.js';

// Lazily injected dependencies
let _securityGuard: SecurityGuardProvider | null = null;
let _timeline: TimelineProvider | null = null;

export function initRouting(deps: {
  securityGuard: SecurityGuardProvider;
  timeline: TimelineProvider;
}): void {
  _securityGuard = deps.securityGuard;
  _timeline = deps.timeline;
}

const DEBUG = !!process.env.DEBUG;

export async function onMessage(msg: NormalizedMessage): Promise<void> {
  if (DEBUG) console.log(
    `\n[DEBUG] Message received: sender="${msg.sender}" text="${msg.text ? `[${msg.text.length} chars]` : '(empty)'}"`,
  );
  const adapter = msg.adapter;

  // --- Owner filter: ignore messages from non-owners ---
  // Set per-platform owner ID in .env (comma-separated for multiple), or DANGER-ALL to allow everyone
  const owners = OWNER_IDS[adapter.name as keyof typeof OWNER_IDS];
  if (!owners) {
    if (!(adapter as unknown as Record<string, boolean>)._ownerWarned) {
      console.log(
        `  ⚠️ ${adapter.name}: No owner configured — ignoring all messages. Set ${
          adapter.name === 'whatsapp'
            ? 'WA_OWNER'
            : adapter.name === 'telegram'
              ? 'TG_OWNER'
              : 'SLACK_OWNER'
        } in .env`,
      );
      (adapter as unknown as Record<string, boolean>)._ownerWarned = true;
    }
    return;
  }
  if (owners !== 'DANGER-ALL' && !owners.has(msg.senderId)) {
    console.log(
      `  ⚠️ Owner mismatch: senderId="${msg.senderId}" not in owners=[${[...owners].join(', ')}]`,
    );
    return;
  }

  let body = msg.text;

  // --- Handle media messages ---
  let mediaContext = '';
  let listeningMsgId: string | null = null; // reusable message ID for voice UX
  if (msg.hasMedia && msg.mediaType === 'image') {
    const downloaded = await adapter.downloadMedia(msg.raw);
    if (downloaded) {
      const ext = downloaded.filePath.split('.').pop() || 'unknown';
      mediaContext =
        `[Image attached]\n` +
        `- File: ${downloaded.filePath}\n` +
        `- Format: ${downloaded.mimetype} (.${ext})\n` +
        `IMPORTANT: You MUST read/view the image file above before responding. ` +
        `Use your file reading tool on the path to see the image contents.\n\n`;
      console.log(`  📷 Saved image: ${downloaded.filePath} (${downloaded.mimetype})`);
    }
  } else if (msg.hasMedia && msg.mediaType === 'voice') {
    const downloaded = await adapter.downloadMedia(msg.raw);
    if (downloaded) {
      console.log(`  🎤 Saved voice: ${downloaded.filePath}`);

      // Send "listening..." as reply — will be edited to "thinking..." after transcription
      listeningMsgId = await adapter.send('🎤 listening...', msg.id);

      const transcript = await transcribeAudio(downloaded.filePath);
      if (transcript) {
        body = body
          ? `${body}\n\n[Voice message transcription]: ${transcript}`
          : transcript;
        mediaContext = `[Voice message transcribed from: ${downloaded.filePath}]\n\n`;
        console.log(`  🎤 Transcribed: ${transcript.substring(0, 100)}`);
      } else {
        mediaContext = `[Voice message received but could not be transcribed: ${downloaded.filePath}]\n\n`;
      }
    }
  }

  // --- Approval intercept: check if this is a reply to an approval request ---
  // Runs after voice transcription so voice "approve"/"deny" replies work.
  if (msg.isQuotedReply && body) {
    const verdict = parseApprovalReply(body);
    if (verdict) {
      const quoted = await adapter.getQuotedMessage(msg.raw);
      if (quoted) {
        const agentId = getMsgAgent(quoted.id);
        if (agentId && hasAgent(agentId)) {
          const agent = getAgents().get(agentId)!;
          if (agent.approvalPending && agent.approvalPending.messageId === quoted.id) {
            console.log(`  🛡️ Approval ${verdict} for ${agent.name}`);
            if (listeningMsgId) await adapter.deleteMsg(listeningMsgId);
            await resolveApproval(agent, verdict === 'approve', adapter);
            return;
          }
        }
      }
    }
  }

  if (!body && !mediaContext) return;

  console.log(
    `\n[${new Date().toLocaleTimeString()}] ${msg.sender}: ${body || '(media)'}`,
  );

  // --- Commands (intercepted before routing) ---
  if (body && body.startsWith('/')) {
    // Clean up orphan listening message if voice was a command
    if (listeningMsgId) {
      await adapter.deleteMsg(listeningMsgId);
    }
    const handled = await handleCommand(body, msg, adapter, listeningMsgId);
    if (handled) return;
  }

  // Parse #model and #backend tags and strip from body
  let requestedModel: string | null = null;
  let requestedBackend: string | null = null;
  if (body) {
    const tags = parseMessageTags(body);
    body = tags.cleanBody;
    requestedModel = tags.model || null;
    requestedBackend = tags.backend || null;
  }

  // Prepend media context to body for all routes
  const fullBody = mediaContext + (body || 'Respond to the attached media.');

  // --- Security Guard: screen message before routing ---
  if (_securityGuard!.isEnabled()) {
    const verdict = await _securityGuard!.screen(body || '');
    if (!verdict.allowed) {
      console.log(
        `  🛡️ BLOCKED [${verdict.category}]: "${(body || '').substring(0, 80)}" (${verdict.latencyMs}ms)`,
      );
      _timeline!.emit('security_block', {
        meta: { category: verdict.category, reason: verdict.reason },
      });
      await adapter.send(`🛡️ Message blocked: ${verdict.reason}`);
      return;
    }
    if (verdict.latencyMs > 0) {
      console.log(`  🛡️ Security check passed (${verdict.latencyMs}ms)`);
    }
  }

  // --- Route 1: @mention at start of message (first match routes, typos error out) ---
  if (body) {
    const atMatch = body.match(/^@(\S+)/);
    if (atMatch) {
      const agent = findAgentByName(atMatch[1].replace(/[,.:;!?]+$/, ''));
      if (!agent) {
        await adapter.send(`❓ Unknown pup: ${atMatch[1]}`);
        return;
      }
      const text = body.replace(/@\S+/g, '').trim();
      // If replying to a message, include the quoted message as context
      let prompt =
        mediaContext + (text || body || 'Respond to the attached media.');
      if (msg.isQuotedReply) {
        const quoted = await adapter.getQuotedMessage(msg.raw);
        const quotedBody = quoted ? quoted.body : '';
        prompt = `${mediaContext}[quoted message]:\n${quotedBody}\n\n[reply]:\n${text || body}`;
        console.log(
          `  ↳ Routed to ${agent.name} (via @mention + reply context)`,
        );
      } else {
        console.log(`  ↳ Routed to ${agent.name} (via @mention)`);
      }
      sendToAgent(
        agent,
        prompt,
        adapter,
        listeningMsgId,
        msg.id,
        requestedModel,
      );
      return;
    }
  }

  // --- Route 2: Reply to an agent's message ---
  if (msg.isQuotedReply) {
    const quoted = await adapter.getQuotedMessage(msg.raw);
    if (quoted) {
      const agentId = getMsgAgent(quoted.id);

      if (agentId) {
        // Check active agents first
        if (hasAgent(agentId)) {
          const agents = getAgents();
          const agent = agents.get(agentId)!;
          if (agent.status === 'active') {
            console.log(`  ↳ Routed to ${agent.name} (via reply)`);
            sendToAgent(
              agent,
              fullBody,
              adapter,
              listeningMsgId,
              msg.id,
              requestedModel,
            );
            return;
          }
        }
        // Check deleted agents — hint about /reborn
        if (hasDeletedAgent(agentId)) {
          const dead = getDeletedAgents().get(agentId)!;
          await adapter.send(
            `💀 *${dead.name}* was shelved. Use \`/reborn ${dead.name}\` to bring them back.`,
          );
          return;
        }
      }
    }
    console.log(`  ↳ Reply to unknown agent, spawning new`);
  }

  // --- Route 3: New message -> spawn new agent ---
  spawnAgent(
    fullBody,
    adapter,
    null,
    listeningMsgId,
    msg.id,
    requestedModel,
    null,
    requestedBackend,
  );
}
