import { useEffect, useRef } from 'preact/hooks';

/**
 * Global keyboard shortcuts with Linear-style sequences ("g b").
 * Shortcuts are ignored while typing in a field and while a modal layer (menu, dialog) is open;
 * the most recently mounted handler for a combo wins.
 */

type Handler = (e: KeyboardEvent) => void | false;
interface Binding {
  combo: string;
  handler: Handler;
}

const bindings: Binding[] = [];
let layers = 0;
let pendingPrefix: string | null = null;
let prefixTimer: number | undefined;

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

/** Modal layers (menus, dialogs) call this while open so page shortcuts stay quiet. */
export function pushLayer() {
  layers++;
  return () => {
    layers = Math.max(0, layers - 1);
  };
}

export const hasLayer = () => layers > 0;

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

const CODE_KEYS: Record<string, [string, string]> = {
  Slash: ['/', '?'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
};

/**
 * Letters, digits and a few symbols are read from the physical key (e.code), so shortcuts
 * keep working with non-latin keyboard layouts such as Russian.
 */
function keyOf(e: KeyboardEvent): string {
  const code = e.code ?? '';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (CODE_KEYS[code]) return CODE_KEYS[code][e.shiftKey ? 1 : 0];
  return e.key === ' ' ? 'space' : e.key.toLowerCase();
}

function comboOf(e: KeyboardEvent): string {
  const key = keyOf(e);
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Shift is implied by printable symbols like "?" — only record it for letters and named keys.
  if (e.shiftKey && (key.length > 1 || /[a-z]/.test(key))) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

function dispatch(combo: string, e: KeyboardEvent): boolean {
  for (let i = bindings.length - 1; i >= 0; i--) {
    if (bindings[i].combo === combo) {
      if (bindings[i].handler(e) !== false) return true;
    }
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || layers > 0 || e.isComposing) return;
  const combo = comboOf(e);
  const typing = isTyping(e);
  // While typing, only the command menu is global: ⌘A/⌘⌫ must keep their text-editing meaning.
  if (typing && combo !== 'mod+k') return;

  if (pendingPrefix) {
    const seq = `${pendingPrefix} ${combo}`;
    pendingPrefix = null;
    clearTimeout(prefixTimer);
    if (dispatch(seq, e)) {
      e.preventDefault();
      return;
    }
  }
  if (!typing && bindings.some((b) => b.combo.startsWith(`${combo} `))) {
    pendingPrefix = combo;
    prefixTimer = window.setTimeout(() => (pendingPrefix = null), 1200);
    e.preventDefault();
    return;
  }
  if (dispatch(combo, e)) e.preventDefault();
});

export function bind(map: Record<string, Handler>): () => void {
  const added = Object.entries(map).map(([combo, handler]) => ({ combo, handler }));
  bindings.push(...added);
  return () => {
    for (const b of added) {
      const i = bindings.indexOf(b);
      if (i >= 0) bindings.splice(i, 1);
    }
  };
}

/** Binds shortcuts while the component is mounted. Handlers always see the latest props. */
export function useHotkeys(map: Record<string, Handler>) {
  const ref = useRef(map);
  ref.current = map;
  const combos = Object.keys(map).join('|');
  useEffect(() => {
    const proxied: Record<string, Handler> = {};
    for (const combo of combos.split('|')) proxied[combo] = (e) => ref.current[combo]?.(e);
    return bind(proxied);
  }, [combos]);
}

/** Pretty label for a combo, e.g. "mod+k" → "⌘K". */
export function keyLabel(combo: string): string[] {
  return combo.split(' ').map((part) =>
    part
      .split('+')
      .map((k) => (k === 'mod' ? modKey : k === 'shift' ? '⇧' : k === 'alt' ? (isMac ? '⌥' : 'Alt') : k === 'enter' ? '↵' : k === 'escape' ? 'Esc' : k.length === 1 ? k.toUpperCase() : k))
      .join(isMac ? '' : '+'),
  );
}
