import type { Hono } from 'hono';
import { CLOSED_CATEGORIES, extractMentions } from '../../shared/constants';
import type { Activity, ActivityKind, Priority, StatusCategory, Task, TaskPatch, User } from '../../shared/types';
import type { AppEnv } from '../auth';
import { loadTask, toActivity, toComment } from '../db';
import { notify, usersByHandles, watchers, type Ctx } from '../notify';
import {
  asBody,
  badRequest,
  date,
  forbidden,
  id,
  idList,
  int,
  newId,
  notFound,
  now,
  num,
  str,
} from '../util';

const COALESCE_MS = 5 * 60_000;

/* ------------------------------ validation ------------------------------ */

export function parsePatch(raw: unknown): TaskPatch {
  const b = asBody(raw);
  const p: TaskPatch = {};
  if (b.title !== undefined) p.title = str(b.title, 'Title', { min: 1, max: 500 });
  if (b.description !== undefined) p.description = str(b.description, 'Description', { max: 100_000, trim: false });
  if (b.statusId !== undefined) p.statusId = id(b.statusId, 'statusId');
  if (b.priority !== undefined) p.priority = int(b.priority, 'priority', 0, 4) as Priority;
  if (b.assigneeId !== undefined) p.assigneeId = b.assigneeId === null ? null : id(b.assigneeId, 'assigneeId');
  if (b.reviewerId !== undefined) p.reviewerId = b.reviewerId === null ? null : id(b.reviewerId, 'reviewerId');
  if (b.sprintId !== undefined) p.sprintId = b.sprintId === null ? null : id(b.sprintId, 'sprintId');
  if (b.estimate !== undefined) p.estimate = b.estimate === null ? null : int(b.estimate, 'estimate', 0, 1000);
  if (b.dueDate !== undefined) p.dueDate = b.dueDate === null ? null : date(b.dueDate, 'dueDate');
  if (b.labelIds !== undefined) p.labelIds = idList(b.labelIds, 'labelIds', 50);
  if (b.addLabelIds !== undefined) p.addLabelIds = idList(b.addLabelIds, 'addLabelIds', 50);
  if (b.removeLabelIds !== undefined) p.removeLabelIds = idList(b.removeLabelIds, 'removeLabelIds', 50);
  if (b.position !== undefined) p.position = num(b.position, 'position');
  return p;
}

function statusCategory(ctx: Ctx, statusId: string): StatusCategory {
  const s = ctx.db.get<{ category: StatusCategory }>('SELECT category FROM statuses WHERE id = ?', statusId);
  if (!s) throw badRequest('Unknown status');
  return s.category;
}

function checkRefs(ctx: Ctx, projectId: string, p: TaskPatch) {
  const { db } = ctx;
  if (p.assigneeId && !db.get('SELECT 1 FROM users WHERE id = ? AND active = 1', p.assigneeId)) throw badRequest('Unknown assignee');
  if (p.reviewerId && !db.get('SELECT 1 FROM users WHERE id = ? AND active = 1', p.reviewerId)) throw badRequest('Unknown reviewer');
  if (p.sprintId) {
    const s = db.get<{ project_id: string }>('SELECT project_id FROM sprints WHERE id = ?', p.sprintId);
    if (!s || s.project_id !== projectId) throw badRequest('That sprint belongs to another project');
  }
  for (const l of [...(p.labelIds ?? []), ...(p.addLabelIds ?? [])]) {
    if (!db.get('SELECT 1 FROM labels WHERE id = ?', l)) throw badRequest('Unknown label');
  }
}

/* ------------------------------- activity ------------------------------- */

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Records a change in the task history. Consecutive changes of the same field by the
 * same person within a few minutes are merged ("Todo → In Progress → Done" becomes
 * "Todo → Done"), and changes that cancel out disappear entirely (a file attached and
 * removed again leaves no trace).
 */
