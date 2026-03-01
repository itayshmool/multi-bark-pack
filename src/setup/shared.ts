/**
 * Shared setup utilities
 * Reduces duplication across setup modules
 */

export const SETUP_EXEC_OPTS = { encoding: 'utf8' as const, timeout: 10000 };
export const HOMEBREW_PATH = `/opt/homebrew/bin:${process.env.PATH}`;
export const SETUP_SPAWN_ENV = { ...process.env, PATH: HOMEBREW_PATH };
