import { useMemo, useState } from 'preact/hooks';
import { CheckCircle2, Plus } from 'lucide-preact';
import { t } from '../lib/i18n';
import { filterTasks, groupTasks, sortTasks, type Display } from '../lib/view';
import { me, projects, taskList } from '../store/data';
import { load, save } from '../store/ui';
import { ListView } from '../components/ListView';
import { EmptyState, PageHeader, viewContext } from '../components/PageHeader';
import { useViewState, ViewBar } from '../components/ViewBar';
import { openCreateTask } from '../components/CreateTask';

type Tab = 'assigned' | 'review' | 'created';

const TAB_FIELD = { assigned: 'assigneeId', review: 'reviewerId', created: 'creatorId' } as const;
const EMPTY_TITLE = { assigned: 'empty.myTitle', review: 'empty.reviewTitle', created: 'empty.createdTitle' } as const;
const DISPLAY: Display = { groupBy: 'status', orderBy: 'priority', completed: 'recent', showEmpty: false };

export function MyTasks() {
  const [tab, setTab] = useState<Tab>(() => {
    const stored = load<Tab>('myTab', 'assigned');
    return stored in TAB_FIELD ? stored : 'assigned';
  });
  const [state, update] = useViewState(`my:${tab}`, DISPLAY);
  const user = me.value!;
  const all = taskList.value;
  const mine = useMemo(
    () => all.filter((x) => projects.value[x.projectId] && !projects.value[x.projectId].archived && x[TAB_FIELD[tab]] === user.id),
    [all, tab, user.id],
  );
  const ctx = viewContext();
  const filtered = filterTasks(mine, state.filters, state.display, ctx);
  const groups = groupTasks(sortTasks(filtered, state.display.orderBy), state.display.groupBy, ctx, state.display.showEmpty);
  const choose = (next: Tab) => {
    setTab(next);
    save('myTab', next);
  };

  return (
    <div class="page">
      <PageHeader
        title={t('nav.myTasks')}
        tabs={
          <>
            <button class={`tab${tab === 'assigned' ? ' active' : ''}`} onClick={() => choose('assigned')}>
              {t('my.assigned')}
            </button>
            <button class={`tab${tab === 'review' ? ' active' : ''}`} onClick={() => choose('review')}>
              {t('my.review')}
            </button>
            <button class={`tab${tab === 'created' ? ' active' : ''}`} onClick={() => choose('created')}>
              {t('my.created')}
            </button>
          </>
        }
        actions={
          <button class="btn primary sm" onClick={() => openCreateTask(tab === 'created' ? {} : { [TAB_FIELD[tab]]: user.id })}>
            <Plus size={14} />
            <span class="hide-sm">{t('task.new')}</span>
          </button>
        }
      />
      <ViewBar state={state} update={update} groupOptions={['status', 'priority', 'label', 'none']} fields={['statuses', 'priorities', 'labels']} />
      <div class="page-scroll">
        {mine.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={28} />} title={t(EMPTY_TITLE[tab])} text={t('empty.myText')} />
        ) : (
          <>
            <ListView groups={groups} orderBy={state.display.orderBy} viewKey={`my:${tab}:${state.display.groupBy}`} showSprint />
            {!filtered.length && <div class="no-results">{t('empty.noMatches')}</div>}
          </>
        )}
      </div>
    </div>
  );
}
