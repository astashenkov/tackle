import { batch } from '@preact/signals';
import { CLOSED_CATEGORIES } from '../../shared/constants';
import type { Attachment, ID, Label, Notification, Project, Sprint, Status, Task, TaskPatch, User } from '../../shared/types';
import { api, ApiError, newId } from '../lib/api';
import { formatSize, t } from '../lib/i18n';
import { toast } from '../components/Toasts';
import {
  attachments,
  drop,
  labels,
  me,
  notifications,
  projects,
  put,
  putMany,
  snapshotUnread,
  sprints,
  statuses,
  tasks,
  uploadLimit,
  uploads,
  users,
  workspace,
} from './data';

/*
 * Every mutation is applied to the local store first (so the UI responds instantly) and then
 * sent to the server. The server's answer replaces the optimistic version unless more edits to
 * the same entity are still in flight; on failure the change is rolled back and a toast explains why.
 */

const inflight = new Map<ID, number>();
export const isPending = (id: ID) => (inflight.get(id) ?? 0) > 0;
const begin = (id: ID) => inflight.set(id, (inflight.get(id) ?? 0) + 1);
const end = (id: ID) => {
  const n = (inflight.get(id) ?? 1) - 1;
  if (n <= 0) inflight.delete(id);
  else inflight.set(id, n);
  return n;
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.code === 'network' ? t('error.network') : err.message;
  return t('error.generic');
}

export function reportError(err: unknown) {
  toast(errorMessage(err), { kind: 'error' });
}

/** Applies a patch locally, mirroring what the server will do. */
export function applyPatch(task: Task, p: TaskPatch): Task {
  const next: Task = { ...task };
  if (p.title !== undefined) next.title = p.title;
  if (p.description !== undefined) next.description = p.description;
  if (p.priority !== undefined) next.priority = p.priority;
  if (p.assigneeId !== undefined) next.assigneeId = p.assigneeId;
  if (p.reviewerId !== undefined) next.reviewerId = p.reviewerId;
  if (p.sprintId !== undefined) next.sprintId = p.sprintId;
  if (p.estimate !== undefined) next.estimate = p.estimate;
  if (p.dueDate !== undefined) next.dueDate = p.dueDate;
  if (p.position !== undefined) next.position = p.position;
  if (p.statusId !== undefined && p.statusId !== task.statusId) {
    next.statusId = p.statusId;
    const from = statuses.value[task.statusId]?.category;
    const to = statuses.value[p.statusId]?.category;
    if (to && CLOSED_CATEGORIES.has(to) && !(from && CLOSED_CATEGORIES.has(from))) next.completedAt = Date.now();
    if (to && !CLOSED_CATEGORIES.has(to)) next.completedAt = null;
    if (to && to !== 'completed') next.archivedAt = null;
    if (to === 'started' && !next.startedAt) next.startedAt = Date.now();
  }
  if (p.labelIds || p.addLabelIds || p.removeLabelIds) {
    const set = new Set(p.labelIds ?? task.labelIds);
    for (const l of p.addLabelIds ?? []) set.add(l);
    for (const l of p.removeLabelIds ?? []) set.delete(l);
    next.labelIds = [...set];
  }
  next.updatedAt = Date.now();
  return next;
}

export async function updateTasks(ids: ID[], patch: TaskPatch) {
  const before = ids.map((id) => tasks.value[id]).filter(Boolean);
  if (!before.length) return;
  putMany(tasks, before.map((tk) => applyPatch(tk, patch)));
  before.forEach((tk) => begin(tk.id));
  try {
    const result =
      before.length === 1
        ? [await api.patch<Task>(`/tasks/${before[0].id}`, patch)]
        : await api.post<Task[]>('/tasks/bulk', { ids: before.map((tk) => tk.id), patch });
    putMany(tasks, result.filter((tk) => end(tk.id) === 0 && tasks.value[tk.id]));
  } catch (err) {
    before.forEach((tk) => end(tk.id));
    putMany(tasks, before.filter((tk) => tasks.value[tk.id]));
    reportError(err);
  }
}

export const updateTask = (id: ID, patch: TaskPatch) => updateTasks([id], patch);

