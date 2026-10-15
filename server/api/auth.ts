import type { Context, Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { localizedDefaults, PALETTE, PROJECT_KEY_RE } from '../../shared/constants';
import { endSession, hashPassword, RateLimiter, sessionUser, startSession, verifyPassword } from '../auth';
import { config } from '../config';
import { toUser } from '../db';
import type { Ctx } from '../notify';
import { handleBase, nextUserColor, uniqueHandle } from '../users';
import { asBody, badRequest, email, HttpError, newId, now, password, str } from '../util';
import { workspaceInfo } from './workspace';

const loginLimiter = new RateLimiter(10, 15 * 60_000);

/** The caller's IP. Forwarded headers are only trusted behind a proxy, otherwise anyone could spoof them. */
function clientIp(c: Context): string {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'local'; // in-process requests (tests) have no socket
  }
}

export function seedWorkspaceDefaults(ctx: Ctx, locale = 'en') {
  const { db } = ctx;
  const defaults = localizedDefaults(locale);
  defaults.statuses.forEach((s, i) =>
    db.run('INSERT INTO statuses (id, name, category, color, position) VALUES (?, ?, ?, ?, ?)', newId(), s.name, s.category, s.color, i + 1),
  );
  for (const l of defaults.labels) db.run('INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)', newId(), l.name, l.color, now());
}

export async function createUser(ctx: Ctx, input: { name: string; email: string; password: string; role: 'admin' | 'member' }) {
  const { db } = ctx;
  if (db.get('SELECT 1 FROM users WHERE email = ?', input.email)) throw badRequest('An account with this email already exists', 'conflict');
  const userId = newId();
  const hash = await hashPassword(input.password);
  db.run(
    'INSERT INTO users (id, email, name, handle, password_hash, role, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId,
    input.email,
    input.name,
    uniqueHandle(db, handleBase(input.name, input.email)),
    hash,
    input.role,
    nextUserColor(db),
    now(),
  );
  return toUser(db.get('SELECT * FROM users WHERE id = ?', userId)!);
}

function validInvite(ctx: Ctx, token: string, kind: 'invite' | 'reset') {
  const row = ctx.db.get('SELECT * FROM invites WHERE token = ? AND kind = ?', token, kind);
  if (!row || (row.expires_at as number) < now()) throw new HttpError(404, 'invalid_invite', 'This link is invalid or has expired');
  return row;
}

export function authRoutes(app: Hono, ctx: Ctx) {
  const { db, hub } = ctx;

  /** Tells the client whether the workspace still needs its first-run setup and who is signed in. */
  app.get('/api/state', (c) => {
    const { n } = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!;
    return c.json({ needsSetup: n === 0, user: n ? sessionUser(c, db) : null, workspace: workspaceInfo(ctx) });
  });

  app.post('/api/setup', async (c) => {
    const b = asBody(await c.req.json());
    const workspaceName = str(b.workspaceName, 'Workspace name', { min: 1, max: 60 });
    const name = str(b.name, 'Name', { min: 1, max: 60 });
    const mail = email(b.email);
    const pass = password(b.password);
    const projectName = str(b.projectName, 'Project name', { min: 1, max: 60 });
    const key = str(b.projectKey, 'Project key', { min: 2, max: 6 }).toUpperCase();
    if (!PROJECT_KEY_RE.test(key)) throw badRequest('Key must be 2–6 latin letters or digits and start with a letter');
    const hash = await hashPassword(pass);

    const user = db.tx(() => {
      const { n } = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!;
      if (n > 0) throw new HttpError(409, 'already_setup', 'This workspace is already set up');
      db.setMeta('workspace_name', workspaceName);
      seedWorkspaceDefaults(ctx, b.locale === 'ru' ? 'ru' : 'en');
      db.run(
        'INSERT INTO projects (id, key, name, description, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId(),
        key,
        projectName,
        '',
        PALETTE[0],
        1,
        now(),
      );
      const userId = newId();
      db.run(
        "INSERT INTO users (id, email, name, handle, password_hash, role, color, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)",
        userId,
        mail,
        name,
        uniqueHandle(db, handleBase(name, mail)),
        hash,
        PALETTE[1],
        now(),
      );
      return toUser(db.get('SELECT * FROM users WHERE id = ?', userId)!);
    });
    startSession(c, db, user.id);
    return c.json(user, 201);
  });

  app.post('/api/login', async (c) => {
    const b = asBody(await c.req.json());
    const mail = email(b.email);
    loginLimiter.check(`${clientIp(c)}:${mail}`);
    const row = db.get('SELECT * FROM users WHERE email = ?', mail);
    const ok = row && (await verifyPassword(typeof b.password === 'string' ? b.password : '', row.password_hash as string));
    if (!row || !ok) throw new HttpError(401, 'bad_credentials', 'Wrong email or password');
    if (!row.active) throw new HttpError(403, 'deactivated', 'Your account has been deactivated. Ask a workspace admin to restore it');
    startSession(c, db, row.id as string);
    return c.json(toUser(row));
  });

  app.post('/api/logout', (c) => {
    endSession(c, db);
    return c.json({ ok: true });
  });

  app.get('/api/invites/:token', (c) => {
    const row = validInvite(ctx, c.req.param('token'), 'invite');
    return c.json({ workspace: workspaceInfo(ctx), role: row.role });
  });

  app.post('/api/join', async (c) => {
    const b = asBody(await c.req.json());
    loginLimiter.check(`${clientIp(c)}:join`);
    const token = str(b.token, 'token', { min: 1, max: 100 });
    const input = { name: str(b.name, 'Name', { min: 1, max: 60 }), email: email(b.email), password: password(b.password) };
    const invite = validInvite(ctx, token, 'invite');
    const user = await createUser(ctx, { ...input, role: invite.role as 'admin' | 'member' });
    db.run('DELETE FROM invites WHERE token = ?', token);
    hub.broadcast({ type: 'user.upsert', data: user });
    startSession(c, db, user.id);
    return c.json(user, 201);
  });

  app.get('/api/reset/:token', (c) => {
    const row = validInvite(ctx, c.req.param('token'), 'reset');
    const user = db.get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', row.user_id);
    return c.json({ workspace: workspaceInfo(ctx), name: user?.name, email: user?.email });
  });

  app.post('/api/reset', async (c) => {
    const b = asBody(await c.req.json());
    const token = str(b.token, 'token', { min: 1, max: 100 });
    const pass = password(b.password);
    const invite = validInvite(ctx, token, 'reset');
    const hash = await hashPassword(pass);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, invite.user_id);
      db.run('DELETE FROM sessions WHERE user_id = ?', invite.user_id);
      db.run('DELETE FROM invites WHERE token = ?', token);
    });
    startSession(c, db, invite.user_id as string);
    return c.json(toUser(db.get('SELECT * FROM users WHERE id = ?', invite.user_id)!));
  });
}
