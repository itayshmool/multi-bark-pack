import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockSetMsgAgent = vi.fn();
const mockSaveState = vi.fn();
const mockDeliverResponse = vi.fn().mockResolvedValue('msg-delivered');
const mockUpdatePinnedStatus = vi.fn().mockResolvedValue(undefined);
const mockBroadcastAgents = vi.fn();

vi.mock('./state.js', () => ({
  setMsgAgent: mockSetMsgAgent,
  saveState: mockSaveState,
}));

vi.mock('./execution.js', () => ({
  deliverResponse: mockDeliverResponse,
}));

vi.mock('./status.js', () => ({
  updatePinnedStatus: mockUpdatePinnedStatus,
}));

vi.mock('./websocket.js', () => ({
  broadcastAgents: mockBroadcastAgents,
}));

vi.mock('../config/paths.js', () => ({
  ROOT_DIR: '/tmp/bark-test',
  TMP_DIR: '/tmp/bark-test/.bark-tmp',
}));

describe('approval module', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('evaluatePolicy', () => {
    it('returns defaultAction when no rules match', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });
      expect(mod.evaluatePolicy('UnknownTool', '')).toBe('block');
    });

    it('matches tool name without pattern', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [{ tool: 'Read', action: 'auto_approve' }],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Read', '')).toBe('auto_approve');
      expect(mod.evaluatePolicy('Write', '')).toBe('block');
    });

    it('matches tool name with pattern (regex)', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'git push|git force-push', action: 'require_approval' },
          { tool: 'Bash', pattern: 'ls |cat |echo', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'git push origin main')).toBe('require_approval');
      expect(mod.evaluatePolicy('Bash', 'ls -la')).toBe('auto_approve');
      expect(mod.evaluatePolicy('Bash', 'rm -rf /')).toBe('block');
    });

    it('first matching rule wins', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'git push', action: 'auto_approve' },
          { tool: 'Bash', pattern: 'git', action: 'require_approval' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'git push origin main')).toBe('auto_approve');
      expect(mod.evaluatePolicy('Bash', 'git commit')).toBe('require_approval');
    });

    it('case-insensitive tool matching', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [{ tool: 'Read', action: 'auto_approve' }],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('read', '')).toBe('auto_approve');
      expect(mod.evaluatePolicy('READ', '')).toBe('auto_approve');
    });
  });

  describe('matchesBarkignore', () => {
    it('matches exact filenames', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [],
        barkignore: ['.env', 'credentials.json'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.matchesBarkignore('.env')).toBe(true);
      expect(mod.matchesBarkignore('credentials.json')).toBe(true);
      expect(mod.matchesBarkignore('package.json')).toBe(false);
    });

    it('matches glob patterns', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [],
        barkignore: ['*.pem', '*.key', '.env.*'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.matchesBarkignore('server.pem')).toBe(true);
      expect(mod.matchesBarkignore('private.key')).toBe(true);
      expect(mod.matchesBarkignore('.env.production')).toBe(true);
      expect(mod.matchesBarkignore('README.md')).toBe(false);
    });

    it('matches paths with directories', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [],
        barkignore: ['**/node_modules/**'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.matchesBarkignore('foo/node_modules/bar')).toBe(true);
      expect(mod.matchesBarkignore('src/utils.ts')).toBe(false);
    });
  });

  describe('parseApprovalReply', () => {
    it('recognizes approval words', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply('approve')).toBe('approve');
      expect(mod.parseApprovalReply('yes')).toBe('approve');
      expect(mod.parseApprovalReply('ok')).toBe('approve');
      expect(mod.parseApprovalReply('y')).toBe('approve');
      expect(mod.parseApprovalReply('proceed')).toBe('approve');
      expect(mod.parseApprovalReply('lgtm')).toBe('approve');
    });

    it('recognizes extended approval words', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply('sure')).toBe('approve');
      expect(mod.parseApprovalReply('go ahead')).toBe('approve');
      expect(mod.parseApprovalReply('sounds good')).toBe('approve');
      expect(mod.parseApprovalReply('fine')).toBe('approve');
      expect(mod.parseApprovalReply('absolutely')).toBe('approve');
      expect(mod.parseApprovalReply('yep')).toBe('approve');
      expect(mod.parseApprovalReply('yup')).toBe('approve');
    });

    it('recognizes denial words', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply('deny')).toBe('deny');
      expect(mod.parseApprovalReply('no')).toBe('deny');
      expect(mod.parseApprovalReply('reject')).toBe('deny');
      expect(mod.parseApprovalReply('stop')).toBe('deny');
      expect(mod.parseApprovalReply('cancel')).toBe('deny');
      expect(mod.parseApprovalReply('nope')).toBe('deny');
    });

    it('recognizes extended denial words', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply("don't")).toBe('deny');
      expect(mod.parseApprovalReply('nah')).toBe('deny');
      expect(mod.parseApprovalReply('negative')).toBe('deny');
      expect(mod.parseApprovalReply('block')).toBe('deny');
    });

    it('returns null for unknown text', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply('maybe')).toBe(null);
      expect(mod.parseApprovalReply('push the code')).toBe(null);
      expect(mod.parseApprovalReply('')).toBe(null);
    });

    it('is case insensitive', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply('APPROVE')).toBe('approve');
      expect(mod.parseApprovalReply('DENY')).toBe('deny');
      expect(mod.parseApprovalReply('Yes')).toBe('approve');
      expect(mod.parseApprovalReply('GO AHEAD')).toBe('approve');
      expect(mod.parseApprovalReply('ABSOLUTELY')).toBe('approve');
    });

    it('trims whitespace', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');

      expect(mod.parseApprovalReply('  yes  ')).toBe('approve');
      expect(mod.parseApprovalReply('  no  ')).toBe('deny');
    });
  });

  describe('getPolicyRulesForPrompt', () => {
    it('returns null when no rules configured', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.getPolicyRulesForPrompt()).toBe(null);
    });

    it('returns formatted prompt with all rule types', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Read', action: 'auto_approve' },
          { tool: 'Bash', pattern: 'git push', action: 'require_approval' },
          { tool: 'Bash', pattern: 'docker push', action: 'block' },
        ],
        barkignore: ['.env', '*.pem'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const prompt = mod.getPolicyRulesForPrompt();
      expect(prompt).toContain('<approval_policy');
      expect(prompt).toContain('BLOCK');
      expect(prompt).toContain('git push');
      expect(prompt).toContain('docker push');
      expect(prompt).toContain('.env');
      expect(prompt).toContain('*.pem');
    });

    it('includes two-step approval flow instructions', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'git push', action: 'require_approval' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const prompt = mod.getPolicyRulesForPrompt()!;
      expect(prompt).toContain('<require_approval>');
      expect(prompt).toContain('Propose');
      expect(prompt).toContain('Wait');
      expect(prompt).toContain('<correct_example>');
      expect(prompt).toContain('<wrong_example>');
      expect(prompt).toContain('Shall I proceed');
    });

    it('lists auto-approved operations', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Read', action: 'auto_approve' },
          { tool: 'Grep', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const prompt = mod.getPolicyRulesForPrompt()!;
      expect(prompt).toContain('<auto_approved>');
      expect(prompt).toContain('Read');
      expect(prompt).toContain('Grep');
    });

    it('includes strict language for blocked operations', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'docker push', action: 'block' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const prompt = mod.getPolicyRulesForPrompt()!;
      expect(prompt).toContain('<blocked>');
      expect(prompt).toContain('NEVER execute');
      expect(prompt).toContain('Strictly forbidden');
      expect(prompt).toContain('docker push');
    });

    it('includes protected files with access instructions', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [],
        barkignore: ['.env', '*.key'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const prompt = mod.getPolicyRulesForPrompt()!;
      expect(prompt).toContain('<protected_files>');
      expect(prompt).toContain('NEVER read, write, edit');
      expect(prompt).toContain('.env');
      expect(prompt).toContain('*.key');
    });
  });

  describe('resolveApproval', () => {
    it('delivers held output on approve', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const { deliverResponse } = await import('./execution.js');

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-approval',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'Pushed successfully',
          heldLiveMsgId: 'msg-live',
          replyToId: 'msg-reply',
          requestedAt: Date.now(),
          adapterName: 'whatsapp',
        },
      };

      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg-new'),
        edit: vi.fn().mockResolvedValue(true),
      };

      await mod.resolveApproval(agent, true, adapter);

      expect(deliverResponse).toHaveBeenCalledWith(
        adapter,
        agent,
        'Pushed successfully',
        'msg-live',
        'msg-reply',
      );
      expect(agent.approvalPending).toBe(null);
    });

    it('suppresses output on deny', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-approval',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'Pushed successfully',
          heldLiveMsgId: 'msg-live',
          replyToId: null,
          requestedAt: Date.now(),
          adapterName: 'whatsapp',
        },
      };

      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg-new'),
        edit: vi.fn().mockResolvedValue(true),
      };

      await mod.resolveApproval(agent, false, adapter);

      expect(adapter.edit).toHaveBeenCalledWith(
        'msg-live',
        expect.stringContaining('denied'),
      );
      expect(agent.approvalPending).toBe(null);
    });

    it('does nothing if no pending approval', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const agent: any = { id: 'a1', name: 'Chase', approvalPending: null };
      const adapter: any = { send: vi.fn(), edit: vi.fn() };

      await mod.resolveApproval(agent, true, adapter);

      expect(adapter.send).not.toHaveBeenCalled();
      expect(adapter.edit).not.toHaveBeenCalled();
    });

    it('writes audit log on resolve', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-approval',
          tool: 'Bash',
          args: 'git push origin main',
          action: 'require_approval',
          heldOutput: 'output',
          heldLiveMsgId: 'msg-live',
          replyToId: null,
          requestedAt: Date.now() - 5000,
          adapterName: 'telegram',
        },
      };

      const adapter: any = {
        name: 'telegram',
        send: vi.fn().mockResolvedValue('msg-new'),
        edit: vi.fn().mockResolvedValue(true),
      };

      await mod.resolveApproval(agent, true, adapter);

      expect(appendSpy).toHaveBeenCalledWith(
        expect.stringContaining('approval.log'),
        expect.stringContaining('"decision":"approved"'),
      );
      const logLine = JSON.parse(appendSpy.mock.calls[0][1] as string);
      expect(logLine.agentId).toBe('agent1');
      expect(logLine.agentName).toBe('Chase');
      expect(logLine.tool).toBe('Bash');
      expect(logLine.decision).toBe('approved');
      expect(logLine.latencyMs).toBeGreaterThanOrEqual(0);
      // args should be truncated to 500 chars inside appendAuditLog
      expect(logLine.args.length).toBeLessThanOrEqual(500);
    });
  });

  describe('requestApproval', () => {
    it('sends approval message and sets approvalPending on agent', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: null,
      };

      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg-approval-123'),
        edit: vi.fn(),
      };

      const violation = {
        tool: 'Bash',
        args: 'git push origin main',
        action: 'require_approval' as const,
        timestamp: Date.now(),
      };

      await mod.requestApproval(agent, adapter, violation, 'output text', 'live-msg-1', 'reply-to-1');

      expect(adapter.send).toHaveBeenCalledWith(
        expect.stringContaining('approval needed'),
        'reply-to-1',
      );
      expect(agent.approvalPending).not.toBeNull();
      expect(agent.approvalPending.messageId).toBe('msg-approval-123');
      expect(agent.approvalPending.tool).toBe('Bash');
      expect(agent.approvalPending.args).toBe('git push origin main');
      expect(agent.approvalPending.action).toBe('require_approval');
      expect(agent.approvalPending.heldOutput).toBe('output text');
      expect(agent.approvalPending.heldLiveMsgId).toBe('live-msg-1');
      expect(agent.approvalPending.adapterName).toBe('whatsapp');
      expect(mockSetMsgAgent).toHaveBeenCalledWith('msg-approval-123', 'agent1');
      expect(mockSaveState).toHaveBeenCalled();
      expect(mockBroadcastAgents).toHaveBeenCalled();
      expect(mockUpdatePinnedStatus).toHaveBeenCalled();
    });

    it('sends block notification for blocked violations', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const agent: any = { id: 'a1', name: 'Marshall', approvalPending: null };
      const adapter: any = {
        name: 'telegram',
        send: vi.fn().mockResolvedValue('msg-block'),
        edit: vi.fn(),
      };

      const violation = {
        tool: 'Bash',
        args: 'docker push myapp:latest',
        action: 'block' as const,
        timestamp: Date.now(),
      };

      await mod.requestApproval(agent, adapter, violation, 'output', null, null);

      expect(adapter.send).toHaveBeenCalledWith(
        expect.stringContaining('BLOCKED'),
        null,
      );
      expect(agent.approvalPending.action).toBe('block');
      expect(agent.approvalPending.adapterName).toBe('telegram');
    });

    it('does not call setMsgAgent when adapter.send returns null', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      mockSetMsgAgent.mockClear();

      const agent: any = { id: 'a1', name: 'Chase', approvalPending: null };
      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue(null),
        edit: vi.fn(),
      };

      const violation = {
        tool: 'Bash',
        args: 'git push',
        action: 'require_approval' as const,
        timestamp: Date.now(),
      };

      await mod.requestApproval(agent, adapter, violation, 'output', null, null);

      expect(mockSetMsgAgent).not.toHaveBeenCalled();
      expect(agent.approvalPending.messageId).toBe('');
    });

    it('truncates long args in approval message preview', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const agent: any = { id: 'a1', name: 'Chase', approvalPending: null };
      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg-1'),
        edit: vi.fn(),
      };

      const longArgs = 'x'.repeat(200);
      const violation = {
        tool: 'Bash',
        args: longArgs,
        action: 'require_approval' as const,
        timestamp: Date.now(),
      };

      await mod.requestApproval(agent, adapter, violation, 'output', null, null);

      const sentText = adapter.send.mock.calls[0][0] as string;
      expect(sentText).toContain('...');
      // The preview in the message should be truncated (117 chars + ...)
      expect(sentText).not.toContain(longArgs);
      // But full args are preserved in approvalPending
      expect(agent.approvalPending.args).toBe(longArgs);
    });
  });

  describe('getPolicyRulesForEnv', () => {
    it('returns serialized policy rules', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [{ tool: 'Read', action: 'auto_approve' }],
        barkignore: ['.env'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      const env = mod.getPolicyRulesForEnv();
      const parsed = JSON.parse(env);
      expect(parsed.defaultAction).toBe('block');
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.barkignore).toEqual(['.env']);
    });
  });

  describe('schema validation', () => {
    it('skips rules with missing tool field', async () => {
      const policy = {
        defaultAction: 'block',
        rules: [
          { action: 'auto_approve' },
          { tool: 'Read', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Read', '')).toBe('auto_approve');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Rule #0"));
      expect(mod.getPolicy().rules).toHaveLength(1);
    });

    it('skips rules with invalid action', async () => {
      const policy = {
        defaultAction: 'block',
        rules: [
          { tool: 'Read', action: 'invalid_action' },
          { tool: 'Write', action: 'require_approval' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Read', '')).toBe('block');
      expect(mod.evaluatePolicy('Write', '')).toBe('require_approval');
      expect(mod.getPolicy().rules).toHaveLength(1);
    });

    it('skips rules with invalid regex pattern', async () => {
      const policy = {
        defaultAction: 'block',
        rules: [
          { tool: 'Bash', pattern: '[invalid', action: 'auto_approve' },
          { tool: 'Read', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Read', '')).toBe('auto_approve');
      expect(mod.getPolicy().rules).toHaveLength(1);
    });

    it('skips non-object rules', async () => {
      const policy = {
        defaultAction: 'block',
        rules: [
          'not-an-object',
          42,
          null,
          { tool: 'Read', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.getPolicy().rules).toHaveLength(1);
      expect(mod.evaluatePolicy('Read', '')).toBe('auto_approve');
    });

    it('uses default action when defaultAction is invalid', async () => {
      const policy = {
        defaultAction: 'invalid',
        rules: [],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.getPolicy().defaultAction).toBe('block');
    });

    it('filters non-string barkignore entries', async () => {
      const policy = {
        defaultAction: 'block',
        rules: [],
        barkignore: ['.env', 42, null, '*.pem'],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.getPolicy().barkignore).toEqual(['.env', '*.pem']);
    });

    it('falls back to defaults on malformed JSON', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('{ invalid json !!!');
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.getPolicy().defaultAction).toBe('block');
      expect(mod.getPolicy().rules).toHaveLength(0);
    });

    it('handles partial JSON (missing fields)', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({}));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.getPolicy().defaultAction).toBe('block');
      expect(mod.getPolicy().rules).toHaveLength(0);
      expect(mod.getPolicy().barkignore).toEqual([]);
    });

    it('does not crash on invalid regex in compileRules', async () => {
      const policy = {
        defaultAction: 'block',
        rules: [
          { tool: 'Read', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Read', '')).toBe('auto_approve');
    });
  });

  describe('timeout behavior', () => {
    it('auto-denies when approval times out', async () => {
      vi.useFakeTimers();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      const mod = await import('./approval.js');

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-1',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'output',
          heldLiveMsgId: 'live-msg',
          replyToId: null,
          requestedAt: Date.now() - 400_000,
          adapterName: 'whatsapp',
        },
      };

      const agents = new Map([['agent1', agent]]);
      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg'),
        edit: vi.fn().mockResolvedValue(true),
      };

      mod.initApproval({
        getAgents: () => agents,
        getAdapters: () => [adapter],
      });

      // Advance timer to trigger the 15s interval
      await vi.advanceTimersByTimeAsync(16_000);

      expect(agent.approvalPending).toBe(null);
      expect(adapter.edit).toHaveBeenCalledWith(
        'live-msg',
        expect.stringContaining('denied'),
      );

      mod.stopApprovalTimers();
      vi.useRealTimers();
    });

    it('uses correct adapter for timeout based on adapterName', async () => {
      vi.useFakeTimers();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      const mod = await import('./approval.js');

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-1',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'output',
          heldLiveMsgId: 'live-msg',
          replyToId: null,
          requestedAt: Date.now() - 400_000,
          adapterName: 'telegram',
        },
      };

      const agents = new Map([['agent1', agent]]);
      const waAdapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg'),
        edit: vi.fn().mockResolvedValue(true),
      };
      const tgAdapter: any = {
        name: 'telegram',
        send: vi.fn().mockResolvedValue('msg'),
        edit: vi.fn().mockResolvedValue(true),
      };

      mod.initApproval({
        getAgents: () => agents,
        getAdapters: () => [waAdapter, tgAdapter],
      });

      await vi.advanceTimersByTimeAsync(16_000);

      // Telegram adapter should be used, not WhatsApp
      expect(tgAdapter.edit).toHaveBeenCalled();
      expect(waAdapter.edit).not.toHaveBeenCalled();

      mod.stopApprovalTimers();
      vi.useRealTimers();
    });

    it('falls back to first adapter when adapterName not found', async () => {
      vi.useFakeTimers();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      const mod = await import('./approval.js');

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-1',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'output',
          heldLiveMsgId: 'live-msg',
          replyToId: null,
          requestedAt: Date.now() - 400_000,
          adapterName: 'slack',
        },
      };

      const agents = new Map([['agent1', agent]]);
      const waAdapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg'),
        edit: vi.fn().mockResolvedValue(true),
      };

      mod.initApproval({
        getAgents: () => agents,
        getAdapters: () => [waAdapter],
      });

      await vi.advanceTimersByTimeAsync(16_000);

      // Falls back to first adapter
      expect(waAdapter.edit).toHaveBeenCalled();

      mod.stopApprovalTimers();
      vi.useRealTimers();
    });

    it('writes single timeout audit log entry (not double-logged)', async () => {
      vi.useFakeTimers();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      const mod = await import('./approval.js');

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-1',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'output',
          heldLiveMsgId: 'live-msg',
          replyToId: null,
          requestedAt: Date.now() - 400_000,
          adapterName: 'whatsapp',
        },
      };

      const agents = new Map([['agent1', agent]]);
      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg'),
        edit: vi.fn().mockResolvedValue(true),
      };

      mod.initApproval({
        getAgents: () => agents,
        getAdapters: () => [adapter],
      });

      await vi.advanceTimersByTimeAsync(16_000);

      // Exactly one audit log entry for the timeout (resolveApproval uses 'timeout' decision)
      const auditCalls = appendSpy.mock.calls.filter(
        (call) => (call[0] as string).includes('approval.log'),
      );
      expect(auditCalls).toHaveLength(1);
      const logLine = JSON.parse(auditCalls[0][1] as string);
      expect(logLine.decision).toBe('timeout');
      expect(logLine.agentName).toBe('Chase');

      mod.stopApprovalTimers();
      vi.useRealTimers();
    });

    it('does not deny before timeout expires', async () => {
      vi.useFakeTimers();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const mod = await import('./approval.js');

      const agent: any = {
        id: 'agent1',
        name: 'Chase',
        approvalPending: {
          messageId: 'msg-1',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          heldOutput: 'output',
          heldLiveMsgId: 'live-msg',
          replyToId: null,
          requestedAt: Date.now(),
          adapterName: 'whatsapp',
        },
      };

      const agents = new Map([['agent1', agent]]);
      const adapter: any = {
        name: 'whatsapp',
        send: vi.fn().mockResolvedValue('msg'),
        edit: vi.fn().mockResolvedValue(true),
      };

      mod.initApproval({
        getAgents: () => agents,
        getAdapters: () => [adapter],
      });

      await vi.advanceTimersByTimeAsync(16_000);

      // Approval should still be pending (not expired yet)
      expect(agent.approvalPending).not.toBeNull();

      mod.stopApprovalTimers();
      vi.useRealTimers();
    });
  });

  describe('audit log', () => {
    it('appendAuditLog writes JSONL entry', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      const mod = await import('./approval.js');

      mod.appendAuditLog({
        agentId: 'a1',
        agentName: 'Chase',
        tool: 'Bash',
        args: 'git push',
        action: 'require_approval',
        decision: 'approved',
        latencyMs: 1234,
      });

      expect(appendSpy).toHaveBeenCalledTimes(1);
      const written = appendSpy.mock.calls[0][1] as string;
      expect(written.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(written);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.agentId).toBe('a1');
      expect(parsed.decision).toBe('approved');
      expect(parsed.latencyMs).toBe(1234);
    });

    it('appendAuditLog truncates long args to 500 chars', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      const mod = await import('./approval.js');

      mod.appendAuditLog({
        agentId: 'a1',
        agentName: 'Chase',
        tool: 'Bash',
        args: 'x'.repeat(1000),
        action: 'require_approval',
        decision: 'approved',
      });

      const parsed = JSON.parse(appendSpy.mock.calls[0][1] as string);
      expect(parsed.args.length).toBe(500);
    });

    it('appendAuditLog does not throw on write errors', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw new Error('disk full'); });

      const mod = await import('./approval.js');

      expect(() => {
        mod.appendAuditLog({
          agentId: 'a1',
          agentName: 'Chase',
          tool: 'Bash',
          args: 'git push',
          action: 'require_approval',
          decision: 'denied',
        });
      }).not.toThrow();
    });
  });

  describe('deploy command coverage', () => {
    it('blocks bare deploy by default', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'deploy|npm run deploy|yarn deploy', action: 'require_approval' },
          { tool: 'Bash', pattern: 'npm run|yarn |npx ', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'deploy')).toBe('require_approval');
    });

    it('catches npm run deploy before the auto-approve npm run rule', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'deploy|npm run deploy|yarn deploy', action: 'require_approval' },
          { tool: 'Bash', pattern: 'npm run|yarn |npx ', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'npm run deploy')).toBe('require_approval');
      expect(mod.evaluatePolicy('Bash', 'yarn deploy')).toBe('require_approval');
    });

    it('still auto-approves non-deploy npm run commands', async () => {
      const policy = {
        defaultAction: 'block',
        approvalTimeout: 300000,
        rules: [
          { tool: 'Bash', pattern: 'deploy|npm run deploy|yarn deploy', action: 'require_approval' },
          { tool: 'Bash', pattern: 'npm run|yarn |npx ', action: 'auto_approve' },
        ],
        barkignore: [],
      };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(policy));

      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'npm run test')).toBe('auto_approve');
      expect(mod.evaluatePolicy('Bash', 'npm run build')).toBe('auto_approve');
      expect(mod.evaluatePolicy('Bash', 'yarn test')).toBe('auto_approve');
    });
  });

  describe('cross-backend: git push, rm -rf, deploy on all tool names', () => {
    const POLICY_WITH_ALL_COMMANDS = {
      defaultAction: 'block',
      approvalTimeout: 300000,
      rules: [
        { tool: 'Bash', pattern: 'docker push|kubectl apply|terraform destroy', action: 'block' },
        { tool: 'Bash', pattern: 'deploy|npm run deploy|yarn deploy', action: 'require_approval' },
        { tool: 'Bash', pattern: 'npm run|yarn ', action: 'auto_approve' },
        { tool: 'Bash', pattern: 'git push|git force-push|git reset --hard', action: 'require_approval' },
        { tool: 'Bash', pattern: 'rm -rf|rm -r|sudo', action: 'require_approval' },
      ],
      barkignore: [],
    };

    it('Claude Code (Bash) — git push requires approval', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(POLICY_WITH_ALL_COMMANDS));
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'git push origin main')).toBe('require_approval');
    });

    it('Claude Code (Bash) — rm -rf requires approval', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(POLICY_WITH_ALL_COMMANDS));
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'rm -rf /tmp/old')).toBe('require_approval');
    });

    it('Claude Code (Bash) — deploy requires approval', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(POLICY_WITH_ALL_COMMANDS));
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'npm run deploy')).toBe('require_approval');
      expect(mod.evaluatePolicy('Bash', 'deploy --prod')).toBe('require_approval');
    });

    it('kubectl apply is blocked', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(POLICY_WITH_ALL_COMMANDS));
      const mod = await import('./approval.js');
      mod.initApproval({ getAgents: () => new Map(), getAdapters: () => [] });

      expect(mod.evaluatePolicy('Bash', 'kubectl apply -f deploy.yaml')).toBe('block');
    });
  });
});
