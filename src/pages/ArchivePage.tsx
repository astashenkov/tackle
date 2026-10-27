import { useMemo } from 'preact/hooks';
import { Archive } from 'lucide-preact';
import type { Project } from '../../shared/types';
import { t } from '../lib/i18n';
import { filterTasks, groupByMonth, type Display } from '../lib/view';
import { taskList } from '../store/data';
import { ListView } from '../components/ListView';
import { EmptyState, viewContext } from '../components/PageHeader';
import { useViewState, ViewBar } from '../components/ViewBar';
import { ProjectHeader } from './ProjectPage';

const DISPLAY: Display = { groupBy: 'none', orderBy: 'manual', completed: 'all', showEmpty: false };

/** Done tasks from past months, grouped by the month they were finished in. */
export function ArchivePage({ project }: { project: Project }) {
  const [state, update] = useViewState(`${project.id}:archive`, DISPLAY);
  const all = taskList.value;
  const archived = useMemo(() => all.filter((x) => x.projectId === project.id && x.archivedAt), [all, project.id]);
  const filtered = filterTasks(archived, state.filters, { completed: 'all' }, viewContext(project.id));
  const groups = groupByMonth(filtered);

  return (
    <div class="page">
      <ProjectHeader project={project} view="archive" />
      <ViewBar state={state} update={update} projectId={project.id} groupOptions={[]} fields={['assignees', 'reviewers', 'priorities', 'labels', 'sprints']} display={false} />
      <div class="page-scroll">
        {archived.length === 0 ? (
          <EmptyState icon={<Archive size={28} />} title={t('archive.emptyTitle')} text={t('archive.emptyText')} />
        ) : (
          <>
            {/* Ordered by completion date, so there is nothing to reorder by hand. */}
            <ListView groups={groups} orderBy="updated" viewKey={`${project.id}:archive`} showSprint />
            {!filtered.length && <div class="no-results">{t('empty.noMatches')}</div>}
          </>
        )}
      </div>
    </div>
  );
}
