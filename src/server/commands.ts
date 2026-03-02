/**
 * Chat command handler — processes all /commands from adapters.
 */

import type { Agent, Adapter, NormalizedMessage, BackendsProvider, SkillsManagerProvider, UsageTrackerProvider } from '../types/index.js';
import { getAgents, getDeletedAgents, getMsgAgent, saveState, getLastAgentForSource } from './state.js';
import { resolveApproval, loadPolicy, getPolicy } from './approval.js';
import {
  findAgentByName,
  hardDeleteAgent,
  spawnAgent,
  stopAgents,
  clearAgents,
  deleteAgents,
  rebornAgent,
  resetAgents,
} from './agents.js';
import { sanitizeName, getAgentIcon } from './naming.js';
import { timeSince } from './status.js';
import { updatePinnedStatus } from './status.js';
import { parseMessageTags } from '../utils/tags.js';
import { shellEscape } from '../utils/shell.js';
import { runDaily } from './daily.js';
import { buildFullHelp, buildQuickView } from './command-registry.js';
import { exec } from 'node:child_process';

// Lazily injected dependencies
let _backends: BackendsProvider | null = null;
let _skillsManager: SkillsManagerProvider | null = null;
let _usageTracker: UsageTrackerProvider | null = null;
let _destroyAllAdapters: (() => Promise<void>) | null = null;
let _getPackNames: (() => string[]) | null = null;

export function initCommands(deps: {
  backends: BackendsProvider;
  skillsManager: SkillsManagerProvider;
  usageTracker: UsageTrackerProvider;
  destroyAllAdapters: () => Promise<void>;
  getPackNames: () => string[];
}): void {
  _backends = deps.backends;
  _skillsManager = deps.skillsManager;
  _usageTracker = deps.usageTracker;
  _destroyAllAdapters = deps.destroyAllAdapters;
  _getPackNames = deps.getPackNames;
}

/**
 * Handle a chat command. Returns true if the command was recognized and handled.
 */
