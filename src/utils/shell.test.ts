import { describe, it, expect } from 'vitest';
import { shellEscape } from './shell.js';

describe('shellEscape', () => {
  it('wraps value in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes single quotes inside the value', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('handles paths with spaces', () => {
    expect(shellEscape('/tmp/my dir/file.sh')).toBe("'/tmp/my dir/file.sh'");
  });

  it('handles paths with special shell chars', () => {
    const dangerous = '/tmp/$(rm -rf /)';
    const escaped = shellEscape(dangerous);
    expect(escaped).toBe("'/tmp/$(rm -rf /)'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles backticks', () => {
    expect(shellEscape('`whoami`')).toBe("'`whoami`'");
  });

  it('handles multiple single quotes', () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });
});