export function recordActivity(ctx: Ctx, taskId: string, actorId: string, kind: ActivityKind, data: Activity['data'] = {}) {
  const { db } = ctx;
  const t = now();
  const last = db.get('SELECT * FROM activity WHERE task_id = ? ORDER BY id DESC LIMIT 1', taskId);
  if (last && last.actor_id === actorId && last.kind === kind && t - (last.created_at as number) < COALESCE_MS && kind !== 'created') {
    const prev = toActivity(last).data;
    let merged: Activity['data'] | null;
    if (kind === 'labels') {
      const added = new Set(prev.added ?? []);
      const removed = new Set(prev.removed ?? []);
      for (const l of data.added ?? []) removed.has(l) ? removed.delete(l) : added.add(l);
      for (const l of data.removed ?? []) added.has(l) ? added.delete(l) : removed.add(l);
      merged = added.size || removed.size ? { added: [...added], removed: [...removed] } : null;
    } else if (kind === 'attachments') {
      // File names, not ids: two files may share a name, and removing one cancels one upload.
      const added = [...(prev.added ?? []), ...(data.added ?? [])];
      const removed = [...(prev.removed ?? [])];
      for (const f of data.removed ?? []) {
        const i = added.indexOf(f);
        if (i >= 0) added.splice(i, 1);
        else removed.push(f);
      }
      merged = added.length || removed.length ? { added, removed } : null;
    } else if (kind === 'title' || kind === 'description') {
      merged = { ...data, from: prev.from };
    } else {
      merged = sameValue(prev.from, data.to) ? null : { from: prev.from, to: data.to };
    }
    if (merged) db.run('UPDATE activity SET data = ?, created_at = ? WHERE id = ?', JSON.stringify(merged), t, last.id);
    else db.run('DELETE FROM activity WHERE id = ?', last.id);
    return;
  }
  db.run('INSERT INTO activity (task_id, actor_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)', taskId, actorId, kind, JSON.stringify(data), t);
}

/* ------------------------------- mutations ------------------------------- */

function rebalanceIfCrowded(ctx: Ctx, projectId: string, taskId: string, position: number, origin: string) {
  const { db, hub } = ctx;
  const crowded = db.get(
    'SELECT 1 FROM tasks WHERE project_id = ? AND id != ? AND deleted_at IS NULL AND ABS(position - ?) < 1e-7',
    projectId,
    taskId,
    position,
  );
  if (!crowded) return;
  const rows = db.all<{ id: string }>('SELECT id FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY position, created_at', projectId);
  rows.forEach((r, i) => db.run('UPDATE tasks SET position = ? WHERE id = ?', (i + 1) * 1024, r.id));
  for (const r of rows) {
    const task = loadTask(db, r.id);
    if (task) hub.broadcast({ type: 'task.upsert', data: task }, r.id === taskId ? origin : '');
  }
}

