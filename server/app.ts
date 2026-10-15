import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { requireUser, type AppEnv } from './auth';
import type { DB } from './db';
import { EventHub } from './events';
import type { Ctx } from './notify';
import { HttpError } from './util';
import { authRoutes } from './api/auth';
import { taskRoutes } from './api/tasks';
import { sprintRoutes } from './api/sprints';
import { workspaceRoutes } from './api/workspace';

export interface AppOptions {
  db: DB;
  publicDir?: string;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function createApp({ db, publicDir }: AppOptions) {
  const hub = new EventHub((send) => db.afterCommit(send));
  const ctx: Ctx = { db, hub };
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
    console.error(err);
    return c.json({ error: 'internal', message: 'Something went wrong on the server' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
  });

  // Defense in depth against CSRF on top of SameSite=Lax cookies: reject cross-origin writes.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
      if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
    }
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  authRoutes(app, ctx);

  const api = new Hono<AppEnv>();
  api.use('*', requireUser(db));

  api.get('/events', (c) => {
    const user = c.get('user');
    const clientId = c.get('clientId');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const remove = hub.add({
        userId: user.id,
        clientId,
        send: (payload) => {
          queue.push(payload);
          wake?.();
        },
      });
      stream.onAbort(() => {
        remove();
        wake?.();
      });
      await stream.writeSSE({ event: 'ready', data: '{}', retry: 3000 });
      while (!stream.aborted) {
        if (!queue.length) {
          // Wait for an event or send a heartbeat every 25s so proxies keep the connection open.
          const timedOut = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), 25_000);
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          wake = null;
          if (timedOut && !stream.aborted) await stream.write(': ping\n\n');
          continue;
        }
        const payload = queue.shift()!;
        await stream.writeSSE({ data: payload });
      }
      remove();
    });
  });

  taskRoutes(api, ctx);
  sprintRoutes(api, ctx);
  workspaceRoutes(api, ctx);
  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'Unknown API endpoint' }, 404));

  if (publicDir && fs.existsSync(path.join(publicDir, 'index.html'))) {
    const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    app.use(
      '/assets/*',
      serveStatic({
        root: publicDir,
        precompressed: true,
        onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
      }),
    );
    app.use(
      '*',
      serveStatic({
        root: publicDir,
        precompressed: true,
        // index.html is always served by the SPA handler below (no-cache + CSP).
        rewriteRequestPath: (p) => (p === '/' || p === '/index.html' ? '/__spa__' : p),
        onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=3600'),
      }),
    );
    // Single-page app: every other GET renders index.html and the client router takes over.
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache');
      c.header('Content-Security-Policy', CSP);
      return c.html(indexHtml);
    });
  }

  return { app, hub, ctx };
}
