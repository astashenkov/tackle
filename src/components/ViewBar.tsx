import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { CircleDot, Filter, SignalHigh, SlidersHorizontal, Tag, Timer, User as UserIcon, X, Search, UserMinus, CircleSlash } from 'lucide-preact';
import { PRIORITY_ORDER } from '../../shared/constants';
import type { ID, Priority } from '../../shared/types';
import { useHotkeys } from '../lib/hotkeys';
import { t, priorityName } from '../lib/i18n';
import { activeFilterCount, emptyFilters, type CompletedMode, type Display, type Filters, type GroupBy, type OrderBy } from '../lib/view';
import { labelList, labels, me, projectSprints, sprints, statusList, statuses, userList, users } from '../store/data';
import { load, save } from '../store/ui';
import { Avatar } from './Avatar';
import { PriorityIcon, StatusIcon } from './Icons';
import { openPicker, type PickerItem } from './Picker';
import { openPopover } from './Popover';

export interface ViewState {
  filters: Filters;
  display: Display;
}

/** View settings (filters + display options) remembered per view in localStorage. */
export function useViewState(key: string, defaults: Display): [ViewState, (patch: Partial<ViewState>) => void] {
  const [state, setState] = useState<ViewState>(() => {
    const stored = load<Partial<ViewState>>(`view:${key}`, {});
    return { filters: { ...emptyFilters(), ...stored.filters, q: '' }, display: { ...defaults, ...stored.display } };
  });
  useEffect(() => {
    const stored = load<Partial<ViewState>>(`view:${key}`, {});
    setState({ filters: { ...emptyFilters(), ...stored.filters, q: '' }, display: { ...defaults, ...stored.display } });
  }, [key]);
  const update = (patch: Partial<ViewState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      save(`view:${key}`, { filters: { ...next.filters, q: '' }, display: next.display });
      return next;
    });
  };
  return [state, update];
}

type FilterField = 'statuses' | 'assignees' | 'priorities' | 'labels' | 'sprints';

function fieldItems(field: FilterField, projectId?: ID): PickerItem[] {
  switch (field) {
    case 'statuses':
      return statusList.value.map((s) => ({ id: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} /> }));
    case 'assignees':
      return [
        { id: 'none', label: t('common.noAssignee'), icon: <UserMinus size={14} /> },
        ...userList.value.map((u) => ({ id: u.id, label: u.id === me.value?.id ? `${u.name} (${t('common.you')})` : u.name, icon: <Avatar user={u} size={16} />, keywords: u.handle })),
      ];
    case 'priorities':
      return PRIORITY_ORDER.map((p) => ({ id: String(p), label: priorityName(p), icon: <PriorityIcon priority={p} /> }));
    case 'labels':
      return labelList.value.map((l) => ({ id: l.id, label: l.name, icon: <span class="label-dot" style={{ background: l.color }} /> }));
    case 'sprints':
      return [
        { id: 'active', label: t('filter.activeSprint'), icon: <span class="sprint-dot active" /> },
        { id: 'none', label: t('filter.noSprint'), icon: <CircleSlash size={14} /> },
        ...(projectId ? projectSprints(projectId) : Object.values(sprints.value)).map((s) => ({ id: s.id, label: s.name, icon: <span class={`sprint-dot ${s.state}`} /> })),
      ];
  }
}

function fieldMeta(field: FilterField): { label: string; icon: ComponentChildren } {
  return {
    statuses: { label: t('prop.status'), icon: <CircleDot size={14} /> },
    assignees: { label: t('prop.assignee'), icon: <UserIcon size={14} /> },
    priorities: { label: t('prop.priority'), icon: <SignalHigh size={14} /> },
    labels: { label: t('prop.labels'), icon: <Tag size={14} /> },
    sprints: { label: t('prop.sprint'), icon: <Timer size={14} /> },
  }[field];
}

function valueLabel(field: FilterField, id: string): string {
  switch (field) {
    case 'statuses':
      return statuses.value[id]?.name ?? '?';
    case 'assignees':
      return id === 'none' ? t('common.noAssignee') : (users.value[id]?.name.split(' ')[0] ?? '?');
    case 'priorities':
      return priorityName(Number(id) as Priority);
    case 'labels':
      return labels.value[id]?.name ?? '?';
    case 'sprints':
      return id === 'active' ? t('filter.activeSprint') : id === 'none' ? t('filter.noSprint') : (sprints.value[id]?.name ?? '?');
  }
}

