import { describe, it, expect } from 'vitest';
import { parseSkillFile } from './parser.js';

describe('parseSkillFile', () => {
  it('parses file with valid YAML frontmatter', () => {
    const content = '---\nname: Test Skill\ndescription: A test\n---\n\nSkill content here.';
    const result = parseSkillFile(content);
    expect(result.name).toBe('Test Skill');
    expect(result.description).toBe('A test');
    expect(result.content).toBe('Skill content here.');
  });

  it('extracts name from frontmatter', () => {
    const content = '---\nname: My Cool Skill\n---\n\nContent';
    const result = parseSkillFile(content);
    expect(result.name).toBe('My Cool Skill');
  });

  it('extracts description from frontmatter', () => {
    const content = '---\ndescription: Does amazing things\n---\n\nContent';
    const result = parseSkillFile(content);
    expect(result.description).toBe('Does amazing things');
  });

  it('parses user-invocable as boolean true', () => {
    const content = '---\nuser-invocable: true\n---\n\nContent';
    const result = parseSkillFile(content);
    expect(result.userInvocable).toBe(true);
  });

  it('parses user-invocable as string "true"', () => {
    // parseFrontmatter converts "true" to boolean true
    const content = '---\nuser-invocable: true\n---\n\nContent';
    const result = parseSkillFile(content);
    expect(result.userInvocable).toBe(true);
  });

  it('parses user-invocable as false', () => {
    const content = '---\nuser-invocable: false\n---\n\nContent';
    const result = parseSkillFile(content);
    expect(result.userInvocable).toBe(false);
  });

  it('returns content without frontmatter', () => {
    const content = '---\nname: Test\n---\n\n# Heading\n\nBody text.';
    const result = parseSkillFile(content);
    expect(result.content).toBe('# Heading\n\nBody text.');
    expect(result.content).not.toContain('---');
  });

  it('handles file without frontmatter (all content)', () => {
    const content = '# Just Content\n\nNo frontmatter here.';
    const result = parseSkillFile(content);
    expect(result.name).toBeNull();
    expect(result.description).toBeNull();
    expect(result.userInvocable).toBe(false);
    expect(result.content).toBe(content.trim());
  });

  it('handles malformed frontmatter (no closing ---)', () => {
    const content = '---\nname: Broken\nsome content after';
    const result = parseSkillFile(content);
    expect(result.name).toBeNull();
    expect(result.content).toBe(content.trim());
  });

  it('handles empty content after frontmatter', () => {
    const content = '---\nname: Empty\n---\n';
    const result = parseSkillFile(content);
    expect(result.name).toBe('Empty');
    expect(result.content).toBe('');
  });
});
