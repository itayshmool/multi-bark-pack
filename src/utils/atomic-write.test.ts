import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { atomicWriteJSON } from './atomic-write.js';

describe('atomicWriteJSON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes to a unique tmp path (not just .tmp)', () => {
    atomicWriteJSON('/data/agents.json', { a: 1 });

    const tmpPath = (writeFileSync as any).mock.calls[0][0] as string;
    expect(tmpPath).toMatch(/^\/data\/agents\.json\.\d+\.tmp$/);
    expect(tmpPath).not.toBe('/data/agents.json.tmp');
  });

  it('renames tmp file to target path on success', () => {
    atomicWriteJSON('/data/agents.json', { a: 1 });

    const tmpPath = (writeFileSync as any).mock.calls[0][0];
    expect(renameSync).toHaveBeenCalledWith(tmpPath, '/data/agents.json');
  });

  it('returns true on success', () => {
    expect(atomicWriteJSON('/data/test.json', {})).toBe(true);
  });

  it('cleans up tmp file and returns false on write error', () => {
    (writeFileSync as any).mockImplementation(() => { throw new Error('disk full'); });

    expect(atomicWriteJSON('/data/test.json', {})).toBe(false);
    expect(unlinkSync).toHaveBeenCalled();
  });

  it('cleans up tmp file and returns false on rename error', () => {
    (renameSync as any).mockImplementation(() => { throw new Error('EXDEV'); });

    expect(atomicWriteJSON('/data/test.json', {})).toBe(false);
    expect(unlinkSync).toHaveBeenCalled();
  });

  it('concurrent writes use different tmp paths', () => {
    atomicWriteJSON('/data/test.json', { a: 1 });
    atomicWriteJSON('/data/test.json', { b: 2 });

    const path1 = (writeFileSync as any).mock.calls[0][0];
    const path2 = (writeFileSync as any).mock.calls[1][0];
    expect(path1).not.toBe(path2);
  });
});
