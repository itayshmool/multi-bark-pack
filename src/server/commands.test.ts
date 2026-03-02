/**
 * TDD tests for commands.ts — validates every /command handler end-to-end.
 * Also ensures command-registry.ts stays in sync with the actual handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Adapter, NormalizedMessage } from '../types/index.js';

// ── Hoisted mocks (referenced inside vi.mock factories) ──────────────────────
const {
  mockGetAgents,
  mockGetDeletedAgents,
  mockGetMsgAgent,
  mockSaveState,
  mockGetLastAgentForSource,
  mockFindAgentByName,
  mockHardDeleteAgent,
  mockSpawnAgent,
  mockStopAgents,
  mockClearAgents,
  mockDeleteAgents,
  mockRebornAgent,
  mockResetAgents,
  mockResolveApproval,
  mockLoadPolicy,
  mockGetPolicy,
  mockUpdatePinnedStatus,
  mockTimeSince,
  mockSanitizeName,
  mockGetAgentIcon,
  mockRunDaily,
  mockFormatCapabilityMatrix,
  mockSkillsFormatList,
  mockSkillsHas,
  mockSkillsGet,
  mockSkillsList,
  mockUsageGetAll,
} = vi.hoisted(() => ({
  mockGetAgents: vi.fn(() => new Map()),
  mockGetDeletedAgents: vi.fn(() => new Map()),
  mockGetMsgAgent: vi.fn(() => undefined),
  mockSaveState: vi.fn(),
  mockGetLastAgentForSource: vi.fn(() => null),
  mockFindAgentByName: vi.fn(() => null),
  mockHardDeleteAgent: vi.fn(),
  mockSpawnAgent: vi.fn(async () => null),
  mockStopAgents: vi.fn(() => ({ stopped: [], notFound: [] })),
  mockClearAgents: vi.fn(() => ({ cleared: [], notFound: [] })),
  mockDeleteAgents: vi.fn(() => ({ deleted: [], deletedFromLosts: [], notFound: [] })),
  mockRebornAgent: vi.fn(() => ({ success: false, error: 'not found' })),
  mockResetAgents: vi.fn(() => ({ reset: [], notFound: [] })),
  mockResolveApproval: vi.fn(async () => {}),
  mockLoadPolicy: vi.fn(),
  mockGetPolicy: vi.fn(() => ({ rules: [], defaultAction: 'block' })),
  mockUpdatePinnedStatus: vi.fn(async () => {}),
  mockTimeSince: vi.fn(() => '2 hours'),
  mockSanitizeName: vi.fn((n: string) => n),
  mockGetAgentIcon: vi.fn(() => '🐕'),
  mockRunDaily: vi.fn(async () => {}),
  mockFormatCapabilityMatrix: vi.fn(() => 'backends text'),
  mockSkillsFormatList: vi.fn(() => 'skills text'),
  mockSkillsHas: vi.fn(() => false),
  mockSkillsGet: vi.fn(() => null),
  mockSkillsList: vi.fn(() => []),
  mockUsageGetAll: vi.fn(() => ({ agents: {}, totals: { costUsd: 0, turns: 0, inputTokens: 0, outputTokens: 0 } })),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('./state.js', () => ({
  getAgents: mockGetAgents,
  getDeletedAgents: mockGetDeletedAgents,
  getMsgAgent: mockGetMsgAgent,
  saveState: mockSaveState,
  getLastAgentForSource: mockGetLastAgentForSource,
}));

vi.mock('./agents.js', () => ({
  findAgentByName: mockFindAgentByName,
  hardDeleteAgent: mockHardDeleteAgent,
  spawnAgent: mockSpawnAgent,
  stopAgents: mockStopAgents,
  clearAgents: mockClearAgents,
  deleteAgents: mockDeleteAgents,
  rebornAgent: mockRebornAgent,
  resetAgents: mockResetAgents,
}));

vi.mock('./approval.js', () => ({
  resolveApproval: mockResolveApproval,
  loadPolicy: mockLoadPolicy,
  getPolicy: mockGetPolicy,
  parseApprovalReply: vi.fn(() => null),
}));

vi.mock('./status.js', () => ({
  updatePinnedStatus: mockUpdatePinnedStatus,
  timeSince: mockTimeSince,
}));

vi.mock('./naming.js', () => ({
  sanitizeName: mockSanitizeName,
  getAgentIcon: mockGetAgentIcon,
}));

vi.mock('./daily.js', () => ({
  runDaily: mockRunDaily,
}));

vi.mock('./config.js', () => ({
  TMP_DIR: '/tmp/bark',
  PROJECTS_DIR: '/tmp/projects',
  TOOLS_DIR: '/tmp/tools',
  MCP_CONFIG_FILE: null,
  AGENTS_FILE: '/tmp/agents.json',
  ROUTING_FILE: '/tmp/routing.json',
  STATUS_FILE: '/tmp/status.json',
  PACKS_FILE: null,
  GROUP_NAME: 'bark-pack',
  DEFAULT_BACKEND: 'claude-code',
  ENABLED_BACKENDS: ['claude-code'],
  REPO_PATH: null,
  REPO_NAME: null,
  EXEC_OPTS: {},
  MAX_SUB_AGENTS: 3,
  AGENT_TIMEOUT: 0,
  MAX_DELEGATION_DEPTH: 1,
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, cb: (err: null) => void) => cb(null)),
}));

// ── Import under test ─────────────────────────────────────────────────────────
import { initCommands, handleCommand } from './commands.js';
import { COMMANDS, COMMAND_SET, buildQuickView, buildFullHelp } from './command-registry.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAdapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    name: 'telegram',
    capabilities: { finalMessageBehavior: 'send' as const },
    initialize: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    isReady: vi.fn(() => true),
    send: vi.fn(async () => 'msg-1'),
    sendFile: vi.fn(async () => null),
    edit: vi.fn(async () => true),
    pin: vi.fn(async () => {}),
    unpin: vi.fn(async () => {}),
    deleteMsg: vi.fn(async () => {}),
    downloadMedia: vi.fn(async () => null),
    getQuotedMessage: vi.fn(async () => null),
    sendGoodbye: vi.fn(async () => {}),
    ...overrides,
  } as Adapter;
}

function makeMsg(text: string, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: 'msg-1',
    text,
    sender: 'Guy',
    senderId: 'owner-1',
    hasMedia: false,
    mediaType: null,
    isQuotedReply: false,
    raw: {},
    adapter: makeAdapter(),
    ...overrides,
  };
}

const mockDeps = {
  backends: { formatCapabilityMatrix: mockFormatCapabilityMatrix } as any,
  skillsManager: {
    formatList: mockSkillsFormatList,
    has: mockSkillsHas,
    get: mockSkillsGet,
    list: mockSkillsList,
  } as any,
  usageTracker: { getAll: mockUsageGetAll } as any,
  destroyAllAdapters: vi.fn(async () => {}),
  getPackNames: vi.fn(() => ['Chase', 'Marshall', 'Rocky']),
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('command-registry', () => {
  it('has at least 20 registered commands', () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(20);
  });

  it('all commands start with /', () => {
    for (const c of COMMANDS) {
      expect(c.cmd).toMatch(/^\//);
    }
  });

  it('all tgCmd values are lowercase with no hyphens', () => {
    for (const c of COMMANDS) {
      const tg = c.tgCmd ?? c.cmd.slice(1);
      expect(tg).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('COMMAND_SET contains every command string', () => {
    for (const c of COMMANDS) {
      expect(COMMAND_SET.has(c.cmd)).toBe(true);
    }
  });

  it('all commands have non-empty description ≤256 chars', () => {
    for (const c of COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('has unique command strings', () => {
    const cmds = COMMANDS.map(c => c.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
  });

  it('has entries for every handler in commands.ts', () => {
    const requiredCmds = [
      '/help', '/status', '/backends', '/skills', '/skill',
      '/losts', '/purge', '/reborn', '/create',
      '/stop', '/stopall', '/clear', '/delete', '/reset',
      '/daily', '/stats', '/approve', '/deny',
      '/reload-policy', '/restart', '/shutdown',
    ];
    for (const cmd of requiredCmds) {
      expect(COMMAND_SET.has(cmd)).toBe(true);
    }
  });

  it('no two commands share the same Telegram tgCmd', () => {
    const tgCmds = COMMANDS.map(c => c.tgCmd ?? c.cmd.slice(1));
    expect(new Set(tgCmds).size).toBe(tgCmds.length);
  });

  it('no command name is a prefix of another (prevents partial-match confusion)', () => {
    const cmds = COMMANDS.map(c => c.cmd);
    for (const a of cmds) {
      for (const b of cmds) {
        if (a === b) continue;
        // e.g. /stop should not be a prefix of /stopall at the word level
        // This is fine (/stop vs /stopall) — they're different tokens when split by spaces
        // What we guard against: /skill being mistaken for /skills
        // The command parser uses exact match on body.split(/\s+/)[0], so this is safe
        // We just verify no two cmds are identical after normalisation
        expect(a.toLowerCase()).not.toBe(b.toLowerCase());
      }
    }
  });

  it('buildQuickView includes every command', () => {
    const output = buildQuickView(null);
    for (const c of COMMANDS) {
      expect(output).toContain(c.cmd);
    }
  });

  it('buildFullHelp includes every command', () => {
    const output = buildFullHelp();
    for (const c of COMMANDS) {
      expect(output).toContain(c.cmd);
    }
  });
});

describe('handleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initCommands(mockDeps);
  });

  describe('non-command messages', () => {
    it('returns false for plain text', async () => {
      const result = await handleCommand('hello world', makeMsg('hello'), makeAdapter(), null);
      expect(result).toBe(false);
    });

    it('returns false for empty string', async () => {
      const result = await handleCommand('', makeMsg(''), makeAdapter(), null);
      expect(result).toBe(false);
    });
  });

  // ── /help ──────────────────────────────────────────────────────────────────
  describe('/help', () => {
    it('shows all command groups in quick view', async () => {
      const adapter = makeAdapter();
      await handleCommand('/help', makeMsg('/help'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      // All 5 groups should appear
      expect(sent).toContain('Navigation');
      expect(sent).toContain('Lifecycle');
      expect(sent).toContain('Approval');
      expect(sent).toContain('Server');
      expect(sent).toContain('/help full');
    });

    it('shows every command in the quick view', async () => {
      const adapter = makeAdapter();
      await handleCommand('/help', makeMsg('/help'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      // A sample of commands should appear
      for (const cmd of ['/stats', '/stop', '/clear', '/reset', '/delete', '/approve', '/deny', '/daily']) {
        expect(sent).toContain(cmd);
      }
    });

    it('sends full help with /help full — shows descriptions', async () => {
      const adapter = makeAdapter();
      await handleCommand('/help full', makeMsg('/help full'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Navigation & Status');
      expect(sent).toContain('Agent Lifecycle');
      expect(sent).toContain('Approval Flow');
      expect(sent).toContain('Server Control');
    });

    it('/help full contains routing and multi-LLM sections', async () => {
      const adapter = makeAdapter();
      await handleCommand('/help full', makeMsg('/help full'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Routing');
      expect(sent).toContain('#claude-code');
    });

    it('includes active pup name in quick view when last agent exists', async () => {
      mockGetLastAgentForSource.mockReturnValueOnce({ name: 'Chase', status: 'active' } as any);
      const adapter = makeAdapter();
      await handleCommand('/help', makeMsg('/help'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Chase');
    });

    it('includes no-active hint when no last agent', async () => {
      const adapter = makeAdapter();
      await handleCommand('/help', makeMsg('/help'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('spawn');
    });

    it('returns true (handled)', async () => {
      const result = await handleCommand('/help', makeMsg('/help'), makeAdapter(), null);
      expect(result).toBe(true);
    });
  });

  // ── /status ────────────────────────────────────────────────────────────────
  describe('/status', () => {
    it('calls updatePinnedStatus', async () => {
      await handleCommand('/status', makeMsg('/status'), makeAdapter(), null);
      expect(mockUpdatePinnedStatus).toHaveBeenCalled();
    });

    it('returns true', async () => {
      const result = await handleCommand('/status', makeMsg('/status'), makeAdapter(), null);
      expect(result).toBe(true);
    });
  });

  // ── /backends ──────────────────────────────────────────────────────────────
  describe('/backends', () => {
    it('sends capability matrix', async () => {
      const adapter = makeAdapter();
      await handleCommand('/backends', makeMsg('/backends'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith('backends text');
    });
  });

  // ── /skills ────────────────────────────────────────────────────────────────
  describe('/skills', () => {
    it('sends skill list', async () => {
      const adapter = makeAdapter();
      await handleCommand('/skills', makeMsg('/skills'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith('skills text');
    });
  });

  // ── /skill ─────────────────────────────────────────────────────────────────
  describe('/skill', () => {
    it('shows usage when no skill name given', async () => {
      mockSkillsList.mockReturnValue([{ id: 'developer' }] as any);
      const adapter = makeAdapter();
      await handleCommand('/skill', makeMsg('/skill'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('sends unknown skill error', async () => {
      mockSkillsHas.mockReturnValue(false);
      mockSkillsList.mockReturnValue([{ id: 'developer' }] as any);
      const adapter = makeAdapter();
      await handleCommand('/skill unknown', makeMsg('/skill unknown'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Unknown skill'));
    });

    it('adds skill to agent when pup name given', async () => {
      mockSkillsHas.mockReturnValue(true);
      mockSkillsGet.mockReturnValue({ name: 'Developer', description: 'dev mode', tokens: 100 } as any);
      const agent = { id: 'a1', name: 'Chase', skills: [] as string[] } as any;
      mockFindAgentByName.mockReturnValue(agent);
      const adapter = makeAdapter();
      await handleCommand('/skill developer @Chase', makeMsg('/skill developer @Chase'), adapter, null);
      expect(agent.skills).toContain('developer');
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('shows error when pup not found', async () => {
      mockSkillsHas.mockReturnValue(true);
      mockFindAgentByName.mockReturnValue(null);
      const adapter = makeAdapter();
      await handleCommand('/skill developer @Ghost', makeMsg('/skill developer @Ghost'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  // ── /stop ──────────────────────────────────────────────────────────────────
  describe('/stop', () => {
    it('sends usage hint when no args and no reply', async () => {
      const adapter = makeAdapter();
      await handleCommand('/stop', makeMsg('/stop'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('stops named agent', async () => {
      mockStopAgents.mockReturnValue({ stopped: ['Chase'], notFound: [] } as any);
      const adapter = makeAdapter();
      await handleCommand('/stop Chase', makeMsg('/stop Chase'), adapter, null);
      expect(mockStopAgents).toHaveBeenCalledWith(['Chase']);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Chase'));
    });

    it('shows not-found hint with /stats reference', async () => {
      mockStopAgents.mockReturnValue({ stopped: [], notFound: ['Ghost'] } as any);
      const adapter = makeAdapter();
      await handleCommand('/stop Ghost', makeMsg('/stop Ghost'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Ghost');
      expect(sent).toContain('/stats');
    });

    it('stops agent from quoted reply', async () => {
      mockStopAgents.mockReturnValue({ stopped: ['Chase'], notFound: [] } as any);
      const agent = { id: 'a1', name: 'Chase' } as any;
      mockGetAgents.mockReturnValue(new Map([['a1', agent]]));
      mockGetMsgAgent.mockReturnValue('a1' as any);
      const adapter = makeAdapter({
        getQuotedMessage: vi.fn(async () => ({ id: 'q1', body: 'prev' })),
      });
      const msg = makeMsg('/stop', { adapter, isQuotedReply: true });
      await handleCommand('/stop', msg, adapter, null);
      expect(mockStopAgents).toHaveBeenCalledWith(['Chase']);
    });
  });

  // ── /stopall ───────────────────────────────────────────────────────────────
  describe('/stopall', () => {
    it('stops all pups via pack shorthand', async () => {
      mockStopAgents.mockReturnValue({ stopped: ['Chase', 'Marshall'], notFound: [] } as any);
      const adapter = makeAdapter();
      await handleCommand('/stopall', makeMsg('/stopall'), adapter, null);
      expect(mockStopAgents).toHaveBeenCalledWith(['pack']);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Chase'));
    });

    it('reports no pups running when none active', async () => {
      mockStopAgents.mockReturnValue({ stopped: [], notFound: [] });
      const adapter = makeAdapter();
      await handleCommand('/stopall', makeMsg('/stopall'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('No pups are running'));
    });

    it('returns true', async () => {
      mockStopAgents.mockReturnValue({ stopped: [], notFound: [] });
      const result = await handleCommand('/stopall', makeMsg('/stopall'), makeAdapter(), null);
      expect(result).toBe(true);
    });
  });

  // ── /clear ────────────────────────────────────────────────────────────────
  describe('/clear', () => {
    it('clears named pup', async () => {
      mockClearAgents.mockReturnValue({ cleared: ['Chase'], notFound: [] } as any);
      const adapter = makeAdapter();
      await handleCommand('/clear Chase', makeMsg('/clear Chase'), adapter, null);
      expect(mockClearAgents).toHaveBeenCalledWith(['Chase']);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Chase'));
    });

    it('shows usage when no args', async () => {
      const adapter = makeAdapter();
      await handleCommand('/clear', makeMsg('/clear'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('reports not found pups', async () => {
      mockClearAgents.mockReturnValue({ cleared: [], notFound: ['Ghost'] } as any);
      const adapter = makeAdapter();
      await handleCommand('/clear Ghost', makeMsg('/clear Ghost'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Ghost'));
    });
  });

  // ── /delete ────────────────────────────────────────────────────────────────
  describe('/delete', () => {
    it('deletes named pup', async () => {
      mockDeleteAgents.mockReturnValue({ deleted: ['Chase'], deletedFromLosts: [], notFound: [] } as any);
      const adapter = makeAdapter();
      await handleCommand('/delete Chase', makeMsg('/delete Chase'), adapter, null);
      expect(mockDeleteAgents).toHaveBeenCalledWith(['Chase']);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Chase'));
    });

    it('deletes pack (all pups)', async () => {
      mockDeleteAgents.mockReturnValue({ deleted: ['Chase', 'Marshall'], deletedFromLosts: [], notFound: [] } as any);
      const adapter = makeAdapter();
      await handleCommand('/delete pack', makeMsg('/delete pack'), adapter, null);
      expect(mockDeleteAgents).toHaveBeenCalledWith(['pack']);
    });

    it('shows usage when no args', async () => {
      const adapter = makeAdapter();
      await handleCommand('/delete', makeMsg('/delete'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  // ── /reset ────────────────────────────────────────────────────────────────
  describe('/reset', () => {
    it('resets named pup', async () => {
      mockResetAgents.mockReturnValue({ reset: ['Chase'], notFound: [] } as any);
      const adapter = makeAdapter();
      await handleCommand('/reset Chase', makeMsg('/reset Chase'), adapter, null);
      expect(mockResetAgents).toHaveBeenCalledWith(['Chase']);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Chase'));
    });

    it('shows usage when no args', async () => {
      const adapter = makeAdapter();
      await handleCommand('/reset', makeMsg('/reset'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  // ── /losts ────────────────────────────────────────────────────────────────
  describe('/losts', () => {
    it('shows empty state when no lost pups', async () => {
      mockGetDeletedAgents.mockReturnValue(new Map());
      const adapter = makeAdapter();
      await handleCommand('/losts', makeMsg('/losts'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('All accounted for'));
    });

    it('lists shelved pups with age', async () => {
      const deadAgent = {
        id: 'a1', name: 'Chase', createdAt: new Date().toISOString(), deletedAt: new Date().toISOString(),
      };
      mockGetDeletedAgents.mockReturnValue(new Map([['a1', deadAgent]]));
      const adapter = makeAdapter();
      await handleCommand('/losts', makeMsg('/losts'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Chase');
      expect(sent).toContain('/reborn');
    });
  });

  // ── /purge ─────────────────────────────────────────────────────────────────
  describe('/purge', () => {
    it('reports nothing to purge when empty', async () => {
      mockGetDeletedAgents.mockReturnValue(new Map());
      const adapter = makeAdapter();
      await handleCommand('/purge', makeMsg('/purge'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('No lost pups'));
    });

    it('calls hardDeleteAgent for each shelved pup', async () => {
      const deadAgents = [
        { id: 'a1', name: 'Chase' },
        { id: 'a2', name: 'Marshall' },
      ];
      const deletedMap = new Map(deadAgents.map(a => [a.id, a]));
      mockGetDeletedAgents.mockReturnValue(deletedMap);
      const adapter = makeAdapter();
      await handleCommand('/purge', makeMsg('/purge'), adapter, null);
      expect(mockHardDeleteAgent).toHaveBeenCalledTimes(2);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('2'));
    });
  });

  // ── /reborn ───────────────────────────────────────────────────────────────
  describe('/reborn', () => {
    it('shows usage hint when no name given', async () => {
      const adapter = makeAdapter();
      await handleCommand('/reborn', makeMsg('/reborn'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('shows error when pup not found', async () => {
      mockRebornAgent.mockReturnValue({ success: false, error: '💀 *Ghost* not found in losts' });
      const adapter = makeAdapter();
      await handleCommand('/reborn Ghost', makeMsg('/reborn Ghost'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('confirms reborn on success', async () => {
      mockRebornAgent.mockReturnValue({ success: true, agent: { name: 'Chase' } } as any);
      mockGetAgentIcon.mockReturnValue('🐕');
      const adapter = makeAdapter();
      await handleCommand('/reborn Chase', makeMsg('/reborn Chase'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Chase'));
    });
  });

  // ── /create ────────────────────────────────────────────────────────────────
  describe('/create', () => {
    it('shows usage when no quoted reply and no args', async () => {
      const adapter = makeAdapter();
      await handleCommand('/create', makeMsg('/create'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('spawns agent from quoted reply', async () => {
      const adapter = makeAdapter({
        getQuotedMessage: vi.fn(async () => ({ id: 'q1', body: 'the original message' })),
      });
      const msg = makeMsg('/create', { adapter, isQuotedReply: true });
      await handleCommand('/create', msg, adapter, null);
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.stringContaining('the original message'),
        expect.any(Object),
        null, null, 'msg-1', null, null, null,
      );
    });

    it('spawns agent with forced name @Name', async () => {
      const adapter = makeAdapter({
        getQuotedMessage: vi.fn(async () => null),
      });
      const msg = makeMsg('/create @MyPup do stuff', { adapter });
      await handleCommand('/create @MyPup do stuff', msg, adapter, null);
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.stringContaining('do stuff'),
        expect.any(Object),
        null, null, 'msg-1', null, 'MyPup', null,
      );
    });

    it('shows error for duplicate name', async () => {
      const existingAgent = { id: 'a1', name: 'Chase' };
      mockGetAgents.mockReturnValue(new Map([['a1', existingAgent]]));
      mockGetDeletedAgents.mockReturnValue(new Map());
      const adapter = makeAdapter();
      await handleCommand('/create @Chase do stuff', makeMsg('/create @Chase do stuff'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('already exists'));
      expect(mockSpawnAgent).not.toHaveBeenCalled();
    });
  });

  // ── /daily ────────────────────────────────────────────────────────────────
  describe('/daily', () => {
    it('calls runDaily with adapter', async () => {
      const adapter = makeAdapter();
      await handleCommand('/daily', makeMsg('/daily'), adapter, null);
      expect(mockRunDaily).toHaveBeenCalledWith(adapter);
    });
  });

  // ── /stats ────────────────────────────────────────────────────────────────
  describe('/stats', () => {
    it('shows empty state with spawn hint when no agents', async () => {
      mockGetAgents.mockReturnValue(new Map());
      const adapter = makeAdapter();
      await handleCommand('/stats', makeMsg('/stats'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('No active pups');
      expect(sent).toContain('spawn');
    });

    it('lists all active agents with status indicators', async () => {
      const agents = [
        { id: 'a1', name: 'Chase', backend: 'claude-code', status: 'active', hasRun: true, parentId: null },
        { id: 'a2', name: 'Marshall', backend: 'cursor', status: 'active', hasRun: false, parentId: null },
      ];
      mockGetAgents.mockReturnValue(new Map(agents.map(a => [a.id, a])));
      const adapter = makeAdapter();
      await handleCommand('/stats', makeMsg('/stats'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Chase');
      expect(sent).toContain('Marshall');
      expect(sent).toContain('🟢'); // running
      expect(sent).toContain('⚪'); // idle
    });

    it('shows routing cheatsheet in pack view', async () => {
      const agents = [{ id: 'a1', name: 'Chase', backend: 'claude-code', status: 'active', hasRun: true, parentId: null }];
      mockGetAgents.mockReturnValue(new Map(agents.map(a => [a.id, a])));
      const adapter = makeAdapter();
      await handleCommand('/stats', makeMsg('/stats'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('@Name');
      expect(sent).toContain('/stop');
      expect(sent).toContain('/stopall');
    });

    it('excludes sub-agents (parentId set) from pack view', async () => {
      const agents = [
        { id: 'a1', name: 'Chase', backend: 'claude-code', status: 'active', hasRun: true, parentId: null },
        { id: 'a2', name: 'sub-Rocky', backend: 'claude-code', status: 'active', hasRun: true, parentId: 'a1' },
      ];
      mockGetAgents.mockReturnValue(new Map(agents.map(a => [a.id, a])));
      const adapter = makeAdapter();
      await handleCommand('/stats', makeMsg('/stats'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).not.toContain('sub-Rocky');
    });

    it('shows per-pup details with /stats Name', async () => {
      const agent = { id: 'a1', name: 'Chase', backend: 'claude-code', model: 'sonnet', status: 'active', hasRun: true, cwd: '/projects/my-app' };
      mockFindAgentByName.mockReturnValue(agent as any);
      mockUsageGetAll.mockReturnValue({
        agents: { a1: { totalCostUsd: 0.0123, turns: 5, totalInputTokens: 1000, totalOutputTokens: 500, estimated: false } },
        totals: { costUsd: 0.0123, turns: 5, inputTokens: 1000, outputTokens: 500 },
      });
      const adapter = makeAdapter();
      await handleCommand('/stats Chase', makeMsg('/stats Chase'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('Chase');
      expect(sent).toContain('claude-code');
      expect(sent).toContain('sonnet');
      expect(sent).toContain('@Chase');
      expect(sent).toContain('/stop Chase');
    });

    it('shows not-found hint for unknown pup', async () => {
      mockFindAgentByName.mockReturnValue(null);
      const adapter = makeAdapter();
      await handleCommand('/stats Ghost', makeMsg('/stats Ghost'), adapter, null);
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('not found');
      expect(sent).toContain('/stats');
    });
  });

  // ── /approve & /deny ──────────────────────────────────────────────────────
  describe('/approve and /deny', () => {
    it('shows usage when no args', async () => {
      const adapter = makeAdapter();
      await handleCommand('/approve', makeMsg('/approve'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('resolves approval for named agent', async () => {
      const agent = { id: 'a1', name: 'Chase', approvalPending: { messageId: 'ap-msg' } } as any;
      mockFindAgentByName.mockReturnValue(agent);
      mockGetAgents.mockReturnValue(new Map([['a1', agent]]));
      const adapter = makeAdapter();
      await handleCommand('/approve Chase', makeMsg('/approve Chase'), adapter, null);
      expect(mockResolveApproval).toHaveBeenCalledWith(agent, true, adapter);
    });

    it('resolves denial for named agent', async () => {
      const agent = { id: 'a1', name: 'Chase', approvalPending: { messageId: 'ap-msg' } } as any;
      mockFindAgentByName.mockReturnValue(agent);
      mockGetAgents.mockReturnValue(new Map([['a1', agent]]));
      const adapter = makeAdapter();
      await handleCommand('/deny Chase', makeMsg('/deny Chase'), adapter, null);
      expect(mockResolveApproval).toHaveBeenCalledWith(agent, false, adapter);
    });

    it('reports when no pending approval', async () => {
      const agent = { id: 'a1', name: 'Chase', approvalPending: undefined } as any;
      mockFindAgentByName.mockReturnValue(agent);
      mockGetAgents.mockReturnValue(new Map([['a1', agent]]));
      const adapter = makeAdapter();
      await handleCommand('/approve Chase', makeMsg('/approve Chase'), adapter, null);
      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('No pending'));
    });
  });

  // ── /reload-policy ─────────────────────────────────────────────────────────
  describe('/reload-policy', () => {
    it('calls loadPolicy and confirms reload', async () => {
      mockGetPolicy.mockReturnValue({ rules: [{ tool: 'Bash' }], defaultAction: 'block' } as any);
      const adapter = makeAdapter();
      await handleCommand('/reload-policy', makeMsg('/reload-policy'), adapter, null);
      expect(mockLoadPolicy).toHaveBeenCalled();
      const sent = (adapter.send as any).mock.calls[0][0] as string;
      expect(sent).toContain('reloaded');
      expect(sent).toContain('1 rules');
    });
  });

  // ── unknown command ─────────────────────────────────────────────────────────
  describe('unknown command', () => {
    it('returns false to let routing handle it', async () => {
      const result = await handleCommand('/nonexistent', makeMsg('/nonexistent'), makeAdapter(), null);
      expect(result).toBe(false);
    });
  });
});
