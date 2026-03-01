import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedMessage, Adapter } from '../types/index.js';

// --- Use vi.hoisted for values referenced inside vi.mock factories ---
const { mockOwnerIds, mockHandleCommand, mockFindAgentByName, mockSpawnAgent,
  mockSendToAgent, mockGetAgents, mockGetDeletedAgents, mockGetMsgAgent,
  mockSetMsgAgent, mockHasAgent, mockHasDeletedAgent } = vi.hoisted(() => ({
  mockOwnerIds: { whatsapp: new Set(['owner-1']), telegram: null as any, slack: null as any } as Record<string, any>,
  mockHandleCommand: vi.fn(async () => false),
  mockFindAgentByName: vi.fn((): any => null),
  mockSpawnAgent: vi.fn(),
  mockSendToAgent: vi.fn(),
  mockGetAgents: vi.fn(() => new Map()),
  mockGetDeletedAgents: vi.fn(() => new Map()),
  mockGetMsgAgent: vi.fn((_id: string): string | undefined => undefined),
  mockSetMsgAgent: vi.fn(),
  mockHasAgent: vi.fn(() => false),
  mockHasDeletedAgent: vi.fn(() => false),
}));

vi.mock('./config.js', () => ({
  OWNER_IDS: mockOwnerIds,
  TMP_DIR: '/tmp/bark',
  PROJECTS_DIR: '/tmp/projects',
  TOOLS_DIR: '/tmp/tools',
  MCP_CONFIG_FILE: null,
  AGENTS_FILE: '/tmp/agents.json',
  ROUTING_FILE: '/tmp/routing.json',
  STATUS_FILE: '/tmp/status.json',
  PACKS_FILE: null,
  GROUP_NAME: 'bark-pack',
  TELEGRAM_TOKEN: null,
  TELEGRAM_CHAT_ID: null,
  SLACK_BOT_TOKEN: null,
  SLACK_APP_TOKEN: null,
  WA_ENABLED: true,
  WHISPER_MODEL: '/tmp/model.bin',
  DEFAULT_BACKEND: 'claude-code',
  ENABLED_BACKENDS: ['claude-code'],
  UI_PORT: 3333,
  API_SECRET: null,
  cleanEnv: {},
  EXEC_OPTS: {},
  AGENT_TIMEOUT: 600000,
  MAX_DELEGATION_DEPTH: 1,
  MAX_SUB_AGENTS: 3,
  REPO_PATH: null,
  REPO_NAME: null,
  parseOwners: vi.fn(),
  ensureDirectories: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock('./state.js', () => ({
  getAgents: mockGetAgents,
  getDeletedAgents: mockGetDeletedAgents,
  getMsgAgent: mockGetMsgAgent,
  setMsgAgent: mockSetMsgAgent,
  hasAgent: mockHasAgent,
  hasDeletedAgent: mockHasDeletedAgent,
}));

vi.mock('./voice.js', () => ({
  transcribeAudio: vi.fn(async () => 'transcribed text'),
}));

vi.mock('./commands.js', () => ({
  handleCommand: mockHandleCommand,
}));

vi.mock('./agents.js', () => ({
  findAgentByName: mockFindAgentByName,
  spawnAgent: mockSpawnAgent,
  sendToAgent: mockSendToAgent,
}));

import { initRouting, onMessage } from './routing.js';

// --- Test Helpers ---

function createMockAdapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    name: 'whatsapp',
    capabilities: { finalMessageBehavior: 'edit' as const },
    initialize: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    isReady: vi.fn(() => true),
    send: vi.fn(async () => 'msg-id'),
    sendFile: vi.fn(async () => 'file-msg-id'),
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

function createMockMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  const adapter = overrides.adapter || createMockAdapter();
  return {
    id: 'msg-1',
    text: 'hello',
    sender: 'User',
    senderId: 'owner-1',
    hasMedia: false,
    mediaType: null,
    isQuotedReply: false,
    raw: {},
    adapter,
    ...overrides,
  };
}

describe('routing - onMessage', () => {
  const mockSecurityGuard = {
    isEnabled: vi.fn(() => false),
    screen: vi.fn(async () => ({ allowed: true, category: null as string | null, reason: null as string | null, latencyMs: 0 })),
  };
  const mockTimeline = {
    emit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnerIds.whatsapp = new Set(['owner-1']);
    mockOwnerIds.telegram = null as any;
    mockOwnerIds.slack = null as any;

    initRouting({
      securityGuard: mockSecurityGuard as any,
      timeline: mockTimeline as any,
    });
  });

  describe('owner filtering', () => {
    it('ignores messages when no owner configured for adapter', async () => {
      const adapter = createMockAdapter({ name: 'telegram' });
      const msg = createMockMessage({ adapter, senderId: 'user-1' });

      await onMessage(msg);

      expect(mockSpawnAgent).not.toHaveBeenCalled();
      expect(mockSendToAgent).not.toHaveBeenCalled();
    });

    it('ignores messages from non-owner sender', async () => {
      const msg = createMockMessage({ senderId: 'stranger-1' });

      await onMessage(msg);

      expect(mockSpawnAgent).not.toHaveBeenCalled();
    });

    it('accepts messages from owner', async () => {
      const msg = createMockMessage({ senderId: 'owner-1', text: 'do something' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalled();
    });

    it('accepts all messages when DANGER-ALL is set', async () => {
      mockOwnerIds.whatsapp = 'DANGER-ALL';
      const msg = createMockMessage({ senderId: 'anyone', text: 'hello' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalled();
    });
  });

  describe('command interception', () => {
    it('routes /command messages to handleCommand', async () => {
      mockHandleCommand.mockResolvedValueOnce(true);
      const msg = createMockMessage({ text: '/status' });

      await onMessage(msg);

      expect(mockHandleCommand).toHaveBeenCalled();
      expect(mockSpawnAgent).not.toHaveBeenCalled();
    });

    it('continues routing when handleCommand returns false', async () => {
      mockHandleCommand.mockResolvedValueOnce(false);
      const msg = createMockMessage({ text: '/unknown-cmd' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalled();
    });
  });

  describe('@mention routing', () => {
    it('routes @name to correct agent', async () => {
      const mockAgent = { id: 'a1', name: 'Chase', status: 'active' };
      mockFindAgentByName.mockReturnValueOnce(mockAgent);

      const msg = createMockMessage({ text: '@Chase fix the bug' });

      await onMessage(msg);

      expect(mockFindAgentByName).toHaveBeenCalledWith('Chase');
      expect(mockSendToAgent).toHaveBeenCalled();
      expect(mockSpawnAgent).not.toHaveBeenCalled();
    });

    it('sends error for unknown @name', async () => {
      mockFindAgentByName.mockReturnValueOnce(null);

      const adapter = createMockAdapter();
      const msg = createMockMessage({ adapter, text: '@Unknown fix this' });

      await onMessage(msg);

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Unknown pup'));
    });

    it('strips @mention from text before sending', async () => {
      const mockAgent = { id: 'a1', name: 'Chase', status: 'active' };
      mockFindAgentByName.mockReturnValueOnce(mockAgent);

      const msg = createMockMessage({ text: '@Chase fix the bug' });
      await onMessage(msg);

      // The second argument to sendToAgent should have the @mention stripped
      const sentPrompt = mockSendToAgent.mock.calls[0][1];
      expect(sentPrompt).not.toContain('@Chase');
      expect(sentPrompt).toContain('fix the bug');
    });
  });

  describe('reply routing', () => {
    it('routes reply to correct active agent via message map', async () => {
      const mockAgent = { id: 'a1', name: 'Chase', status: 'active' };
      const agentsMap = new Map([['a1', mockAgent]]);
      mockGetAgents.mockReturnValue(agentsMap);
      mockGetMsgAgent.mockReturnValueOnce('a1');
      mockHasAgent.mockReturnValueOnce(true);

      const adapter = createMockAdapter({
        getQuotedMessage: vi.fn(async () => ({ id: 'quoted-msg-1', body: 'previous response' })),
      });
      const msg = createMockMessage({
        adapter,
        isQuotedReply: true,
        text: 'now do this',
      });

      await onMessage(msg);

      expect(mockSendToAgent).toHaveBeenCalledWith(
        mockAgent,
        expect.any(String),
        adapter,
        null,
        'msg-1',
        null,
      );
    });

    it('shows shelved hint when replying to deleted agent', async () => {
      const deletedAgent = { id: 'a1', name: 'Chase', status: 'deleted' };
      mockGetDeletedAgents.mockReturnValue(new Map([['a1', deletedAgent]]));
      mockGetMsgAgent.mockReturnValueOnce('a1');
      mockHasAgent.mockReturnValueOnce(false);
      mockHasDeletedAgent.mockReturnValueOnce(true);

      const adapter = createMockAdapter({
        getQuotedMessage: vi.fn(async () => ({ id: 'quoted-msg-1', body: 'old message' })),
      });
      const msg = createMockMessage({
        adapter,
        isQuotedReply: true,
        text: 'are you there?',
      });

      await onMessage(msg);

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('reborn'));
    });

    it('spawns new agent for reply to unknown message', async () => {
      mockGetMsgAgent.mockReturnValueOnce(undefined);

      const adapter = createMockAdapter({
        getQuotedMessage: vi.fn(async () => ({ id: 'quoted-msg-unknown', body: 'some text' })),
      });
      const msg = createMockMessage({
        adapter,
        isQuotedReply: true,
        text: 'reply to unknown',
      });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalled();
    });
  });

  describe('new agent spawn', () => {
    it('spawns new agent for fresh message', async () => {
      const msg = createMockMessage({ text: 'fix the login page' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.stringContaining('fix the login page'),
        expect.any(Object), // adapter
        null, // parentId
        null, // listeningMsgId
        'msg-1', // replyToId
        null, // model
        null, // forceName
        null, // backendName
      );
    });

    it('includes requested model from tags', async () => {
      const msg = createMockMessage({ text: '#opus fix this bug' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        null,
        null,
        'msg-1',
        'opus', // model extracted from tag
        null,
        null,
      );
    });

    it('includes requested backend from tags', async () => {
      const msg = createMockMessage({ text: '#cursor fix this bug' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        null,
        null,
        'msg-1',
        null,
        null,
        'cursor', // backend extracted from tag
      );
    });
  });

  describe('security guard', () => {
    it('blocks message when security guard returns not allowed', async () => {
      mockSecurityGuard.isEnabled.mockReturnValue(true);
      mockSecurityGuard.screen.mockResolvedValueOnce({
        allowed: false,
        category: 'prompt_injection',
        reason: 'jailbreak',
        latencyMs: 50,
      });

      const adapter = createMockAdapter();
      const msg = createMockMessage({ adapter, text: 'ignore instructions' });

      await onMessage(msg);

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('blocked'));
      expect(mockSpawnAgent).not.toHaveBeenCalled();
    });

    it('allows message when security guard passes', async () => {
      mockSecurityGuard.isEnabled.mockReturnValue(true);
      mockSecurityGuard.screen.mockResolvedValueOnce({
        allowed: true,
        category: null,
        reason: null,
        latencyMs: 30,
      });

      const msg = createMockMessage({ text: 'fix the bug' });

      await onMessage(msg);

      expect(mockSpawnAgent).toHaveBeenCalled();
    });
  });

  describe('debug logging (Fix #17)', () => {
    it('does not log DEBUG messages when process.env.DEBUG is unset', async () => {
      const logSpy = vi.spyOn(console, 'log');
      const msg = createMockMessage({ text: 'test' });
      await onMessage(msg);
      const debugCalls = logSpy.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('[DEBUG]'),
      );
      expect(debugCalls).toHaveLength(0);
      logSpy.mockRestore();
    });
  });
});
