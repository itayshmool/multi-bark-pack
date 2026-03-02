/**
 * Escape a string for safe interpolation into a shell command.
 * Wraps in single quotes and escapes embedded single quotes.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
