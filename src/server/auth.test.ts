import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  API_SECRET: 'my-secret-token',
}));

import { isAuthenticated, deriveSessionToken, parseCookie } from './auth.js';

describe('auth', () => {
  describe('deriveSessionToken', () => {
    it('returns a hex string', () => {
      const token = deriveSessionToken('my-secret');
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic', () => {
      const t1 = deriveSessionToken('my-secret');
      const t2 = deriveSessionToken('my-secret');
      expect(t1).toBe(t2);
    });

    it('differs from the raw secret', () => {
      const token = deriveSessionToken('my-secret');
      expect(token).not.toBe('my-secret');
    });

    it('produces different tokens for different secrets', () => {
      const t1 = deriveSessionToken('secret-a');
      const t2 = deriveSessionToken('secret-b');
      expect(t1).not.toBe(t2);
    });
  });

  describe('isAuthenticated', () => {
    it('accepts valid bearer token (derived)', () => {
      const token = deriveSessionToken('my-secret-token');
      const req = { headers: { authorization: `Bearer ${token}` } };
      expect(isAuthenticated(req as any)).toBe(true);
    });

    it('still accepts raw API_SECRET as bearer for backward compat', () => {
      const req = { headers: { authorization: 'Bearer my-secret-token' } };
      expect(isAuthenticated(req as any)).toBe(true);
    });

    it('rejects invalid bearer', () => {
      const req = { headers: { authorization: 'Bearer wrong' } };
      expect(isAuthenticated(req as any)).toBe(false);
    });
  });
});
