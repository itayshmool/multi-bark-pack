/**
 * Chat command handler — processes all /commands from adapters.
 */

import type { Agent, Adapter, NormalizedMessage, BackendsProvider, SkillsManagerProvider, UsageTrackerProvider } from '../types/index.js';
import { getAgents, getDeletedAgents, getMsgAgent, saveState } from './state.js';
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
    await adapter.send(
      '*Commands:*\n' +
        '`/status` — show pack status\n' +
        '`/backends` — show available LLM backends\n' +
        '`/skills` — show available skills\n' +
        '`/skill name @pup` — add skill to pup\n' +
        '`/stop name` — stop a running pup\n' +
        '`/clear name` — shelve pup (can /reborn)\n' +
        '`/delete name` — permanently remove pup\n' +
        '`/reset name` — wipe pup memory\n' +
        '`/create` — reply to spawn pup with context\n' +
        '`/losts` — show shelved pups\n' +
        '`/reborn name` — resurrect shelved pup\n' +
        '`/daily` — standup from all pups\n' +
        '`/stats` — usage & cost summary\n' +
        '`/approve name` — approve pending operation\n' +
        '`/deny name` — deny pending operation\n' +
        '`/reload-policy` — hot-reload bark-policy.json\n' +
        '`/purge` — delete all shelved pups\n' +
        '`/restart` `/shutdown` — server control\n' +
        'Use `pack` instead of name for all pups\n\n' +
        '*Multi-LLM:*\n' +
        '`#claude-code` `#cursor` `#codex` `#gemini`\n' +
        '`#haiku` `#sonnet` `#opus` (models)\n' +
        'Example: `#cursor #opus fix this bug`\n\n' +
        '*Routing:*\n' +
        '`@name msg` — send to pup\n' +
        'Reply — send to that pup\n' +
        'New message — spawn new pup\n\n' +
        '*Delegation:*\n' +
        'Pups can spawn sub-agents via `bark delegate "task"`\n' +
        'Add `--branch` for isolated branch + PR\n\n' +
        '🖥 Dashboard: http://localhost:3333',
    );
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
        `Usage: \`/skill <name> [@pup]\`\n\nAvailable: ${available}`,
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
        `Usage: \`/skill ${skillName} @pup\` to add to a pup`,
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
    lines.push(`\nUse \`/reborn name\` to resurrect`);
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
        'Usage: `/reborn name` — resurrect a deleted pup.\nUse `/losts` to see available pups.',
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

  if (command === '/create') {
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
          'Usage: `/create @name` — name must be alphanumeric (a-z, 0-9, hyphens, underscores).',
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
        'Usage: reply to a message with `/create` to spawn a new pup with that context.\nOptionally add instructions: `/create review this code`\nOptionally name the pup: `/create @name`',
      );
      return true;
    }

    // Build prompt from quoted message + optional extra instructions
    let prompt = '';
    if (msg.isQuotedReply) {
      const quoted = await adapter.getQuotedMessage(msg.raw);
      const quotedBody = quoted ? quoted.body : '';
      if (extraText) {
        prompt = `[context]:\n${quotedBody}\n\n[instructions]:\n${extraText}`;
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
      await adapter.send(`🛑 *${agent.name}* stopped.`);
      return true;
    }
    if (names.length === 0) {
      await adapter.send('Usage: `/stop name` or `/stop pack` or reply to a message with `/stop`');
      return true;
    }
    const { stopped, notFound } = stopAgents(names);
    let response = '';
    if (stopped.length) response += `🛑 Stopped: *${stopped.join('*, *')}*`;
    else if (names[0].toLowerCase() === 'pack') response = 'No pups are running.';
    if (notFound.length) response += `${stopped.length ? '\n' : ''}❓ Not found: ${notFound.join(', ')}`;
    await adapter.send(response);
    return true;
  }

  if (command === '/clear') {
    const names = body.split(/\s+/).slice(1).map(n => n.replace(/^@/, ''));
    if (names.length === 0 && msg.isQuotedReply) {
      const agent = await resolveAgentFromReply(msg, adapter);
      if (agent === null) return true;
      const agentName = agent.name;
      clearAgents([agent.name]);
      await adapter.send(`🧹 *${agentName}* shelved.\nUse \`/reborn ${agentName}\` to bring back.`);
      return true;
    }
    if (names.length === 0) {
      await adapter.send('Usage: /clear name1 name2 ... or /clear pack or reply to a message with /clear');
      return true;
    }
    const { cleared, notFound } = clearAgents(names);
    let response = '';
    if (cleared.length) {
      const isPack = names.length === 1 && names[0].toLowerCase() === 'pack';
      response = isPack
        ? `🧹 Entire pack shelved: *${cleared.join('*, *')}*\nUse \`/losts\` to see them, \`/reborn name\` to bring back.`
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
        await adapter.send(`Pup *${arg}* not found.`);
        return true;
      }
      const a = usageData.agents[agent.id];
      if (!a) {
        await adapter.send(`No usage data for *${agent.name}* yet.`);
        return true;
      }
      const est = a.estimated ? ' ≈' : '';
      const prefix = a.estimated ? '~' : '';
      const lines = [
        `📊 *${agent.name}* Stats`,
        `Cost: ${prefix}$${a.totalCostUsd.toFixed(4)}${est}`,
        `Turns: ${a.turns}`,
        `Tokens: ${a.totalInputTokens.toLocaleString()} in / ${a.totalOutputTokens.toLocaleString()} out`,
        `Backend: ${a.backend}`,
        `First seen: ${new Date(a.firstSeen).toLocaleDateString()}`,
      ];
      await adapter.send(lines.join('\n'));
      return true;
    }

    // Global stats
    const t = usageData.totals;
    if (t.turns === 0) {
      await adapter.send('📊 No usage data yet.');
      return true;
    }

    const lines = [
      `📊 *Pack Stats*`,
      `Total: $${t.costUsd.toFixed(4)} (${t.turns} turns)`,
      `Tokens: ${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out`,
    ];

    // By backend
    const byBackend: Record<
      string,
      { cost: number; turns: number; estimated: boolean }
    > = {};
    for (const [, a] of Object.entries(usageData.agents)) {
      const b = a.backend || 'unknown';
      if (!byBackend[b])
        byBackend[b] = { cost: 0, turns: 0, estimated: false };
      byBackend[b].cost += a.totalCostUsd;
      byBackend[b].turns += a.turns;
      if (a.estimated) byBackend[b].estimated = true;
    }

    if (Object.keys(byBackend).length > 0) {
      lines.push('', '*By backend:*');
      for (const [name, b] of Object.entries(byBackend).sort(
        (a, b) => b[1].cost - a[1].cost,
      )) {
        const est = b.estimated ? ' ≈' : '';
        const prefix = b.estimated ? '~' : '';
        lines.push(
          `  ${name}: ${prefix}$${b.cost.toFixed(4)} (${b.turns} turns)${est}`,
        );
      }
    }

    // Top pups (sorted by cost, max 10)
    const sortedAgents = Object.entries(usageData.agents)
      .sort((a, b) => b[1].totalCostUsd - a[1].totalCostUsd)
      .slice(0, 10);

    if (sortedAgents.length > 0) {
      lines.push('', '*Top pups:*');
      for (const [, a] of sortedAgents) {
        const est = a.estimated ? ' ≈' : '';
        const prefix = a.estimated ? '~' : '';
        lines.push(
          `  ${a.name}: ${prefix}$${a.totalCostUsd.toFixed(4)} (${a.turns} turns)${est}`,
        );
      }
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
      await adapter.send(`Usage: \`${command} name\` or \`${command} pack\``);
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
