import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Attachment, Notification, Snapshot, Sprint, Task } from '../../shared/types';
import { createApp } from '../../server/app';
import { archiveDoneTasks, nextMonthStart, scheduleArchive } from '../../server/archive';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { hashPassword } from '../../server/auth';
import { backupDatabase } from '../../server/backup';
import { DB, MIGRATIONS, loadAllTasks } from '../../server/db';

type App = ReturnType<typeof createApp>['app'];

class Client {
  cookie = '';
  constructor(private app: App) {}

  async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const res = await this.app.request(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, data };
  }
  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>('POST', p, b);
  patch = <T = any>(p: string, b: unknown) => this.req<T>('PATCH', p, b);
  del = <T = any>(p: string) => this.req<T>('DELETE', p);

  /** Uploads a file the way the browser does: the body is the file, the name goes in the query. */
  async upload<T = any>(taskId: string, body: BodyInit, opts: { name?: string; type?: string; id?: string; headers?: Record<string, string> } = {}) {
    const query = new URLSearchParams({ name: opts.name ?? 'notes.txt', ...(opts.id ? { id: opts.id } : {}) });
    const res = await this.app.request(`/api/tasks/${taskId}/attachments?${query}`, {
      method: 'POST',
      headers: { 'content-type': opts.type ?? 'text/plain', ...(this.cookie ? { cookie: this.cookie } : {}), ...opts.headers },
      body,
    });
    return { status: res.status, data: (await res.json()) as T };
  }

  /** Fetches a raw response (for file downloads). */
  fetch(path: string, headers: Record<string, string> = {}) {
    return this.app.request(`/api${path}`, { headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers } });
  }
}

let app: App;
let hub: ReturnType<typeof createApp>['hub'];
let ctx: ReturnType<typeof createApp>['ctx'];
let admin: Client;
let snap: Snapshot;
let filesDir: string;
const UPLOAD_LIMIT = 64 * 1024;

const status = (name: string) => snap.statuses.find((s) => s.name === name)!.id;

beforeEach(async () => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tackle-files-'));
  ({ app, hub, ctx } = createApp({ db: new DB(':memory:'), attachmentsDir: filesDir, maxUploadBytes: UPLOAD_LIMIT }));
  admin = new Client(app);
  const res = await admin.post('/setup', {
    workspaceName: 'Acme',
    name: 'Alex Admin',
    email: 'alex@example.com',
    password: 'password123',
    projectName: 'Web app',
    projectKey: 'web',
  });
  assert.equal(res.status, 201);
  snap = (await admin.get<Snapshot>('/sync')).data;
});

afterEach(() => fs.rmSync(filesDir, { recursive: true, force: true }));

