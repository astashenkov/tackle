import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Notification, Snapshot, Sprint, Task } from '../../shared/types';
import { createApp } from '../../server/app';
import { DB } from '../../server/db';

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
}

let app: App;
let hub: ReturnType<typeof createApp>['hub'];
let admin: Client;
let snap: Snapshot;

const status = (name: string) => snap.statuses.find((s) => s.name === name)!.id;

beforeEach(async () => {
  ({ app, hub } = createApp({ db: new DB(':memory:') }));
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
