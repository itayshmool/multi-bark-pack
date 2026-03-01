import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockData = () => ({
  version: 1,
  agents: {} as Record<string, any>,
  totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 },
});

vi.mock('./storage.js', () => ({
  load: vi.fn(() => mockData()),
  save: vi.fn(),
}));

import * as storage from './storage.js';
import { initialize, record, getAll, getAgentUsage, removeAgent } from './index.js';

describe('usage tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storage.load as any).mockImplementation(() => mockData());
    // Re-initialize to reset internal state
    initialize();
  });

  describe('record', () => {
    it('creates new agent entry on first record', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.05 });
      const data = getAll();
      expect(data.agents['agent-1']).toBeDefined();
      expect(data.agents['agent-1'].name).toBe('Chase');
      expect(data.agents['agent-1'].backend).toBe('claude-code');
    });

    it('accumulates cost across multiple records', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.05 });
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.10 });
      const data = getAll();
      expect(data.agents['agent-1'].totalCostUsd).toBeCloseTo(0.15);
    });

    it('accumulates tokens correctly', () => {
      record('agent-1', 'Chase', 'claude-code', {
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      record('agent-1', 'Chase', 'claude-code', {
        usage: { input_tokens: 200, output_tokens: 100 },
      });
      const agent = getAgentUsage('agent-1');
      expect(agent?.totalInputTokens).toBe(300);
      expect(agent?.totalOutputTokens).toBe(150);
    });

    it('increments turns counter', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.01 });
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.02 });
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.03 });
      expect(getAgentUsage('agent-1')?.turns).toBe(3);
    });

    it('estimates cost when backend does not report it (codex)', () => {
      record('agent-1', 'Chase', 'codex', {
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      });
      const agent = getAgentUsage('agent-1');
      expect(agent?.totalCostUsd).toBeGreaterThan(0);
      expect(agent?.estimated).toBe(true);
    });

    it('does nothing when usageData is null', () => {
      record('agent-1', 'Chase', 'claude-code', null);
      expect(getAgentUsage('agent-1')).toBeNull();
    });

    it('updates totals', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.05 });
      const data = getAll();
      expect(data.totals.costUsd).toBeCloseTo(0.05);
      expect(data.totals.turns).toBe(1);
    });
  });

  describe('getAll', () => {
    it('returns all recorded data', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.05 });
      const data = getAll();
      expect(data.agents).toBeDefined();
      expect(data.totals).toBeDefined();
    });
  });

  describe('getAgentUsage', () => {
    it('returns agent data when exists', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.05 });
      const agent = getAgentUsage('agent-1');
      expect(agent).not.toBeNull();
      expect(agent?.name).toBe('Chase');
    });

    it('returns null when agent not found', () => {
      expect(getAgentUsage('nonexistent')).toBeNull();
    });
  });

  describe('removeAgent', () => {
    it('removes agent and subtracts from totals', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.10 });
      record('agent-2', 'Marshall', 'claude-code', { costUsd: 0.05 });

      removeAgent('agent-1');

      expect(getAgentUsage('agent-1')).toBeNull();
      expect(getAll().totals.costUsd).toBeCloseTo(0.05);
    });

    it('does nothing for unknown agent', () => {
      record('agent-1', 'Chase', 'claude-code', { costUsd: 0.10 });
      removeAgent('nonexistent');
      expect(getAll().totals.costUsd).toBeCloseTo(0.10);
    });
  });
});
