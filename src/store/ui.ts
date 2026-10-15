import { computed, effect, signal } from '@preact/signals';
import type { ID } from '../../shared/types';
import { findTaskByRef } from './data';
import { route } from '../lib/router';

/* -------------------------------- persistence -------------------------------- */

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`tackle:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`tackle:${key}`, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

/* ----------------------------------- theme ----------------------------------- */

export type Theme = 'system' | 'light' | 'dark';
export const theme = signal<Theme>(load('theme', 'system'));
effect(() => {
  save('theme', theme.value);
  const root = document.documentElement;
  if (theme.value === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme.value);
});

export const sidebarOpen = signal(false); // mobile drawer
export const sidebarCollapsed = signal<Record<string, boolean>>(load('sidebarCollapsed', {}));
effect(() => save('sidebarCollapsed', sidebarCollapsed.value));

/* ---------------------------- open task & selection ---------------------------- */

/** The task shown in the side panel, taken from the `?task=WEB-12` query parameter. */
export const openTaskRef = computed(() => new URLSearchParams(route.value.search).get('task'));
export const openTask = computed(() => (openTaskRef.value ? findTaskByRef(openTaskRef.value) : undefined));

/** Ordered task ids of the view currently on screen (used for j/k navigation). */
export const visibleIds = signal<ID[]>([]);
/** Keyboard cursor / hover target. */
export const focusedId = signal<ID | null>(null);
export const selectedIds = signal<ReadonlySet<ID>>(new Set());

export function toggleSelected(id: ID, on?: boolean) {
  const next = new Set(selectedIds.value);
  const want = on ?? !next.has(id);
  if (want) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
}

export function clearSelection() {
  if (selectedIds.value.size) selectedIds.value = new Set();
}

/** Tasks that keyboard shortcuts and the command palette act on. */
export function targetIds(): ID[] {
  if (selectedIds.value.size) return [...selectedIds.value];
  if (openTask.value) return [openTask.value.id];
  if (focusedId.value) return [focusedId.value];
  return [];
}

/** Create-task dialog state; `defaults` pre-fills fields (e.g. the column it was opened from). */
export const createDialog = signal<null | { defaults: Partial<import('../../shared/types').Task> }>(null);
export const paletteOpen = signal(false);
export const shortcutsOpen = signal(false);
