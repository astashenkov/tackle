import type { Hono } from 'hono';
import { HANDLE_RE, PROJECT_KEY_RE, STATUS_CATEGORIES } from '../../shared/constants';
import type { Snapshot, Workspace } from '../../shared/types';
import { hashPassword, requireAdmin, verifyPassword, type AppEnv } from '../auth';
import {
  loadAllTasks,
  loadTask,
  toAttachment,
  toComment,
  toLabel,
  toNotification,
  toProject,
  toSprint,
  toStatus,
  toUser,
} from '../db';
import type { Ctx } from '../notify';
import {
  asBody,
  badRequest,
  color,
  id,
  newId,
  newToken,
  notFound,
  now,
  num,
  oneOf,
  optStr,
  password,
  str,
} from '../util';

export function workspaceInfo(ctx: Ctx): Workspace {
  return { name: ctx.db.getMeta('workspace_name') ?? 'Tackle' };
}

export function workspaceRoutes(api: Hono<AppEnv>, ctx: Ctx) {
  const { db, hub, files } = ctx;

  /* ------------------------------ sync ------------------------------ */

  api.get('/sync', (c) => {
    const me = c.get('user');
    const snapshot: Snapshot = {
      workspace: workspaceInfo(ctx),
      me,
      users: db.all('SELECT * FROM users ORDER BY name COLLATE NOCASE').map(toUser),
      projects: db.all('SELECT * FROM projects ORDER BY position, created_at').map(toProject),
      statuses: db.all('SELECT * FROM statuses ORDER BY position').map(toStatus),
      labels: db.all('SELECT * FROM labels ORDER BY name COLLATE NOCASE').map(toLabel),
      sprints: db.all('SELECT * FROM sprints ORDER BY start_date, number').map(toSprint),
      tasks: loadAllTasks(db),
      attachments: db.all('SELECT * FROM attachments ORDER BY created_at').map(toAttachment),
      unread: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me.id)!.n,
      serverTime: now(),
      uploadLimit: files.maxBytes,
    };
    return c.json(snapshot);
  });

  /* ---------------------------- workspace ---------------------------- */

  api.patch('/workspace', async (c) => {
    requireAdmin(c);
    const name = str(asBody(await c.req.json()).name, 'Workspace name', { min: 1, max: 60 });
    db.setMeta('workspace_name', name);
    hub.broadcast({ type: 'workspace.update', data: workspaceInfo(ctx) }, c.get('clientId'));
    return c.json(workspaceInfo(ctx));
  });

  api.get('/export', (c) => {
    requireAdmin(c);
    const dump = {
      exportedAt: new Date().toISOString(),
      workspace: workspaceInfo(ctx),
      users: db.all('SELECT * FROM users').map(toUser),
      projects: db.all('SELECT * FROM projects').map(toProject),
      statuses: db.all('SELECT * FROM statuses').map(toStatus),
      labels: db.all('SELECT * FROM labels').map(toLabel),
      sprints: db.all('SELECT * FROM sprints').map(toSprint),
      tasks: loadAllTasks(db),
      comments: db.all('SELECT * FROM comments').map(toComment),
      // Only the list: the files themselves stay in the attachments directory.
      attachments: db.all('SELECT * FROM attachments').map(toAttachment),
    };
    c.header('Content-Disposition', `attachment; filename="tackle-export-${dump.exportedAt.slice(0, 10)}.json"`);
    return c.json(dump);
  });

  /* ----------------------------- projects ----------------------------- */

  const loadProject = (projectId: string) => {
    const row = db.get('SELECT * FROM projects WHERE id = ?', projectId);
    if (!row) throw notFound('Project not found');
    return toProject(row);
  };

  api.post('/projects', async (c) => {
    const b = asBody(await c.req.json());
    const name = str(b.name, 'Project name', { min: 1, max: 60 });
    const key = str(b.key, 'Key', { min: 2, max: 6 }).toUpperCase();
    if (!PROJECT_KEY_RE.test(key)) throw badRequest('Key must be 2–6 latin letters or digits and start with a letter');
    if (db.get('SELECT 1 FROM projects WHERE key = ?', key)) throw badRequest(`Key ${key} is already used by another project`, 'conflict');
    const projectId = b.id === undefined ? newId() : id(b.id, 'id');
    const { p } = db.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM projects')!;
    db.run(
      'INSERT INTO projects (id, key, name, description, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      projectId,
      key,
      name,
      optStr(b.description, 'Description', { max: 2000 }) ?? '',
      b.color === undefined ? '#6366f1' : color(b.color),
      p,
      now(),
    );
    const project = loadProject(projectId);
    hub.broadcast({ type: 'project.upsert', data: project }, c.get('clientId'));
    return c.json(project, 201);
  });

  api.patch('/projects/:id', async (c) => {
    const project = loadProject(c.req.param('id'));
    const b = asBody(await c.req.json());
    db.run(
      'UPDATE projects SET name = ?, description = ?, color = ?, archived = ?, position = ? WHERE id = ?',
      b.name === undefined ? project.name : str(b.name, 'Project name', { min: 1, max: 60 }),
      b.description === undefined ? project.description : str(b.description, 'Description', { max: 2000 }),
      b.color === undefined ? project.color : color(b.color),
      b.archived === undefined ? project.archived : !!b.archived,
      b.position === undefined ? project.position : num(b.position, 'position'),
      project.id,
    );
    const updated = loadProject(project.id);
    hub.broadcast({ type: 'project.upsert', data: updated }, c.get('clientId'));
    return c.json(updated);
  });

  api.delete('/projects/:id', (c) => {
    requireAdmin(c);
    const project = loadProject(c.req.param('id'));
    const attached = db.all<{ id: string }>('SELECT a.id FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.project_id = ?', project.id);
    db.tx(() => {
      db.run('DELETE FROM tasks WHERE project_id = ?', project.id);
      db.run('DELETE FROM projects WHERE id = ?', project.id);
    });
    for (const a of attached) files.remove(a.id);
    hub.broadcast({ type: 'resync', data: {} });
    return c.json({ ok: true });
  });

  /* ----------------------------- statuses ----------------------------- */

  api.post('/statuses', async (c) => {
    requireAdmin(c);
    const b = asBody(await c.req.json());
    const statusId = newId();
    const { p } = db.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM statuses')!;
    db.run(
      'INSERT INTO statuses (id, name, category, color, position) VALUES (?, ?, ?, ?, ?)',
      statusId,
      str(b.name, 'Status name', { min: 1, max: 40 }),
      oneOf(b.category, 'category', STATUS_CATEGORIES),
      b.color === undefined ? '#94a3b8' : color(b.color),
      b.position === undefined ? p : num(b.position, 'position'),
    );
    const status = toStatus(db.get('SELECT * FROM statuses WHERE id = ?', statusId)!);
    hub.broadcast({ type: 'status.upsert', data: status }, c.get('clientId'));
    return c.json(status, 201);
  });

  api.patch('/statuses/:id', async (c) => {
    requireAdmin(c);
    const row = db.get('SELECT * FROM statuses WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('Status not found');
    const s = toStatus(row);
    const b = asBody(await c.req.json());
    db.run(
      'UPDATE statuses SET name = ?, category = ?, color = ?, position = ? WHERE id = ?',
      b.name === undefined ? s.name : str(b.name, 'Status name', { min: 1, max: 40 }),
      b.category === undefined ? s.category : oneOf(b.category, 'category', STATUS_CATEGORIES),
      b.color === undefined ? s.color : color(b.color),
      b.position === undefined ? s.position : num(b.position, 'position'),
      s.id,
    );
    const status = toStatus(db.get('SELECT * FROM statuses WHERE id = ?', s.id)!);
    hub.broadcast({ type: 'status.upsert', data: status }, c.get('clientId'));
    return c.json(status);
  });

  /** Deletes a status; its tasks move to `replacementId`. */
  api.delete('/statuses/:id', (c) => {
    requireAdmin(c);
    const statusId = c.req.param('id');
    const replacementId = c.req.query('replacementId');
    if (!db.get('SELECT 1 FROM statuses WHERE id = ?', statusId)) throw notFound('Status not found');
    const { n } = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM statuses')!;
    if (n <= 1) throw badRequest('A workspace needs at least one status');
    const used = db.all<{ id: string }>('SELECT id FROM tasks WHERE status_id = ?', statusId);
    if (used.length) {
      if (!replacementId || replacementId === statusId || !db.get('SELECT 1 FROM statuses WHERE id = ?', replacementId)) {
        throw badRequest('Choose a status to move existing tasks to');
      }
    }
    db.tx(() => {
      if (used.length) db.run('UPDATE tasks SET status_id = ? WHERE status_id = ?', replacementId!, statusId);
      db.run('DELETE FROM statuses WHERE id = ?', statusId);
    });
    hub.broadcast({ type: 'status.delete', data: { id: statusId } });
    for (const t of used) {
      const task = loadTask(db, t.id);
      if (task) hub.broadcast({ type: 'task.upsert', data: task });
    }
    return c.json({ ok: true });
  });

  /* ------------------------------ labels ------------------------------ */

  api.post('/labels', async (c) => {
    const b = asBody(await c.req.json());
    const name = str(b.name, 'Label name', { min: 1, max: 40 });
    if (db.get('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE', name)) throw badRequest(`Label "${name}" already exists`, 'conflict');
    const labelId = b.id === undefined ? newId() : id(b.id, 'id');
    db.run('INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)', labelId, name, b.color === undefined ? '#64748b' : color(b.color), now());
    const label = toLabel(db.get('SELECT * FROM labels WHERE id = ?', labelId)!);
    hub.broadcast({ type: 'label.upsert', data: label }, c.get('clientId'));
    return c.json(label, 201);
  });

  api.patch('/labels/:id', async (c) => {
    const row = db.get('SELECT * FROM labels WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('Label not found');
    const b = asBody(await c.req.json());
    const name = b.name === undefined ? (row.name as string) : str(b.name, 'Label name', { min: 1, max: 40 });
    if (db.get('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE AND id != ?', name, row.id)) throw badRequest(`Label "${name}" already exists`, 'conflict');
    db.run('UPDATE labels SET name = ?, color = ? WHERE id = ?', name, b.color === undefined ? (row.color as string) : color(b.color), row.id);
    const label = toLabel(db.get('SELECT * FROM labels WHERE id = ?', row.id)!);
    hub.broadcast({ type: 'label.upsert', data: label }, c.get('clientId'));
    return c.json(label);
  });

  api.delete('/labels/:id', (c) => {
    const labelId = c.req.param('id');
    const affected = db.all<{ task_id: string }>('SELECT task_id FROM task_labels WHERE label_id = ?', labelId);
    db.run('DELETE FROM labels WHERE id = ?', labelId);
    hub.broadcast({ type: 'label.delete', data: { id: labelId } });
    for (const a of affected) {
      const task = loadTask(db, a.task_id);
      if (task) hub.broadcast({ type: 'task.upsert', data: task });
    }
    return c.json({ ok: true });
  });

  /* ------------------------------- users ------------------------------- */

  api.patch('/me', async (c) => {
    const me = c.get('user');
    const b = asBody(await c.req.json());
    const name = b.name === undefined ? me.name : str(b.name, 'Name', { min: 1, max: 60 });
    let handle = me.handle;
    if (b.handle !== undefined) {
      handle = str(b.handle, 'Handle', { min: 1, max: 31 }).toLowerCase().replace(/^@/, '');
      if (!HANDLE_RE.test(handle)) throw badRequest('Handle may contain latin letters, digits, dots, dashes and underscores');
      if (db.get('SELECT 1 FROM users WHERE handle = ? AND id != ?', handle, me.id)) throw badRequest(`@${handle} is already taken`, 'conflict');
    }
    if (b.newPassword !== undefined) {
      const row = db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', me.id)!;
      const current = typeof b.currentPassword === 'string' ? b.currentPassword : '';
      if (!(await verifyPassword(current, row.password_hash))) throw badRequest('Current password is incorrect', 'wrong_password');
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password(b.newPassword)), me.id);
    }
    db.run('UPDATE users SET name = ?, handle = ?, color = ? WHERE id = ?', name, handle, b.color === undefined ? me.color : color(b.color), me.id);
    const user = toUser(db.get('SELECT * FROM users WHERE id = ?', me.id)!);
    hub.broadcast({ type: 'user.upsert', data: user }, c.get('clientId'));
    return c.json(user);
  });

  api.patch('/users/:id', async (c) => {
    requireAdmin(c);
    const row = db.get('SELECT * FROM users WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('User not found');
    const target = toUser(row);
    const b = asBody(await c.req.json());
    const role = b.role === undefined ? target.role : oneOf(b.role, 'role', ['admin', 'member'] as const);
    const active = b.active === undefined ? target.active : !!b.active;
    if (target.role === 'admin' && (role !== 'admin' || !active)) {
      const { n } = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", target.id)!;
      if (n === 0) throw badRequest('The workspace needs at least one active admin');
    }
    db.run('UPDATE users SET role = ?, active = ? WHERE id = ?', role, active, target.id);
    if (!active) {
      db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
      hub.kick(target.id);
    }
    const user = toUser(db.get('SELECT * FROM users WHERE id = ?', target.id)!);
    hub.broadcast({ type: 'user.upsert', data: user }, c.get('clientId'));
    return c.json(user);
  });

  /** Creates a one-time password reset link for a member (there is no e-mail in a self-hosted setup). */
  api.post('/users/:id/reset', (c) => {
    requireAdmin(c);
    const target = db.get('SELECT id FROM users WHERE id = ?', c.req.param('id'));
    if (!target) throw notFound('User not found');
    const token = newToken();
    db.run("DELETE FROM invites WHERE kind = 'reset' AND user_id = ?", target.id);
    db.run(
      "INSERT INTO invites (token, kind, role, user_id, created_by, created_at, expires_at) VALUES (?, 'reset', 'member', ?, ?, ?, ?)",
      token,
      target.id,
      c.get('user').id,
      now(),
      now() + 2 * 86_400_000,
    );
    return c.json({ token, path: `/reset/${token}` });
  });

  /* ------------------------------ invites ------------------------------ */

  api.get('/invites', (c) => {
    requireAdmin(c);
    const rows = db.all("SELECT * FROM invites WHERE kind = 'invite' AND expires_at > ? ORDER BY created_at DESC", now());
    return c.json(rows.map((r) => ({ token: r.token, kind: r.kind, role: r.role, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at })));
  });

  api.post('/invites', async (c) => {
    requireAdmin(c);
    const b = asBody(await c.req.json().catch(() => ({})));
    const role = b.role === undefined ? 'member' : oneOf(b.role, 'role', ['admin', 'member'] as const);
    const token = newToken();
    const t = now();
    db.run("INSERT INTO invites (token, kind, role, created_by, created_at, expires_at) VALUES (?, 'invite', ?, ?, ?, ?)", token, role, c.get('user').id, t, t + 7 * 86_400_000);
    return c.json({ token, kind: 'invite', role, userId: null, createdAt: t, expiresAt: t + 7 * 86_400_000 }, 201);
  });

  api.delete('/invites/:token', (c) => {
    requireAdmin(c);
    db.run('DELETE FROM invites WHERE token = ?', c.req.param('token'));
    return c.json({ ok: true });
  });

  /* --------------------------- notifications --------------------------- */

  api.get('/notifications', (c) => {
    const rows = db.all(
      `SELECT n.* FROM notifications n JOIN tasks t ON t.id = n.task_id
       WHERE n.user_id = ? AND t.deleted_at IS NULL ORDER BY n.created_at DESC, n.id DESC LIMIT 200`,
      c.get('user').id,
    );
    return c.json(rows.map(toNotification));
  });

  api.post('/notifications/read', async (c) => {
    const me = c.get('user');
    const b = asBody(await c.req.json());
    const unread = b.unread === true;
    const readAt = unread ? null : now();
    if (b.all === true) {
      db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', readAt, me.id);
      hub.toUser(me.id, { type: 'notifications.read', data: { ids: 'all' } }, c.get('clientId'));
    } else {
      if (!Array.isArray(b.ids) || b.ids.length > 500 || !b.ids.every((x) => Number.isInteger(x))) throw badRequest('ids must be a list of numbers');
      for (const nid of b.ids as number[]) db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', readAt, nid, me.id);
      hub.toUser(me.id, { type: 'notifications.read', data: { ids: b.ids as number[] } }, c.get('clientId'));
    }
    const { n } = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me.id)!;
    return c.json({ unread: n });
  });

}
