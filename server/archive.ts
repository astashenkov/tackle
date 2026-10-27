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

/**
 * Moves done tasks to the archive once the month they were finished in is over, so the Done
 * column only holds this month's work. Tasks of a running sprint stay on the board until the
 * sprint is completed. Returns the ids of the archived tasks.
 */
export function archiveDoneTasks(ctx: Ctx, at = now()): string[] {
  const { db, hub } = ctx;
  return db.tx(() => {
    const ids = db
      .all<{ id: string }>(
        `SELECT t.id FROM tasks t
         JOIN statuses s ON s.id = t.status_id
         LEFT JOIN sprints sp ON sp.id = t.sprint_id
         WHERE s.category = 'completed' AND t.archived_at IS NULL AND t.deleted_at IS NULL
           AND COALESCE(t.completed_at, t.updated_at) < ? AND (sp.state IS NULL OR sp.state != 'active')
         ORDER BY t.completed_at`,
        monthStart(at),
      )
      .map((r) => r.id);
    for (const taskId of ids) {
      db.run('UPDATE tasks SET archived_at = ? WHERE id = ?', at, taskId);
      // Nobody did this by hand, so the history entry has no actor.
      db.run("INSERT INTO activity (task_id, actor_id, kind, data, created_at) VALUES (?, NULL, 'archived', '{}', ?)", taskId, at);
      hub.broadcast({ type: 'task.upsert', data: loadTask(db, taskId)! });
    }
    return ids;
  });
}

/**
 * Archives right away (catching up on a 1st the server was down for), then again as each month
 * begins. It also wakes up hourly, which picks up a sprint's tasks soon after the sprint is completed.
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
