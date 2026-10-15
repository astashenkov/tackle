import type { Hono } from 'hono';
import { CLOSED_CATEGORIES } from '../../shared/constants';
import type { Sprint, SprintStats, StatusCategory } from '../../shared/types';
import type { AppEnv } from '../auth';
import { loadTask, toSprint } from '../db';
import type { Ctx } from '../notify';
import { recordActivity } from './tasks';
import { asBody, badRequest, date, id, newId, notFound, now, optStr, str } from '../util';

function loadSprint(ctx: Ctx, sprintId: string): Sprint {
  const row = ctx.db.get('SELECT * FROM sprints WHERE id = ?', sprintId);
  if (!row) throw notFound('Sprint not found');
  return toSprint(row);
}

function checkDates(start: string, end: string) {
  if (end < start) throw badRequest('The sprint must end after it starts');
}

export function sprintStats(ctx: Ctx, sprintId: string): SprintStats {
  const rows = ctx.db.all<{ estimate: number | null; category: StatusCategory }>(
    `SELECT t.estimate, s.category FROM tasks t JOIN statuses s ON s.id = t.status_id
     WHERE t.sprint_id = ? AND t.deleted_at IS NULL`,
    sprintId,
  );
  const stats: SprintStats = { total: 0, completed: 0, points: 0, completedPoints: 0 };
  for (const r of rows) {
    if (r.category === 'canceled') continue;
    stats.total++;
    stats.points += r.estimate ?? 0;
    if (r.category === 'completed') {
      stats.completed++;
      stats.completedPoints += r.estimate ?? 0;
    }
  }
  return stats;
}

