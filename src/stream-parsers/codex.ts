/**
 * OpenAI Codex CLI stream parser
 * Processes streaming output from `codex exec --json`
 */

import { TOOL_ICONS, getToolIcon } from '../config/tools.js';
import type { ParsedEvent, StreamParser } from '../types/index.js';

// Codex-specific tool name aliases
const CODEX_ICONS: Record<string, string> = {
  command_execution: '💻', shell: '💻',
};

function toolIcon(name: string): string {
  return getToolIcon(name, CODEX_ICONS);
}

interface CodexItem {
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
}

interface CodexStreamData {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens: number; output_tokens: number } | null;
}

const codexParser: StreamParser = {
  name: 'codex',
  toolIcons: TOOL_ICONS,

  /**
   * Parse a single line of JSON output
   */
  parseLine(line: string): ParsedEvent | null {
    if (!line.trim()) return null;

    try {
      const data: CodexStreamData = JSON.parse(line);

      // Thread started - extract session ID
      if (data.type === 'thread.started') {
        return {
          type: 'init',
          sessionId: data.thread_id,
        };
      }

      // Item completed
      if (data.type === 'item.completed' && data.item) {
        const item = data.item;

        // Reasoning/thinking
        if (item.type === 'reasoning') {
          return {
            type: 'thinking',
            text: item.text || '',
          };
        }

        // Agent message (response)
        if (item.type === 'agent_message') {
          return {
            type: 'text',
            text: item.text || '',
          };
        }

        // Command execution (tool use)
        if (item.type === 'command_execution') {
          return {
            type: 'tool',
            name: 'Bash',
            icon: '💻',
          };
        }
      }

      // Item started (tool in progress)
      if (data.type === 'item.started' && data.item) {
        const item = data.item;

        if (item.type === 'command_execution') {
          return {
            type: 'tool',
            name: 'Bash',
            icon: '💻',
          };
        }
      }

      // Turn completed (final result)
      if (data.type === 'turn.completed') {
        return {
          type: 'result',
          text: '',  // Codex doesn't include final text in turn.completed
          isError: false,
          usage: data.usage || null,
        };
      }

      return null;
    } catch (_e) {
      return null;
    }
  },

  /**
   * Get icon for a tool name
   */
  getToolIcon(name: string): string {
    return toolIcon(name);
  },
};

export default codexParser;
