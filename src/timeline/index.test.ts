import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./storage.js', () => ({
  load: vi.fn(() => []),
  append: vi.fn(),
  trim: vi.fn(),
  rotate: vi.fn(),
}));

import * as storage from './storage.js';
import { initialize, emit, getAll } from './index.js';

describe('timeline/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    initialize({ broadcast: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('emit', () => {
    it('appends event to storage', () => {
      emit('spawn', { agentId: 'a1', agentName: 'Chase' });
      expect(storage.append).toHaveBeenCalledTimes(1);
    });

    it('creates event with correct fields', () => {
      emit('spawn', { agentId: 'a1', agentName: 'Chase', backend: 'claude-code' });
      const event = (storage.append as any).mock.calls[0][0];
      expect(event.type).toBe('spawn');
      expect(event.agentName).toBe('Chase');
      expect(event.id).toMatch(/^evt_/);
    });
  });

  describe('trim/rotate debounce (Fix #6)', () => {
    it('does not run trim/rotate immediately even after many appends', () => {
      for (let i = 0; i < 200; i++) {
        emit('spawn', { agentName: `pup-${i}` });
      }
      // Trim/rotate is debounced — should not run synchronously
      expect(storage.trim).not.toHaveBeenCalled();
      expect(storage.rotate).not.toHaveBeenCalled();
    });

    it('schedules trim/rotate via setTimeout (debounced)', () => {
      for (let i = 0; i < 200; i++) {
        emit('spawn', { agentName: `pup-${i}` });
      }
      // Advance past the 30s debounce
      vi.advanceTimersByTime(31_000);
      expect(storage.trim).toHaveBeenCalled();
      expect(storage.rotate).toHaveBeenCalled();
    });
  });

  describe('getAll', () => {
    it('returns events with filtering', () => {
      emit('spawn', { agentId: 'a1', agentName: 'Chase' });
      emit('spawn', { agentId: 'a2', agentName: 'Marshall' });

      const all = getAll();
      expect(all).toHaveLength(2);

      const filtered = getAll({ agentId: 'a1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].agentName).toBe('Chase');
    });
  });
});
