import { PALETTE, transliterate } from '../shared/constants';
import type { DB } from './db';

/** Turns "Мария Иванова" into "mariya"-style handle candidates. */
export function handleBase(name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const cleaned = transliterate(first).normalize('NFKD').replace(/[^a-z0-9]/g, '');
  if (cleaned) return cleaned.slice(0, 24);
  return email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user';
}

export function uniqueHandle(db: DB, base: string, exceptUserId?: string): string {
  let candidate = base;
  for (let i = 2; ; i++) {
    const taken = db.get('SELECT id FROM users WHERE handle = ? AND id != ?', candidate, exceptUserId ?? '');
    if (!taken) return candidate;
    candidate = `${base}${i}`;
  }
}

export function nextUserColor(db: DB): string {
  const { n } = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!;
  return PALETTE[(n * 5) % PALETTE.length];
}
