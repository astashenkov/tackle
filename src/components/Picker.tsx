import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Plus } from 'lucide-preact';
import { openPopover, type Anchor } from './Popover';
import { t } from '../lib/i18n';

export interface PickerItem {
  id: string;
  label: string;
  icon?: ComponentChildren;
  hint?: ComponentChildren;
  keywords?: string;
  section?: string;
  danger?: boolean;
}

export interface PickerOptions {
  items: PickerItem[];
  selected?: string[];
  multi?: boolean;
  placeholder?: string;
  /** Pressing 1–9 picks the n-th item while the search box is empty. */
  numbered?: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onCreate?: { label: (query: string) => string; run: (query: string) => void };
  onClose?: () => void;
  width?: number;
  align?: 'start' | 'end';
  emptyText?: string;
  /** Extra results computed from the query (e.g. tasks in the command palette), shown after matching items. */
  search?: (query: string) => PickerItem[];
}

/** Scores an item against a query: prefix matches beat substring matches; null = no match. */
export function matchScore(text: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const token of q.split(/\s+/)) {
    const i = hay.indexOf(token);
    if (i < 0) return null;
    score += i === 0 ? 0 : hay[i - 1] === ' ' ? 1 : 3;
  }
  return score;
}

export function PickerList({ opts, close }: { opts: PickerOptions; close: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(() => new Set(opts.selected ?? []));
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const extra = opts.search?.(query) ?? [];
    if (!query.trim()) return [...opts.items, ...extra];
    const sectionOrder = new Map<string | undefined, number>();
    for (const item of opts.items) if (!sectionOrder.has(item.section)) sectionOrder.set(item.section, sectionOrder.size);
    const matched = opts.items
      .map((item) => ({ item, score: matchScore(`${item.label} ${item.keywords ?? ''}`, query) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => sectionOrder.get(a.item.section)! - sectionOrder.get(b.item.section)! || a.score! - b.score!)
      .map((x) => x.item);
    return [...matched, ...extra];
  }, [query, opts.items]);

  const showCreate = !!opts.onCreate && !!query.trim() && !opts.items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase());
  const total = items.length + (showCreate ? 1 : 0);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (index: number) => {
    if (index >= items.length) {
      if (showCreate) {
        opts.onCreate!.run(query.trim());
        if (!opts.multi) close();
        setQuery('');
      }
      return;
    }
    const item = items[index];
    if (!item) return;
    if (opts.multi) {
      const next = new Set(selected);
      const on = !next.has(item.id);
      if (on) next.add(item.id);
      else next.delete(item.id);
      setSelected(next);
      opts.onSelect(item.id, on);
    } else {
      close();
      opts.onSelect(item.id, true);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (total ? (a + 1) % total : 0));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (total ? (a - 1 + total) % total : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (opts.numbered && !query && /^Digit[0-9]$/.test(e.code) && !e.metaKey && !e.ctrlKey) {
      const n = Number(e.code.slice(5));
      const index = n === 0 ? 9 : n - 1;
      if (index < items.length) {
        e.preventDefault();
        choose(index);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  let lastSection: string | undefined;
  return (
    <div class="picker" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        class="picker-input"
        value={query}
        placeholder={opts.placeholder ?? t('common.search')}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        aria-label={opts.placeholder}
        autocomplete="off"
        spellcheck={false}
      />
      <div class="picker-list" ref={listRef} role="listbox">
        {items.map((item, i) => {
          const header = item.section && item.section !== lastSection ? item.section : null;
          lastSection = item.section;
          const isSel = selected.has(item.id);
          return (
            <Fragment key={item.id}>
              {header && <div class="picker-section">{header}</div>}
              <div
                data-index={i}
                role="option"
                aria-selected={i === active}
                class={`picker-item${i === active ? ' active' : ''}${item.danger ? ' danger' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {opts.multi && <span class={`picker-check${isSel ? ' on' : ''}`}>{isSel && <Check size={11} strokeWidth={3} />}</span>}
                {item.icon && <span class="picker-icon">{item.icon}</span>}
                <span class="picker-label">{item.label}</span>
                {item.hint && <span class="picker-hint">{item.hint}</span>}
                {!opts.multi && isSel && <Check size={14} class="picker-current" />}
                {opts.numbered && !query && i < 10 && <kbd class="picker-num">{i === 9 ? 0 : i + 1}</kbd>}
              </div>
            </Fragment>
          );
        })}
        {showCreate && (
          <div
            data-index={items.length}
            class={`picker-item${active === items.length ? ' active' : ''}`}
            onMouseMove={() => setActive(items.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(items.length)}
          >
            <span class="picker-icon">
              <Plus size={14} />
            </span>
            <span class="picker-label">{opts.onCreate!.label(query.trim())}</span>
          </div>
        )}
        {!total && <div class="picker-empty">{opts.emptyText ?? t('common.noResults')}</div>}
      </div>
    </div>
  );
}

export function openPicker(anchor: Anchor, opts: PickerOptions) {
  return openPopover(anchor, (close) => <PickerList opts={opts} close={close} />, {
    width: opts.width ?? 260,
    align: opts.align,
    onClose: opts.onClose,
  });
}
