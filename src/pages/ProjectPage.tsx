import { useMemo } from 'preact/hooks';
import { Columns3, List, MoreHorizontal, Pencil, Archive, Plus, Timer, Inbox as InboxIcon } from 'lucide-preact';
import type { Project, Task } from '../../shared/types';
import { t } from '../lib/i18n';
import { navigate } from '../lib/router';
import { filterTasks, groupTasks, sortTasks, type Display, type GroupBy } from '../lib/view';
import { activeSprint, projectsByKey, taskList } from '../store/data';
import { saveProject } from '../store/actions';
import { Board } from '../components/Board';
import { ListView } from '../components/ListView';
import { EmptyState, PageHeader, viewContext } from '../components/PageHeader';
import { useViewState, ViewBar } from '../components/ViewBar';
import { openCreateTask } from '../components/CreateTask';
import { openProjectDialog } from '../components/Dialogs';
import { openPicker } from '../components/Picker';
import { confirm } from '../components/Modal';
import { ArchivePage } from './ArchivePage';
import { SprintsPage } from './SprintsPage';
import { NotFound } from './NotFound';

export type ProjectView = 'board' | 'list' | 'sprints' | 'archive';

export function ProjectTabs({ project, view }: { project: Project; view: ProjectView }) {
  const tab = (v: ProjectView, icon: preact.ComponentChildren, label: string) => (
    <a href={`/p/${project.key}/${v}`} class={`tab${view === v ? ' active' : ''}`}>
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <>
      {tab('board', <Columns3 size={14} />, t('view.board'))}
      {tab('list', <List size={14} />, t('view.list'))}
      {tab('sprints', <Timer size={14} />, t('view.sprints'))}
      {tab('archive', <Archive size={14} />, t('view.archive'))}
    </>
  );
}

export function projectMenu(anchor: Element, project: Project) {
  openPicker(anchor, {
    width: 220,
    align: 'end',
    placeholder: project.name,
    items: [
      { id: 'edit', label: t('project.edit'), icon: <Pencil size={14} /> },
      { id: 'archive', label: t('project.archive'), icon: <Archive size={14} />, danger: true },
    ],
    onSelect: async (id) => {
      if (id === 'edit') openProjectDialog(project);
      if (id === 'archive') {
        const ok = await confirm({ title: t('project.archiveTitle', { name: project.name }), message: t('project.archiveText'), confirmLabel: t('project.archive'), danger: true });
        if (ok && (await saveProject({ id: project.id, archived: true }))) navigate('/');
      }
    },
  });
}

export function ProjectHeader({ project, view }: { project: Project; view: ProjectView }) {
  return (
    <PageHeader
      icon={
        <span class="project-badge" style={{ background: project.color }}>
          {project.key[0]}
        </span>
      }
      title={project.name}
      tabs={<ProjectTabs project={project} view={view} />}
      actions={
        <>
          <button class="icon-btn" title={t('common.more')} onClick={(e) => projectMenu(e.currentTarget, project)}>
            <MoreHorizontal size={16} />
          </button>
          <button class="btn primary sm" onClick={() => openCreateTask({ projectId: project.id })}>
            <Plus size={14} />
            <span class="hide-sm">{t('task.new')}</span>
          </button>
        </>
      }
    />
  );
}

const DEFAULTS: Record<'board' | 'list', Display> = {
  board: { groupBy: 'status', orderBy: 'manual', completed: 'recent', showEmpty: true },
  list: { groupBy: 'status', orderBy: 'manual', completed: 'recent', showEmpty: false },
};

export function ProjectPage({ projectKey, view }: { projectKey: string; view: ProjectView }) {
  const project = projectsByKey.value[projectKey];
  if (!project) return <NotFound />;
  if (view === 'sprints') return <SprintsPage project={project} />;
  if (view === 'archive') return <ArchivePage project={project} />;
  return <TasksView project={project} view={view} />;
}

function TasksView({ project, view }: { project: Project; view: 'board' | 'list' }) {
  const [state, update] = useViewState(`${project.id}:${view}`, DEFAULTS[view]);
  const all = taskList.value;
  const projectTasks = useMemo(() => all.filter((x) => x.projectId === project.id), [all, project.id]);
  // Done tasks from past months live in the archive, not here.
  const current = useMemo(() => projectTasks.filter((x) => !x.archivedAt), [projectTasks]);
  const ctx = viewContext(project.id);
  const filtered = filterTasks(current, state.filters, state.display, ctx);
  const sorted = sortTasks(filtered, state.display.orderBy);
  const groupBy: GroupBy = view === 'board' ? 'status' : state.display.groupBy;
  const groups = groupTasks(sorted, groupBy, ctx, view === 'board' ? true : state.display.showEmpty);

  // New tasks created from a sprint-filtered view land in that sprint.
  const defaults: Partial<Task> & { projectId: string } = { projectId: project.id };
  const sf = state.filters.sprints;
  if (sf.length === 1) {
    if (sf[0] === 'active') defaults.sprintId = activeSprint(project.id)?.id ?? null;
    else if (sf[0] !== 'none') defaults.sprintId = sf[0];
  }
  if (state.filters.assignees.length === 1 && state.filters.assignees[0] !== 'none') defaults.assigneeId = state.filters.assignees[0];

  return (
    <div class="page">
      <ProjectHeader project={project} view={view} />
      <ViewBar state={state} update={update} projectId={project.id} groupOptions={['status', 'assignee', 'priority', 'sprint', 'label', 'none']} hideGrouping={view === 'board'} />
      {projectTasks.length === 0 ? (
        <EmptyState icon={<InboxIcon size={28} />} title={t('empty.projectTitle')} text={t('empty.projectText')}>
          <button class="btn primary" onClick={() => openCreateTask({ projectId: project.id })}>
            <Plus size={14} />
            {t('task.new')}
            <kbd class="kbd-inline">C</kbd>
          </button>
        </EmptyState>
      ) : view === 'board' ? (
        <Board groups={groups} orderBy={state.display.orderBy} defaults={defaults} />
      ) : (
        <div class="page-scroll">
          <ListView
            groups={groups}
            orderBy={state.display.orderBy}
            defaults={defaults}
            viewKey={`${project.id}:list:${groupBy}`}
            showSprint={groupBy !== 'sprint'}
          />
          {!filtered.length && <div class="no-results">{t('empty.noMatches')}</div>}
        </div>
      )}
    </div>
  );
}
