/**
 * Google Gemini CLI stream parser
 * Processes streaming output from `gemini --output-format stream-json`
 */

import { TOOL_ICONS, getToolIcon } from '../config/tools.js';
import type { ParsedEvent, StreamParser } from '../types/index.js';

// Gemini-specific tool name aliases (snake_case variants used by gemini CLI)
const GEMINI_ICONS: Record<string, string> = {
  list_directory: '📂', read_file: '📖', write_file: '📝', edit_file: '✏️',
  shell: '💻', run_command: '💻',
};

function toolIcon(name: string): string {
  return getToolIcon(name, GEMINI_ICONS);
}

interface GeminiStreamData {
  type?: string;
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  output?: string;
  stats?: Record<string, unknown> | null;
}

const geminiParser: StreamParser = {
  name: 'gemini',
  toolIcons: TOOL_ICONS,

  /**
   * Parse a single line of stream-json output
   */
  parseLine(line: string): ParsedEvent | null {
    if (!line.trim()) return null;

    try {
      const data: GeminiStreamData = JSON.parse(line);

      // Init message - extract session ID
      if (data.type === 'init') {
        return {
          type: 'init',
          sessionId: data.session_id,
        };
      }

      // User message (echo)
      if (data.type === 'message' && data.role === 'user') {
        return null;  // Skip user message echo
      }

      // Assistant message
      if (data.type === 'message' && data.role === 'assistant') {
        return {
          type: 'text',
          text: data.content || '',
        };
      }

      // Tool use
      if (data.type === 'tool_use') {
        const toolName = data.tool_name || 'tool';
        return {
          type: 'tool',
          name: toolName,
          icon: toolIcon(toolName),
        };
      }

      // Tool result
      if (data.type === 'tool_result') {
        return {
          type: 'result',
          text: data.output || '',
          isError: data.status !== 'success',
        };
      }

      // Final result
      if (data.type === 'result') {
        return {
          type: 'result',
          text: '',
          isError: data.status !== 'success',
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

export default geminiParser;
