import { useMemo, useState } from 'preact/hooks';
import { CalendarRange, ChevronRight, Columns3, MoreHorizontal, Pencil, Play, Plus, Target, Timer, Trash2, CheckCircle2 } from 'lucide-preact';
import type { Project, Sprint, Task } from '../../shared/types';
import { daysBetween, formatDate, isoDate } from '../lib/date';
import { t, sprintLabel } from '../lib/i18n';
import { navigate } from '../lib/router';
import { emptyFilters, filterTasks, groupTasks, sortTasks, type Display } from '../lib/view';
import { activeSprint, projectSprints, statuses, taskList } from '../store/data';
import { deleteSprint } from '../store/actions';
import { load, save } from '../store/ui';
import { Burndown } from '../components/Burndown';
import { ListView } from '../components/ListView';
import { EmptyState, viewContext } from '../components/PageHeader';
import { useViewState, ViewBar } from '../components/ViewBar';
import { openCompleteSprint, openSprintDialog } from '../components/Dialogs';
import { openPicker } from '../components/Picker';
import { confirm } from '../components/Modal';
import { ProjectHeader } from './ProjectPage';

function sprintMenu(anchor: Element, sprint: Sprint) {
  openPicker(anchor, {
    width: 200,
    align: 'end',
    placeholder: sprint.name,
    items: [
      { id: 'edit', label: t('sprint.edit'), icon: <Pencil size={14} /> },
      { id: 'delete', label: t('sprint.delete'), icon: <Trash2 size={14} />, danger: true },
    ],
    onSelect: async (id) => {
      if (id === 'edit') openSprintDialog(sprint.projectId, sprint, 'edit');
      if (id === 'delete' && (await confirm({ title: t('sprint.deleteTitle', { name: sprint.name }), message: t('sprint.deleteText'), confirmLabel: t('common.delete'), danger: true }))) {
        void deleteSprint(sprint.id);
      }
    },
  });
}

/** Opens the board filtered to the active sprint. */
function openSprintBoard(project: Project) {
  const key = `view:${project.id}:board`;
  const stored = load<{ filters?: object; display?: object }>(key, {});
  save(key, { ...stored, filters: { ...emptyFilters(), sprints: ['active'] } });
  navigate(`/p/${project.key}/board`);
}

