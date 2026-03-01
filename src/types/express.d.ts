/**
 * Minimal Express 5 type declarations for multi-bark-pack.
 * Covers only the API surface used in this project.
 * Remove this file if @types/express v5+ is installed and working.
 */

declare module 'express' {
  import type { Server, IncomingMessage, ServerResponse } from 'node:http';

  interface Request {
    headers: Record<string, string | string[] | undefined> & {
      cookie?: string;
      authorization?: string;
      host?: string;
    };
    params: Record<string, string>;
    query: Record<string, string | string[] | undefined>;
    body: unknown;
    path: string;
    url: string;
    method: string;
  }

  interface CookieOptions {
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none' | boolean;
    path?: string;
    maxAge?: number;
    secure?: boolean;
    domain?: string;
  }

  interface Response {
    json(body: unknown): void;
    send(body: string | Buffer): void;
    sendFile(path: string): void;
    status(code: number): Response;
    redirect(url: string): void;
    redirect(status: number, url: string): void;
    cookie(name: string, value: string, options?: CookieOptions): Response;
    clearCookie(name: string, options?: CookieOptions): Response;
  }

  type NextFunction = (err?: unknown) => void;

  type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

  // Express app is both an object with route methods AND a request handler function.
  // This allows http.createServer(app) to work.
  interface Express {
    (req: IncomingMessage, res: ServerResponse): void;
    use(handler: RequestHandler): Express;
    use(path: string, handler: RequestHandler): Express;
    use(handler: (req: Request, res: Response, next: NextFunction) => void): Express;
    get(path: string, ...handlers: RequestHandler[]): Express;
    post(path: string, ...handlers: RequestHandler[]): Express;
    put(path: string, ...handlers: RequestHandler[]): Express;
    delete(path: string, ...handlers: RequestHandler[]): Express;
    patch(path: string, ...handlers: RequestHandler[]): Express;
    listen(port: number, callback?: () => void): Server;
  }

  interface ExpressStatic {
    (): Express;
    json(options?: { limit?: string }): RequestHandler;
    urlencoded(options?: { extended?: boolean }): RequestHandler;
    static(root: string, options?: Record<string, unknown>): RequestHandler;
  }

  const express: ExpressStatic;
  export default express;
  export type { Request, Response, NextFunction, Express };
}
