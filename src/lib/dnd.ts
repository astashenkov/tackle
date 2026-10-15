import { useEffect, useRef } from 'preact/hooks';

/*
 * Lightweight pointer-based drag and drop for task cards and rows.
 *
 * Markup contract: draggable elements carry `data-dnd-id`, drop zones carry
 * `data-dnd-container="<key>"`. Elements marked `data-no-drag` (buttons, inputs) never start
 * a drag. Works with mouse, pen and touch (long-press), auto-scrolls near edges and shows a
 * drop indicator line. Plain clicks pass through untouched.
 */

export interface DndOptions {
  onDrop: (id: string, container: string, beforeId: string | null) => void;
  /** Return false to hide the indicator for a container (e.g. a sorted list). */
  canReorder?: (container: string) => boolean;
}

interface DragState {
  id: string;
  source: HTMLElement;
  ghost: HTMLElement;
  indicator: HTMLElement;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  target: { container: string; beforeId: string | null; el: HTMLElement } | null;
  raf: number;
}

const DRAG_THRESHOLD = 5;
const LONG_PRESS_MS = 260;
const EDGE = 48;

function scrollableParent(el: HTMLElement | null, axis: 'x' | 'y'): HTMLElement | null {
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const overflow = axis === 'y' ? style.overflowY : style.overflowX;
    const scrollable = axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
    if (scrollable && (overflow === 'auto' || overflow === 'scroll')) return el;
    el = el.parentElement;
  }
  return null;
}

export function attachDnd(root: HTMLElement, getOpts: () => DndOptions): () => void {
  let pending: { id: string; el: HTMLElement; x: number; y: number; pointerId: number; touch: boolean; timer?: number; armed: boolean } | null = null;
  let drag: DragState | null = null;

  const startDrag = (x: number, y: number) => {
    if (!pending) return;
    const { el, id } = pending;
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('dnd-ghost');
    ghost.removeAttribute('data-dnd-id');
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    document.body.appendChild(ghost);
    const indicator = document.createElement('div');
    indicator.className = 'dnd-indicator';
    document.body.appendChild(indicator);
    el.classList.add('dnd-source');
    document.body.classList.add('dnd-active');
    navigator.vibrate?.(10);
    drag = { id, source: el, ghost, indicator, offsetX: x - rect.left, offsetY: y - rect.top, x, y, target: null, raf: 0 };
    pending = null;
    update();
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const update = () => {
    if (!drag) return;
    const { x, y } = drag;
    drag.ghost.style.transform = `translate(${x - drag.offsetX - parseFloat(drag.ghost.style.left)}px, ${y - drag.offsetY - parseFloat(drag.ghost.style.top)}px) rotate(1.5deg)`;
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    const container = under?.closest<HTMLElement>('[data-dnd-container]');
    if (!container || !root.contains(container)) {
      drag.target = null;
      drag.indicator.style.display = 'none';
      root.querySelectorAll('.dnd-over').forEach((n) => n.classList.remove('dnd-over'));
      return;
    }
    const key = container.dataset.dndContainer!;
    const items = [...container.querySelectorAll<HTMLElement>('[data-dnd-id]')].filter((n) => n !== drag!.source);
    let beforeId: string | null = null;
    let lineY: number;
    let lineX: number;
    let lineW: number;
    const cRect = container.getBoundingClientRect();
    const next = items.find((n) => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (next) {
      beforeId = next.dataset.dndId!;
      const r = next.getBoundingClientRect();
      const prev = items[items.indexOf(next) - 1]?.getBoundingClientRect();
      lineY = prev ? (prev.bottom + r.top) / 2 : r.top - 3;
      lineX = r.left;
      lineW = r.width;
    } else if (items.length) {
      const r = items[items.length - 1].getBoundingClientRect();
      lineY = r.bottom + 3;
      lineX = r.left;
      lineW = r.width;
    } else {
      lineY = cRect.top + 8;
      lineX = cRect.left + 8;
      lineW = cRect.width - 16;
    }
    drag.target = { container: key, beforeId, el: container };
    root.querySelectorAll('.dnd-over').forEach((n) => n !== container && n.classList.remove('dnd-over'));
    container.classList.add('dnd-over');
    const reorder = getOpts().canReorder?.(key) ?? true;
    Object.assign(drag.indicator.style, {
      display: reorder ? 'block' : 'none',
      top: `${lineY - 1}px`,
      left: `${lineX}px`,
      width: `${lineW}px`,
    });
  };

  const autoScroll = () => {
    if (!drag) return;
    const under = document.elementFromPoint(drag.x, drag.y) as HTMLElement | null;
    const vertical = scrollableParent(under, 'y');
    const horizontal = scrollableParent(under, 'x') ?? scrollableParent(root, 'x');
    let moved = false;
    if (vertical) {
      const r = vertical.getBoundingClientRect();
      if (drag.y < r.top + EDGE) (vertical.scrollTop -= Math.ceil((r.top + EDGE - drag.y) / 4)), (moved = true);
      else if (drag.y > r.bottom - EDGE) (vertical.scrollTop += Math.ceil((drag.y - r.bottom + EDGE) / 4)), (moved = true);
    }
    if (horizontal) {
      const r = horizontal.getBoundingClientRect();
      if (drag.x < r.left + EDGE) (horizontal.scrollLeft -= Math.ceil((r.left + EDGE - drag.x) / 4)), (moved = true);
      else if (drag.x > r.right - EDGE) (horizontal.scrollLeft += Math.ceil((drag.x - r.right + EDGE) / 4)), (moved = true);
    }
    if (moved) update();
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const cleanup = () => {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.indicator.remove();
    drag.source.classList.remove('dnd-source');
    root.querySelectorAll('.dnd-over').forEach((n) => n.classList.remove('dnd-over'));
    document.body.classList.remove('dnd-active');
    drag = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag], input, textarea, button, a, select')) return;
    const el = target.closest<HTMLElement>('[data-dnd-id]');
    if (!el || !root.contains(el)) return;
    const touch = e.pointerType === 'touch';
    pending = { id: el.dataset.dndId!, el, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch, armed: !touch };
    if (touch) {
      pending.timer = window.setTimeout(() => {
        if (pending) {
          pending.armed = true;
          startDrag(pending.x, pending.y);
        }
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag) {
      e.preventDefault();
      drag.x = e.clientX;
      drag.y = e.clientY;
      update();
      return;
    }
    if (!pending || e.pointerId !== pending.pointerId) return;
    const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.touch) {
      if (dist > 8) cleanup(); // the user is scrolling, not dragging
      return;
    }
    if (dist > DRAG_THRESHOLD) startDrag(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    if (drag) {
      const { id, target } = drag;
      cleanup();
      // Swallow the click that follows a drag.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
      if (target) getOpts().onDrop(id, target.container, target.beforeId);
      return;
    }
    cleanup();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  };

  // Prevent native scrolling while a touch drag is in progress.
  const onTouchMove = (e: TouchEvent) => {
    if (drag) e.preventDefault();
  };

  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cleanup);
  window.addEventListener('keydown', onKey, true);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('contextmenu', (e) => pending?.touch && e.preventDefault());

  return () => {
    cleanup();
    root.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', cleanup);
    window.removeEventListener('keydown', onKey, true);
    root.removeEventListener('touchmove', onTouchMove);
  };
}

export function useDnd(opts: DndOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!ref.current) return;
    return attachDnd(ref.current, () => optsRef.current);
  }, []);
  return ref;
}
