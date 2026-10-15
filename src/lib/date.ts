import { lang } from './i18n';

const DAY = 86_400_000;

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / DAY);
}

export function formatDate(iso: string, opts: { withYear?: boolean } = {}): string {
  const d = parseIso(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(lang.value, {
    month: 'short',
    day: 'numeric',
    ...(opts.withYear || !sameYear ? { year: 'numeric' } : {}),
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(lang.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto', style: 'short' });
  if (abs < 45_000) return rtf.format(0, 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  return formatDate(isoDate(new Date(ms)));
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

export function dueState(iso: string): DueState {
  const days = daysBetween(isoDate(), iso);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}

/** Short human label for a due date: "Today", "Tomorrow", "Mon", "Oct 21". */
export function dueLabel(iso: string): string {
  const days = daysBetween(isoDate(), iso);
  const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto' });
  if (days >= -1 && days <= 1) {
    const s = rtf.format(days, 'day');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (days > 1 && days < 7) {
    const s = parseIso(iso).toLocaleDateString(lang.value, { weekday: 'short' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return formatDate(iso);
}

/** Next Monday (or today + 7 if today is Monday). */
export function nextWeek(): string {
  const d = new Date();
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  return isoDate(d);
}

export function endOfDay(iso: string): number {
  const d = parseIso(iso);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
