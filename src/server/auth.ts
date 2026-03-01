/**
 * Authentication — cookie/bearer parsing, login page, auth middleware.
 */

import type { Request, Response, NextFunction, Express } from 'express';
import crypto from 'node:crypto';
import express from 'express';
import { API_SECRET } from './config.js';

/** Derive a session token from the API secret (never store raw secret in cookies). */
export function deriveSessionToken(secret: string): string {
  return crypto.createHmac('sha256', secret).update('bark-session').digest('hex');
}

const SESSION_TOKEN = API_SECRET ? deriveSessionToken(API_SECRET) : null;

/** Parse a cookie value by name from request headers. */
export function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie || '';
  const match = header
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(name + '='));
  return match ? match.substring(name.length + 1) : null;
}

/** Constant-time string comparison to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Check if a request is authenticated (cookie, bearer token, or query param). */
export function isAuthenticated(req: Request | { headers?: Record<string, string | undefined> }): boolean {
  if (!API_SECRET) return true;
  const headers = req.headers as Record<string, string | undefined>;
  const bearer = headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (bearer && safeCompare(bearer, API_SECRET)) return true;
  if (bearer && SESSION_TOKEN && safeCompare(bearer, SESSION_TOKEN)) return true;
  const cookie =
    typeof req === 'object' && headers
      ? parseCookie(req as Request, 'bark_token')
      : null;
  if (cookie && SESSION_TOKEN && safeCompare(cookie, SESSION_TOKEN)) return true;
  return false;
}

/** Register login/logout routes and auth middleware on the Express app. */
export function setupAuth(app: Express): void {
  // Login page
  app.get('/login', (req: Request, res: Response) => {
    if (!API_SECRET || isAuthenticated(req)) {
      return res.redirect('/');
    }
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>bark-pack // login</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
body { background: #05080a; color: #c9d1d9; font-family: 'JetBrains Mono', monospace; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.login-box { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 40px; width: 320px; text-align: center; }
h1 { font-size: 18px; color: #00ff41; margin: 0 0 8px 0; }
p { font-size: 12px; color: #666; margin: 0 0 24px 0; }
input { width: 100%; padding: 10px 12px; background: #0a0e12; border: 1px solid #21262d; border-radius: 4px; color: #c9d1d9; font-family: inherit; font-size: 14px; box-sizing: border-box; outline: none; }
input:focus { border-color: #00ff41; }
button { width: 100%; padding: 10px; margin-top: 16px; background: #00ff41; color: #05080a; border: none; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
button:hover { background: #00cc33; }
.error { color: #f85149; font-size: 12px; margin-top: 12px; display: none; }
</style></head><body>
<div class="login-box">
<h1>bark-pack</h1>
<p>mission control</p>
<form id="f" method="POST" action="/login">
<input type="password" name="secret" placeholder="API secret" autofocus required>
<button type="submit">unlock</button>
</form>
<div class="error" id="err">wrong secret</div>
</div>
<script>
const p = new URLSearchParams(window.location.search);
if (p.get('error')) document.getElementById('err').style.display = 'block';
</script>
</body></html>`);
  });

  // Login POST handler
  app.post(
    '/login',
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      const submitted = (req.body as Record<string, string>)?.secret;
      if (submitted && API_SECRET && safeCompare(submitted, API_SECRET)) {
        const host = req.headers.host || '';
        const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
        res.cookie('bark_token', SESSION_TOKEN!, {
          httpOnly: true,
          sameSite: 'lax',
          secure: !isLocalhost,
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        return res.redirect('/');
      }
      res.redirect('/login?error=1');
    },
  );

  // Logout
  app.get('/logout', (_req: Request, res: Response) => {
    res.clearCookie('bark_token', { path: '/' });
    res.redirect('/login');
  });

  // Protect static UI — redirect to login if not authenticated
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!API_SECRET) return next();
    if (req.path === '/login' || req.path === '/favicon.svg') return next();
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/login');
  });
}
