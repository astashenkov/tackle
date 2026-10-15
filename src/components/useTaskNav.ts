import { useEffect } from 'preact/hooks';
import type { ID } from '../../shared/types';
import { useHotkeys } from '../lib/hotkeys';
import { tasks } from '../store/data';
import { clearSelection, focusedId, openTask, selectedIds, toggleSelected, visibleIds } from '../store/ui';
import { openTaskPanel } from './TaskPanel';

function reveal(id: ID) {
  requestAnimationFrame(() => document.querySelector(`[data-task-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}

/**
 * Keyboard navigation for a view: j/k or ↑/↓ move the cursor, ←/→ jump between board
 * columns, Enter opens, X selects, ⇧↑/⇧↓ extend the selection, ⌘A selects everything.
 */
export function useTaskNav(columns: ID[][]) {
  const flat = columns.flat();
  const key = flat.join(',');

  useEffect(() => {
    visibleIds.value = flat;
    if (focusedId.value && !flat.includes(focusedId.value)) focusedId.value = null;
  }, [key]);

  const locate = (id: ID | null) => {
    if (!id) return null;
    for (let c = 0; c < columns.length; c++) {
      const r = columns[c].indexOf(id);
      if (r >= 0) return { c, r };
    }
    return null;
  };

  const move = (dr: number, dc: number, extend = false) => {
    // While the panel is open, j/k walk through tasks and the panel follows.
    const current = openTask.value && !extend ? openTask.value.id : focusedId.value;
    const pos = locate(current);
    let next: ID | undefined;
    if (!pos) next = columns.find((c) => c.length)?.[0];
    else if (dc) {
      let c = pos.c + dc;
      while (c >= 0 && c < columns.length && !columns[c].length) c += dc;
      if (c >= 0 && c < columns.length) next = columns[c][Math.min(pos.r, columns[c].length - 1)];
    } else {
      const col = columns[pos.c];
      next = col[Math.max(0, Math.min(col.length - 1, pos.r + dr))];
    }
    if (!next) return;
    if (extend) {
      if (current) toggleSelected(current, true);
      toggleSelected(next, true);
    }
    focusedId.value = next;
    if (openTask.value && !extend) {
      const t = tasks.value[next];
      if (t) openTaskPanel(t, { replace: true });
    }
    reveal(next);
  };

  useHotkeys({
    j: () => move(1, 0),
    arrowdown: () => move(1, 0),
    k: () => move(-1, 0),
    arrowup: () => move(-1, 0),
    arrowleft: () => (columns.length > 1 ? move(0, -1) : false),
    arrowright: () => (columns.length > 1 ? move(0, 1) : false),
    'shift+arrowdown': () => move(1, 0, true),
    'shift+arrowup': () => move(-1, 0, true),
    'shift+j': () => move(1, 0, true),
    'shift+k': () => move(-1, 0, true),
    enter: () => {
      const t = focusedId.value ? tasks.value[focusedId.value] : null;
      if (!t) return false;
      openTaskPanel(t);
    },
    o: () => {
      const t = focusedId.value ? tasks.value[focusedId.value] : null;
      if (!t) return false;
      openTaskPanel(t);
    },
    x: () => {
      const id = focusedId.value ?? openTask.value?.id;
      if (!id) return false;
      toggleSelected(id);
    },
    'mod+a': () => {
      selectedIds.value = new Set(flat);
    },
    escape: () => {
      if (!selectedIds.value.size) return false;
      clearSelection();
    },
  });
}