export function sprintRoutes(api: Hono<AppEnv>, ctx: Ctx) {
  const { db, hub } = ctx;
  const emit = (sprintId: string, origin: string) => hub.broadcast({ type: 'sprint.upsert', data: loadSprint(ctx, sprintId) }, origin);

  api.post('/sprints', async (c) => {
    const b = asBody(await c.req.json());
    const projectId = id(b.projectId, 'projectId');
    const startDate = date(b.startDate, 'startDate');
    const endDate = date(b.endDate, 'endDate');
    checkDates(startDate, endDate);
    const sprintId = b.id === undefined ? newId() : id(b.id, 'id');
    db.tx(() => {
      if (!db.get('SELECT 1 FROM projects WHERE id = ?', projectId)) throw badRequest('Unknown project');
      const { n } = db.get<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM sprints WHERE project_id = ?', projectId)!;
      const name = optStr(b.name, 'Name', { max: 80 }) || `Sprint ${n}`;
      db.run(
        'INSERT INTO sprints (id, project_id, number, name, goal, start_date, end_date, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        sprintId,
        projectId,
        n,
        name,
        optStr(b.goal, 'Goal', { max: 2000 }) ?? '',
        startDate,
        endDate,
        'planned',
        now(),
      );
    });
    emit(sprintId, c.get('clientId'));
    return c.json(loadSprint(ctx, sprintId), 201);
  });

  api.patch('/sprints/:id', async (c) => {
    const sprint = loadSprint(ctx, c.req.param('id'));
    const b = asBody(await c.req.json());
    const name = b.name === undefined ? sprint.name : str(b.name, 'Name', { min: 1, max: 80 });
    const goal = b.goal === undefined ? sprint.goal : str(b.goal, 'Goal', { max: 2000 });
    const startDate = b.startDate === undefined ? sprint.startDate : date(b.startDate, 'startDate');
    const endDate = b.endDate === undefined ? sprint.endDate : date(b.endDate, 'endDate');
    checkDates(startDate, endDate);
    db.run('UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ? WHERE id = ?', name, goal, startDate, endDate, sprint.id);
    emit(sprint.id, c.get('clientId'));
    return c.json(loadSprint(ctx, sprint.id));
  });

  api.post('/sprints/:id/start', async (c) => {
    const sprint = loadSprint(ctx, c.req.param('id'));
    const b = asBody(await c.req.json().catch(() => ({})));
    if (sprint.state !== 'planned') throw badRequest('Only planned sprints can be started');
    const active = db.get("SELECT name FROM sprints WHERE project_id = ? AND state = 'active'", sprint.projectId);
    if (active) throw badRequest(`Complete "${active.name}" before starting another sprint`, 'conflict');
    const startDate = b.startDate === undefined ? sprint.startDate : date(b.startDate, 'startDate');
    const endDate = b.endDate === undefined ? sprint.endDate : date(b.endDate, 'endDate');
    checkDates(startDate, endDate);
    db.run("UPDATE sprints SET state = 'active', start_date = ?, end_date = ? WHERE id = ?", startDate, endDate, sprint.id);
    emit(sprint.id, c.get('clientId'));
    return c.json(loadSprint(ctx, sprint.id));
  });

  /**
   * Completes the active sprint. Unfinished tasks move to `moveTo`: another sprint id,
   * "backlog" (no sprint) or "new" (a freshly created next sprint of the same length).
   */
  api.post('/sprints/:id/complete', async (c) => {
    const user = c.get('user');
    const origin = c.get('clientId');
    const sprint = loadSprint(ctx, c.req.param('id'));
    if (sprint.state !== 'active') throw badRequest('Only the active sprint can be completed');
    const b = asBody(await c.req.json().catch(() => ({})));
    const moveTo = b.moveTo === undefined || b.moveTo === 'backlog' ? 'backlog' : b.moveTo === 'new' ? 'new' : id(b.moveTo, 'moveTo');

    const result = db.tx(() => {
      let targetId: string | null = null;
      if (moveTo === 'new') {
        const length = Math.max(1, Math.round((Date.parse(sprint.endDate) - Date.parse(sprint.startDate)) / 86_400_000));
        const start = new Date(Math.max(Date.now(), Date.parse(sprint.endDate) + 86_400_000));
        const end = new Date(start.getTime() + length * 86_400_000);
        const { n } = db.get<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM sprints WHERE project_id = ?', sprint.projectId)!;
        targetId = newId();
        db.run(
          "INSERT INTO sprints (id, project_id, number, name, goal, start_date, end_date, state, created_at) VALUES (?, ?, ?, ?, '', ?, ?, 'planned', ?)",
          targetId,
          sprint.projectId,
          n,
          `Sprint ${n}`,
          start.toISOString().slice(0, 10),
          end.toISOString().slice(0, 10),
          now(),
        );
      } else if (moveTo !== 'backlog') {
        const target = loadSprint(ctx, moveTo);
        if (target.projectId !== sprint.projectId || target.state === 'completed' || target.id === sprint.id) {
          throw badRequest('Unfinished tasks can only move to an upcoming sprint of the same project');
        }
        targetId = target.id;
      }

      const stats = sprintStats(ctx, sprint.id);
      db.run("UPDATE sprints SET state = 'completed', completed_at = ?, stats = ? WHERE id = ?", now(), JSON.stringify(stats), sprint.id);

      const unfinished = db
        .all<{ id: string; category: StatusCategory }>(
          `SELECT t.id, s.category FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.sprint_id = ? AND t.deleted_at IS NULL`,
          sprint.id,
        )
        .filter((r) => !CLOSED_CATEGORIES.has(r.category));
      for (const t of unfinished) {
        db.run('UPDATE tasks SET sprint_id = ?, updated_at = ? WHERE id = ?', targetId, now(), t.id);
        recordActivity(ctx, t.id, user.id, 'sprint', { from: sprint.id, to: targetId });
      }
      return { targetId, moved: unfinished.map((t) => t.id) };
    });

    emit(sprint.id, origin);
    if (result.targetId) emit(result.targetId, origin);
    for (const taskId of result.moved) {
      hub.broadcast({ type: 'task.upsert', data: loadTask(db, taskId)! }, origin);
    }
    return c.json({ sprint: loadSprint(ctx, sprint.id), movedTo: result.targetId, moved: result.moved.length });
  });

  api.delete('/sprints/:id', (c) => {
    const sprint = loadSprint(ctx, c.req.param('id'));
    const origin = c.get('clientId');
    const affected = db.all<{ id: string }>('SELECT id FROM tasks WHERE sprint_id = ? AND deleted_at IS NULL', sprint.id);
    db.tx(() => {
      db.run('UPDATE tasks SET sprint_id = NULL WHERE sprint_id = ?', sprint.id);
      db.run('DELETE FROM sprints WHERE id = ?', sprint.id);
    });
    hub.broadcast({ type: 'sprint.delete', data: { id: sprint.id } }, origin);
    for (const t of affected) hub.broadcast({ type: 'task.upsert', data: loadTask(db, t.id)! }, origin);
    return c.json({ ok: true });
  });
}
