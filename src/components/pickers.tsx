import { ESTIMATES, PALETTE, PRIORITY_ORDER } from '../../shared/constants';
import type { ID, Priority, Task } from '../../shared/types';
import { Calendar, CalendarX, CircleSlash, Hash, UserMinus } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, dueLabel, formatDate, isoDate, nextWeek } from '../lib/date';
import { t, priorityName, sprintLabel } from '../lib/i18n';
import { labelList, me, projectSprints, statusList, tasks, userList } from '../store/data';
import { saveLabel, updateTasks } from '../store/actions';
import { Avatar } from './Avatar';
import { PriorityIcon, StatusIcon } from './Icons';
import { openPicker } from './Picker';
import { openPopover, type Anchor } from './Popover';

/* Property pickers that act on one or many tasks. Used by cards, the task panel, shortcuts and the palette. */

const list = (ids: ID[]) => ids.map((id) => tasks.value[id]).filter((x): x is Task => !!x);
const common = <K extends keyof Task>(items: Task[], key: K): Task[K] | undefined =>
  items.length && items.every((x) => x[key] === items[0][key]) ? items[0][key] : undefined;

/** Finds an on-screen element for a task to anchor a picker to (falls back to a centered menu). */
export function anchorFor(id: ID | undefined, prop?: string): Anchor {
  if (!id) return null;
  // Prefer the open task panel, then the card/row on screen.
  const inPanel = prop ? document.querySelector(`.panel[data-task-id="${id}"] [data-prop="${prop}"]`) : null;
  if (inPanel) return inPanel;
  const el = document.querySelector(`[data-task-id="${id}"]${prop ? ` [data-prop="${prop}"]` : ''}`) ?? document.querySelector(`[data-task-id="${id}"]`);
  return el ?? null;
}

export function pickStatus(anchor: Anchor, ids: ID[], onPick?: (statusId: ID) => void, current?: ID) {
  const items = list(ids);
  openPicker(anchor, {
    placeholder: t('picker.status'),
    numbered: true,
    selected: [current ?? common(items, 'statusId') ?? ''],
    items: statusList.value.map((s) => ({ id: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} /> })),
    onSelect: (statusId) => (onPick ? onPick(statusId) : updateTasks(ids, { statusId })),
  });
}

export function pickPriority(anchor: Anchor, ids: ID[], onPick?: (p: Priority) => void, value?: Priority) {
  const items = list(ids);
  const current = value ?? common(items, 'priority');
  openPicker(anchor, {
    placeholder: t('picker.priority'),
    numbered: true,
    width: 220,
    selected: current === undefined ? [] : [String(current)],
    items: [0, ...PRIORITY_ORDER.slice(0, 4)].map((p) => ({ id: String(p), label: priorityName(p as Priority), icon: <PriorityIcon priority={p as Priority} /> })),
    onSelect: (id) => {
      const priority = Number(id) as Priority;
      if (onPick) onPick(priority);
      else updateTasks(ids, { priority });
    },
  });
}

function pickPerson(field: 'assigneeId' | 'reviewerId', anchor: Anchor, ids: ID[], onPick?: (userId: ID | null) => void, value?: ID | null) {
  const items = list(ids);
  const current = value !== undefined ? value : common(items, field);
  const mine = me.value;
  openPicker(anchor, {
    placeholder: field === 'assigneeId' ? t('picker.assignee') : t('picker.reviewer'),
    selected: current === undefined ? [] : [current ?? 'none'],
    items: [
      { id: 'none', label: field === 'assigneeId' ? t('common.noAssignee') : t('common.noReviewer'), icon: <UserMinus size={14} /> },
      ...(mine ? [{ id: mine.id, label: `${mine.name} (${t('common.you')})`, icon: <Avatar user={mine} size={16} />, keywords: `${mine.handle} me` }] : []),
      ...userList.value
        .filter((u) => u.id !== mine?.id)
        .map((u) => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} />, keywords: u.handle, hint: `@${u.handle}` })),
    ],
    onSelect: (id) => {
      const userId = id === 'none' ? null : id;
      if (onPick) onPick(userId);
      else updateTasks(ids, { [field]: userId });
    },
  });
}

export const pickAssignee = (anchor: Anchor, ids: ID[], onPick?: (userId: ID | null) => void, value?: ID | null) =>
  pickPerson('assigneeId', anchor, ids, onPick, value);

export const pickReviewer = (anchor: Anchor, ids: ID[], onPick?: (userId: ID | null) => void, value?: ID | null) =>
  pickPerson('reviewerId', anchor, ids, onPick, value);

