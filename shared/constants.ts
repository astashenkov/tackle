import type { Priority, StatusCategory } from './types';

/** Display order for priorities when sorting (urgent first, "no priority" last). */
export const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0];

export const STATUS_CATEGORIES: StatusCategory[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

/** Categories that count as "closed": tasks there are done or dropped. */
export const CLOSED_CATEGORIES: ReadonlySet<StatusCategory> = new Set(['completed', 'canceled']);

/** Story point scale offered in pickers. */
export const ESTIMATES = [1, 2, 3, 5, 8, 13];

/** Curated palette used for projects, labels, statuses and avatars. Works on light and dark backgrounds. */
export const PALETTE = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#64748b', // slate
];

export const DEFAULT_STATUSES: { name: string; category: StatusCategory; color: string }[] = [
  { name: 'Backlog', category: 'backlog', color: '#94a3b8' },
  { name: 'Todo', category: 'unstarted', color: '#94a3b8' },
  { name: 'In Progress', category: 'started', color: '#eab308' },
  { name: 'In Review', category: 'started', color: '#22c55e' },
  { name: 'Done', category: 'completed', color: '#6366f1' },
  { name: 'Canceled', category: 'canceled', color: '#94a3b8' },
];

export const DEFAULT_LABELS: { name: string; color: string }[] = [
  { name: 'Bug', color: '#ef4444' },
  { name: 'Feature', color: '#8b5cf6' },
  { name: 'Improvement', color: '#3b82f6' },
  { name: 'Design', color: '#ec4899' },
  { name: 'Tech debt', color: '#f97316' },
];

const RU_NAMES: Record<string, string> = {
  Backlog: 'Бэклог',
  Todo: 'К выполнению',
  'In Progress': 'В работе',
  'In Review': 'На ревью',
  Done: 'Готово',
  Canceled: 'Отменено',
  Bug: 'Баг',
  Feature: 'Фича',
  Improvement: 'Улучшение',
  Design: 'Дизайн',
  'Tech debt': 'Техдолг',
};

/** Default statuses and labels in the language the workspace was set up in. */
export function localizedDefaults(locale: string) {
  const tr = (name: string) => (locale === 'ru' ? (RU_NAMES[name] ?? name) : name);
  return {
    statuses: DEFAULT_STATUSES.map((s) => ({ ...s, name: tr(s.name) })),
    labels: DEFAULT_LABELS.map((l) => ({ ...l, name: tr(l.name) })),
  };
}

export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;
export const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{0,30}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** Extracts unique @handles mentioned in a markdown text (ignores code spans and e-mails). */
export function extractMentions(text: string): string[] {
  const cleaned = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const found = new Set<string>();
  const re = /(^|[^\w@.])@([a-z0-9][a-z0-9._-]{0,30})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) found.add(m[2].toLowerCase().replace(/[._-]+$/, ''));
  return [...found];
}

/** Counts markdown checklist items: "- [ ] todo" / "- [x] done". */
export function checklistProgress(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const m of text.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+/gm)) {
    total++;
    if (m[1] !== ' ') done++;
  }
  return { done, total };
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

/** Lowercase latin transliteration (Cyrillic → Latin), e.g. "Мария" → "mariya". */
export function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join('');
}

/** URL/git-friendly slug: "Fix login bug!" → "fix-login-bug". */
export function slugify(text: string, max = 40): string {
  const slug = transliterate(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '');
}
