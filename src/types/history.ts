export interface HistoryFile {
  filename: string;
  filepath: string;
  type: string;
}

export interface HistoryTurn {
  id: number;
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
  files?: HistoryFile[];
  tools?: string[];
  filesModified?: string[];
  exitCode?: number;
}

export interface HistorySummary {
  text: string;
  updatedAt: string;
  turnsCovered: number;
}

export interface AgentHistory {
  version: number;
  agentId: string;
  backend: string;
  created: string;
  summary: HistorySummary | null;
  turns: HistoryTurn[];
  totalTurns: number;
  lastError: HistoryError | null;
  cwd: string | null;
}

export interface HistoryError {
  type: string;
  message: string;
  timestamp: string;
}

export interface AddAssistantTurnResult {
  history: AgentHistory;
  needsSummary: boolean;
}

export interface AddAssistantTurnOptions {
  tools?: string[];
  filesModified?: string[];
  exitCode?: number;
}

export interface ContextPromptOptions {
  maxRecentTurns?: number;
}
