/**
 * Claude Code stream-json parser
 * Processes streaming output from `claude -p --output-format stream-json`
 */

import { TOOL_ICONS, getToolIcon } from '../config/tools.js';
import type { ParsedEvent, StreamParser } from '../types/index.js';

interface StreamEventDelta {
  type?: string;
  thinking?: string;
  text?: string;
}

interface StreamEventContentBlock {
  type?: string;
  name?: string;
}

interface StreamEvent {
  type?: string;
  delta?: StreamEventDelta;
  content_block?: StreamEventContentBlock;
}

interface ClaudeStreamData {
  type?: string;
  event?: StreamEvent;
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens: number; output_tokens: number } | null;
  total_cost_usd?: number | null;
}

const claudeParser: StreamParser = {
  name: 'claude',
  toolIcons: TOOL_ICONS,

  /**
   * Parse a single line of stream-json output
   */
  parseLine(line: string): ParsedEvent | null {
    if (!line.trim()) return null;

    try {
      const data: ClaudeStreamData = JSON.parse(line);

      // Stream events
      if (data.type === 'stream_event') {
        const event = data.event;

        // Thinking delta
        if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          return {
            type: 'thinking',
            text: event.delta.thinking,
          };
        }

        // Text delta
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          return {
            type: 'text',
            text: event.delta.text,
          };
        }

        // Tool use start
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const toolName = event.content_block.name || 'tool';
          return {
            type: 'tool',
            name: toolName,
            icon: getToolIcon(toolName),
          };
        }

        // Thinking block start
        if (event?.type === 'content_block_start' && event.content_block?.type === 'thinking') {
          return {
            type: 'thinking_start',
          };
        }
      }

      // Final result
      if (data.type === 'result') {
        return {
          type: 'result',
          text: data.result || '',
          isError: !!data.is_error,
          usage: data.usage || null,
          costUsd: data.total_cost_usd || null,
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
    return getToolIcon(name);
  },
};

export default claudeParser;
