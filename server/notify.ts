import type { NotificationKind, Task } from '../shared/types';
import { toNotification, type DB } from './db';
import type { EventHub } from './events';
import type { FileStore } from './files';
import { now } from './util';

export interface Ctx {
  db: DB;
  hub: EventHub;
  files: FileStore;
}

export function taskRef(db: DB, task: Task): string {
  const p = db.get<{ key: string }>('SELECT key FROM projects WHERE id = ?', task.projectId);
  return `${p?.key ?? '?'}-${task.number}`;
}

/** Users who care about a task: its creator, assignee, reviewer and everyone who commented on it. */
export function watchers(db: DB, task: Task): Set<string> {
  const ids = new Set<string>();
  if (task.creatorId) ids.add(task.creatorId);
  if (task.assigneeId) ids.add(task.assigneeId);
  if (task.reviewerId) ids.add(task.reviewerId);
  for (const r of db.all<{ author_id: string }>('SELECT DISTINCT author_id FROM comments WHERE task_id = ? AND author_id IS NOT NULL', task.id)) {
    ids.add(r.author_id);
  }
  return ids;
}

export function usersByHandles(db: DB, handles: string[]): string[] {
  if (!handles.length) return [];
  const placeholders = handles.map(() => '?').join(',');
  return db.all<{ id: string }>(`SELECT id FROM users WHERE active = 1 AND handle IN (${placeholders})`, ...handles).map((r) => r.id);
}

/**
 * Creates inbox notifications and pushes them to the recipients' open tabs.
 * The actor never notifies themselves. Repeated unread "status" notifications for the
 * same task are collapsed into one so dragging a card around does not spam the inbox.
 */
export function notify(
  ctx: Ctx,
  recipients: Iterable<string>,
  n: { task: Task; actorId: string; kind: NotificationKind; excerpt?: string; statusId?: string },
) {
  const { db, hub } = ctx;
  const data = JSON.stringify({
    taskTitle: n.task.title,
    taskRef: taskRef(db, n.task),
    ...(n.excerpt ? { excerpt: n.excerpt.slice(0, 280) } : {}),
    ...(n.statusId ? { statusId: n.statusId } : {}),
  });
  for (const userId of new Set(recipients)) {
    if (userId === n.actorId) continue;
    const active = db.get('SELECT 1 FROM users WHERE id = ? AND active = 1', userId);
    if (!active) continue;
    let id: number;
    const existing =
      n.kind === 'status'
        ? db.get<{ id: number }>(
            "SELECT id FROM notifications WHERE user_id = ? AND task_id = ? AND kind = 'status' AND read_at IS NULL",
            userId,
            n.task.id,
          )
        : undefined;
    if (existing) {
      db.run('UPDATE notifications SET actor_id = ?, data = ?, created_at = ? WHERE id = ?', n.actorId, data, now(), existing.id);
      id = existing.id;
    } else {
      id = db.run(
        'INSERT INTO notifications (user_id, task_id, actor_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        userId,
        n.task.id,
        n.actorId,
        n.kind,
        data,
        now(),
      ).lastInsertRowid;
    }
    const row = db.get('SELECT * FROM notifications WHERE id = ?', id)!;
    hub.toUser(userId, { type: 'notification', data: toNotification(row) });
  }
}