function SprintSummary({ sprint, tasks, project }: { sprint: Sprint; tasks: Task[]; project: Project }) {
  const cat = (x: Task) => statuses.value[x.statusId]?.category;
  const scoped = tasks.filter((x) => cat(x) !== 'canceled');
  const usePoints = scoped.some((x) => (x.estimate ?? 0) > 0);
  const w = (x: Task) => (usePoints ? (x.estimate ?? 0) : 1);
  const total = scoped.reduce((s, x) => s + w(x), 0);
  const done = scoped.filter((x) => cat(x) === 'completed').reduce((s, x) => s + w(x), 0);
  const started = scoped.filter((x) => cat(x) === 'started').reduce((s, x) => s + w(x), 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const today = isoDate();
  const daysLeft = daysBetween(today, sprint.endDate);
  const length = daysBetween(sprint.startDate, sprint.endDate) + 1;
  const elapsed = Math.min(length, Math.max(0, daysBetween(sprint.startDate, today) + 1));
  const unitLabel = (v: number) => (usePoints ? t('common.pointsShort', { count: v }) : t('common.tasks', { count: v }));

  return (
    <section class="sprint-card">
      <div class="sprint-card-head">
        <div>
          <div class="sprint-eyebrow">
            <span class="sprint-dot active" />
            {t('sprint.active')}
          </div>
          <h2>{sprint.name}</h2>
          <div class="sprint-dates">
            <CalendarRange size={14} />
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
            <span class={`days-left${daysLeft < 0 ? ' overdue' : daysLeft <= 2 ? ' soon' : ''}`}>
              {daysLeft < 0 ? t('sprint.overdue', { count: -daysLeft }) : daysLeft === 0 ? t('sprint.lastDay') : t('sprint.daysLeft', { count: daysLeft })}
            </span>
          </div>
        </div>
        <span class="grow" />
        <div class="sprint-actions">
          <button class="btn sm" onClick={() => openSprintBoard(project)}>
            <Columns3 size={14} />
            {t('sprint.openBoard')}
          </button>
          <button class="btn primary sm" onClick={() => openCompleteSprint(sprint)}>
            <CheckCircle2 size={14} />
            {t('sprint.complete')}
          </button>
          <button class="icon-btn" onClick={(e) => sprintMenu(e.currentTarget, sprint)} title={t('common.more')}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>
      {sprint.goal && (
        <p class="sprint-goal">
          <Target size={14} />
          {sprint.goal}
        </p>
      )}
      <div class="sprint-grid">
        <div class="sprint-stats">
          <div class="stat">
            <span class="stat-label">{t('sprint.progress')}</span>
            <span class="stat-value">{pct}%</span>
            <div class="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span class="progress-done" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              <span class="progress-started" style={{ width: `${total ? (started / total) * 100 : 0}%` }} />
            </div>
            <span class="stat-sub">
              {t('sprint.doneOf', { done: unitLabel(done), total: unitLabel(total) })}
            </span>
          </div>
          <div class="stat-row">
            <div class="stat small">
              <span class="stat-label">{t('sprint.statCompleted')}</span>
              <span class="stat-value">{scoped.filter((x) => cat(x) === 'completed').length}</span>
            </div>
            <div class="stat small">
              <span class="stat-label">{t('sprint.statInProgress')}</span>
              <span class="stat-value">{scoped.filter((x) => cat(x) === 'started').length}</span>
            </div>
            <div class="stat small">
              <span class="stat-label">{t('sprint.statTodo')}</span>
              <span class="stat-value">{scoped.filter((x) => cat(x) === 'unstarted' || cat(x) === 'backlog').length}</span>
            </div>
          </div>
          <div class="stat-sub">{t('sprint.dayOf', { day: elapsed, total: length })}</div>
        </div>
        <Burndown sprint={sprint} tasks={tasks} />
      </div>
    </section>
  );
}

const DISPLAY: Display = { groupBy: 'sprint', orderBy: 'manual', completed: 'all', showEmpty: true };

export function SprintsPage({ project }: { project: Project }) {
  const [state, update] = useViewState(`${project.id}:sprints`, DISPLAY);
  const [showPast, setShowPast] = useState(false);
  const all = taskList.value;
  const projectTasks = useMemo(() => all.filter((x) => x.projectId === project.id), [all, project.id]);
  const sprints = projectSprints(project.id);
  const active = activeSprint(project.id);
  const planned = sprints.filter((s) => s.state === 'planned');
  const completed = sprints.filter((s) => s.state === 'completed').reverse();
  const ctx = { ...viewContext(project.id), sprints: sprints.filter((s) => s.state !== 'completed') };

  // Planning shows open work: everything in active/planned sprints plus the open backlog.
  const planningTasks = projectTasks.filter((x) => {
    const s = x.sprintId ? sprints.find((sp) => sp.id === x.sprintId) : null;
    if (s?.state === 'completed') return false;
    const category = statuses.value[x.statusId]?.category;
    if (!s && (category === 'completed' || category === 'canceled')) return false;
    return true;
  });
  const filtered = filterTasks(planningTasks, state.filters, { completed: 'all' }, ctx);
  const groups = groupTasks(sortTasks(filtered, state.display.orderBy), 'sprint', ctx, true);

  return (
    <div class="page">
      <ProjectHeader project={project} view="sprints" />
      <div class="page-scroll">
        <div class="sprints-page">
          {active ? (
            <SprintSummary sprint={active} project={project} tasks={projectTasks.filter((x) => x.sprintId === active.id)} />
          ) : (
            <section class="sprint-card empty">
              <EmptyState icon={<Timer size={28} />} title={t('sprint.noneActive')} text={planned.length ? t('sprint.startHint') : t('sprint.createHint')}>
                {planned.length ? (
                  <button class="btn primary" onClick={() => openSprintDialog(project.id, planned[0], 'start')}>
                    <Play size={14} />
                    {t('sprint.startNamed', { name: planned[0].name })}
                  </button>
                ) : (
                  <button class="btn primary" onClick={() => openSprintDialog(project.id)}>
                    <Plus size={14} />
                    {t('sprint.new')}
                  </button>
                )}
              </EmptyState>
            </section>
          )}

          <div class="section-head">
            <h3>{t('sprint.planning')}</h3>
            <span class="muted hide-sm">{t('sprint.planningHint')}</span>
            <span class="grow" />
            <button class="btn sm" onClick={() => openSprintDialog(project.id)}>
              <Plus size={14} />
              {t('sprint.new')}
            </button>
          </div>
          <ViewBar state={state} update={update} projectId={project.id} groupOptions={['sprint']} hideGrouping fields={['statuses', 'assignees', 'priorities', 'labels']} />
          <ListView
            groups={groups}
            orderBy={state.display.orderBy}
            defaults={{ projectId: project.id }}
            viewKey={`${project.id}:sprints`}
            emptyGroupText={t('sprint.dropHere')}
            renderGroupActions={(g) => {
              const s = g.key === 'none' ? null : sprints.find((sp) => sp.id === g.key);
              if (!s) return null;
              return (
                <span class="group-actions">
                  {s.state === 'planned' && !active && (
                    <button class="btn ghost xs" onClick={() => openSprintDialog(project.id, s, 'start')}>
                      <Play size={12} />
                      {t('sprint.start')}
                    </button>
                  )}
                  <button class="icon-btn sm" onClick={(e) => sprintMenu(e.currentTarget, s)} title={t('common.more')}>
                    <MoreHorizontal size={14} />
                  </button>
                </span>
              );
            }}
          />

          {completed.length > 0 && (
            <section class="past-sprints">
              <button class="section-toggle" onClick={() => setShowPast(!showPast)}>
                <ChevronRight size={14} class={`chevron${showPast ? ' open' : ''}`} />
                {t('sprint.completedSprints', { count: completed.length })}
              </button>
              {showPast &&
                completed.map((s) => (
                  <div class="past-sprint" key={s.id}>
                    <CheckCircle2 size={15} class="muted" />
                    <strong>{s.name}</strong>
                    <span class="muted">{sprintLabel(s)}</span>
                    <span class="grow" />
                    {s.stats && (
                      <span class="muted">
                        {t('sprint.pastStats', { done: s.stats.completed, total: s.stats.total })}
                        {s.stats.points > 0 && ` · ${t('common.pointsShort', { count: s.stats.completedPoints })}`}
                      </span>
                    )}
                    <button class="icon-btn sm" onClick={(e) => sprintMenu(e.currentTarget, s)}>
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
