export interface OwnerIds {
  whatsapp: Set<string> | 'DANGER-ALL' | null;
  telegram: Set<string> | 'DANGER-ALL' | null;
  slack: Set<string> | 'DANGER-ALL' | null;
}

export interface ServerConfig {
  groupName: string;
  telegramToken: string | null;
  telegramChatId: string | null;
  slackBotToken: string | null;
  slackAppToken: string | null;
  waEnabled: boolean;
  ownerIds: OwnerIds;
  whisperModel: string;
  defaultBackend: string;
  enabledBackends: string[];
  uiPort: number;
  apiSecret: string | null;
  shellPath: string;
  agentTimeout: number;
  maxDelegationDepth: number;
  maxSubAgents: number;
}

export interface ExecOpts {
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  encoding?: BufferEncoding;
  timeout?: number;
}
