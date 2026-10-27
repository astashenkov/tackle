import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sprint, Status, Task } from '../../shared/types';
import { checklistProgress, extractMentions, slugify } from '../../shared/constants';
import { emptyFilters, filterTasks, groupByMonth, groupTasks, positionBetween, sortTasks, type ViewContext } from '../../src/lib/view';

const statusList: Status[] = [
  { id: 'backlog', name: 'Backlog', category: 'backlog', color: '#999', position: 1 },
  { id: 'todo', name: 'Todo', category: 'unstarted', color: '#999', position: 2 },
  { id: 'doing', name: 'Doing', category: 'started', color: '#999', position: 3 },
  { id: 'done', name: 'Done', category: 'completed', color: '#999', position: 4 },
  { id: 'canceled', name: 'Canceled', category: 'canceled', color: '#999', position: 5 },
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
    archivedAt: null,
    ...p,
  };
}

const a = task({ title: 'Fix login', priority: 2, assigneeId: 'u1', sprintId: 's2', labelIds: ['bug'] });
const b = task({ title: 'Write docs', priority: 4, statusId: 'doing', reviewerId: 'u1' });
const c = task({ title: 'Old done', statusId: 'done', completedAt: NOW - 30 * 86_400_000, sprintId: 's1' });
const d = task({ title: 'New done', statusId: 'done', completedAt: NOW - 86_400_000, priority: 1 });
const all = [a, b, c, d];

test('"recent" mode keeps done tasks until they are archived and hides old canceled ones', () => {
  const oldCanceled = task({ statusId: 'canceled', completedAt: NOW - 15 * 86_400_000 });
  const newCanceled = task({ statusId: 'canceled', completedAt: NOW - 13 * 86_400_000 });
  const tasks = [...all, oldCanceled, newCanceled];
  const ids = filterTasks(tasks, emptyFilters(), { completed: 'recent' }, ctx).map((t) => t.id);
  // A month-old done task stays on the board: the monthly archive, not its age, takes it away.
  assert.deepEqual(ids, [a.id, b.id, c.id, d.id, newCanceled.id]);
  assert.equal(filterTasks(tasks, emptyFilters(), { completed: 'all' }, ctx).length, 6);
  assert.deepEqual(filterTasks(tasks, emptyFilters(), { completed: 'none' }, ctx).map((t) => t.id), [a.id, b.id]);
});

test('groups archived tasks by the month they were finished in, newest first', () => {
  const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime();
  const sept = task({ statusId: 'done', completedAt: at(9, 30, 23) });
  const octEarly = task({ statusId: 'done', completedAt: at(10, 1, 0) });
  const octLate = task({ statusId: 'done', completedAt: at(10, 31, 23) });
  // Moved into a "completed" status by re-categorizing it, so it has no completion time.
  const recategorized = task({ statusId: 'done', completedAt: null, updatedAt: at(8, 14) });
  const groups = groupByMonth([octEarly, recategorized, sept, octLate]);
  assert.deepEqual(groups.map((g) => g.key), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(groups[0].tasks.map((t) => t.id), [octLate.id, octEarly.id]);
  assert.deepEqual(groups[2].tasks.map((t) => t.id), [recategorized.id]);
  assert.ok(groups.every((g) => g.kind === 'month' && g.patch === null), 'dropping a task on a month changes nothing');
  assert.deepEqual(groupByMonth([]), []);
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
  assert.deepEqual(byStatus.map((g) => g.key), ['backlog', 'todo', 'doing', 'done', 'canceled']);
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
