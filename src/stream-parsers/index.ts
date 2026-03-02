/**
 * Stream Parser Registry
 * Each parser handles output from a specific backend's CLI
 */

import claudeParser from './claude.js';
import cursorParser from './cursor.js';
import codexParser from './codex.js';
import geminiParser from './gemini.js';
import type { StreamParser } from '../types/index.js';

const parsers: Record<string, StreamParser> = {
  claude: claudeParser,
  cursor: cursorParser,
  codex: codexParser,
  gemini: geminiParser,
};

/**
 * Get a parser by name
 */
export function get(name: string): StreamParser | null {
  return parsers[name] || null;
}

/**
 * List all available parsers
 */
export function list(): string[] {
  return Object.keys(parsers);
}

/**
 * Register a new parser
 */
export function register(name: string, parser: StreamParser): void {
  parsers[name] = parser;
}
