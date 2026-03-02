import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { isCliInstalled, getCliVersion, clearCliCache } from './shared.js';

describe('shared backend utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCliCache();
  });

  describe('isCliInstalled cache', () => {
    it('calls execSync only once per CLI', () => {
      (execSync as any).mockReturnValue('/usr/bin/claude');

      expect(isCliInstalled('claude')).toBe(true);
      expect(isCliInstalled('claude')).toBe(true);
      expect(isCliInstalled('claude')).toBe(true);

      const whichCalls = (execSync as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('which'),
      );
      expect(whichCalls).toHaveLength(1);
    });

    it('caches false results too', () => {
      (execSync as any).mockImplementation(() => { throw new Error('not found'); });

      expect(isCliInstalled('missing-cli')).toBe(false);
      expect(isCliInstalled('missing-cli')).toBe(false);

      const whichCalls = (execSync as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('which'),
      );
      expect(whichCalls).toHaveLength(1);
    });

    it('caches independently per CLI name', () => {
      (execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/bin/claude';
        throw new Error('not found');
      });

      expect(isCliInstalled('claude')).toBe(true);
      expect(isCliInstalled('codex')).toBe(false);
    });

    it('clearCliCache forces re-check', () => {
      (execSync as any).mockReturnValue('/usr/bin/claude');
      isCliInstalled('claude');

      clearCliCache();
      (execSync as any).mockImplementation(() => { throw new Error('not found'); });

      expect(isCliInstalled('claude')).toBe(false);
    });
  });

  describe('getCliVersion', () => {
    it('returns trimmed version string', () => {
      (execSync as any).mockReturnValue('  1.2.3\n');
      expect(getCliVersion('claude --version')).toBe('1.2.3');
    });

    it('returns null on error', () => {
      (execSync as any).mockImplementation(() => { throw new Error('fail'); });
      expect(getCliVersion('claude --version')).toBeNull();
    });
  });
});
