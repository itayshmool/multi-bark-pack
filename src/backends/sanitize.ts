/**
 * Path sanitization for backend buildCommand.
 * Validates paths before they are interpolated into shell scripts.
 */

const SHELL_META = /[;|&`$(){}\n\r\\!#<>"']/;

export function sanitizePath(p: string): string | null {
  if (!p || p.length === 0) return null;
  if (SHELL_META.test(p)) return null;
  return p;
}

const SAFE_MODEL = /^[a-zA-Z0-9._:/-]+$/;

export function sanitizeModel(m: string): string | null {
  if (!m || m.length === 0) return null;
  if (!SAFE_MODEL.test(m)) return null;
  return m;
}