export async function handleCommand(
  body: string,
  msg: NormalizedMessage,
  adapter: Adapter,
  listeningMsgId: string | null,
): Promise<boolean> {
  if (!body.startsWith('/')) return false;

  const command = body.split(/\s+/)[0].toLowerCase();

  if (command === '/help') {
    const arg = body.split(/\s+/)[1]?.toLowerCase();
    if (arg === 'full') {
      await adapter.send(
        buildFullHelp() +
          '\n\n*Routing:*\n' +
          'Just send a message → goes to last active pup\n' +
          '`@Name msg` → send to a specific pup\n' +
          'Reply to a pup\'s message → continues that pup\n\n' +
          '*Multi-LLM:*\n' +
          '`#claude-code` `#cursor` `#codex` `#gemini`\n' +
          '`#haiku` `#sonnet` `#opus` (models)\n' +
          'Example: `#cursor #opus fix this bug`\n\n' +
          'Use `pack` instead of Name for bulk ops\n\n' +
          '🖥 Dashboard: http://localhost:3333',
      );
    } else {
      const lastAgent = getLastAgentForSource(adapter.name);
      await adapter.send(buildQuickView(lastAgent?.name ?? null));
    }
    return true;
  }

  if (command === '/status') {
    await updatePinnedStatus();
    return true;
  }

  if (command === '/backends') {
    await adapter.send(_backends!.formatCapabilityMatrix());
    return true;
  }

  if (command === '/skills') {
    await adapter.send(_skillsManager!.formatList());
    return true;
  }

  if (command === '/skill') {
    const args = body.split(/\s+/).slice(1);
    const skillName = args[0]?.replace(/^\//, ''); // Handle /skill /developer or /skill developer
    const pupName = args[1]?.replace(/^@/, '');

    if (!skillName) {
      // Show available skills inline
      const available = _skillsManager!
        .list(true)
        .map(s => `\`${s.id}\``)
        .join(', ');
      await adapter.send(
        `Usage: \`/skill SkillName [@Name]\`\n\nAvailable: ${available}`,
      );
      return true;
    }

    if (!_skillsManager!.has(skillName)) {
      const available = _skillsManager!
        .list(true)
        .map(s => `\`${s.id}\``)
        .join(', ');
      await adapter.send(
        `Unknown skill: \`${skillName}\`\n\nAvailable: ${available}`,
      );
      return true;
    }

    // If pup name specified, add skill to that pup
    if (pupName) {
      const agent = findAgentByName(pupName);
      if (!agent) {
        await adapter.send(`Pup *${pupName}* not found.`);
        return true;
      }
      agent.skills = agent.skills || [];
      if (agent.skills.includes(skillName)) {
        await adapter.send(
          `*${agent.name}* already has the \`${skillName}\` skill.`,
        );
        return true;
      }
      agent.skills.push(skillName);
      saveState();
      const skill = _skillsManager!.get(skillName)!;
      await adapter.send(
        `⚡ Added \`${skillName}\` to *${agent.name}*\n${skill.description}\n\nSkill will apply on next message (new session).`,
      );
      return true;
    }

    // No pup specified - show skill info
    const skill = _skillsManager!.get(skillName)!;
    await adapter.send(
      `*${skill.name}*\n` +
        `${skill.description}\n\n` +
        `Tokens: ~${skill.tokens}\n\n` +
        `Usage: \`/skill ${skillName} @Name\` to add to a pup`,
    );
    return true;
  }

  if (command === '/losts') {
    const deletedAgents = getDeletedAgents();
    if (deletedAgents.size === 0) {
      await adapter.send('No lost pups. All accounted for!');
      return true;
    }
    const lines = [`💀 *Lost Pups* (${deletedAgents.size} shelved)\n`];
    const sorted = [...deletedAgents.values()].sort(
      (a, b) =>
        new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime(),
    );
    for (const agent of sorted) {
      const age = timeSince(new Date(agent.createdAt));
      const died = agent.deletedAt
        ? timeSince(new Date(agent.deletedAt))
        : 'unknown';
      lines.push(`💀 *${agent.name}* — born ${age}, shelved ${died}`);
    }
    lines.push(`\nUse \`/reborn @Name\` to resurrect`);
    const msgText = lines.join('\n');
    await adapter.send(
      msgText.length > 4000 ? msgText.substring(0, 3950) + '...' : msgText,
    );
    return true;
  }

  if (command === '/purge') {
    const deletedAgents = getDeletedAgents();
    if (deletedAgents.size === 0) {
      await adapter.send('No lost pups to purge.');
      return true;
    }
    const count = deletedAgents.size;
    for (const agent of [...deletedAgents.values()]) {
      hardDeleteAgent(agent, deletedAgents);
    }
    await adapter.send(`🗑️ Purged ${count} lost pups. All names freed.`);
    await updatePinnedStatus();
    return true;
  }

  if (command === '/reborn') {
    const name = body
      .split(/\s+/)
      .slice(1)
      .join(' ')
      .replace(/^@/, '')
      .trim();
    if (!name) {
      await adapter.send(
        'Usage: `/reborn @Name` — resurrect a shelved pup.\nUse `/losts` to see available pups.',
      );
      return true;
    }

    const result = rebornAgent(name);
    if (!result.success) {
      await adapter.send(result.error!);
      return true;
    }
    const rebornIcon = getAgentIcon(result.agent!);
    await adapter.send(
      `${rebornIcon} *${result.agent!.name}* is back! Session restored — send a message to pick up where you left off.`,
    );
    return true;
  }

  if (command === '/spawn' || command === '/create') {
    const parts = body.split(/\s+/).slice(1);
    const firstWord = parts[0] || '';
    const isNameArg = firstWord.startsWith('@');

    let forceName: string | null = null;
    let extraText = '';

    if (isNameArg) {
      const rawName = sanitizeName(firstWord.replace(/^@/, '').trim());
      extraText = parts.slice(1).join(' ').trim();
      if (!rawName) {
        await adapter.send(
          'Usage: `/create @Name` — name must be alphanumeric (a-z, 0-9, hyphens, underscores).',
        );
        return true;
      }
      // Normalize casing: use canonical pack names casing if it matches, else use input as-is
      const PUP_NAMES = _getPackNames!();
      forceName =
        PUP_NAMES.find(n => n.toLowerCase() === rawName.toLowerCase()) || rawName;
      // Check collision case-insensitively (active + deleted)
      const agents = getAgents();
      const deletedAgents = getDeletedAgents();
      const allAgents = [...agents.values(), ...deletedAgents.values()];
      const collision = allAgents.find(
        a => a.name.toLowerCase() === forceName!.toLowerCase(),
      );
      if (collision) {
        await adapter.send(
          `A pup named *${collision.name}* already exists. Use a different name.`,
        );
        return true;
      }
    } else {
      extraText = parts.join(' ').trim();
    }

    if (!msg.isQuotedReply && !extraText && !forceName) {
      await adapter.send(
        'Usage: reply to a message with `/create` to spawn a new pup with that context.\nOptionally add instructions: `/create review this code`\nOptionally name the pup: `/create @Name`',
      );
      return true;
    }

    // Build prompt from quoted message + optional extra instructions
    let prompt = '';
    if (msg.isQuotedReply) {
      const quoted = await adapter.getQuotedMessage(msg.raw);
      const quotedBody = quoted ? quoted.body : '';
      if (extraText) {
        prompt = `The user is referencing this message:\n\n${quotedBody}\n\nTheir request: ${extraText}`;
      } else {
        prompt = quotedBody;
      }
    } else {
      prompt = extraText;
    }

    // Parse #model and #backend tags from prompt
    const tags = parseMessageTags(prompt);
    prompt = tags.cleanBody;
    const model: string | null = tags.model || null;
    const backendName: string | null = tags.backend || null;

    await spawnAgent(
      prompt,
      adapter,
      null,
      listeningMsgId,
      msg.id,
      model,
      forceName,
      backendName,
    );
    return true;
  }

  if (command === '/stop') {
    const names = body.split(/\s+/).slice(1).map(n => n.replace(/^@/, ''));
    if (names.length === 0 && msg.isQuotedReply) {
      const agent = await resolveAgentFromReply(msg, adapter);
      if (agent === null) return true;
      stopAgents([agent.name]);
      await adapter.send(`🛑 *${agent.name}* stopped.\n💡 Use \`/stats\` to see all agents`);
      return true;
    }
    if (names.length === 0) {
      await adapter.send('Usage: `/stop @Name` · `/stop pack` · or reply to a message with `/stop`\n💡 Use `/stats` to see all agent names');
      return true;
    }
    const { stopped, notFound } = stopAgents(names);
    let response = '';
    if (stopped.length) response += `🛑 Stopped: *${stopped.join('*, *')}*`;
    else if (names[0].toLowerCase() === 'pack') response = 'No pups are running.';
    if (notFound.length) response += `${stopped.length ? '\n' : ''}❓ Not found: ${notFound.join(', ')}\n💡 \`/stats\` to see active agents`;
    await adapter.send(response);
    return true;
  }

  if (command === '/stopall') {
    const { stopped } = stopAgents(['pack']);
    if (stopped.length === 0) {
      await adapter.send('No pups are running.');
    } else {
      await adapter.send(`🛑 Stopped all: *${stopped.join('*, *')}*\n💡 Send any message to spawn a new pup`);
    }
    return true;
  }

  if (command === '/clear') {
    const names = body.split(/\s+/).slice(1).map(n => n.replace(/^@/, ''));
    if (names.length === 0 && msg.isQuotedReply) {
      const agent = await resolveAgentFromReply(msg, adapter);
      if (agent === null) return true;
      const agentName = agent.name;
      clearAgents([agent.name]);
      await adapter.send(`🧹 *${agentName}* shelved.\nUse \`/reborn @${agentName}\` to bring back.`);
      return true;
    }
    if (names.length === 0) {
      await adapter.send('Usage: `/clear @Name` · `/clear pack` · or reply to a message with `/clear`');
      return true;
    }
    const { cleared, notFound } = clearAgents(names);
    let response = '';
    if (cleared.length) {
      const isPack = names.length === 1 && names[0].toLowerCase() === 'pack';
      response = isPack
        ? `🧹 Entire pack shelved: *${cleared.join('*, *')}*\nUse \`/losts\` to see them, \`/reborn @Name\` to bring back.`
        : `🧹 Shelved: *${cleared.join('*, *')}*`;
    }
    if (notFound.length) response += `${cleared.length ? '\n' : ''}❓ Not found: ${notFound.join(', ')}`;
    await adapter.send(response);
    return true;
  }

  if (command === '/delete') {
    const names = body.split(/\s+/).slice(1).map(n => n.replace(/^@/, ''));
    if (names.length === 0 && msg.isQuotedReply) {
      const agent = await resolveAgentFromReply(msg, adapter, true);
      if (agent === null) return true;
      const agentName = agent.name;
      deleteAgents([agent.name]);
      await adapter.send(`❌ *${agentName}* permanently deleted. Name freed.`);
      return true;
    }
    if (names.length === 0) {
      await adapter.send('Usage: /delete name1 name2 ... or /delete pack or reply to a message with /delete');
      return true;
    }
    const { deleted, deletedFromLosts, notFound } = deleteAgents(names);
    const allDeleted = [...deleted, ...deletedFromLosts];
    let response = '';
    if (allDeleted.length) {
      const isPack = names.length === 1 && names[0].toLowerCase() === 'pack';
      if (isPack) {
        const parts: string[] = [];
        if (deleted.length) parts.push(`${deleted.length} active`);
        if (deletedFromLosts.length) parts.push(`${deletedFromLosts.length} shelved`);
        response = `❌ Entire pack permanently deleted (${parts.join(' + ')}). All names freed.`;
      } else {
        response = `❌ Permanently deleted: *${allDeleted.join('*, *')}*`;
      }
    }
    if (notFound.length) response += `${allDeleted.length ? '\n' : ''}❓ Not found: ${notFound.join(', ')}`;
    await adapter.send(response);
    return true;
  }

  if (command === '/reset') {
    const names = body.split(/\s+/).slice(1).map(n => n.replace(/^@/, ''));
    if (names.length === 0 && msg.isQuotedReply) {
      const agent = await resolveAgentFromReply(msg, adapter);
      if (agent === null) return true;
      resetAgents([agent.name]);
      await adapter.send(`🔄 *${agent.name}* memory wiped. Next message starts fresh.`);
      return true;
    }
    if (names.length === 0) {
      await adapter.send('Usage: /reset name1 name2 ... or /reset pack or reply to a message with /reset');
      return true;
    }
    const { reset, notFound } = resetAgents(names);
    let response = '';
    if (reset.length) {
      const isPack = names.length === 1 && names[0].toLowerCase() === 'pack';
      response = isPack
        ? `🔄 Entire pack reset: *${reset.join('*, *')}*\nAll pups start fresh on next message.`
        : `🔄 Reset: *${reset.join('*, *')}*`;
    }
    if (notFound.length) response += `${reset.length ? '\n' : ''}❓ Not found: ${notFound.join(', ')}`;
    await adapter.send(response);
    return true;
  }

  if (command === '/daily') {
    await runDaily(adapter);
    return true;
  }

  if (command === '/stats') {
    const usageData = _usageTracker!.getAll();
    const arg = body
      .split(/\s+/)
      .slice(1)
      .join(' ')
      .replace(/^@/, '')
      .trim();

    // Per-pup stats
    if (arg) {
      const agent = findAgentByName(arg);
      if (!agent) {
        await adapter.send(`Pup *${arg}* not found.\n💡 \`/stats\` (no args) for the full list`);
        return true;
      }
      const a = usageData.agents[agent.id];
      const runStatus = agent.status === 'active' ? (agent.hasRun ? '🟢 active' : '⚪ idle') : '🔴 stopped';
      const lines = [
        `📊 *${agent.name}* · ${runStatus}`,
        `Backend: ${agent.backend}${agent.model ? ` · ${agent.model}` : ''}`,
        `CWD: ${agent.cwd ? agent.cwd.split('/').pop() : 'none'}`,
      ];
      if (a) {
        const est = a.estimated ? ' ≈' : '';
        const prefix = a.estimated ? '~' : '';
        lines.push(
          '',
          `Cost: ${prefix}$${a.totalCostUsd.toFixed(4)}${est}`,
          `Turns: ${a.turns}`,
          `Tokens: ${a.totalInputTokens.toLocaleString()} in / ${a.totalOutputTokens.toLocaleString()} out`,
        );
      }
      lines.push('', `💡 Switch: \`@${agent.name} your message\``);
      lines.push(`💡 Stop: \`/stop ${agent.name}\``);
      await adapter.send(lines.join('\n'));
      return true;
    }

    // Agent list (primary view)
    const activeAgents = [...getAgents().values()].filter(a => !a.parentId);
    const lines: string[] = ['*Pack Status*\n'];

    if (activeAgents.length === 0) {
      lines.push('No active pups.');
      lines.push('\n💡 Send any message to spawn one');
    } else {
      for (const agent of activeAgents) {
        const a = usageData.agents[agent.id];
        const runStatus = agent.status === 'active' ? (agent.hasRun ? '🟢' : '⚪') : '🔴';
        const costStr = a && a.totalCostUsd > 0 ? ` · $${a.totalCostUsd.toFixed(3)}` : '';
        const turnsStr = a && a.turns > 0 ? ` · ${a.turns} turns` : '';
        lines.push(`${runStatus} *${agent.name}* · ${agent.backend}${costStr}${turnsStr}`);
      }

      lines.push('');
      lines.push('*How to route:*');
      lines.push('Just send a message → goes to last active pup');
      lines.push('`@Name message` → send to a specific pup');
      lines.push('`/stop Name` · `/stopall` → stop pup(s)');
            lines.push('`/stats @Name` → detailed stats for one pup');
    }

    // Global cost summary (if any)
    const t = usageData.totals;
    if (t.turns > 0) {
      lines.push('');
      lines.push(`*Total:* $${t.costUsd.toFixed(4)} · ${t.turns} turns`);
    }

    await adapter.send(lines.join('\n'));
    return true;
  }

  if (command === '/approve' || command === '/deny') {
    const isApprove = command === '/approve';
    const names = body.split(/\s+/).slice(1).map(n => n.replace(/^@/, ''));

    if (names.length === 0 && msg.isQuotedReply) {
      const agent = await resolveAgentFromReply(msg, adapter);
      if (agent === null) return true;
      if (!agent.approvalPending) {
        await adapter.send(`*${agent.name}* has no pending approval.`);
        return true;
      }
      await resolveApproval(agent, isApprove, adapter);
      await adapter.send(`${isApprove ? '✅' : '🚫'} ${agent.name} · ${isApprove ? 'approved' : 'denied'}`);
      return true;
    }

    if (names.length === 0) {
      await adapter.send(`Usage: \`${command} @Name\` or \`${command} pack\``);
      return true;
    }

    const isPack = names.length === 1 && names[0].toLowerCase() === 'pack';
    const targets = isPack ? [...getAgents().values()] : names.map(n => findAgentByName(n)).filter(Boolean) as Agent[];
    const resolved: string[] = [];
    const noPending: string[] = [];
    const notFound: string[] = [];

    if (!isPack) {
      for (const n of names) {
        if (!findAgentByName(n)) notFound.push(n);
      }
    }

    for (const agent of targets) {
      if (!agent.approvalPending) {
        noPending.push(agent.name);
        continue;
      }
      await resolveApproval(agent, isApprove, adapter);
      resolved.push(agent.name);
    }

    const parts: string[] = [];
    if (resolved.length) parts.push(`${isApprove ? '✅' : '🚫'} ${isApprove ? 'Approved' : 'Denied'}: *${resolved.join('*, *')}*`);
    if (noPending.length && !isPack) parts.push(`No pending: ${noPending.join(', ')}`);
    if (notFound.length) parts.push(`❓ Not found: ${notFound.join(', ')}`);
    if (parts.length === 0) parts.push(isPack ? 'No pups have pending approvals.' : 'Nothing to do.');
    await adapter.send(parts.join('\n'));
    return true;
  }

  if (command === '/reload-policy') {
    loadPolicy();
    const policy = getPolicy();
    await adapter.send(`🛡️ Policy reloaded: ${policy.rules.length} rules, default: ${policy.defaultAction}`);
    return true;
  }

  if (command === '/shutdown') {
    await adapter.send('🌙 Pack going offline. Goodnight.');
    console.log(`  🌙 Shutdown requested via ${adapter.name}`);
    await killAllTmuxSessions();
    await _destroyAllAdapters!();
    process.exit(2); // non-zero = scripts/start.sh does NOT restart
  }

  if (command === '/restart') {
    const restartMessages = [
      '🐾 Quick shake...',
      '💤 Pup nap, brb',
      '🔄 Rebooting pups...',
      '🦴 Chewed a cable',
    ];
    await adapter.send(
      restartMessages[Math.floor(Math.random() * restartMessages.length)],
    );
    console.log(`  🔄 Restart requested via ${adapter.name}`);
    await killAllTmuxSessions();
    await _destroyAllAdapters!();
    process.exit(0);
  }

  // Unknown command — fall through to routing
  return false;
}

async function resolveAgentFromReply(
  msg: NormalizedMessage,
  adapter: Adapter,
  includeDeleted = false,
): Promise<Agent | null> {
  const quoted = await adapter.getQuotedMessage(msg.raw);
  if (!quoted) {
    await adapter.send('Could not find quoted message.');
    return null;
  }
  const agentId = getMsgAgent(quoted.id);
  const agent = agentId
    ? getAgents().get(agentId) || (includeDeleted ? getDeletedAgents().get(agentId) : undefined)
    : undefined;
  if (!agent) {
    await adapter.send('No agent found for that message.');
    return null;
  }
  return agent;
}

function killAllTmuxSessions(): Promise<void[]> {
  const agents = getAgents();
  return Promise.all(
    [...agents.values()]
      .filter(a => a.tmuxSession)
      .map(a => new Promise<void>(resolve => {
        exec(`tmux kill-session -t ${shellEscape(a.tmuxSession)} 2>/dev/null`, () => resolve());
      })),
  );
}