export async function createTask(fields: Partial<Task> & { projectId: ID; title: string }): Promise<Task | null> {
  const id = newId();
  const now = Date.now();
  const projectTasks = Object.values(tasks.value).filter((tk) => tk.projectId === fields.projectId && tk.statusId === fields.statusId);
  const position = fields.position ?? Math.min(1024, ...projectTasks.map((tk) => tk.position)) - 1024;
  const optimistic: Task = {
    id,
    number: 0,
    description: '',
    statusId: fields.statusId ?? '',
    priority: 0,
    assigneeId: null,
    reviewerId: null,
    creatorId: me.value?.id ?? null,
    sprintId: null,
    estimate: null,
    dueDate: null,
    labelIds: [],
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    ...fields,
    position,
  };
  put(tasks, optimistic);
  begin(id);
  try {
    const { number: _n, createdAt: _c, updatedAt: _u, startedAt: _s, completedAt: _d, archivedAt: _a, creatorId: _cr, ...body } = optimistic;
    const created = await api.post<Task>('/tasks', body);
    end(id);
    put(tasks, created);
    return created;
  } catch (err) {
    end(id);
    drop(tasks, id);
    reportError(err);
    return null;
  }
}

export async function deleteTasks(ids: ID[]) {
  const removed = ids.map((id) => tasks.value[id]).filter(Boolean);
  if (!removed.length) return;
  batch(() => removed.forEach((tk) => drop(tasks, tk.id)));
  try {
    await api.post('/tasks/delete', { ids: removed.map((tk) => tk.id) });
    toast(t('toast.deleted', { count: removed.length }), {
      action: { label: t('common.undo'), run: () => restoreTasks(removed) },
    });
  } catch (err) {
    putMany(tasks, removed);
    reportError(err);
  }
}

async function restoreTasks(removed: Task[]) {
  putMany(tasks, removed);
  try {
    await api.post('/tasks/restore', { ids: removed.map((tk) => tk.id) });
  } catch (err) {
    batch(() => removed.forEach((tk) => drop(tasks, tk.id)));
    reportError(err);
  }
}

/* -------------------------------- attachments -------------------------------- */

/**
 * Starts uploading files to a task. Ids are chosen here and returned right away, so a description
 * or comment can link to a file before its upload has finished. Files over the limit are skipped.
 */
export function uploadFiles(taskId: ID, files: File[]): { id: ID; name: string; type: string }[] {
  const started: { id: ID; name: string; type: string }[] = [];
  for (const file of files) {
    const name = file.name || 'file';
    if (uploadLimit.value && file.size > uploadLimit.value) {
      toast(t('attach.tooLarge', { name, limit: formatSize(uploadLimit.value) }), { kind: 'error' });
      continue;
    }
    const id = newId();
    put(uploads, { id, taskId, name, type: file.type, size: file.size, loaded: 0 });
    started.push({ id, name, type: file.type });
    const query = new URLSearchParams({ id, name });
    api
      .upload<Attachment>(`/tasks/${taskId}/attachments?${query}`, file, (loaded) => {
        const upload = uploads.value[id];
        if (upload) put(uploads, { ...upload, loaded });
      })
      .then((attachment) => put(attachments, attachment))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 413) toast(t('attach.tooLarge', { name, limit: formatSize(uploadLimit.value) }), { kind: 'error' });
        else reportError(err);
      })
      .finally(() => drop(uploads, id));
  }
  return started;
}

export async function deleteAttachment(id: ID) {
  const attachment = attachments.value[id];
  if (!attachment) return;
  drop(attachments, id);
  try {
    await api.del(`/attachments/${id}`);
  } catch (err) {
    put(attachments, attachment);
    reportError(err);
  }
}

/* ---------------------------------- sprints ---------------------------------- */

export async function saveSprint(data: Partial<Sprint> & { projectId: ID }): Promise<Sprint | null> {
  try {
    const sprint = data.id && sprints.value[data.id] ? await api.patch<Sprint>(`/sprints/${data.id}`, data) : await api.post<Sprint>('/sprints', data);
    put(sprints, sprint);
    return sprint;
  } catch (err) {
    reportError(err);
    return null;
  }
}

