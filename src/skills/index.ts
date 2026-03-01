/**
 * Skills Manager
 * Cross-backend skill system - loads skills once at startup
 */

import { errorMessage } from '../utils/error.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSkillFile, estimateTokens } from './parser.js';
import { SKILLS_DIR as DEFAULT_SKILLS_DIR } from '../config/paths.js';
import type { Skill, SkillSummary } from '../types/index.js';

// In-memory skill registry
const skills = new Map<string, Skill>();

interface InitializeResult {
  loaded: number;
  skills: string[];
}

/**
 * Initialize skills registry - call once at server startup
 */
export function initialize(skillsDir: string = DEFAULT_SKILLS_DIR): InitializeResult {
  skills.clear();

  if (!existsSync(skillsDir)) {
    console.log('  ⚠️ Skills directory not found:', skillsDir);
    return { loaded: 0, skills: [] };
  }

  const dirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const loaded: string[] = [];

  for (const dir of dirs) {
    const skillFile = path.join(skillsDir, dir, 'SKILL.md');

    if (!existsSync(skillFile)) {
      continue;
    }

    try {
      const content = readFileSync(skillFile, 'utf8');
      const parsed = parseSkillFile(content);

      // Use directory name as skill ID, parsed name as display name
      const skillId = dir;
      const skill: Skill = {
        id: skillId,
        name: parsed.name || skillId,
        description: parsed.description || '',
        userInvocable: parsed.userInvocable,
        content: parsed.content,
        tokens: estimateTokens(parsed.content),
        path: skillFile,
      };

      skills.set(skillId, skill);
      loaded.push(skillId);
    } catch (err) {
      const message = errorMessage(err);
      console.log(`  ⚠️ Failed to load skill ${dir}:`, message);
    }
  }

  if (loaded.length > 0) {
    console.log(`  ⚡ Loaded ${loaded.length} skills: ${loaded.join(', ')}`);
  }

  return { loaded: loaded.length, skills: loaded };
}

/**
 * Get a skill by ID
 */
export function get(id: string): Skill | null {
  return skills.get(id) || null;
}

/**
 * List all available skills
 */
export function list(userInvocableOnly: boolean = false): SkillSummary[] {
  const result: SkillSummary[] = [];

  for (const skill of skills.values()) {
    if (userInvocableOnly && !skill.userInvocable) {
      continue;
    }

    result.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tokens: skill.tokens,
      userInvocable: skill.userInvocable,
    });
  }

  return result;
}

/**
 * Check if a skill exists
 */
export function has(id: string): boolean {
  return skills.has(id);
}

/**
 * Get skill content for injection into system prompt
 */
export function getContent(id: string): string | null {
  const skill = skills.get(id);
  return skill ? skill.content : null;
}

/**
 * Build combined skill content for multiple skills
 */
export function buildSkillPrompt(skillIds: string[]): string {
  if (!skillIds || skillIds.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const id of skillIds) {
    const content = getContent(id);
    if (content) {
      parts.push(content);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return '\n\n---\n\n' + parts.join('\n\n---\n\n');
}

/**
 * Get total token count for skills
 */
export function getTokenCount(skillIds: string[]): number {
  let total = 0;

  for (const id of skillIds) {
    const skill = skills.get(id);
    if (skill) {
      total += skill.tokens;
    }
  }

  return total;
}

/**
 * Format skills list for display
 */
export function formatList(): string {
  const skillList = list(true);

  if (skillList.length === 0) {
    return 'No skills available.';
  }

  const lines = ['*Available Skills:*', ''];

  for (const skill of skillList) {
    lines.push(`• \`/${skill.id}\` — ${skill.description} (~${skill.tokens} tokens)`);
  }

  lines.push('');
  lines.push('_Use `/skill <name>` to activate a skill for a pup._');

  return lines.join('\n');
}
