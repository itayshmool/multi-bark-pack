/**
 * SKILL.md Parser
 * Parses skill files with YAML frontmatter + markdown content
 */

interface ParsedSkillFile {
  name: string | null;
  description: string | null;
  userInvocable: boolean;
  content: string;
}

/**
 * Parse a SKILL.md file content
 */
export function parseSkillFile(content: string): ParsedSkillFile {
  const lines = content.split('\n');

  // Check for YAML frontmatter
  if (lines[0].trim() !== '---') {
    // No frontmatter, treat entire content as markdown
    return {
      name: null,
      description: null,
      userInvocable: false,
      content: content.trim(),
    };
  }

  // Find end of frontmatter
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    // Malformed frontmatter
    return {
      name: null,
      description: null,
      userInvocable: false,
      content: content.trim(),
    };
  }

  // Parse frontmatter
  const frontmatter = lines.slice(1, endIndex).join('\n');
  const metadata = parseFrontmatter(frontmatter);

  // Extract markdown content (after frontmatter)
  const markdown = lines.slice(endIndex + 1).join('\n').trim();

  return {
    name: (metadata.name as string) || null,
    description: (metadata.description as string) || null,
    userInvocable: metadata['user-invocable'] === true || metadata['user-invocable'] === 'true',
    content: markdown,
  };
}

/**
 * Parse YAML-like frontmatter (simple key: value pairs)
 */
function parseFrontmatter(frontmatter: string): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const lines = frontmatter.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    // Handle boolean values
    let value: string | boolean;
    if (rawValue === 'true') value = true;
    else if (rawValue === 'false') value = false;
    else value = rawValue;

    result[key] = value;
  }

  return result;
}

// estimateTokens moved to utils/tokens.ts
export { estimateTokens } from '../utils/tokens.js';
