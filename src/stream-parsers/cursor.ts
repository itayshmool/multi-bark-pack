/**
 * Cursor Agent stream-json parser
 * Processes streaming output from `agent -p --output-format stream-json`
 */

import { TOOL_ICONS, getToolIcon } from '../config/tools.js';
import type { ParsedEvent, StreamParser } from '../types/index.js';

// Cursor-specific tool name aliases (lowercase variants used by cursor-agent)
const CURSOR_ICONS: Record<string, string> = {
  shell: '💻', read: '📖', edit: '✏️', write: '📝', grep: '🔍',
};

function toolIcon(name: string): string {
  return getToolIcon(name, CURSOR_ICONS);
}

interface ToolCall {
  shellToolCall?: unknown;
  readToolCall?: unknown;
  editToolCall?: unknown;
  writeToolCall?: unknown;
  grepToolCall?: unknown;
  globToolCall?: unknown;
  [key: string]: unknown;
}

/**
 * Extract tool name from Cursor's tool_call structure
 */
function extractToolName(toolCall: ToolCall | null | undefined): string {
  if (!toolCall) return 'tool';

  // Shell tool
  if (toolCall.shellToolCall) {
    return 'Bash';
  }

  // File read tool
  if (toolCall.readToolCall) {
    return 'Read';
  }

  // File edit tool
  if (toolCall.editToolCall) {
    return 'Edit';
  }

  // File write tool
  if (toolCall.writeToolCall) {
    return 'Write';
  }

  // Grep tool
  if (toolCall.grepToolCall) {
    return 'Grep';
  }

  // Glob tool
  if (toolCall.globToolCall) {
    return 'Glob';
  }

  // Try to extract from any *ToolCall property
  for (const key of Object.keys(toolCall)) {
    if (key.endsWith('ToolCall')) {
      const name = key.replace('ToolCall', '');
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  return 'tool';
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface CursorMessage {
  content?: ContentBlock[];
}

interface CursorStreamData {
  type?: string;
  subtype?: string;
  text?: string;
  tool_call?: ToolCall;
  message?: CursorMessage;
  result?: string;
  is_error?: boolean;
  session_id?: string;
  model?: string;
  cwd?: string;
}

const cursorParser: StreamParser = {
  name: 'cursor',
  toolIcons: TOOL_ICONS,

  /**
   * Parse a single line of stream-json output
   */
  parseLine(line: string): ParsedEvent | null {
    if (!line.trim()) return null;

    try {
      const data: CursorStreamData = JSON.parse(line);

      // Thinking delta
      if (data.type === 'thinking' && data.subtype === 'delta') {
        return {
          type: 'thinking',
          text: data.text || '',
        };
      }

      // Tool call started
      if (data.type === 'tool_call' && data.subtype === 'started') {
        const toolName = extractToolName(data.tool_call);
        return {
          type: 'tool',
          name: toolName,
          icon: toolIcon(toolName),
        };
      }

      // Assistant text message
      if (data.type === 'assistant' && data.message?.content) {
        const textContent = data.message.content.find((c: ContentBlock) => c.type === 'text');
        if (textContent?.text) {
          return {
            type: 'text',
            text: textContent.text,
          };
        }
      }

      // Final result
      if (data.type === 'result') {
        return {
          type: 'result',
          text: data.result || '',
          isError: !!data.is_error,
          sessionId: data.session_id || undefined,
        };
      }

      // System init (can extract session_id if needed)
      if (data.type === 'system' && data.subtype === 'init') {
        return {
          type: 'init',
          sessionId: data.session_id,
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

export default cursorParser;
