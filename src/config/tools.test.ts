import { describe, it, expect } from 'vitest';
import { getToolIcon, TOOL_ICONS } from './tools.js';

describe('TOOL_ICONS', () => {
  it('contains expected tool mappings', () => {
    expect(TOOL_ICONS.Bash).toBe('💻');
    expect(TOOL_ICONS.Read).toBe('📖');
    expect(TOOL_ICONS.Edit).toBe('✏️');
    expect(TOOL_ICONS.Write).toBe('📝');
    expect(TOOL_ICONS.Grep).toBe('🔍');
    expect(TOOL_ICONS.Glob).toBe('📂');
  });
});

describe('getToolIcon', () => {
  it('returns exact match icon', () => {
    expect(getToolIcon('Bash')).toBe('💻');
    expect(getToolIcon('Read')).toBe('📖');
  });

  it('returns fuzzy match (lowercase contains)', () => {
    expect(getToolIcon('bash_command')).toBe('💻');
    expect(getToolIcon('file_read')).toBe('📖');
  });

  it('returns MCP icon for mcp__ prefix tools', () => {
    expect(getToolIcon('mcp__some_server__tool')).toBe('🔌');
  });

  it('returns default wrench icon for unknown tools', () => {
    expect(getToolIcon('SomeRandomTool')).toBe('🔧');
  });

  it('uses extraIcons when provided', () => {
    expect(getToolIcon('CustomTool', { CustomTool: '🎯' })).toBe('🎯');
  });

  it('extraIcons override default icons', () => {
    expect(getToolIcon('Bash', { Bash: '🖥️' })).toBe('🖥️');
  });

  it('handles case-insensitive fuzzy matching', () => {
    // "grep" contains "grep" (case-insensitive match against "Grep")
    expect(getToolIcon('grep_search')).toBe('🔍');
  });
});
