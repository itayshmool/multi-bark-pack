/**
 * Command help text builders for /help command.
 */

const COMMANDS: [string, string][] = [
  ['/status', 'Refresh pinned status message'],
  ['/backends', 'Show available LLM backends'],
  ['/skills', 'Show available skills'],
  ['/skill name @pup', 'Add a skill to a pup'],
  ['/stop name', 'Stop a running pup'],
  ['/clear name', 'Shelve pup (can /reborn)'],
  ['/delete name', 'Permanently remove pup'],
  ['/reset name', 'Wipe pup memory (new session)'],
  ['/losts', 'List shelved pups'],
  ['/reborn name', 'Resurrect a shelved pup'],
  ['/purge', 'Permanently delete all shelved pups'],
  ['/create', 'Reply to spawn a pup with context'],
  ['/daily', 'Request standup from all pups'],
  ['/stats', 'Usage & cost summary'],
  ['/approve name', 'Approve pending operation'],
  ['/deny name', 'Deny pending operation'],
  ['/reload-policy', 'Hot-reload bark-policy.json'],
  ['/help', 'Show this list (/help full for more)'],
  ['/restart', 'Restart the server'],
  ['/shutdown', 'Shut down the server'],
];

export function buildFullHelp(): string {
  const lines = COMMANDS.map(([cmd, desc]) => `\`${cmd}\` — ${desc}`);
  return '*Commands:*\n' + lines.join('\n');
}

export function buildQuickView(lastPupName: string | null): string {
  const target = lastPupName ? `\`@${lastPupName}\`` : 'a pup';
  const core = [
    '/stop', '/clear', '/delete', '/reset',
    '/losts', '/reborn', '/status', '/stats',
    '/help full',
  ];
  return (
    `📋 *Quick commands:* ${core.map(c => `\`${c}\``).join(' · ')}\n` +
    `💬 Reply or \`@Name msg\` to talk to ${target}\n` +
    `Use \`pack\` for bulk ops · \`#backend\` \`#model\` to switch`
  );
}
