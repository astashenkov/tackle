import { CLOSED_CATEGORIES, PRIORITY_ORDER } from '../../shared/constants';
import type { ID, Label, Priority, Sprint, Status, Task, TaskPatch, User } from '../../shared/types';

/* Pure filtering / grouping / sorting logic shared by board, list and sprint views. */

export type GroupBy = 'status' | 'assignee' | 'priority' | 'sprint' | 'label' | 'none';
export type OrderBy = 'manual' | 'priority' | 'updated' | 'created' | 'due';
export type CompletedMode = 'recent' | 'all' | 'none';

export interface Filters {
  statuses: ID[];
  assignees: string[]; // user ids or "none"
  priorities: Priority[];
  labels: ID[];
  sprints: string[]; // sprint ids, "none" or "active"
  q: string;
}

export interface Display {
  groupBy: GroupBy;
  orderBy: OrderBy;
  completed: CompletedMode;
  showEmpty: boolean;
}

export const emptyFilters = (): Filters => ({ statuses: [], assignees: [], priorities: [], labels: [], sprints: [], q: '' });

export const activeFilterCount = (f: Filters) =>
  f.statuses.length + f.assignees.length + f.priorities.length + f.labels.length + f.sprints.length;

export interface ViewContext {
  statuses: Record<ID, Status>;
  statusList: Status[];
  users: Record<ID, User>;
  userList: User[];
  labels: Record<ID, Label>;
  labelList: Label[];
  sprints: Sprint[]; // sprints relevant to the view, chronological
  projectKeys: Record<ID, string>;
  now: number;
}

/** Closed tasks older than this are hidden in "recent" mode so boards don't grow forever. */
export const RECENT_MS = 14 * 86_400_000;

const isClosed = (t: Task, ctx: ViewContext) => {
  const s = ctx.statuses[t.statusId];
  return !!s && CLOSED_CATEGORIES.has(s.category);
};

export function matchesQuery(t: Task, q: string, ctx: ViewContext): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const ref = `${ctx.projectKeys[t.projectId] ?? ''}-${t.number}`.toLowerCase();
  return (
    t.title.toLowerCase().includes(needle) ||
    (needle.includes('-') && ref.startsWith(needle)) ||
    String(t.number) === needle ||
    t.description.toLowerCase().includes(needle)
  );
}

export function filterTasks(tasks: Task[], f: Filters, d: Pick<Display, 'completed'>, ctx: ViewContext): Task[] {
  const active = ctx.sprints.filter((s) => s.state === 'active').map((s) => s.id);
  return tasks.filter((t) => {
    if (isClosed(t, ctx)) {
      if (d.completed === 'none') return false;
      if (d.completed === 'recent' && t.completedAt && ctx.now - t.completedAt > RECENT_MS) return false;
    }
    if (f.statuses.length && !f.statuses.includes(t.statusId)) return false;
    if (f.assignees.length && !f.assignees.includes(t.assigneeId ?? 'none')) return false;
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
    if (f.labels.length && !f.labels.some((l) => t.labelIds.includes(l))) return false;
    if (f.sprints.length) {
      const ok = f.sprints.some((s) =>
        s === 'none' ? !t.sprintId : s === 'active' ? !!t.sprintId && active.includes(t.sprintId) : t.sprintId === s,
      );
      if (!ok) return false;
    }
    return matchesQuery(t, f.q, ctx);
  });
}

const priorityRank = (p: Priority) => PRIORITY_ORDER.indexOf(p);

export function sortTasks(tasks: Task[], orderBy: OrderBy): Task[] {
  const arr = [...tasks];
  const byPos = (a: Task, b: Task) => a.position - b.position || a.createdAt - b.createdAt;
  switch (orderBy) {
    case 'manual':
      return arr.sort(byPos);
    case 'priority':
      return arr.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || byPos(a, b));
    case 'updated':
      return arr.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'created':
      return arr.sort((a, b) => b.createdAt - a.createdAt);
    case 'due':
      return arr.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || priorityRank(a.priority) - priorityRank(b.priority));
  }
}

export interface Group {
  key: string;
  kind: GroupBy;
  /** The patch that moves a task into this group (used by drag and drop and inline create). */
  patch: TaskPatch | null;
  tasks: Task[];
}

/** Splits tasks into ordered groups. Groups always come in a stable, meaningful order. */
export function groupTasks(tasks: Task[], groupBy: GroupBy, ctx: ViewContext, showEmpty: boolean): Group[] {
  if (groupBy === 'none') return [{ key: 'all', kind: 'none', patch: null, tasks }];

  let groups: Group[] = [];
  const bucket = (key: string) => groups.find((g) => g.key === key);

  if (groupBy === 'status') {
    groups = ctx.statusList.map((s) => ({ key: s.id, kind: groupBy, patch: { statusId: s.id }, tasks: [] }));
    for (const t of tasks) bucket(t.statusId)?.tasks.push(t);
  } else if (groupBy === 'priority') {
    groups = PRIORITY_ORDER.map((p) => ({ key: String(p), kind: groupBy, patch: { priority: p }, tasks: [] }));
    for (const t of tasks) bucket(String(t.priority))?.tasks.push(t);
  } else if (groupBy === 'assignee') {
    const ids = new Set(ctx.userList.map((u) => u.id));
    for (const t of tasks) if (t.assigneeId) ids.add(t.assigneeId);
    groups = [...ids]
      .map((id) => ({ key: id, kind: groupBy, patch: { assigneeId: id } as TaskPatch, tasks: [] as Task[] }))
      .sort((a, b) => (ctx.users[a.key]?.name ?? '').localeCompare(ctx.users[b.key]?.name ?? ''));
    groups.push({ key: 'none', kind: groupBy, patch: { assigneeId: null }, tasks: [] });
    for (const t of tasks) bucket(t.assigneeId ?? 'none')?.tasks.push(t);
  } else if (groupBy === 'sprint') {
    const rank = { active: 0, planned: 1, completed: 2 } as const;
    const ordered = [...ctx.sprints].sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'completed' ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate)));
    groups = ordered.map((s) => ({ key: s.id, kind: groupBy, patch: { sprintId: s.id }, tasks: [] }));
    groups.push({ key: 'none', kind: groupBy, patch: { sprintId: null }, tasks: [] });
    for (const t of tasks) (bucket(t.sprintId ?? 'none') ?? bucket('none'))!.tasks.push(t);
  } else if (groupBy === 'label') {
    groups = ctx.labelList.map((l) => ({ key: l.id, kind: groupBy, patch: { addLabelIds: [l.id] }, tasks: [] }));
    groups.push({ key: 'none', kind: groupBy, patch: null, tasks: [] });
    for (const t of tasks) {
      if (!t.labelIds.length) bucket('none')!.tasks.push(t);
      for (const l of t.labelIds) bucket(l)?.tasks.push(t);
    }
  }
  return showEmpty ? groups : groups.filter((g) => g.tasks.length > 0);
}

/** Position for a task dropped right before `beforeId` (or at the end) in an ordered list. */
export function positionBetween(ordered: Task[], movingId: ID, beforeId: ID | null): number {
  const list = ordered.filter((t) => t.id !== movingId);
  const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
  const at = idx < 0 ? list.length : idx;
  const prev = list[at - 1]?.position;
  const next = list[at]?.position;
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1024;
  if (next === undefined) return prev + 1024;
  return (prev + next) / 2;
}
