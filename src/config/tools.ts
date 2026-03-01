export const TOOL_ICONS: Record<string, string> = {
  Bash: '💻',
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Grep: '🔍',
  Glob: '📂',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Skill: '⚡',
  Task: '🔀',
};

export function getToolIcon(name: string, extraIcons?: Record<string, string>): string {
  const allIcons = extraIcons ? { ...TOOL_ICONS, ...extraIcons } : TOOL_ICONS;
  if (allIcons[name]) return allIcons[name];
  for (const [key, icon] of Object.entries(allIcons)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  if (name.startsWith('mcp__')) return '🔌';
  return '🔧';
}
