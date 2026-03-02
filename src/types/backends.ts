export interface BackendCapabilities {
  streaming: boolean;
  sessionPersistence: boolean;
  workingDirectory: boolean;
  forceMode: boolean;
  systemPrompt: boolean;
  planning: boolean;
}

export interface BuildCommandOpts {
  promptFile: string;
  sessionId: string;
  isResume: boolean;
  model: string;
  systemPromptFile?: string;
  streamParserScript: string;
  agentId: string;
  tmpDir: string;
  mcpConfigFile?: string | null;
  cwd?: string | null;
}

export interface BuildCommandResult {
  script: string;
  env: Record<string, string>;
}

export interface Backend {
  name: string;
  displayName: string;
  models: string[];
  defaultModel: string;
  canResume: boolean;
  streamParserName: string;
  capabilities: BackendCapabilities;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  validateModel(model: string): boolean;
  generateSessionId(): string;
  buildCommand(opts: BuildCommandOpts): BuildCommandResult;
  extractSessionId(output: string): string | null;
}

