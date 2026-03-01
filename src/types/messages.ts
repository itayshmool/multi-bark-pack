export interface ParsedEvent {
  type: 'thinking' | 'thinking_start' | 'text' | 'tool' | 'result' | 'init';
  text?: string;
  name?: string;
  icon?: string;
  isError?: boolean;
  usage?: { input_tokens: number; output_tokens: number } | null;
  costUsd?: number | null;
  sessionId?: string;
}

export interface StreamParser {
  name: string;
  toolIcons: Record<string, string>;
  parseLine(line: string): ParsedEvent | null;
  getToolIcon(name: string): string;
}