async function invite(name: string, email: string): Promise<Client> {
  const inv = await admin.post('/invites', { role: 'member' });
  const c = new Client(app);
  const res = await c.post('/join', { token: inv.data.token, name, email, password: 'password123' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return c;
}

describe('auth', () => {
  test('setup only works once and creates defaults', async () => {
    assert.equal(snap.projects[0].key, 'WEB');
    assert.equal(snap.statuses.length, 6);
    assert.equal(snap.me.handle, 'alex');
    assert.equal(snap.me.role, 'admin');
    const again = await new Client(app).post('/setup', { workspaceName: 'X', name: 'Y', email: 'y@y.y', password: 'password123', projectName: 'P', projectKey: 'PP' });
    assert.equal(again.status, 409);
  });

  test('setup in Russian localizes default statuses', async () => {
    const fresh = createApp({ db: new DB(':memory:') }).app;
    const c = new Client(fresh);
    await c.post('/setup', { workspaceName: 'Ромашка', name: 'Мария Иванова', email: 'm@x.ru', password: 'password123', projectName: 'Сайт', projectKey: 'SITE', locale: 'ru' });
    const s = (await c.get<Snapshot>('/sync')).data;
    assert.ok(s.statuses.some((x) => x.name === 'В работе'));
    assert.equal(s.me.handle, 'mariya');
  });

  test('requires a session and rejects wrong passwords', async () => {
    const anon = new Client(app);
    assert.equal((await anon.get('/sync')).status, 401);
    assert.equal((await anon.post('/login', { email: 'alex@example.com', password: 'nope-nope' })).status, 401);
    assert.equal((await anon.post('/login', { email: 'ALEX@example.com', password: 'password123' })).status, 200);
    assert.equal((await anon.get('/sync')).status, 200);
    await anon.post('/logout');
    anon.cookie = '';
    assert.equal((await anon.get('/sync')).status, 401);
  });

  test('blocks cross-origin writes', async () => {
    const res = await admin.req('POST', '/tasks', { projectId: snap.projects[0].id, title: 'x' }, { origin: 'https://evil.example', host: 'tackle.local' });
    assert.equal(res.status, 403);
  });

  test('uses Sec-Fetch-Site so reverse proxies that rewrite Host keep working', async () => {
    const p = snap.projects[0].id;
    const proxied = await admin.req('POST', '/tasks', { projectId: p, title: 'via nginx' }, {
      origin: 'https://tackle.example.com',
      host: '127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
    });
    assert.equal(proxied.status, 201);
    const forged = await admin.req('POST', '/tasks', { projectId: p, title: 'csrf' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(forged.status, 403);
  });

  test('a spoofed X-Forwarded-For does not bypass sign-in rate limiting', async () => {
    const anon = new Client(app);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await anon.req('POST', '/login', { email: 'brute@example.com', password: 'wrong-password' }, { 'x-forwarded-for': `10.0.0.${i}` })).status;
    }
    assert.equal(last, 429);
  });

  test('invites are single-use and members cannot do admin things', async () => {
    const inv = await admin.post('/invites', {});
    const maria = new Client(app);
    assert.equal((await maria.get(`/invites/${inv.data.token}`)).status, 200);
    assert.equal((await maria.post('/join', { token: inv.data.token, name: 'Maria', email: 'maria@example.com', password: 'password123' })).status, 201);
    assert.equal((await new Client(app).post('/join', { token: inv.data.token, name: 'Eve', email: 'eve@example.com', password: 'password123' })).status, 404);
    assert.equal((await maria.patch('/workspace', { name: 'Hacked' })).status, 403);
    assert.equal((await maria.post('/invites', {})).status, 403);
  });

  test('deactivating a user ends their sessions; the last admin is protected', async () => {
    const maria = await invite('Maria', 'maria@example.com');
    const mariaId = (await maria.get<Snapshot>('/sync')).data.me.id;
    assert.equal((await admin.patch(`/users/${mariaId}`, { active: false })).status, 200);
    assert.equal((await maria.get('/sync')).status, 401);
    assert.equal((await admin.patch(`/users/${snap.me.id}`, { role: 'member' })).status, 400);
  });

  test('password reset links work once', async () => {
    const maria = await invite('Maria', 'maria@example.com');
    const mariaId = (await maria.get<Snapshot>('/sync')).data.me.id;
    const link = await admin.post(`/users/${mariaId}/reset`);
    const token = link.data.path.split('/').pop();
    const c = new Client(app);
    assert.equal((await c.post('/reset', { token, password: 'brand-new-pass' })).status, 200);
    assert.equal((await maria.get('/sync')).status, 401, 'old sessions are revoked');
    assert.equal((await new Client(app).post('/login', { email: 'maria@example.com', password: 'brand-new-pass' })).status, 200);
    assert.equal((await c.post('/reset', { token, password: 'again-again' })).status, 404);
  });
});

describe('tasks', () => {
  test('numbers tasks per project and puts new tasks on top', async () => {
    const p = snap.projects[0].id;
    const t1 = (await admin.post<Task>('/tasks', { projectId: p, title: 'First', statusId: status('Todo') })).data;
    const t2 = (await admin.post<Task>('/tasks', { projectId: p, title: 'Second', statusId: status('Todo') })).data;
    assert.equal(t1.number, 1);
    assert.equal(t2.number, 2);
    assert.ok(t2.position < t1.position);
    const other = (await admin.post('/projects', { name: 'Mobile', key: 'mob' })).data;
    const t3 = (await admin.post<Task>('/tasks', { projectId: other.id, title: 'Mobile 1' })).data;
    assert.equal(t3.number, 1);
    assert.equal((await admin.post('/projects', { name: 'Dup', key: 'MOB' })).status, 400);
  });

  test('accepts client-generated ids and validates input', async () => {
    const p = snap.projects[0].id;
    const res = await admin.post<Task>('/tasks', { id: 'clientId1234', projectId: p, title: 'Mine' });
    assert.equal(res.data.id, 'clientId1234');
    assert.equal((await admin.post('/tasks', { id: 'clientId1234', projectId: p, title: 'Dup' })).status, 400);
    assert.equal((await admin.post('/tasks', { projectId: p, title: '   ' })).status, 400);
    assert.equal((await admin.post('/tasks', { projectId: p, title: 'x', priority: 9 })).status, 400);
    assert.equal((await admin.post('/tasks', { projectId: p, title: 'x', dueDate: '2026-13-45' })).status, 400);
  });

  test('tracks completion time and records merged history', async () => {
    const p = snap.projects[0].id;
    const t = (await admin.post<Task>('/tasks', { projectId: p, title: 'Work', statusId: status('Todo') })).data;
    const done = (await admin.patch<Task>(`/tasks/${t.id}`, { statusId: status('Done') })).data;
    assert.ok(done.completedAt && done.startedAt);
    const reopened = (await admin.patch<Task>(`/tasks/${t.id}`, { statusId: status('In Progress') })).data;
    assert.equal(reopened.completedAt, null);

    // Rapid changes of the same field by the same person collapse into one entry.
    await admin.patch(`/tasks/${t.id}`, { priority: 1 });
    await admin.patch(`/tasks/${t.id}`, { priority: 2 });
    await admin.patch(`/tasks/${t.id}`, { priority: 0 }); // back to the start → entry disappears
    const { activity } = (await admin.get<{ activity: Activity[] }>(`/tasks/${t.id}/timeline`)).data;
    const kinds = activity.map((a) => a.kind);
    assert.deepEqual(kinds, ['created', 'status']);
    assert.deepEqual(activity[1].data, { from: status('Todo'), to: status('In Progress') });
  });

  test('adds and removes labels incrementally and in bulk', async () => {
    const p = snap.projects[0].id;
    const [bug, feature] = snap.labels;
    const a = (await admin.post<Task>('/tasks', { projectId: p, title: 'A', labelIds: [bug.id] })).data;
    const b = (await admin.post<Task>('/tasks', { projectId: p, title: 'B' })).data;
    const res = await admin.post<Task[]>('/tasks/bulk', { ids: [a.id, b.id], patch: { addLabelIds: [feature.id], priority: 2 } });
    assert.deepEqual(res.data.map((x) => x.labelIds.sort()), [[bug.id, feature.id].sort(), [feature.id]]);
    assert.ok(res.data.every((x) => x.priority === 2));
    const removed = (await admin.patch<Task>(`/tasks/${a.id}`, { removeLabelIds: [bug.id] })).data;
    assert.deepEqual(removed.labelIds, [feature.id]);
    assert.equal((await admin.post('/tasks/bulk', { ids: [a.id], patch: { title: 'nope' } })).status, 400);
  });

  test('soft-deletes and restores', async () => {
    const p = snap.projects[0].id;
    const t = (await admin.post<Task>('/tasks', { projectId: p, title: 'Temp' })).data;
    await admin.post('/tasks/delete', { ids: [t.id] });
    assert.ok(!(await admin.get<Snapshot>('/sync')).data.tasks.some((x) => x.id === t.id));
    await admin.post('/tasks/restore', { ids: [t.id] });
    assert.ok((await admin.get<Snapshot>('/sync')).data.tasks.some((x) => x.id === t.id));
  });

  test('rejects a sprint from another project', async () => {
    const other = (await admin.post('/projects', { name: 'Mobile', key: 'MOB' })).data;
    const sprint = (await admin.post<Sprint>('/sprints', { projectId: other.id, startDate: '2026-01-01', endDate: '2026-01-14' })).data;
    const t = (await admin.post<Task>('/tasks', { projectId: snap.projects[0].id, title: 'X' })).data;
    assert.equal((await admin.patch(`/tasks/${t.id}`, { sprintId: sprint.id })).status, 400);
  });
});

describe('operations', () => {
  test('compresses JSON responses', async () => {
    const res = await app.request('/api/sync', { headers: { cookie: admin.cookie, 'accept-encoding': 'gzip' } });
    assert.equal(res.headers.get('content-encoding'), 'gzip');
  });

  test('backs up a live database to a single file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tackle-backup-'));
    const live = new DB(path.join(dir, 'live.db'));
    live.run("INSERT INTO meta (key, value) VALUES ('workspace_name', 'Backed up')");
    const file = backupDatabase(live, path.join(dir, 'nested', 'copy.db'));
    assert.throws(() => backupDatabase(live, file), /already exists/);
    const copy = new DB(file);
    assert.equal(copy.getMeta('workspace_name'), 'Backed up');
    copy.close();
    live.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('realtime', () => {
  test('broadcasts committed changes and nothing from rolled-back ones', async () => {
    const events: { type: string; origin: string }[] = [];
    hub.add({ userId: 'observer', clientId: 'observer', send: (p) => events.push(JSON.parse(p)) });
    const p = snap.projects[0].id;
    const t = (await admin.req<Task>('POST', '/tasks', { projectId: p, title: 'Live' }, { 'x-client-id': 'tab-1' })).data;
    assert.deepEqual(events.map((e) => [e.type, e.origin]), [['task.upsert', 'tab-1']]);

    events.length = 0;
    const res = await admin.post('/tasks/bulk', { ids: [t.id, 'missingTask0001'], patch: { priority: 1 } });
    assert.equal(res.status, 404);
    assert.equal(events.length, 0, 'no events for a rolled-back bulk update');
    assert.equal((await admin.get<Snapshot>('/sync')).data.tasks[0].priority, 0);
  });
});

describe('notifications', () => {
  test('assignments, mentions and comments reach the right people', async () => {
    const maria = await invite('Maria Petrova', 'maria@example.com');
    const ivan = await invite('Ivan Sokolov', 'ivan@example.com');
    const ids = Object.fromEntries((await admin.get<Snapshot>('/sync')).data.users.map((u) => [u.handle, u.id]));
    const p = snap.projects[0].id;

    const t = (await admin.post<Task>('/tasks', { projectId: p, title: 'Ship it', assigneeId: ids.maria })).data;
    let mine = (await maria.get<Notification[]>('/notifications')).data;
    assert.deepEqual(mine.map((n) => n.kind), ['assigned']);
    assert.equal(mine[0].data.taskRef, 'WEB-1');

    await admin.post(`/tasks/${t.id}/comments`, { body: 'Hey @ivan, can you review?' });
    assert.deepEqual((await ivan.get<Notification[]>('/notifications')).data.map((n) => n.kind), ['mention']);
    mine = (await maria.get<Notification[]>('/notifications')).data;
    assert.deepEqual(mine.map((n) => n.kind), ['comment', 'assigned'], 'the assignee hears about comments');

    // Status changes by others notify creator and assignee, collapsed while unread.
    await ivan.patch(`/tasks/${t.id}`, { statusId: status('In Progress') });
    await ivan.patch(`/tasks/${t.id}`, { statusId: status('In Review') });
    const adminInbox = (await admin.get<Notification[]>('/notifications')).data.filter((n) => n.kind === 'status');
    assert.equal(adminInbox.length, 1);
    assert.equal(adminInbox[0].data.statusId, status('In Review'));

    const read = await maria.post<{ unread: number }>('/notifications/read', { all: true });
    assert.equal(read.data.unread, 0);
    assert.equal((await maria.get<Snapshot>('/sync')).data.unread, 0);
  });

  test('nobody is notified about their own actions', async () => {
    const p = snap.projects[0].id;
    await admin.post<Task>('/tasks', { projectId: p, title: 'Self', assigneeId: snap.me.id, description: 'note to @alex' });
    assert.equal((await admin.get<Notification[]>('/notifications')).data.length, 0);
  });
});

describe('sprints', () => {
  test('start, guard a second active sprint, complete and carry over open work', async () => {
    const p = snap.projects[0].id;
    const s1 = (await admin.post<Sprint>('/sprints', { projectId: p, startDate: '2026-01-05', endDate: '2026-01-18', goal: 'Ship' })).data;
    const s2 = (await admin.post<Sprint>('/sprints', { projectId: p, startDate: '2026-01-19', endDate: '2026-02-01' })).data;
    assert.equal(s1.name, 'Sprint 1');
    assert.equal(s2.number, 2);
    assert.equal((await admin.post('/sprints', { projectId: p, startDate: '2026-02-10', endDate: '2026-02-01' })).status, 400);

    const done = (await admin.post<Task>('/tasks', { projectId: p, title: 'Done', sprintId: s1.id, estimate: 3, statusId: status('Done') })).data;
    const open = (await admin.post<Task>('/tasks', { projectId: p, title: 'Open', sprintId: s1.id, estimate: 5 })).data;

    assert.equal((await admin.post(`/sprints/${s1.id}/start`)).data.state, 'active');
    const second = await admin.post(`/sprints/${s2.id}/start`);
    assert.equal(second.status, 400);

    const res = await admin.post(`/sprints/${s1.id}/complete`, { moveTo: 'new' });
    assert.equal(res.data.moved, 1);
    assert.deepEqual(res.data.sprint.stats, { total: 2, completed: 1, points: 8, completedPoints: 3 });
    const after = (await admin.get<Snapshot>('/sync')).data;
    const moved = after.tasks.find((x) => x.id === open.id)!;
    const created = after.sprints.find((s) => s.id === res.data.movedTo)!;
    assert.equal(created.name, 'Sprint 3');
    assert.equal(moved.sprintId, created.id);
    assert.equal(after.tasks.find((x) => x.id === done.id)!.sprintId, s1.id, 'finished work stays in its sprint');

    await admin.del(`/sprints/${created.id}`);
    assert.equal((await admin.get<Snapshot>('/sync')).data.tasks.find((x) => x.id === open.id)!.sprintId, null);
  });
});

describe('workflow', () => {
  test('deleting a used status requires a replacement', async () => {
    const p = snap.projects[0].id;
    const t = (await admin.post<Task>('/tasks', { projectId: p, title: 'X', statusId: status('In Review') })).data;
    assert.equal((await admin.del(`/statuses/${status('In Review')}`)).status, 400);
    assert.equal((await admin.del(`/statuses/${status('In Review')}?replacementId=${status('In Progress')}`)).status, 200);
    const after = (await admin.get<Snapshot>('/sync')).data;
    assert.equal(after.tasks.find((x) => x.id === t.id)!.statusId, status('In Progress'));
    assert.equal(after.statuses.length, 5);
  });

  test('export includes data but never password hashes', async () => {
    await admin.post<Task>('/tasks', { projectId: snap.projects[0].id, title: 'X' });
    const res = await admin.get('/export');
    assert.equal(res.data.tasks.length, 1);
    assert.ok(!JSON.stringify(res.data).includes('scrypt$'));
  });
});

describe('reviewer', () => {
  test('the reviewer is notified, kept up to date and recorded in the history', async () => {
    const maria = await invite('Maria Petrova', 'maria@example.com');
    const ids = Object.fromEntries((await admin.get<Snapshot>('/sync')).data.users.map((u) => [u.handle, u.id]));
    const p = snap.projects[0].id;

    const t = (await admin.post<Task>('/tasks', { projectId: p, title: 'Review me', reviewerId: ids.maria })).data;
    assert.equal(t.reviewerId, ids.maria);
    assert.deepEqual((await maria.get<Notification[]>('/notifications')).data.map((n) => n.kind), ['review']);

    // Like the assignee, the reviewer hears about comments and status changes.
    await admin.post(`/tasks/${t.id}/comments`, { body: 'Ready when you are' });
    await admin.patch(`/tasks/${t.id}`, { statusId: status('In Review') });
    const kinds = (await maria.get<Notification[]>('/notifications')).data.map((n) => n.kind);
    assert.deepEqual(kinds.sort(), ['comment', 'review', 'status']);

    const cleared = (await admin.patch<Task>(`/tasks/${t.id}`, { reviewerId: null })).data;
    assert.equal(cleared.reviewerId, null);
    const { activity } = (await admin.get<{ activity: Activity[] }>(`/tasks/${t.id}/timeline`)).data;
    assert.deepEqual(activity.map((a) => a.kind), ['created', 'status', 'reviewer']);
    assert.deepEqual(activity[2].data, { from: ids.maria, to: null });

    assert.equal((await admin.patch(`/tasks/${t.id}`, { reviewerId: 'nobodyAtAll1' })).status, 400);
    const other = (await admin.post<Task>('/tasks', { projectId: p, title: 'Another' })).data;
    const bulk = await admin.post<Task[]>('/tasks/bulk', { ids: [t.id, other.id], patch: { reviewerId: ids.alex } });
    assert.deepEqual(bulk.data.map((x) => x.reviewerId), [ids.alex, ids.alex]);
    assert.ok((await admin.get<Snapshot>('/sync')).data.tasks.every((x) => x.reviewerId === ids.alex));
  });
});

describe('attachments', () => {
  const newTask = async (title = 'With files') => (await admin.post<Task>('/tasks', { projectId: snap.projects[0].id, title })).data;

  test('uploads, serves and deletes a file', async () => {
    const t = await newTask();
    const events: { type: string; origin: string }[] = [];
    hub.add({ userId: 'observer', clientId: 'observer', send: (p) => events.push(JSON.parse(p)) });

    const up = await admin.upload<Attachment>(t.id, 'hello world', { name: 'notes.txt', headers: { 'x-client-id': 'tab-1' } });
    assert.equal(up.status, 201);
    const a = up.data;
    assert.equal(a.name, 'notes.txt');
    assert.equal(a.size, 11);
    assert.equal(a.type, 'text/plain');
    assert.equal(a.uploaderId, snap.me.id);
    assert.ok(fs.existsSync(path.join(filesDir, a.id)));
    assert.deepEqual(events.map((e) => [e.type, e.origin]), [['attachment.upsert', 'tab-1'], ['timeline', '']]);

    const synced = (await admin.get<Snapshot>('/sync')).data;
    assert.deepEqual(synced.attachments.map((x) => x.id), [a.id]);
    assert.equal(synced.uploadLimit, UPLOAD_LIMIT);

    const res = await admin.fetch(`/attachments/${a.id}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'hello world');
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(res.headers.get('content-disposition')!, /^inline; filename="notes.txt"/);
    assert.match(res.headers.get('cache-control')!, /private/);
    assert.match(res.headers.get('content-security-policy')!, /sandbox/);
    assert.match((await admin.fetch(`/attachments/${a.id}?download`)).headers.get('content-disposition')!, /^attachment/);

    const part = await admin.fetch(`/attachments/${a.id}`, { range: 'bytes=6-' });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 6-10/11');
    assert.equal(await part.text(), 'world');
    assert.equal((await admin.fetch(`/attachments/${a.id}`, { range: 'bytes=50-' })).status, 416);
    const head = await app.request(`/api/attachments/${a.id}`, { method: 'HEAD', headers: { cookie: admin.cookie } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '11');
    assert.equal((await new Client(app).fetch(`/attachments/${a.id}`)).status, 401);

    const maria = await invite('Maria', 'maria@example.com');
    assert.equal((await maria.del(`/attachments/${a.id}`)).status, 403, 'only the uploader or an admin can delete');
    assert.equal((await admin.del(`/attachments/${a.id}`)).status, 200);
    assert.ok(!fs.existsSync(path.join(filesDir, a.id)));
    assert.equal((await admin.fetch(`/attachments/${a.id}`)).status, 404);
    assert.equal((await admin.get<Snapshot>('/sync')).data.attachments.length, 0);

    // Attached and removed again right away: nothing left in the history.
    const { activity } = (await admin.get<{ activity: Activity[] }>(`/tasks/${t.id}/timeline`)).data;
    assert.deepEqual(activity.map((x) => x.kind), ['created']);
  });

  test('records attached and deleted files in the history', async () => {
    const t = await newTask();
    const maria = await invite('Maria', 'maria@example.com');
    await admin.upload(t.id, 'a', { name: 'spec.pdf', type: 'application/pdf' });
    await admin.upload(t.id, 'b', { name: 'mockup.png', type: 'image/png' });
    const mine = (await maria.upload<Attachment>(t.id, 'c', { name: 'log.txt' })).data;
    assert.equal((await admin.del(`/attachments/${mine.id}`)).status, 200, 'admins can delete any file');
    const { activity } = (await admin.get<{ activity: Activity[] }>(`/tasks/${t.id}/timeline`)).data;
    assert.deepEqual(
      activity.map((x) => [x.kind, x.data]),
      [
        ['created', {}],
        ['attachments', { added: ['spec.pdf', 'mockup.png'], removed: [] }],
        ['attachments', { added: ['log.txt'] }],
        ['attachments', { removed: ['log.txt'] }],
      ],
    );
  });

  test('never serves an uploaded page or script as part of the app', async () => {
    const t = await newTask();
    const html = (await admin.upload<Attachment>(t.id, '<script>alert(1)</script>', { name: 'evil.html', type: 'text/html' })).data;
    const svg = (await admin.upload<Attachment>(t.id, '<svg xmlns="http://www.w3.org/2000/svg"/>', { name: 'logo.svg', type: 'image/svg+xml' })).data;
    const exe = (await admin.upload<Attachment>(t.id, 'MZ', { name: '../../setup.exe', type: 'application/x-msdownload' })).data;
    const pdf = (await admin.upload<Attachment>(t.id, '%PDF-1.4', { name: 'Отчёт.pdf', type: 'application/pdf' })).data;

    const page = await admin.fetch(`/attachments/${html.id}`);
    assert.equal(page.headers.get('content-type'), 'text/plain; charset=utf-8');
    const image = await admin.fetch(`/attachments/${svg.id}`);
    assert.equal(image.headers.get('content-type'), 'image/svg+xml');
    assert.match(image.headers.get('content-disposition')!, /^attachment/);
    assert.match(image.headers.get('content-security-policy')!, /sandbox/);
    const binary = await admin.fetch(`/attachments/${exe.id}`);
    assert.equal(binary.headers.get('content-type'), 'application/octet-stream');
    assert.match(binary.headers.get('content-disposition')!, /^attachment/);
    assert.equal(exe.name, '.._.._setup.exe');
    const doc = await admin.fetch(`/attachments/${pdf.id}`);
    assert.match(doc.headers.get('content-disposition')!, /^inline; filename="_____.pdf"; filename\*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82\.pdf$/);
    assert.deepEqual(fs.readdirSync(filesDir).filter((f) => f !== '.tmp').sort(), [html.id, svg.id, exe.id, pdf.id].sort());
  });

  test('rejects files over the limit, missing tasks and reused ids', async () => {
    const t = await newTask();
    const big = new Uint8Array(UPLOAD_LIMIT + 1);
    assert.equal((await admin.upload(t.id, big, { name: 'big.bin', type: 'application/octet-stream' })).status, 413);
    // Without a Content-Length the limit is enforced while the upload streams in.
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(UPLOAD_LIMIT / 2));
        controller.close();
      },
    });
    const res = await app.request(`/api/tasks/${t.id}/attachments?name=stream.bin`, {
      method: 'POST',
      headers: { cookie: admin.cookie, 'content-type': 'application/octet-stream' },
      body: streamed,
      duplex: 'half',
    } as RequestInit);
    assert.equal(res.status, 413);
    assert.deepEqual(fs.readdirSync(filesDir).filter((f) => f !== '.tmp'), []);
    assert.deepEqual(fs.readdirSync(path.join(filesDir, '.tmp')), [], 'no half-written files are left behind');

    assert.equal((await admin.upload('missingTask0001', 'x')).status, 404);
    const first = await admin.upload<Attachment>(t.id, 'x', { id: 'clientFile01' });
    assert.equal(first.data.id, 'clientFile01');
    assert.equal((await admin.upload(t.id, 'y', { id: 'clientFile01' })).status, 400);
    assert.equal((await admin.upload(t.id, 'y', { id: '../../etc' })).status, 400);
    await admin.post('/tasks/delete', { ids: [t.id] });
    assert.equal((await admin.upload(t.id, 'z')).status, 404, 'deleted tasks take no new files');
  });

  test('deleting a project removes its files from disk; the export lists them', async () => {
    const t = await newTask();
    const a = (await admin.upload<Attachment>(t.id, 'keep me', { name: 'a.txt' })).data;
    const exported = (await admin.get('/export')).data;
    assert.deepEqual(exported.attachments.map((x: Attachment) => x.name), ['a.txt']);
    assert.equal((await admin.del(`/projects/${snap.projects[0].id}`)).status, 200);
    assert.ok(!fs.existsSync(path.join(filesDir, a.id)));
    assert.equal((await admin.get<Snapshot>('/sync')).data.attachments.length, 0);
  });
});

describe('archive', () => {
  /** A moment in the server's local time; the archive follows the server's calendar. */
  const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();
  const HOUR = 3_600_000;

  /** A task in Done that was finished at the given moment. */
  async function doneTask(title: string, completedAt: number, fields: Record<string, unknown> = {}) {
    const t = (await admin.post<Task>('/tasks', { projectId: snap.projects[0].id, title, statusId: status('Done'), ...fields })).data;
    ctx.db.run('UPDATE tasks SET completed_at = ? WHERE id = ?', completedAt, t.id);
    return t;
  }
  const synced = async (id: string) => (await admin.get<Snapshot>('/sync')).data.tasks.find((x) => x.id === id)!;

  test('on the 1st, everything finished last month leaves the Done column', async () => {
    const october = await doneTask('Shipped in October', at(2026, 10, 15));
    const lastMinute = await doneTask('Shipped on Halloween night', at(2026, 10, 31, 23, 59));
    const november = await doneTask('Shipped on the 1st', at(2026, 11, 1, 0, 0));
    const canceled = await doneTask('Dropped in October', at(2026, 10, 10), { statusId: status('Canceled') });
    const open = (await admin.post<Task>('/tasks', { projectId: snap.projects[0].id, title: 'Still going', statusId: status('In Progress') })).data;
    const deleted = await doneTask('Deleted', at(2026, 10, 3));
    await admin.post('/tasks/delete', { ids: [deleted.id] });
    const events: { type: string; data: Task }[] = [];
    hub.add({ userId: 'observer', clientId: 'observer', send: (p) => events.push(JSON.parse(p)) });

    assert.deepEqual(archiveDoneTasks(ctx, at(2026, 10, 31, 23, 59, 59)), [], 'nothing moves while the month is still on');
    const firstOfMonth = at(2026, 11, 1, 0, 0, 1);
    assert.deepEqual(archiveDoneTasks(ctx, firstOfMonth), [october.id, lastMinute.id]);

    assert.equal((await synced(october.id)).archivedAt, firstOfMonth);
    assert.equal((await synced(lastMinute.id)).archivedAt, firstOfMonth);
    for (const t of [november, canceled, open]) assert.equal((await synced(t.id)).archivedAt, null, t.title);
    assert.deepEqual(
      events.map((e) => [e.type, e.data.id, e.data.archivedAt]),
      [
        ['task.upsert', october.id, firstOfMonth],
        ['task.upsert', lastMinute.id, firstOfMonth],
      ],
      'open boards update live',
    );
    const { activity } = (await admin.get<{ activity: Activity[] }>(`/tasks/${october.id}/timeline`)).data;
    assert.deepEqual(activity.map((a) => [a.kind, a.actorId]), [['created', snap.me.id], ['archived', null]]);

    assert.deepEqual(archiveDoneTasks(ctx, at(2026, 11, 20)), [], 'running again during the month changes nothing');
    assert.equal((await synced(october.id)).archivedAt, firstOfMonth);
    assert.deepEqual(archiveDoneTasks(ctx, at(2026, 12, 1)), [november.id], 'next month it is November’s turn');
  });

  test('a task taken out of Done comes back from the archive', async () => {
    const task = await doneTask('Needs another look', at(2026, 9, 20));
    archiveDoneTasks(ctx, at(2026, 10, 1));

    // Editing an archived task, or moving it to another "done" status, keeps it in the archive.
    assert.ok((await admin.patch<Task>(`/tasks/${task.id}`, { priority: 1 })).data.archivedAt);
    const shipped = (await admin.post('/statuses', { name: 'Shipped', category: 'completed' })).data;
    assert.ok((await admin.patch<Task>(`/tasks/${task.id}`, { statusId: shipped.id })).data.archivedAt);

    const reopened = (await admin.patch<Task>(`/tasks/${task.id}`, { statusId: status('In Progress') })).data;
    assert.equal(reopened.archivedAt, null);
    assert.equal(reopened.completedAt, null);

    // Done once more, it stays on the board until its new month is over.
    const redone = (await admin.patch<Task>(`/tasks/${task.id}`, { statusId: status('Done') })).data;
    assert.equal(redone.archivedAt, null);
    assert.deepEqual(archiveDoneTasks(ctx, redone.completedAt!), []);
    assert.deepEqual(archiveDoneTasks(ctx, nextMonthStart(redone.completedAt!)), [task.id]);
  });

  test('tasks of a running sprint wait until the sprint is completed', async () => {
    const p = snap.projects[0].id;
    const sprint = (await admin.post<Sprint>('/sprints', { projectId: p, startDate: '2026-10-19', endDate: '2026-11-01' })).data;
    await admin.post(`/sprints/${sprint.id}/start`);
    const inSprint = await doneTask('Sprint work', at(2026, 10, 25), { sprintId: sprint.id, estimate: 3 });
    const outside = await doneTask('Other work', at(2026, 10, 25));

    assert.deepEqual(archiveDoneTasks(ctx, at(2026, 11, 1)), [outside.id]);
    const res = await admin.post(`/sprints/${sprint.id}/complete`, { moveTo: 'backlog' });
    assert.deepEqual(res.data.sprint.stats, { total: 1, completed: 1, points: 3, completedPoints: 3 });
    assert.deepEqual(archiveDoneTasks(ctx, at(2026, 11, 2)), [inSprint.id]);
    assert.equal((await synced(inSprint.id)).sprintId, sprint.id, 'archived work stays in its sprint');
  });

  const archivedTitles = () => loadAllTasks(ctx.db).filter((x) => x.archivedAt).map((x) => x.title).sort();

  test('the server archives on start and again at midnight on the 1st', async (t) => {
    await doneTask('From September', at(2026, 9, 30));
    await doneTask('From October', at(2026, 10, 31, 20));

    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: at(2026, 10, 31, 22) });
    const stop = scheduleArchive(ctx);
    assert.deepEqual(archivedTitles(), ['From September'], 'catches up on a missed 1st right away');
    t.mock.timers.tick(HOUR);
    assert.deepEqual(archivedTitles(), ['From September']);
    t.mock.timers.tick(HOUR + 2000);
    assert.deepEqual(archivedTitles(), ['From October', 'From September']);
    stop();
  });

  test('the server archives a sprint’s done tasks within an hour of completing it', async (t) => {
    const sprint = (await admin.post<Sprint>('/sprints', { projectId: snap.projects[0].id, startDate: '2026-10-19', endDate: '2026-11-08' })).data;
    await admin.post(`/sprints/${sprint.id}/start`);
    await doneTask('Sprint work', at(2026, 10, 30), { sprintId: sprint.id });

    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: at(2026, 11, 10, 9) });
    const stop = scheduleArchive(ctx);
    assert.deepEqual(archivedTitles(), []);
    await admin.post(`/sprints/${sprint.id}/complete`, { moveTo: 'backlog' });
    t.mock.timers.tick(HOUR);
    assert.deepEqual(archivedTitles(), ['Sprint work']);
    stop();
  });
});

describe('upgrade', () => {
  test('a database left by v0.1 is upgraded in place and keeps its data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tackle-upgrade-'));
    const file = path.join(dir, 'tackle.db');
    // The database as Tackle v0.1 left it: schema version 1 with some work in it.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const old = new DatabaseSync(file);
    old.exec(MIGRATIONS[0]);
    old.exec('PRAGMA user_version = 1');
    const t = Date.now();
    old
      .prepare("INSERT INTO users (id, email, name, handle, password_hash, role, color, created_at) VALUES ('userAlex0001', 'alex@example.com', 'Alex', 'alex', ?, 'admin', '#8b5cf6', ?)")
      .run(await hashPassword('password123'), t);
    old.exec(`
      INSERT INTO statuses (id, name, category, color, position) VALUES ('statusTodo01', 'Todo', 'unstarted', '#94a3b8', 1);
      INSERT INTO projects (id, key, name, color, next_number, position, created_at) VALUES ('projectWeb01', 'WEB', 'Web', '#6366f1', 2, 1, ${t});
      INSERT INTO tasks (id, project_id, number, title, status_id, assignee_id, creator_id, position, created_at, updated_at)
        VALUES ('taskOld00001', 'projectWeb01', 1, 'Made in v0.1', 'statusTodo01', 'userAlex0001', 'userAlex0001', 0, ${t}, ${t});
      INSERT INTO comments (id, task_id, author_id, body, created_at, updated_at) VALUES ('commentOld01', 'taskOld00001', 'userAlex0001', 'Still here?', ${t}, ${t});
    `);
    old.close();

    const db = new DB(file);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, MIGRATIONS.length);
    const c = new Client(createApp({ db, attachmentsDir: path.join(dir, 'attachments') }).app);
    assert.equal((await c.post('/login', { email: 'alex@example.com', password: 'password123' })).status, 200);
    const s = (await c.get<Snapshot>('/sync')).data;
    assert.deepEqual(s.tasks.map((x) => [x.title, x.assigneeId, x.reviewerId, x.archivedAt]), [['Made in v0.1', 'userAlex0001', null, null]]);
    assert.deepEqual(s.attachments, []);
    assert.equal((await c.get('/tasks/taskOld00001/timeline')).data.comments[0].body, 'Still here?');

    // The new features work on tasks from before the upgrade.
    assert.equal((await c.patch<Task>('/tasks/taskOld00001', { reviewerId: 'userAlex0001' })).data.reviewerId, 'userAlex0001');
    assert.equal((await c.upload('taskOld00001', 'log')).status, 201);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
