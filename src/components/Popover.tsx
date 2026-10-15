import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pushLayer } from '../lib/hotkeys';

/*
 * A single overlay root for menus and pickers. Popovers are opened imperatively
 * (openPopover) so that both mouse clicks and keyboard shortcuts can summon them.
 */

export type Anchor = Element | DOMRect | null;

interface PopoverEntry {
  id: number;
  anchor: DOMRect | null;
  align: 'start' | 'end';
  width?: number;
  render: (close: () => void) => ComponentChildren;
  close: () => void;
  onClose?: () => void;
}

const entries = signal<PopoverEntry[]>([]);
let seq = 0;

export function openPopover(
  anchor: Anchor,
  render: (close: () => void) => ComponentChildren,
  opts: { align?: 'start' | 'end'; width?: number; onClose?: () => void } = {},
): () => void {
  const id = ++seq;
  const rect = anchor ? (anchor instanceof Element ? anchor.getBoundingClientRect() : anchor) : null;
  const restoreFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    const entry = entries.value.find((e) => e.id === id);
    if (!entry) return;
    entries.value = entries.value.filter((e) => e.id !== id);
    entry.onClose?.();
    if (restoreFocus && document.contains(restoreFocus) && restoreFocus.tagName !== 'BODY') restoreFocus.focus({ preventScroll: true });
  };
  entries.value = [...entries.value, { id, anchor: rect, align: opts.align ?? 'start', width: opts.width, render, close, onClose: opts.onClose }];
  return close;
}

export function closeAllPopovers() {
  for (const e of [...entries.value].reverse()) e.onClose?.();
  entries.value = [];
}

function PopoverBox({ entry }: { entry: PopoverEntry }) {
  const { close } = entry;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => pushLayer(), []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const a = entry.anchor;
    const update = (next: { top: number; left: number }) => {
      if (!pos || Math.abs(pos.top - next.top) > 0.5 || Math.abs(pos.left - next.left) > 0.5) setPos(next);
    };
    if (!a || vw < 560) {
      update({ top: Math.max(margin, Math.min(vh * 0.16, vh - h - margin)), left: Math.max(margin, (vw - w) / 2) });
      return;
    }
    let left = entry.align === 'end' ? a.right - w : a.left;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    let top = a.bottom + 4;
    if (top + h > vh - margin) top = a.top - h - 4 >= margin ? a.top - h - 4 : Math.max(margin, vh - h - margin);
    update({ top, left });
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    const el = ref.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class={`popover-layer${entry.anchor ? '' : ' centered'}`} onMouseDown={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div
        ref={ref}
        class="popover"
        role="dialog"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, ...(entry.width ? { width: `${entry.width}px` } : {}) }}
      >
        {entry.render(close)}
      </div>
    </div>
  );
}

export function Popovers() {
  return (
    <>
      {entries.value.map((entry) => (
        <PopoverBox key={entry.id} entry={entry} />
      ))}
    </>
  );
}
