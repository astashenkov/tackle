import { computed, signal, type Signal } from '@preact/signals';
import type { Attachment, ID, Label, Notification, Project, Snapshot, Sprint, Status, Task, User, Workspace } from '../../shared/types';
import { CLOSED_CATEGORIES } from '../../shared/constants';

/* The whole workspace lives in memory: every view filters and groups locally, so navigation is instant. */

export type Dict<T> = Record<ID, T>;

export const ready = signal(false);
export const me = signal<User | null>(null);
export const workspace = signal<Workspace>({ name: '' });
export const users = signal<Dict<User>>({});
export const projects = signal<Dict<Project>>({});
export const statuses = signal<Dict<Status>>({});
export const labels = signal<Dict<Label>>({});
export const sprints = signal<Dict<Sprint>>({});
export const tasks = signal<Dict<Task>>({});
export const attachments = signal<Dict<Attachment>>({});
/** Largest file the server accepts, in bytes. */
export const uploadLimit = signal(0);
/** Files on their way to the server, by the id their attachment will get. */
export const uploads = signal<Dict<{ id: ID; taskId: ID; name: string; type: string; size: number; loaded: number }>>({});
export const notifications = signal<Notification[] | null>(null);
export const snapshotUnread = signal(0);
export const connection = signal<'online' | 'connecting'>('connecting');
/** Bumped when a task's comments/history change, so an open task panel refetches. */
export const timelineVersion = signal<Dict<number>>({});

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export const statusList = computed(() => Object.values(statuses.value).sort(byPosition));
export const projectList = computed(() => Object.values(projects.value).filter((p) => !p.archived).sort(byPosition));
export const allProjects = computed(() => Object.values(projects.value).sort(byPosition));
export const userList = computed(() =>
  Object.values(users.value)
    .filter((u) => u.active)
    .sort((a, b) => a.name.localeCompare(b.name)),
);
export const labelList = computed(() => Object.values(labels.value).sort((a, b) => a.name.localeCompare(b.name)));
export const taskList = computed(() => Object.values(tasks.value));

/** Attachments per task id, oldest first. */
export const attachmentsByTask = computed(() => {
  const map: Record<ID, Attachment[]> = {};
  for (const a of Object.values(attachments.value)) (map[a.taskId] ??= []).push(a);
  for (const list of Object.values(map)) list.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
  return map;
});

export const projectsByKey = computed(() => {
  const map: Record<string, Project> = {};
  for (const p of Object.values(projects.value)) map[p.key] = p;
  return map;
});

export const usersByHandle = computed(() => {
  const map: Record<string, User> = {};
  for (const u of Object.values(users.value)) map[u.handle] = u;
  return map;
});

export const unreadCount = computed(() =>
  notifications.value ? notifications.value.filter((n) => !n.readAt).length : snapshotUnread.value,
);

export const isClosed = (task: Task) => {
  const s = statuses.value[task.statusId];
  return !!s && CLOSED_CATEGORIES.has(s.category);
};

export function taskRef(task: Task): string {
  const key = projects.value[task.projectId]?.key ?? '?';
  return task.number ? `${key}-${task.number}` : `${key}-…`;
}

export function findTaskByRef(ref: string): Task | undefined {
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(ref);
  if (!m) return undefined;
  const project = projectsByKey.value[m[1].toUpperCase()];
  if (!project) return undefined;
  const n = Number(m[2]);
  return taskList.value.find((t) => t.projectId === project.id && t.number === n);
}

export function projectSprints(projectId: ID): Sprint[] {
  return Object.values(sprints.value)
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.number - b.number);
}

export function activeSprint(projectId: ID): Sprint | undefined {
  return Object.values(sprints.value).find((s) => s.projectId === projectId && s.state === 'active');
}

/* ------------------------------ mutation helpers ------------------------------ */

export function put<T extends { id: ID }>(sig: Signal<Dict<T>>, item: T) {
  sig.value = { ...sig.value, [item.id]: item };
}

export function putMany<T extends { id: ID }>(sig: Signal<Dict<T>>, items: T[]) {
  if (!items.length) return;
  const next = { ...sig.value };
  for (const item of items) next[item.id] = item;
  sig.value = next;
}

export function drop<T>(sig: Signal<Dict<T>>, id: ID) {
  if (!(id in sig.value)) return;
  const next = { ...sig.value };
  delete next[id];
  sig.value = next;
}

const index = <T extends { id: ID }>(items: T[]): Dict<T> => Object.fromEntries(items.map((i) => [i.id, i]));

export function applySnapshot(s: Snapshot) {
  workspace.value = s.workspace;
  me.value = s.me;
  users.value = index(s.users);
  projects.value = index(s.projects);
  statuses.value = index(s.statuses);
  labels.value = index(s.labels);
  sprints.value = index(s.sprints);
  tasks.value = index(s.tasks);
  attachments.value = index(s.attachments);
  uploadLimit.value = s.uploadLimit;
  snapshotUnread.value = s.unread;
  ready.value = true;
}

export function clearData() {
  ready.value = false;
  me.value = null;
  users.value = {};
  projects.value = {};
  statuses.value = {};
  labels.value = {};
  sprints.value = {};
  tasks.value = {};
  attachments.value = {};
  notifications.value = null;
}