export function ViewBar({
  state,
  update,
  projectId,
  groupOptions,
  hideGrouping = false,
  fields = ['statuses', 'assignees', 'priorities', 'labels', 'sprints'],
  children,
}: {
  state: ViewState;
  update: (patch: Partial<ViewState>) => void;
  projectId?: ID;
  groupOptions: GroupBy[];
  hideGrouping?: boolean;
  fields?: FilterField[];
  children?: ComponentChildren;
}) {
  const { filters } = state;
  const searchRef = useRef<HTMLInputElement>(null);
  const setFilter = (field: FilterField, values: string[]) =>
    update({ filters: { ...filters, [field]: field === 'priorities' ? values.map(Number) : values } as Filters });

  useHotkeys({
    '/': () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });

  const editField = (anchor: Element | null, field: FilterField) => {
    let current = (filters[field] as (string | number)[]).map(String);
    openPicker(anchor, {
      multi: true,
      placeholder: fieldMeta(field).label,
      selected: current,
      items: fieldItems(field, projectId),
      onSelect: (id, on) => {
        current = on ? [...current, id] : current.filter((x) => x !== id);
        setFilter(field, current);
      },
    });
  };

  const addFilter = (anchor: Element) => {
    openPicker(anchor, {
      placeholder: t('filter.add'),
      width: 220,
      items: fields.map((f) => ({ id: f, label: fieldMeta(f).label, icon: fieldMeta(f).icon })),
      onSelect: (f) => setTimeout(() => editField(anchor, f as FilterField), 0),
    });
  };

  const openDisplay = (anchor: Element) => {
    openPopover(anchor, () => <DisplayMenu state={state} update={update} groupOptions={groupOptions} hideGrouping={hideGrouping} />, { width: 280, align: 'end' });
  };

  const count = activeFilterCount(filters);

  return (
    <div class="viewbar">
      <div class="viewbar-search">
        <Search size={14} />
        <input
          ref={searchRef}
          value={filters.q}
          placeholder={t('filter.search')}
          onInput={(e) => update({ filters: { ...filters, q: (e.target as HTMLInputElement).value } })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              update({ filters: { ...filters, q: '' } });
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {filters.q && (
          <button class="icon-btn xs" onClick={() => update({ filters: { ...filters, q: '' } })} aria-label={t('common.clear')}>
            <X size={12} />
          </button>
        )}
      </div>
      {fields.map((field) => {
        const values = (filters[field] as (string | number)[]).map(String);
        if (!values.length) return null;
        const meta = fieldMeta(field);
        return (
          <span class="filter-chip" key={field}>
            <button class="filter-chip-main" onClick={(e) => editField(e.currentTarget, field)}>
              {meta.icon}
              <span class="muted">{meta.label}:</span>
              <span>{values.length > 2 ? t('filter.nSelected', { count: values.length }) : values.map((v) => valueLabel(field, v)).join(', ')}</span>
            </button>
            <button class="filter-chip-x" onClick={() => setFilter(field, [])} aria-label={t('common.clear')}>
              <X size={12} />
            </button>
          </span>
        );
      })}
      <button class="btn ghost sm" onClick={(e) => addFilter(e.currentTarget)}>
        <Filter size={14} />
        {count ? '' : t('filter.filter')}
      </button>
      {count > 1 && (
        <button class="btn ghost sm" onClick={() => update({ filters: { ...emptyFilters(), q: filters.q } })}>
          {t('filter.clearAll')}
        </button>
      )}
      <span class="grow" />
      {children}
      <button class="btn ghost sm" onClick={(e) => openDisplay(e.currentTarget)}>
        <SlidersHorizontal size={14} />
        <span class="hide-sm">{t('display.title')}</span>
      </button>
    </div>
  );
}

function DisplayMenu({ state, update, groupOptions, hideGrouping }: { state: ViewState; update: (p: Partial<ViewState>) => void; groupOptions: GroupBy[]; hideGrouping: boolean }) {
  const [display, setDisplay] = useState(state.display);
  const set = (patch: Partial<Display>) => {
    const next = { ...display, ...patch };
    setDisplay(next);
    update({ display: next });
  };
  const groupLabels: Record<GroupBy, string> = {
    status: t('prop.status'),
    assignee: t('prop.assignee'),
    priority: t('prop.priority'),
    sprint: t('prop.sprint'),
    label: t('prop.labels'),
    none: t('display.noGrouping'),
  };
  const orderLabels: Record<OrderBy, string> = {
    manual: t('display.manual'),
    priority: t('prop.priority'),
    updated: t('display.updated'),
    created: t('display.created'),
    due: t('prop.dueDate'),
  };
  return (
    <div class="display-menu">
      {!hideGrouping && (
        <label class="display-row">
          <span>{t('display.groupBy')}</span>
          <select class="input sm" value={display.groupBy} onChange={(e) => set({ groupBy: (e.target as HTMLSelectElement).value as GroupBy })}>
            {groupOptions.map((g) => (
              <option value={g}>{groupLabels[g]}</option>
            ))}
          </select>
        </label>
      )}
      <label class="display-row">
        <span>{t('display.orderBy')}</span>
        <select class="input sm" value={display.orderBy} onChange={(e) => set({ orderBy: (e.target as HTMLSelectElement).value as OrderBy })}>
          {(Object.keys(orderLabels) as OrderBy[]).map((o) => (
            <option value={o}>{orderLabels[o]}</option>
          ))}
        </select>
      </label>
      <div class="display-row">
        <span>{t('display.completed')}</span>
        <div class="segmented sm">
          {(['recent', 'all', 'none'] as CompletedMode[]).map((m) => (
            <button class={display.completed === m ? 'on' : ''} onClick={() => set({ completed: m })}>
              {t(`display.completed_${m}`)}
            </button>
          ))}
        </div>
      </div>
      {!hideGrouping && (
        <label class="display-row check">
          <span>{t('display.showEmpty')}</span>
          <input type="checkbox" checked={display.showEmpty} onChange={(e) => set({ showEmpty: (e.target as HTMLInputElement).checked })} />
        </label>
      )}
    </div>
  );
}
