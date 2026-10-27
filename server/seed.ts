/**
 * Fills a fresh database with a realistic demo workspace.
 *
 *   npm run seed            # uses DATABASE_PATH or ./data/tackle.db, refuses to touch a non-empty db
 *   npm run seed -- --force # wipes the database first
 *
 * Every demo account uses the password "demo1234"; sign in as alex@tackle.dev.
 */
import fs from 'node:fs';
import { DEFAULT_LABELS, DEFAULT_STATUSES } from '../shared/constants';
import { hashPassword } from './auth';
import { config } from './config';
import { DB } from './db';
import { newId } from './util';

const DAY = 86_400_000;
const force = process.argv.includes('--force');
const file = config.databasePath;

if (force) for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
const db = new DB(file);
if (db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n > 0) {
  console.error(`${file} already has data. Run with --force to replace it with the demo workspace.`);
  process.exit(1);
}

const T = Date.now();
const iso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let rnd = 42;
const random = () => ((rnd = (rnd * 16807) % 2147483647) - 1) / 2147483646;
const pick = <X>(arr: X[]) => arr[Math.floor(random() * arr.length)];

const hash = await hashPassword('demo1234');

db.tx(() => {
  db.setMeta('workspace_name', 'Acme Labs');

  const status: Record<string, string> = {};
  DEFAULT_STATUSES.forEach((s, i) => {
    const sid = newId();
    status[s.name] = sid;
    db.run('INSERT INTO statuses (id, name, category, color, position) VALUES (?, ?, ?, ?, ?)', sid, s.name, s.category, s.color, i + 1);
  });
  const label: Record<string, string> = {};
  for (const l of DEFAULT_LABELS) {
    label[l.name] = newId();
    db.run('INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)', label[l.name], l.name, l.color, T - 60 * DAY);
  }
  label.Backend = newId();
  db.run('INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)', label.Backend, 'Backend', '#14b8a6', T - 60 * DAY);

  const people = [
    { name: 'Alex Morgan', email: 'alex@tackle.dev', handle: 'alex', role: 'admin', color: '#8b5cf6' },
    { name: 'Maria Petrova', email: 'maria@tackle.dev', handle: 'maria', role: 'member', color: '#ec4899' },
    { name: 'Ivan Sokolov', email: 'ivan@tackle.dev', handle: 'ivan', role: 'member', color: '#14b8a6' },
    { name: 'Sofia Chen', email: 'sofia@tackle.dev', handle: 'sofia', role: 'member', color: '#f97316' },
    { name: 'Dan Brooks', email: 'dan@tackle.dev', handle: 'dan', role: 'member', color: '#3b82f6' },
  ];
  const u: Record<string, string> = {};
  for (const p of people) {
    u[p.handle] = newId();
    db.run(
      'INSERT INTO users (id, email, name, handle, password_hash, role, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      u[p.handle],
      p.email,
      p.name,
      p.handle,
      hash,
      p.role,
      p.color,
      T - 60 * DAY,
    );
  }

  const projects = [
    { key: 'WEB', name: 'Web app', color: '#6366f1', description: 'Customer-facing web application' },
    { key: 'MOB', name: 'Mobile', color: '#22c55e', description: 'iOS and Android apps' },
  ];
  const proj: Record<string, string> = {};
  projects.forEach((p, i) => {
    proj[p.key] = newId();
    db.run(
      'INSERT INTO projects (id, key, name, description, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      proj[p.key],
      p.key,
      p.name,
      p.description,
      p.color,
      i + 1,
      T - 60 * DAY,
    );
  });

  const sprint = (projectKey: string, number: number, startOffset: number, state: string, goal = '') => {
    const sid = newId();
    db.run(
      'INSERT INTO sprints (id, project_id, number, name, goal, start_date, end_date, state, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      sid,
      proj[projectKey],
      number,
      `Sprint ${number}`,
      goal,
      iso(T + startOffset * DAY),
      iso(T + (startOffset + 13) * DAY),
      state,
      state === 'completed' ? T + (startOffset + 14) * DAY : null,
      T - 40 * DAY,
    );
    return sid;
  };
  const web1 = sprint('WEB', 1, -34, 'completed', 'Ship the new onboarding flow');
  const web2 = sprint('WEB', 2, -20, 'completed', 'Billing v2 and team invites');
  const web3 = sprint('WEB', 3, -6, 'active', 'Make search fast and polish the dashboard before the public beta');
  const web4 = sprint('WEB', 4, 8, 'planned');
  const mob1 = sprint('MOB', 1, -9, 'active', 'Offline mode for the field team');

  type Seed = {
    title: string;
    s: string;
    p?: number;
    a?: string;
    r?: string;
    l?: string[];
    e?: number;
    sp?: string;
    due?: number;
    done?: number;
    d?: string;
  };
  const counters: Record<string, number> = { WEB: 0, MOB: 0 };
  const taskIds: Record<string, string> = {};

  const add = (key: string, t: Seed) => {
    const tid = newId();
    const number = ++counters[key];
    const closed = t.s === 'Done' || t.s === 'Canceled';
    const completedAt = closed ? T + (t.done ?? -Math.floor(random() * 10)) * DAY - Math.floor(random() * 6) * 3600_000 : null;
    const created = Math.min(T - (8 + Math.floor(random() * 20)) * DAY, (completedAt ?? T) - 6 * DAY);
    const started = t.s === 'In Progress' || t.s === 'In Review' || closed ? (completedAt ?? T) - 2 * DAY : null;
    db.run(
      `INSERT INTO tasks (id, project_id, number, title, description, status_id, priority, assignee_id, reviewer_id, creator_id,
        sprint_id, estimate, due_date, position, created_at, updated_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tid,
      proj[key],
      number,
      t.title,
      t.d ?? '',
      status[t.s],
      t.p ?? 0,
      t.a ? u[t.a] : null,
      t.r ? u[t.r] : null,
      u[pick(['alex', 'maria', 'ivan', 'sofia'])],
      t.sp ?? null,
      t.e ?? null,
      t.due === undefined ? null : iso(T + t.due * DAY),
      number * 1024,
      created,
      completedAt ?? T - Math.floor(random() * 5) * DAY,
      started,
      completedAt,
    );
    for (const l of t.l ?? []) db.run('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)', tid, label[l]);
    db.run("INSERT INTO activity (task_id, actor_id, kind, data, created_at) VALUES (?, ?, 'created', '{}', ?)", tid, u.alex, created);
    if (closed) {
      db.run(
        "INSERT INTO activity (task_id, actor_id, kind, data, created_at) VALUES (?, ?, 'status', ?, ?)",
        tid,
        t.a ? u[t.a] : u.alex,
        JSON.stringify({ from: status['In Review'], to: status[t.s] }),
        completedAt,
      );
    }
    taskIds[`${key}-${number}`] = tid;
    return tid;
  };

  // Sprint 1 & 2 (completed)
  for (const [title, a, e, l] of [
    ['Welcome screen with product tour', 'sofia', 3, ['Feature', 'Design']],
    ['Email verification for new accounts', 'ivan', 2, ['Feature', 'Backend']],
    ['Onboarding checklist widget', 'maria', 5, ['Feature']],
    ['Track onboarding funnel events', 'dan', 2, ['Improvement']],
  ] as const) add('WEB', { title, s: 'Done', a, e, l: [...l], sp: web1, p: 3, done: -22 });
  for (const [title, a, e, l] of [
    ['Stripe customer portal integration', 'ivan', 5, ['Feature', 'Backend']],
    ['Invite teammates by link', 'maria', 3, ['Feature']],
    ['Proration preview when changing plans', 'ivan', 3, ['Feature', 'Backend']],
    ['Billing settings page redesign', 'sofia', 3, ['Design']],
    ['Webhook retries for failed payments', 'dan', 2, ['Backend']],
  ] as const) add('WEB', { title, s: 'Done', a, e, l: [...l], sp: web2, p: 2, done: -8 });

  // Sprint 3 (active) — completion dates spread across the sprint for a realistic burndown
  add('WEB', {
    title: 'Search results page is slow for large workspaces',
    s: 'In Progress',
    p: 1,
    a: 'ivan',
    r: 'alex',
    e: 5,
    l: ['Bug', 'Backend'],
    sp: web3,
    due: 2,
    d: `Searching in workspaces with **10k+ records** takes 3–4 seconds. We need to get p95 under 300 ms.

### Plan
- [x] Add timing to the search endpoint
- [x] Reproduce on a copy of the largest workspace
- [ ] Add a trigram index for titles
- [ ] Cache the permission check per request
- [ ] Load-test before rollout

Related: WEB-14. cc @maria`,
  });
  add('WEB', { title: 'Dashboard: new KPI cards', s: 'In Review', p: 2, a: 'sofia', r: 'alex', e: 3, l: ['Feature', 'Design'], sp: web3 });
  add('WEB', {
    title: 'Keyboard shortcuts for common actions',
    s: 'Todo',
    p: 3,
    a: 'maria',
    e: 3,
    l: ['Improvement'],
    sp: web3,
    d: 'Power users asked for shortcuts. Start with `C` to create, `/` to search and `?` for help.',
  });
  add('WEB', { title: 'Empty states for all list views', s: 'Done', p: 3, a: 'sofia', e: 2, l: ['Design'], sp: web3, done: -4 });
  add('WEB', { title: 'Fix timezone bug in activity feed', s: 'Done', p: 2, a: 'dan', e: 1, l: ['Bug'], sp: web3, done: -5 });
  add('WEB', { title: 'Paginate the audit log API', s: 'Done', p: 3, a: 'ivan', e: 2, l: ['Backend'], sp: web3, done: -3 });
  add('WEB', { title: 'Avatar upload crops images incorrectly', s: 'Done', p: 2, a: 'maria', e: 2, l: ['Bug'], sp: web3, done: -2 });
  add('WEB', { title: 'Saved filters on the reports page', s: 'In Progress', p: 3, a: 'maria', e: 5, l: ['Feature'], sp: web3, due: 4 });
  add('WEB', { title: 'Dark mode contrast issues in charts', s: 'Todo', p: 4, a: 'sofia', e: 1, l: ['Design', 'Bug'], sp: web3 });
  add('WEB', { title: 'Upgrade to Postgres 17', s: 'In Review', p: 2, a: 'dan', r: 'ivan', e: 3, l: ['Tech debt', 'Backend'], sp: web3, due: -1 });
  add('WEB', { title: 'Export reports to CSV', s: 'Done', p: 3, a: 'ivan', r: 'maria', e: 3, l: ['Feature'], sp: web3, done: -1 });
  add('WEB', { title: 'Session expires too early on Safari', s: 'Todo', p: 1, a: 'dan', e: 2, l: ['Bug'], sp: web3, due: 1 });

  // Sprint 4 (planned)
  add('WEB', { title: 'Public beta landing page', s: 'Todo', p: 2, a: 'sofia', e: 5, l: ['Design'], sp: web4 });
  add('WEB', { title: 'Rate limiting for the public API', s: 'Todo', p: 2, a: 'ivan', e: 3, l: ['Backend'], sp: web4 });
  add('WEB', { title: 'Two-factor authentication', s: 'Todo', p: 2, e: 8, l: ['Feature'], sp: web4 });

  // Backlog
  for (const [title, p, l, e] of [
    ['Slack integration for notifications', 3, ['Feature'], 5],
    ['Bulk edit in table views', 3, ['Feature'], 5],
    ['Remove legacy v1 endpoints', 4, ['Tech debt'], 3],
    ['Improve error messages on sign-up form', 4, ['Improvement'], 1],
    ['Audit npm dependencies', 4, ['Tech debt'], 2],
    ['SSO with Google Workspace', 2, ['Feature', 'Backend'], 8],
    ['Weekly digest email', 0, ['Feature'], 3],
  ] as const) add('WEB', { title, s: 'Backlog', p, l: [...l], e });
  add('WEB', { title: 'Old reporting prototype', s: 'Canceled', p: 4, l: ['Feature'], done: -12 });

  // Mobile
  add('MOB', { title: 'Offline queue for form submissions', s: 'In Progress', p: 1, a: 'dan', e: 8, l: ['Feature'], sp: mob1, due: 3 });
  add('MOB', { title: 'Sync conflicts resolution UI', s: 'Todo', p: 2, a: 'sofia', e: 5, l: ['Design'], sp: mob1 });
  add('MOB', { title: 'Crash on Android 12 when opening camera', s: 'Done', p: 1, a: 'maria', e: 2, l: ['Bug'], sp: mob1, done: -6 });
  add('MOB', { title: 'Cache map tiles for offline use', s: 'In Review', p: 2, a: 'ivan', r: 'dan', e: 5, l: ['Feature'], sp: mob1 });
  add('MOB', { title: 'Push notification permissions prompt', s: 'Done', p: 3, a: 'maria', e: 2, l: ['Improvement'], sp: mob1, done: -3 });
  add('MOB', { title: 'Biometric login', s: 'Backlog', p: 3, l: ['Feature'], e: 3 });
  add('MOB', { title: 'Reduce app bundle size', s: 'Backlog', p: 4, l: ['Tech debt'], e: 3 });

  // Finished in earlier months: the server moves these to the archive when it starts.
  for (const [title, a, e, l, done] of [
    ['Set up error tracking', 'dan', 2, ['Tech debt'], -38],
    ['Pricing page for the marketing site', 'sofia', 3, ['Design'], -45],
    ['Password reset emails', 'ivan', 2, ['Feature', 'Backend'], -52],
    ['Flaky sign-in test on CI', 'maria', 1, ['Bug'], -64],
  ] as const) add('WEB', { title, s: 'Done', a, e, l: [...l], p: 3, done });
  add('MOB', { title: 'App Store screenshots', s: 'Done', p: 3, a: 'sofia', e: 2, l: ['Design'], done: -41 });

  // Comments & notifications on the headline task
  const headline = taskIds['WEB-10'];
  const comments: [string, string, number][] = [
    ['maria', 'I can reproduce it with the Globex workspace: **3.8s** for a two-letter query.', -3],
    ['ivan', 'Timing shows ~70% is spent in the permission check. Caching it per request should be a quick win. @alex any objections?', -2],
    ['alex', 'Go for it 👍 Let’s keep the index change behind a flag until we load-test.', -1],
  ];
  for (const [who, body, offset] of comments) {
    db.run('INSERT INTO comments (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), headline, u[who], body, T + offset * DAY, T + offset * DAY);
  }
  db.run(
    "INSERT INTO activity (task_id, actor_id, kind, data, created_at) VALUES (?, ?, 'status', ?, ?)",
    headline,
    u.ivan,
    JSON.stringify({ from: status.Todo, to: status['In Progress'] }),
    T - 3 * DAY,
  );
  const note = (taskKey: string, actor: string, kind: string, data: object, offsetH: number, read = false) =>
    db.run(
      'INSERT INTO notifications (user_id, task_id, actor_id, kind, data, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      u.alex,
      taskIds[taskKey],
      u[actor],
      kind,
      JSON.stringify(data),
      T - offsetH * 3600_000,
      read ? T : null,
    );
  note('WEB-10', 'ivan', 'mention', { taskTitle: 'Search results page is slow for large workspaces', taskRef: 'WEB-10', excerpt: comments[1][1] }, 26);
  note('WEB-11', 'sofia', 'review', { taskTitle: 'Dashboard: new KPI cards', taskRef: 'WEB-11' }, 3);
  note('WEB-19', 'dan', 'status', { taskTitle: 'Upgrade to Postgres 17', taskRef: 'WEB-19', statusId: status['In Review'] }, 5);
  note('WEB-21', 'maria', 'assigned', { taskTitle: 'Session expires too early on Safari', taskRef: 'WEB-21' }, 50, true);

  for (const [key, n] of Object.entries(counters)) db.run('UPDATE projects SET next_number = ? WHERE id = ?', n + 1, proj[key]);
  for (const sid of [web1, web2]) {
    const rows = db.all<{ estimate: number | null; category: string }>(
      'SELECT t.estimate, s.category FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.sprint_id = ?',
      sid,
    );
    const points = rows.reduce((sum, r) => sum + (r.estimate ?? 0), 0);
    const stats = { total: rows.length, completed: rows.length, points, completedPoints: points };
    db.run('UPDATE sprints SET stats = ? WHERE id = ?', JSON.stringify(stats), sid);
  }
});

console.log(`Demo workspace created in ${file}. Sign in as alex@tackle.dev / demo1234`);
db.close();
