import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db';

/**
 * Writes a consistent copy of the database with VACUUM INTO. Safe while the server is
 * running (WAL mode); the copy is compact and has no -wal/-shm side files.
 */
export function backupDatabase(db: DB, target: string): string {
  const file = path.resolve(target);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db.run('VACUUM INTO ?', file);
  return file;
}

export function defaultBackupPath(databasePath: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return path.join(path.dirname(databasePath), 'backups', `tackle-${stamp}.db`);
}
