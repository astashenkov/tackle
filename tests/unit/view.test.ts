import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sprint, Status, Task } from '../../shared/types';
import { checklistProgress, extractMentions, slugify } from '../../shared/constants';
import { emptyFilters, filterTasks, groupTasks, positionBetween, sortTasks, type ViewContext } from '../../src/lib/view';

const statusList: Status[] = [
  { id: 'backlog', name: 'Backlog', category: 'backlog', color: '#999', position: 1 },
  { id: 'todo', name: 'Todo', category: 'unstarted', color: '#999', position: 2 },
  { id: 'doing', name: 'Doing', category: 'started', color: '#999', position: 3 },
  { id: 'done', name: 'Done', category: 'completed', color: '#999', position: 4 },
];
const sprints: Sprint[] = [
  { id: 's1', projectId: 'p', number: 1, name: 'S1', goal: '', startDate: '2026-01-01', endDate: '2026-01-14', state: 'completed', completedAt: 1, stats: null, createdAt: 0 },
  { id: 's2', projectId: 'p', number: 2, name: 'S2', goal: '', startDate: '2026-01-15', endDate: '2026-01-28', state: 'active', completedAt: null, stats: null, createdAt: 0 },
  { id: 's3', projectId: 'p', number: 3, name: 'S3', goal: '', startDate: '2026-01-29', endDate: '2026-02-11', state: 'planned', completedAt: null, stats: null, createdAt: 0 },
];
const NOW = Date.UTC(2026, 0, 20);

const ctx: ViewContext = {
  statuses: Object.fromEntries(statusList.map((s) => [s.id, s])),
  statusList,
  users: {},
  userList: [],
  labels: {},
  labelList: [{ id: 'bug', name: 'Bug', color: '#f00' }],
  sprints,
  projectKeys: { p: 'WEB' },
  now: NOW,
};

let n = 0;
function task(p: Partial<Task>): Task {
  n++;
  return {
    id: `t${n}`,
    projectId: 'p',
    number: n,
    title: `Task ${n}`,
    description: '',
    statusId: 'todo',
    priority: 0,
    assigneeId: null,
    reviewerId: null,
    creatorId: null,
    sprintId: null,
    estimate: null,
    dueDate: null,
    labelIds: [],
    position: n * 1024,
    createdAt: n,
    updatedAt: n,
    startedAt: null,
    completedAt: null,
    ...p,
  };
}

const a = task({ title: 'Fix login', priority: 2, assigneeId: 'u1', sprintId: 's2', labelIds: ['bug'] });
const b = task({ title: 'Write docs', priority: 4, statusId: 'doing', reviewerId: 'u1' });
const c = task({ title: 'Old done', statusId: 'done', completedAt: NOW - 30 * 86_400_000, sprintId: 's1' });
const d = task({ title: 'New done', statusId: 'done', completedAt: NOW - 86_400_000, priority: 1 });
const all = [a, b, c, d];

test('hides old completed tasks in "recent" mode', () => {
  const ids = filterTasks(all, emptyFilters(), { completed: 'recent' }, ctx).map((t) => t.id);
  assert.deepEqual(ids, [a.id, b.id, d.id]);
  assert.equal(filterTasks(all, emptyFilters(), { completed: 'all' }, ctx).length, 4);
  assert.equal(filterTasks(all, emptyFilters(), { completed: 'none' }, ctx).length, 2);
});

test('filters by assignee, reviewer, label, sprint and text', () => {
  const f = emptyFilters();
  assert.deepEqual(filterTasks(all, { ...f, assignees: ['none'] }, { completed: 'all' }, ctx).map((t) => t.id), [b.id, c.id, d.id]);
  assert.deepEqual(filterTasks(all, { ...f, reviewers: ['u1'] }, { completed: 'all' }, ctx).map((t) => t.id), [b.id]);
  assert.deepEqual(filterTasks(all, { ...f, reviewers: ['none'] }, { completed: 'all' }, ctx).map((t) => t.id), [a.id, c.id, d.id]);
  assert.deepEqual(filterTasks(all, { ...f, labels: ['bug'] }, { completed: 'all' }, ctx).map((t) => t.id), [a.id]);
  assert.deepEqual(filterTasks(all, { ...f, sprints: ['active'] }, { completed: 'all' }, ctx).map((t) => t.id), [a.id]);
  assert.deepEqual(filterTasks(all, { ...f, sprints: ['none'] }, { completed: 'all' }, ctx).map((t) => t.id), [b.id, d.id]);
  assert.deepEqual(filterTasks(all, { ...f, q: 'docs' }, { completed: 'all' }, ctx).map((t) => t.id), [b.id]);
  assert.deepEqual(filterTasks(all, { ...f, q: `web-${b.number}` }, { completed: 'all' }, ctx).map((t) => t.id), [b.id]);
});

test('sorts by priority with "no priority" last', () => {
  assert.deepEqual(sortTasks([b, a, d], 'priority').map((t) => t.priority), [1, 2, 4]);
  const none = task({ priority: 0 });
  assert.equal(sortTasks([none, b], 'priority')[1].id, none.id);
});

test('groups by status in workflow order and by sprint with backlog last', () => {
  const byStatus = groupTasks(all, 'status', ctx, true);
  assert.deepEqual(byStatus.map((g) => g.key), ['backlog', 'todo', 'doing', 'done']);
  assert.deepEqual(byStatus.find((g) => g.key === 'done')!.patch, { statusId: 'done' });
  const bySprint = groupTasks(all, 'sprint', ctx, false);
  assert.deepEqual(bySprint.map((g) => g.key), ['s2', 's1', 'none']);
  assert.deepEqual(bySprint.at(-1)!.patch, { sprintId: null });
});

test('positionBetween places a task between neighbours', () => {
  const list = [task({ position: 100 }), task({ position: 200 }), task({ position: 300 })];
  assert.equal(positionBetween(list, 'x', list[1].id), 150);
  assert.equal(positionBetween(list, 'x', list[0].id), 100 - 1024);
  assert.equal(positionBetween(list, 'x', null), 300 + 1024);
  // Moving an item ignores its own old slot.
  assert.equal(positionBetween(list, list[0].id, list[2].id), 250);
  assert.equal(positionBetween([], 'x', null), 0);
});

test('shared helpers', () => {
  assert.deepEqual(extractMentions('Hi @alex, @Maria. mail me at x@y.com `@code`'), ['alex', 'maria']);
  assert.deepEqual(checklistProgress('- [x] a\n- [ ] b\n* [X] c\nnot - [ ] d'), { done: 2, total: 3 });
  assert.equal(slugify('Исправить логин: SSO & 2FA!'), 'ispravit-login-sso-2fa');
});
