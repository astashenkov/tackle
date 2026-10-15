import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  /** Path to the SQLite database file. */
  databasePath: env.DATABASE_PATH ?? path.resolve(env.DATA_DIR ?? 'data', 'tackle.db'),
  /** Directory with the built client (index.html + assets). */
  publicDir: env.PUBLIC_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public'),
  /**
   * Mark the session cookie as Secure. Defaults to "auto": secure when the request
   * arrived over HTTPS (directly or via X-Forwarded-Proto from a reverse proxy).
   */
  secureCookies: (env.SECURE_COOKIES ?? 'auto') as 'auto' | 'true' | 'false',
  sessionDays: Number(env.SESSION_DAYS ?? 30),
};