export function createTask(ctx: Ctx, user: User, raw: unknown, origin = ''): Task {
  const { db, hub } = ctx;
  const b = asBody(raw);
  const projectId = id(b.projectId, 'projectId');
  const taskId = b.id === undefined ? newId() : id(b.id, 'id');
  const p = parsePatch({ ...b, title: b.title ?? '' });

  return db.tx(() => {
    const project = db.get<{ next_number: number; archived: number }>('SELECT next_number, archived FROM projects WHERE id = ?', projectId);
    if (!project) throw badRequest('Unknown project');
    if (db.get('SELECT 1 FROM tasks WHERE id = ?', taskId)) throw badRequest('A task with this id already exists', 'conflict');
    checkRefs(ctx, projectId, p);

    const statusId =
      p.statusId ??
      db.get<{ id: string }>("SELECT id FROM statuses WHERE category = 'unstarted' ORDER BY position LIMIT 1")?.id ??
      db.get<{ id: string }>('SELECT id FROM statuses ORDER BY position LIMIT 1')!.id;
    const category = statusCategory(ctx, statusId);
    const position =
      p.position ??
      (db.get<{ m: number | null }>('SELECT MIN(position) AS m FROM tasks WHERE project_id = ? AND status_id = ? AND deleted_at IS NULL', projectId, statusId)?.m ?? 1024) - 1024;
    const t = now();
    const number = project.next_number;
    db.run('UPDATE projects SET next_number = next_number + 1 WHERE id = ?', projectId);
    db.run(
      `INSERT INTO tasks (id, project_id, number, title, description, status_id, priority, assignee_id, reviewer_id, creator_id,
        sprint_id, estimate, due_date, position, created_at, updated_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taskId,
      projectId,
      number,
      p.title!,
      p.description ?? '',
      statusId,
      p.priority ?? 0,
      p.assigneeId ?? null,
      p.reviewerId ?? null,
      user.id,
      p.sprintId ?? null,
      p.estimate ?? null,
      p.dueDate ?? null,
      position,
      t,
      t,
      category === 'started' || CLOSED_CATEGORIES.has(category) ? t : null,
      CLOSED_CATEGORIES.has(category) ? t : null,
    );
    for (const l of p.labelIds ?? []) db.run('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)', taskId, l);
    recordActivity(ctx, taskId, user.id, 'created');

    const task = loadTask(db, taskId)!;
    if (task.assigneeId) notify(ctx, [task.assigneeId], { task, actorId: user.id, kind: 'assigned' });
    if (task.reviewerId) notify(ctx, [task.reviewerId], { task, actorId: user.id, kind: 'review' });
    const mentioned = usersByHandles(db, extractMentions(task.description));
    if (mentioned.length) notify(ctx, mentioned, { task, actorId: user.id, kind: 'mention', excerpt: task.description });
    hub.broadcast({ type: 'task.upsert', data: task }, origin);
    return task;
  });
}

export function updateTask(ctx: Ctx, user: User, taskId: string, p: TaskPatch, origin = ''): Task {
  const { db, hub } = ctx;
  return db.tx(() => {
    const before = loadTask(db, taskId);
    if (!before) throw notFound('Task not found');
    checkRefs(ctx, before.projectId, p);

    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    const set = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    const t = now();
    let meaningful = false;
    const changed = <K extends keyof Task>(k: K, v: Task[K] | undefined): v is Task[K] => v !== undefined && !sameValue(before[k], v);

    if (changed('title', p.title)) {
      set('title', p.title);
      recordActivity(ctx, taskId, user.id, 'title', { from: before.title, to: p.title });
      meaningful = true;
    }
    if (changed('description', p.description)) {
      set('description', p.description);
      recordActivity(ctx, taskId, user.id, 'description');
      meaningful = true;
    }
    let statusChanged = false;
    if (changed('statusId', p.statusId)) {
      const from = statusCategory(ctx, before.statusId);
      const to = statusCategory(ctx, p.statusId);
      set('status_id', p.statusId);
      if ((to === 'started' || CLOSED_CATEGORIES.has(to)) && !before.startedAt) set('started_at', t);
      if (CLOSED_CATEGORIES.has(to) && !CLOSED_CATEGORIES.has(from)) set('completed_at', t);
      if (!CLOSED_CATEGORIES.has(to)) set('completed_at', null);
      recordActivity(ctx, taskId, user.id, 'status', { from: before.statusId, to: p.statusId });
      statusChanged = true;
      meaningful = true;
    }
    if (changed('priority', p.priority)) {
      set('priority', p.priority);
      recordActivity(ctx, taskId, user.id, 'priority', { from: before.priority, to: p.priority });
      meaningful = true;
    }
    if (changed('assigneeId', p.assigneeId)) {
      set('assignee_id', p.assigneeId);
      recordActivity(ctx, taskId, user.id, 'assignee', { from: before.assigneeId, to: p.assigneeId });
      meaningful = true;
    }
    if (changed('reviewerId', p.reviewerId)) {
      set('reviewer_id', p.reviewerId);
      recordActivity(ctx, taskId, user.id, 'reviewer', { from: before.reviewerId, to: p.reviewerId });
      meaningful = true;
    }
    if (changed('sprintId', p.sprintId)) {
      set('sprint_id', p.sprintId);
      recordActivity(ctx, taskId, user.id, 'sprint', { from: before.sprintId, to: p.sprintId });
      meaningful = true;
    }
    if (changed('estimate', p.estimate)) {
      set('estimate', p.estimate);
      recordActivity(ctx, taskId, user.id, 'estimate', { from: before.estimate, to: p.estimate });
      meaningful = true;
    }
    if (changed('dueDate', p.dueDate)) {
      set('due_date', p.dueDate);
      recordActivity(ctx, taskId, user.id, 'due', { from: before.dueDate, to: p.dueDate });
      meaningful = true;
    }
    if (p.position !== undefined && p.position !== before.position) set('position', p.position);

    let labels = new Set(before.labelIds);
    if (p.labelIds) labels = new Set(p.labelIds);
    for (const l of p.addLabelIds ?? []) labels.add(l);
    for (const l of p.removeLabelIds ?? []) labels.delete(l);
    const added = [...labels].filter((l) => !before.labelIds.includes(l));
    const removed = before.labelIds.filter((l) => !labels.has(l));
    if (added.length || removed.length) {
      for (const l of added) db.run('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)', taskId, l);
      for (const l of removed) db.run('DELETE FROM task_labels WHERE task_id = ? AND label_id = ?', taskId, l);
      recordActivity(ctx, taskId, user.id, 'labels', { added, removed });
      meaningful = true;
    }

    if (!sets.length && !meaningful) return before;
    if (meaningful) set('updated_at', t);
    if (sets.length) db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...vals, taskId);

    const task = loadTask(db, taskId)!;
    if (task.assigneeId && task.assigneeId !== before.assigneeId) {
      notify(ctx, [task.assigneeId], { task, actorId: user.id, kind: 'assigned' });
    }
    if (task.reviewerId && task.reviewerId !== before.reviewerId) {
      notify(ctx, [task.reviewerId], { task, actorId: user.id, kind: 'review' });
    }
    if (statusChanged) {
      notify(ctx, [task.creatorId, task.assigneeId, task.reviewerId].filter((x): x is string => !!x), {
        task,
        actorId: user.id,
        kind: 'status',
        statusId: task.statusId,
      });
    }
    if (p.description !== undefined && p.description !== before.description) {
      const old = new Set(extractMentions(before.description));
      const fresh = extractMentions(task.description).filter((h) => !old.has(h));
      const ids = usersByHandles(db, fresh);
      if (ids.length) notify(ctx, ids, { task, actorId: user.id, kind: 'mention', excerpt: task.description });
    }

    hub.broadcast({ type: 'task.upsert', data: task }, origin);
    if (meaningful) hub.broadcast({ type: 'timeline', data: { taskId } });
    if (p.position !== undefined) rebalanceIfCrowded(ctx, task.projectId, taskId, p.position, origin);
    return task;
  });
}

function setDeleted(ctx: Ctx, user: User, ids: string[], deleted: boolean, origin: string) {
  const { db, hub } = ctx;
  return db.tx(() => {
    let count = 0;
    for (const taskId of ids) {
      const row = db.get<{ deleted_at: number | null }>('SELECT deleted_at FROM tasks WHERE id = ?', taskId);
      if (!row || (row.deleted_at !== null) === deleted) continue;
      db.run('UPDATE tasks SET deleted_at = ? WHERE id = ?', deleted ? now() : null, taskId);
      recordActivity(ctx, taskId, user.id, deleted ? 'deleted' : 'restored');
      if (deleted) {
        db.run('DELETE FROM notifications WHERE task_id = ? AND read_at IS NULL', taskId);
        hub.broadcast({ type: 'task.delete', data: { id: taskId } }, origin);
      } else {
        hub.broadcast({ type: 'task.upsert', data: loadTask(db, taskId)! }, origin);
      }
      count++;
    }
    return count;
  });
}

/* --------------------------------- routes --------------------------------- */

export function taskRoutes(api: Hono<AppEnv>, ctx: Ctx) {
  const { db, hub } = ctx;

  api.post('/tasks', async (c) => {
    const task = createTask(ctx, c.get('user'), await c.req.json(), c.get('clientId'));
    return c.json(task, 201);
  });

  api.patch('/tasks/:id', async (c) => {
    const patch = parsePatch(await c.req.json());
    return c.json(updateTask(ctx, c.get('user'), c.req.param('id'), patch, c.get('clientId')));
  });

  api.post('/tasks/bulk', async (c) => {
    const b = asBody(await c.req.json());
    const ids = idList(b.ids, 'ids', 500);
    const patch = parsePatch(b.patch);
    if (patch.position !== undefined || patch.title !== undefined || patch.description !== undefined) {
      throw badRequest('Bulk updates cannot change title, description or position');
    }
    const tasks = db.tx(() => ids.map((taskId) => updateTask(ctx, c.get('user'), taskId, patch, c.get('clientId'))));
    return c.json(tasks);
  });

  api.post('/tasks/delete', async (c) => {
    const ids = idList(asBody(await c.req.json()).ids, 'ids', 500);
    return c.json({ deleted: setDeleted(ctx, c.get('user'), ids, true, c.get('clientId')) });
  });

  api.post('/tasks/restore', async (c) => {
    const ids = idList(asBody(await c.req.json()).ids, 'ids', 500);
    return c.json({ restored: setDeleted(ctx, c.get('user'), ids, false, c.get('clientId')) });
  });

  api.get('/tasks/:id/timeline', (c) => {
    const taskId = c.req.param('id');
    if (!db.get('SELECT 1 FROM tasks WHERE id = ?', taskId)) throw notFound('Task not found');
    return c.json({
      comments: db.all('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at', taskId).map(toComment),
      activity: db.all('SELECT * FROM activity WHERE task_id = ? ORDER BY id', taskId).map(toActivity),
    });
  });

  api.post('/tasks/:id/comments', async (c) => {
    const user = c.get('user');
    const b = asBody(await c.req.json());
    const body = str(b.body, 'Comment', { min: 1, max: 50_000 });
    const commentId = b.id === undefined ? newId() : id(b.id, 'id');
    const comment = db.tx(() => {
      const task = loadTask(db, c.req.param('id'));
      if (!task) throw notFound('Task not found');
      const recipients = watchers(db, task);
      const t = now();
      db.run('INSERT INTO comments (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', commentId, task.id, user.id, body, t, t);
      const mentioned = usersByHandles(db, extractMentions(body));
      if (mentioned.length) notify(ctx, mentioned, { task, actorId: user.id, kind: 'mention', excerpt: body });
      for (const m of mentioned) recipients.delete(m);
      notify(ctx, recipients, { task, actorId: user.id, kind: 'comment', excerpt: body });
      return toComment(db.get('SELECT * FROM comments WHERE id = ?', commentId)!);
    });
    hub.broadcast({ type: 'timeline', data: { taskId: comment.taskId } });
    return c.json(comment, 201);
  });

  api.patch('/comments/:id', async (c) => {
    const body = str(asBody(await c.req.json()).body, 'Comment', { min: 1, max: 50_000 });
    const row = db.get('SELECT * FROM comments WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('Comment not found');
    if (row.author_id !== c.get('user').id) throw forbidden('You can only edit your own comments');
    db.run('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?', body, now(), row.id);
    hub.broadcast({ type: 'timeline', data: { taskId: row.task_id as string } });
    return c.json(toComment(db.get('SELECT * FROM comments WHERE id = ?', row.id)!));
  });

  api.delete('/comments/:id', (c) => {
    const user = c.get('user');
    const row = db.get('SELECT * FROM comments WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('Comment not found');
    if (row.author_id !== user.id && user.role !== 'admin') throw forbidden('You can only delete your own comments');
    db.run('DELETE FROM comments WHERE id = ?', row.id);
    hub.broadcast({ type: 'timeline', data: { taskId: row.task_id as string } });
    return c.json({ ok: true });
  });
}