export function pickLabels(anchor: Anchor, ids: ID[], onToggle?: (labelId: ID, on: boolean) => void, initial?: ID[]) {
  const items = list(ids);
  const selected = initial ?? labelList.value.filter((l) => items.length && items.every((x) => x.labelIds.includes(l.id))).map((l) => l.id);
  const toggle = (labelId: ID, on: boolean) => {
    if (onToggle) onToggle(labelId, on);
    else updateTasks(ids, on ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] });
  };
  openPicker(anchor, {
    placeholder: t('picker.labels'),
    multi: true,
    selected,
    items: labelList.value.map((l) => ({ id: l.id, label: l.name, icon: <span class="label-dot" style={{ background: l.color }} /> })),
    onSelect: toggle,
    onCreate: {
      label: (q) => t('picker.createLabel', { name: q }),
      run: async (name) => {
        const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        const label = await saveLabel({ name, color });
        if (label) toggle(label.id, true);
      },
    },
  });
}

export function pickEstimate(anchor: Anchor, ids: ID[], onPick?: (e: number | null) => void, value?: number | null) {
  const items = list(ids);
  const current = value !== undefined ? value : common(items, 'estimate');
  openPicker(anchor, {
    placeholder: t('picker.estimate'),
    numbered: true,
    width: 200,
    selected: current === undefined ? [] : [String(current ?? 'none')],
    items: [
      { id: 'none', label: t('common.noEstimate'), icon: <CircleSlash size={14} /> },
      ...ESTIMATES.map((e) => ({ id: String(e), label: t('common.points', { count: e }), icon: <Hash size={14} /> })),
    ],
    onSelect: (id) => {
      const estimate = id === 'none' ? null : Number(id);
      if (onPick) onPick(estimate);
      else updateTasks(ids, { estimate });
    },
  });
}

export function pickSprint(anchor: Anchor, ids: ID[], projectId?: ID, onPick?: (sprintId: ID | null) => void, value?: ID | null) {
  const items = list(ids);
  const pid = projectId ?? common(items, 'projectId');
  if (!pid) return;
  const current = value !== undefined ? value : common(items, 'sprintId');
  const sprints = projectSprints(pid).filter((s) => s.state !== 'completed' || s.id === current);
  openPicker(anchor, {
    placeholder: t('picker.sprint'),
    selected: current === undefined ? [] : [current ?? 'none'],
    items: [
      { id: 'none', label: t('common.noSprint'), icon: <CircleSlash size={14} /> },
      ...sprints.map((s) => ({
        id: s.id,
        label: s.name,
        hint: sprintLabel(s),
        icon: <span class={`sprint-dot ${s.state}`} />,
      })),
    ],
    emptyText: t('picker.noSprints'),
    onSelect: (id) => {
      const sprintId = id === 'none' ? null : id;
      if (onPick) onPick(sprintId);
      else updateTasks(ids, { sprintId });
    },
  });
}

function DueDateMenu({ value, onPick, close }: { value: string | null; onPick: (d: string | null) => void; close: () => void }) {
  const [custom, setCustom] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const pick = (d: string | null) => {
    close();
    onPick(d);
  };
  const today = isoDate();
  const presets: [string, string][] = [
    [t('date.today'), today],
    [t('date.tomorrow'), addDays(today, 1)],
    [t('date.nextWeek'), nextWeek()],
    [t('date.inTwoWeeks'), addDays(today, 14)],
  ];
  return (
    <div class="due-menu">
      {presets.map(([label, d]) => (
        <button class="menu-item" onClick={() => pick(d)}>
          <Calendar size={14} />
          <span class="grow">{label}</span>
          <span class="muted">{formatDate(d)}</span>
        </button>
      ))}
      <div class="due-custom">
        <input
          ref={inputRef}
          type="date"
          class="input"
          value={custom}
          onInput={(e) => setCustom((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && custom && pick(custom)}
        />
        <button class="btn primary sm" disabled={!custom} onClick={() => pick(custom)}>
          {t('common.set')}
        </button>
      </div>
      {value && (
        <button class="menu-item danger" onClick={() => pick(null)}>
          <CalendarX size={14} />
          <span class="grow">{t('date.clear')}</span>
          <span class="muted">{dueLabel(value)}</span>
        </button>
      )}
    </div>
  );
}

export function pickDueDate(anchor: Anchor, ids: ID[], onPick?: (d: string | null) => void, value?: string | null) {
  const items = list(ids);
  const current = value !== undefined ? value : (common(items, 'dueDate') ?? null);
  openPopover(anchor, (close) => <DueDateMenu value={current} close={close} onPick={(dueDate) => (onPick ? onPick(dueDate) : updateTasks(ids, { dueDate }))} />, {
    width: 260,
  });
}

/** Assigns tasks to the current user, or unassigns them if they are all already theirs. */
export function toggleAssignMe(ids: ID[]) {
  const mine = me.value;
  if (!mine || !ids.length) return;
  const items = list(ids);
  const allMine = items.every((x) => x.assigneeId === mine.id);
  void updateTasks(ids, { assigneeId: allMine ? null : mine.id });
}

