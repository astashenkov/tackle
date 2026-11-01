import type { Task, User } from '../shared/types';
import { loadTask } from './db';
import type { Ctx } from './notify';
import { now } from './util';

const HOUR = 3_600_000;

/** Midnight on the 1st of the month `at` falls in, in the server's time zone (TZ). */
export function monthStart(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Midnight on the 1st of the month after the one `at` falls in. */
export function nextMonthStart(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

function moveToArchive(ctx: Ctx, ids: string[], actorId: string | null, at: number, origin = '') {
  const { db, hub } = ctx;
  for (const taskId of ids) {
    db.run('UPDATE tasks SET archived_at = ? WHERE id = ?', at, taskId);
    db.run("INSERT INTO activity (task_id, actor_id, kind, data, created_at) VALUES (?, ?, 'archived', '{}', ?)", taskId, actorId, at);
    hub.broadcast({ type: 'task.upsert', data: loadTask(db, taskId)! }, origin);
  }
}

/**
 * Moves done tasks to the archive once the month they were finished in is over, so the Done
 * column only holds this month's work. Returns the ids of the archived tasks.
 */
export function archiveDoneTasks(ctx: Ctx, at = now()): string[] {
  const { db } = ctx;
  return db.tx(() => {
    const ids = db
      .all<{ id: string }>(
        `SELECT t.id FROM tasks t JOIN statuses s ON s.id = t.status_id
         WHERE s.category = 'completed' AND t.archived_at IS NULL AND t.deleted_at IS NULL
           AND COALESCE(t.completed_at, t.updated_at) < ?
         ORDER BY t.completed_at`,
        monthStart(at),
      )
      .map((r) => r.id);
    // Nobody did this by hand, so the history entries have no actor.
    moveToArchive(ctx, ids, null, at);
    return ids;
  });
}

/** Moves the given tasks to the archive right away, however recently they were finished. Only done tasks move. */
export function archiveTasks(ctx: Ctx, user: User, ids: string[], origin = ''): Task[] {
  const { db } = ctx;
  return db.tx(() => {
    const done = ids.filter((taskId) =>
      db.get(
        `SELECT 1 FROM tasks t JOIN statuses s ON s.id = t.status_id
         WHERE t.id = ? AND s.category = 'completed' AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
        taskId,
      ),
    );
    moveToArchive(ctx, done, user.id, now(), origin);
    return done.map((taskId) => loadTask(db, taskId)!);
  });
}

/**
 * Archives right away (catching up on a 1st the server was down for), then again as each month
 * begins. It also wakes up hourly, which picks up last month's tasks that come back later
 * (restored after deletion) and keeps working if the clock or time zone changes.
 */
export function scheduleArchive(ctx: Ctx): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const run = () => {
    try {
      const archived = archiveDoneTasks(ctx);
      if (archived.length) console.log(`Moved ${archived.length} done task(s) to the archive`);
    } catch (err) {
      console.error('Archiving done tasks failed', err);
    }
    const t = now();
    timer = setTimeout(run, Math.min(nextMonthStart(t) - t + 1000, HOUR));
    timer.unref();
  };
  run();
  return () => clearTimeout(timer);
}
