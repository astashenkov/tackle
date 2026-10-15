import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { User } from '../shared/types';
import { config } from './config';
import { toUser, type DB } from './db';
import { HttpError, newToken, now } from './util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = 'tackle_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function isSecure(c: Context): boolean {
  if (config.secureCookies !== 'auto') return config.secureCookies === 'true';
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  return proto === 'https' || new URL(c.req.url).protocol === 'https:';
}

/** Creates a session for the user and sets the cookie. Only a hash of the token is stored. */
export function startSession(c: Context, db: DB, userId: string) {
  const token = newToken();
  const expires = now() + config.sessionDays * 86_400_000;
  db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), userId, now(), expires);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(c),
    path: '/',
    maxAge: config.sessionDays * 86_400,
  });
}

export function endSession(c: Context, db: DB) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function sessionUser(c: Context, db: DB): User | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = db.get(
    `SELECT u.*, s.expires_at AS s_expires FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.active = 1`,
    sha256(token),
  );
  if (!row) return null;
  if ((row.s_expires as number) < now()) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return null;
  }
  return toUser(row);
}

export type AppEnv = { Variables: { user: User; clientId: string } };

/** Rejects unauthenticated requests and exposes the current user as c.get('user'). */
export function requireUser(db: DB): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = sessionUser(c, db);
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in');
    c.set('user', user);
    c.set('clientId', c.req.header('x-client-id') ?? c.req.query('clientId') ?? '');
    await next();
  };
}

export function requireAdmin(c: Context<AppEnv>) {
  if (c.get('user').role !== 'admin') throw new HttpError(403, 'forbidden', 'Only workspace admins can do that');
}

/** Tiny fixed-window rate limiter for sign-in style endpoints. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  check(key: string) {
    const t = now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset < t) {
      this.hits.set(key, { count: 1, reset: t + this.windowMs });
      if (this.hits.size > 10_000) this.prune(t);
      return;
    }
    entry.count++;
    if (entry.count > this.limit) throw new HttpError(429, 'rate_limited', 'Too many attempts, please try again in a few minutes');
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.reset < t) this.hits.delete(k);
  }
}