export async function startSprint(id: ID, dates?: { startDate: string; endDate: string }) {
  try {
    put(sprints, await api.post<Sprint>(`/sprints/${id}/start`, dates ?? {}));
    toast(t('sprint.started'));
  } catch (err) {
    reportError(err);
  }
}

export async function completeSprint(id: ID, moveTo: string) {
  try {
    const res = await api.post<{ sprint: Sprint; movedTo: ID | null; moved: number }>(`/sprints/${id}/complete`, { moveTo });
    put(sprints, res.sprint);
    toast(t('sprint.completedToast', { count: res.moved }));
  } catch (err) {
    reportError(err);
  }
}

export async function deleteSprint(id: ID) {
  const sprint = sprints.value[id];
  try {
    await api.del(`/sprints/${id}`);
    drop(sprints, id);
    putMany(
      tasks,
      Object.values(tasks.value)
        .filter((tk) => tk.sprintId === id)
        .map((tk) => ({ ...tk, sprintId: null })),
    );
  } catch (err) {
    if (sprint) put(sprints, sprint);
    reportError(err);
  }
}

/* ------------------------------ workspace entities ------------------------------ */

async function save<T extends { id: ID }>(path: string, data: Partial<T>, sig: Parameters<typeof put<T>>[0]): Promise<T | null> {
  try {
    const item = data.id && sig.value[data.id] ? await api.patch<T>(`${path}/${data.id}`, data) : await api.post<T>(path, data);
    put(sig, item);
    return item;
  } catch (err) {
    reportError(err);
    return null;
  }
}

export const saveProject = (data: Partial<Project>) => save<Project>('/projects', data, projects);
export const saveLabel = (data: Partial<Label>) => save<Label>('/labels', data, labels);
export const saveStatus = (data: Partial<Status>) => save<Status>('/statuses', data, statuses);

export async function deleteLabel(id: ID) {
  try {
    await api.del(`/labels/${id}`);
    drop(labels, id);
    putMany(
      tasks,
      Object.values(tasks.value)
        .filter((tk) => tk.labelIds.includes(id))
        .map((tk) => ({ ...tk, labelIds: tk.labelIds.filter((l) => l !== id) })),
    );
  } catch (err) {
    reportError(err);
  }
}

export async function deleteStatus(id: ID, replacementId?: ID) {
  try {
    await api.del(`/statuses/${id}${replacementId ? `?replacementId=${replacementId}` : ''}`);
    drop(statuses, id);
    if (replacementId) {
      putMany(
        tasks,
        Object.values(tasks.value)
          .filter((tk) => tk.statusId === id)
          .map((tk) => ({ ...tk, statusId: replacementId })),
      );
    }
  } catch (err) {
    reportError(err);
  }
}

export async function deleteProject(id: ID) {
  try {
    await api.del(`/projects/${id}`);
    drop(projects, id);
    tasks.value = Object.fromEntries(Object.entries(tasks.value).filter(([, tk]) => tk.projectId !== id));
  } catch (err) {
    reportError(err);
  }
}

export async function updateMe(data: Record<string, unknown>): Promise<boolean> {
  try {
    const user = await api.patch<User>('/me', data);
    me.value = user;
    put(users, user);
    return true;
  } catch (err) {
    reportError(err);
    return false;
  }
}

export async function updateUser(id: ID, data: Partial<Pick<User, 'role' | 'active'>>) {
  try {
    put(users, await api.patch<User>(`/users/${id}`, data));
  } catch (err) {
    reportError(err);
  }
}

export async function renameWorkspace(name: string) {
  try {
    workspace.value = await api.patch('/workspace', { name });
  } catch (err) {
    reportError(err);
  }
}

/* -------------------------------- notifications -------------------------------- */

export async function loadNotifications() {
  try {
    notifications.value = await api.get<Notification[]>('/notifications');
  } catch {
    /* the inbox shows its own empty state */
  }
}

export async function markRead(ids: number[] | 'all', unread = false) {
  const list = notifications.value;
  if (list) {
    const stamp = unread ? null : Date.now();
    notifications.value = list.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, readAt: stamp } : n));
  }
  try {
    const res = await api.post<{ unread: number }>('/notifications/read', ids === 'all' ? { all: true, unread } : { ids, unread });
    snapshotUnread.value = res.unread;
  } catch (err) {
    reportError(err);
  }
}
