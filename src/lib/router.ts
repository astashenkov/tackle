import { signal } from '@preact/signals';

export interface Location {
  path: string;
  search: string;
}

const read = (): Location => ({ path: window.location.pathname, search: window.location.search });

export const route = signal<Location>(read());

window.addEventListener('popstate', () => {
  route.value = read();
});

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = new URL(to, window.location.origin);
  const current = window.location.pathname + window.location.search;
  if (url.pathname + url.search === current) return;
  if (opts.replace) history.replaceState(null, '', url.pathname + url.search);
  else history.pushState(null, '', url.pathname + url.search);
  route.value = read();
}

/** Updates (or removes, with null) query parameters on the current path. */
export function setQuery(params: Record<string, string | null>, opts: { replace?: boolean } = {}) {
  const sp = new URLSearchParams(route.value.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString();
  navigate(route.value.path + (qs ? `?${qs}` : ''), opts);
}

export type Route =
  | { name: 'home' }
  | { name: 'login' }
  | { name: 'setup' }
  | { name: 'join'; token: string }
  | { name: 'reset'; token: string }
  | { name: 'my' }
  | { name: 'inbox' }
  | { name: 'project'; key: string; view: 'board' | 'list' | 'sprints' }
  | { name: 'task'; ref: string }
  | { name: 'settings'; tab: string }
  | { name: 'notfound' };

export function matchRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  if (!a) return { name: 'home' };
  if (a === 'login' && !b) return { name: 'login' };
  if (a === 'setup' && !b) return { name: 'setup' };
  if (a === 'join' && b) return { name: 'join', token: b };
  if (a === 'reset' && b) return { name: 'reset', token: b };
  if (a === 'my' && !b) return { name: 'my' };
  if (a === 'inbox' && !b) return { name: 'inbox' };
  if (a === 't' && b) return { name: 'task', ref: b.toUpperCase() };
  if (a === 'settings') return { name: 'settings', tab: b ?? 'profile' };
  if (a === 'p' && b) {
    const view = c ?? 'board';
    if (view === 'board' || view === 'list' || view === 'sprints') return { name: 'project', key: b.toUpperCase(), view };
  }
  return { name: 'notfound' };
}

/** Intercepts clicks on same-origin <a href> so links navigate without a page reload. */
export function interceptLinks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
    e.preventDefault();
    navigate(href);
  });
}
