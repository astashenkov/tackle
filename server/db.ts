import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type {
  Activity,
  Attachment,
  Comment,
  Label,
  Notification,
  Project,
  Sprint,
  Status,
  Task,
  User,
} from '../shared/types';

// node:sqlite is built into Node 22.13+ and needs no native compilation, but it still
// prints an ExperimentalWarning on load. Silence just that one warning.
const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (text.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync: Database } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    color TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE invites (
    token TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'invite',
    role TEXT NOT NULL DEFAULT 'member',
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    position REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE statuses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL,
    position REAL NOT NULL
  );

  CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sprints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'planned',
    completed_at INTEGER,
    stats TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sprints_project ON sprints(project_id);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL REFERENCES statuses(id),
    priority INTEGER NOT NULL DEFAULT 0,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
    estimate INTEGER,
    due_date TEXT,
    position REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    deleted_at INTEGER,
    UNIQUE (project_id, number)
  );
  CREATE INDEX tasks_project ON tasks(project_id);
  CREATE INDEX tasks_sprint ON tasks(sprint_id);
  CREATE INDEX tasks_assignee ON tasks(assignee_id);

  CREATE TABLE task_labels (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );
  CREATE INDEX task_labels_label ON task_labels(label_id);

  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX comments_task ON comments(task_id);

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX activity_task ON activity(task_id);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX notifications_user ON notifications(user_id, read_at);
  `,
  /* 2: task reviewer */ `
  ALTER TABLE tasks ADD COLUMN reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL;
  CREATE INDEX tasks_reviewer ON tasks(reviewer_id);
  `,
  /* 3: attachments (the files live in a directory next to the database) */ `
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX attachments_task ON attachments(task_id);
  `,
  /* 4: archive for done tasks */ `
  ALTER TABLE tasks ADD COLUMN archived_at INTEGER;
  `,
];

export type Row = Record<string, SQLInputValue>;
export type Param = SQLInputValue | boolean | undefined;

/** Thin convenience wrapper around node:sqlite with statement caching and transactions. */
export class DB {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  private depth = 0;
  private onCommit: (() => void)[] = [];

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new Database(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private static norm(params: Param[]): SQLInputValue[] {
    return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...DB.norm(params)) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...DB.norm(params)) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...DB.norm(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** Runs `fn` inside a transaction (nested calls join the outer one). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.raw.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      committed = true;
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
      const callbacks = this.onCommit;
      this.onCommit = [];
      if (committed) for (const cb of callbacks) cb();
    }
  }

  /** Runs `fn` once the current transaction commits (immediately when there is none). Dropped on rollback. */
  afterCommit(fn: () => void) {
    if (this.depth > 0) this.onCommit.push(fn);
    else fn();
  }

  private migrate() {
    const { user_version: version } = this.get<{ user_version: number }>('PRAGMA user_version')!;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  getMeta(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value;
  }

  setMeta(key: string, value: string) {
    this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  close() {
    this.raw.close();
  }
}

/* ----------------------------- row mappers ----------------------------- */

type R = Record<string, any>;

export const toUser = (r: R): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  handle: r.handle,
  role: r.role,
  color: r.color,
  active: !!r.active,
  createdAt: r.created_at,
});

export const toProject = (r: R): Project => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  color: r.color,
  position: r.position,
  archived: !!r.archived,
  createdAt: r.created_at,
});

export const toStatus = (r: R): Status => ({
  id: r.id,
  name: r.name,
  category: r.category,
  color: r.color,
  position: r.position,
});

export const toLabel = (r: R): Label => ({ id: r.id, name: r.name, color: r.color });

export const toSprint = (r: R): Sprint => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  name: r.name,
  goal: r.goal,
  startDate: r.start_date,
  endDate: r.end_date,
  state: r.state,
  completedAt: r.completed_at ?? null,
  stats: r.stats ? JSON.parse(r.stats) : null,
  createdAt: r.created_at,
});

export const toTask = (r: R, labelIds: string[]): Task => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  title: r.title,
  description: r.description,
  statusId: r.status_id,
  priority: r.priority,
  assigneeId: r.assignee_id ?? null,
  reviewerId: r.reviewer_id ?? null,
  creatorId: r.creator_id ?? null,
  sprintId: r.sprint_id ?? null,
  estimate: r.estimate ?? null,
  dueDate: r.due_date ?? null,
  labelIds,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at ?? null,
  completedAt: r.completed_at ?? null,
  archivedAt: r.archived_at ?? null,
});

export const toAttachment = (r: R): Attachment => ({
  id: r.id,
  taskId: r.task_id,
  uploaderId: r.uploader_id ?? null,
  name: r.name,
  type: r.type,
  size: r.size,
  createdAt: r.created_at,
});

export const toComment = (r: R): Comment => ({
  id: r.id,
  taskId: r.task_id,
  authorId: r.author_id ?? null,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toActivity = (r: R): Activity => ({
  id: r.id,
  taskId: r.task_id,
  actorId: r.actor_id ?? null,
  kind: r.kind,
  data: JSON.parse(r.data),
  createdAt: r.created_at,
});

export const toNotification = (r: R): Notification => ({
  id: r.id,
  taskId: r.task_id,
  actorId: r.actor_id ?? null,
  kind: r.kind,
  data: JSON.parse(r.data),
  createdAt: r.created_at,
  readAt: r.read_at ?? null,
});

/* ----------------------------- common queries ----------------------------- */

export function loadTask(db: DB, id: string): Task | undefined {
  const row = db.get('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) return undefined;
  const labels = db.all<{ label_id: string }>('SELECT label_id FROM task_labels WHERE task_id = ?', id).map((l) => l.label_id);
  return toTask(row, labels);
}

export function loadAllTasks(db: DB): Task[] {
  const labelMap = new Map<string, string[]>();
  for (const l of db.all<{ task_id: string; label_id: string }>('SELECT task_id, label_id FROM task_labels')) {
    const arr = labelMap.get(l.task_id);
    if (arr) arr.push(l.label_id);
    else labelMap.set(l.task_id, [l.label_id]);
  }
  return db.all('SELECT * FROM tasks WHERE deleted_at IS NULL').map((r) => toTask(r, labelMap.get(r.id as string) ?? []));
}
