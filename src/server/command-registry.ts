/**
 * Central registry of all chat commands.
 * Single source of truth consumed by:
 *   - commands.ts   → /help output
 *   - telegram.ts   → setMyCommands (autocomplete menu)
 *   - agents.ts     → spawn hint
 *   - commands.test → exhaustive coverage assertions
 */

export type CommandGroup = 'nav' | 'lifecycle' | 'content' | 'approval' | 'server';

export interface CommandSpec {
  /** Full command string including slash, e.g. '/status' */
  cmd: string;
  /** Short description (≤256 chars) for Telegram autocomplete and /help */
  description: string;
  /** Optional extended usage shown in /help full, e.g. 'Name or pack' */
  usage?: string;
  /** Telegram command name — must be lowercase letters/digits/underscores only.
   *  Defaults to cmd.slice(1). Set explicitly when cmd contains hyphens. */
  tgCmd?: string;
  /** Logical group for /help full sectioning */
  group: CommandGroup;
}

export const COMMANDS: CommandSpec[] = [
  // ── Navigation & Status ──────────────────────────────────────────────────
  {
    cmd: '/help',
    tgCmd: 'help',
    description: 'Show all commands — /help full for details',
    group: 'nav',
  },
  {
    cmd: '/stats',
    tgCmd: 'stats',
    description: 'Agents list — status, backend, cost & routing hints',
    usage: '[@Name]',
    group: 'nav',
  },
  {
    cmd: '/status',
    tgCmd: 'status',
    description: 'Refresh pinned status message',
    group: 'nav',
  },
  {
    cmd: '/backends',
    tgCmd: 'backends',
    description: 'Show available LLM backends & capabilities',
    group: 'nav',
  },
  {
    cmd: '/daily',
    tgCmd: 'daily',
    description: 'Request one-line standup from every active pup',
    group: 'nav',
  },

  // ── Agent Lifecycle ──────────────────────────────────────────────────────
  {
    cmd: '/stop',
    tgCmd: 'stop',
    description: 'Stop a running pup (Ctrl+C — pup stays active)',
    usage: '@Name|pack',
    group: 'lifecycle',
  },
  {
    cmd: '/stopall',
    tgCmd: 'stopall',
    description: 'Stop ALL running pups — shortcut for /stop pack',
    group: 'lifecycle',
  },
  {
    cmd: '/clear',
    tgCmd: 'clear',
    description: 'Shelve a pup — pauses it, history kept, /reborn to restore',
    usage: '@Name|pack',
    group: 'lifecycle',
  },
  {
    cmd: '/reset',
    tgCmd: 'reset',
    description: 'Wipe pup memory — new session, same pup & backend',
    usage: '@Name|pack',
    group: 'lifecycle',
  },
  {
    cmd: '/delete',
    tgCmd: 'delete',
    description: 'Permanently delete a pup, free its name (no recovery)',
    usage: '@Name|pack',
    group: 'lifecycle',
  },
  {
    cmd: '/create',
    tgCmd: 'create',
    description: 'Spawn a new pup — reply to a message to give it context',
    usage: '@Name task',
    group: 'lifecycle',
  },
  {
    cmd: '/reborn',
    tgCmd: 'reborn',
    description: 'Resurrect a shelved pup, restores its session history',
    usage: '@Name',
    group: 'lifecycle',
  },
  {
    cmd: '/losts',
    tgCmd: 'losts',
    description: 'List shelved pups available for /reborn',
    group: 'lifecycle',
  },
  {
    cmd: '/purge',
    tgCmd: 'purge',
    description: 'Permanently delete ALL shelved pups, free all names',
    group: 'lifecycle',
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    cmd: '/skills',
    tgCmd: 'skills',
    description: 'List all available skills',
    group: 'content',
  },
  {
    cmd: '/skill',
    tgCmd: 'skill',
    description: 'Show a skill or add it to a pup',
    usage: 'SkillName [@Name]',
    group: 'content',
  },

  // ── Approval ─────────────────────────────────────────────────────────────
  {
    cmd: '/approve',
    tgCmd: 'approve',
    description: 'Approve a pup\'s pending operation',
    usage: '@Name|pack',
    group: 'approval',
  },
  {
    cmd: '/deny',
    tgCmd: 'deny',
    description: 'Deny a pup\'s pending operation',
    usage: '@Name|pack',
    group: 'approval',
  },

  // ── Server Control ───────────────────────────────────────────────────────
  {
    cmd: '/reload-policy',
    tgCmd: 'reload_policy',
    description: 'Hot-reload bark-policy.json without restarting',
    group: 'server',
  },
  {
    cmd: '/restart',
    tgCmd: 'restart',
    description: 'Restart the server (start.sh will auto-restart)',
    group: 'server',
  },
  {
    cmd: '/shutdown',
    tgCmd: 'shutdown',
    description: 'Shut down the server (start.sh will NOT restart)',
    group: 'server',
  },
];

/** All command strings as a Set for O(1) lookup */
export const COMMAND_SET: ReadonlySet<string> = new Set(COMMANDS.map(c => c.cmd));

/** Commands formatted for Telegram's setMyCommands API */
export function getTelegramCommands(): Array<{ command: string; description: string }> {
  return COMMANDS.map(c => ({
    command: c.tgCmd ?? c.cmd.slice(1),
    description: c.description,
  }));
}

/** Group label display names */
const GROUP_LABELS: Record<CommandGroup, string> = {
  nav: 'Navigation & Status',
  lifecycle: 'Agent Lifecycle',
  content: 'Content & Skills',
  approval: 'Approval Flow',
  server: 'Server Control',
};

/** Commands grouped by section for /help full */
export function getCommandsByGroup(): Array<{ label: string; commands: CommandSpec[] }> {
  const groups = new Map<CommandGroup, CommandSpec[]>();
  const order: CommandGroup[] = ['nav', 'lifecycle', 'content', 'approval', 'server'];
  for (const g of order) groups.set(g, []);
  for (const c of COMMANDS) groups.get(c.group)!.push(c);
  return order.map(g => ({ label: GROUP_LABELS[g], commands: groups.get(g)! }));
}

/** Compact /help view — all commands grouped, one line each, mobile-friendly */
export function buildQuickView(activePupName?: string | null): string {
  const sections = getCommandsByGroup();
  const lines: string[] = ['*🐾 All Commands*\n'];

  for (const { label, commands } of sections) {
    // One compact line per group: `cmd1` · `cmd2` · ...
    const cmdList = commands
      .map(c => (c.usage ? `\`${c.cmd} ${c.usage}\`` : `\`${c.cmd}\``))
      .join(' · ');
    lines.push(`*${label}*\n${cmdList}`);
  }

  lines.push('');
  lines.push('*Routing:*');
  lines.push('Just message → last active pup');
  lines.push('`@Name msg` → specific pup · Reply → that pup');
  lines.push('`pack` = all pups in bulk commands');
  lines.push('');
  lines.push('`/help full` — descriptions for every command');

  if (activePupName) {
    lines.push(`\n💡 Active: *${activePupName}* — just send a message`);
  } else {
    lines.push('\n💡 No active pup — send any message to spawn one');
  }

  return lines.join('\n');
}

/** Detailed /help full — all commands with descriptions, grouped by section */
export function buildFullHelp(): string {
  const sections = getCommandsByGroup();
  return sections
    .map(({ label, commands }) => {
      const lines = [`*${label}*`];
      for (const c of commands) {
        // Format: `/cmd <arg>` — description
        const argStr = c.usage ? ` \`${c.usage}\`` : '';
        lines.push(`\`${c.cmd}\`${argStr} — ${c.description}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
