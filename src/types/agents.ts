import type { ApprovalRequest } from './approval.js';

export type AgentStatus = 'active' | 'deleted';

export type AgentSource = 'whatsapp' | 'telegram' | 'slack' | 'ui' | 'delegation';

export interface Agent {
  id: string;
  name: string;
  backend: string;
  model: string;
  sessionId: string;
  tmuxSession: string;
  status: AgentStatus;
  cwd: string | null;
  skills: string[];
  hasRun: boolean;
  parentId: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  source: AgentSource;
  packId?: string;
  fallbackContext?: string | null;
  approvalPending?: ApprovalRequest | null;
}

export interface AgentClassification {
  priority: number;
  emoji: string;
  status: 'run' | 'idle' | 'yelp' | 'nap';
  agent: Agent;
}
