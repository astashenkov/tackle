import { useEffect, useState } from 'preact/hooks';
import { CalendarClock, CircleSlash, Eye, Hash, Plus } from 'lucide-preact';
import type { ID, Priority, Task } from '../../shared/types';
import { dueLabel } from '../lib/date';
import { t, priorityName } from '../lib/i18n';
import { modKey } from '../lib/hotkeys';
import { activeSprint, labels, projectList, projects, sprints, statusList, statuses, users } from '../store/data';
import { createTask } from '../store/actions';
import { createDialog, load, save } from '../store/ui';
import { Avatar } from './Avatar';
import { PriorityIcon, StatusIcon } from './Icons';
import { MentionTextarea } from './MentionTextarea';
import { Modal } from './Modal';
import { openPicker } from './Picker';
import { pickAssignee, pickDueDate, pickEstimate, pickLabels, pickPriority, pickReviewer, pickSprint, pickStatus } from './pickers';
import { openTaskPanel } from './TaskPanel';
import { toast } from './Toasts';

type Draft = {
  projectId: ID;
  title: string;
  description: string;
  statusId: ID;
  priority: Priority;
  assigneeId: ID | null;
  reviewerId: ID | null;
  labelIds: ID[];
  estimate: number | null;
  sprintId: ID | null;
  dueDate: string | null;
};

function initialDraft(defaults: Partial<Task>): Draft {
  const projectId = defaults.projectId ?? load<string | null>('lastProject', null) ?? projectList.value[0]?.id ?? '';
  const statusId =
    defaults.statusId ?? statusList.value.find((s) => s.category === 'unstarted')?.id ?? statusList.value[0]?.id ?? '';
  return {
    projectId: projects.value[projectId] ? projectId : (projectList.value[0]?.id ?? ''),
    title: '',
    description: '',
    statusId,
    priority: defaults.priority ?? 0,
    assigneeId: defaults.assigneeId ?? null,
    reviewerId: defaults.reviewerId ?? null,
    labelIds: defaults.labelIds ?? [],
    estimate: defaults.estimate ?? null,
    sprintId: defaults.sprintId ?? null,
    dueDate: defaults.dueDate ?? null,
  };
}

export function CreateTaskDialog() {
  const state = createDialog.value;
  if (!state) return null;
  return <CreateTaskForm defaults={state.defaults} />;
}

function CreateTaskForm({ defaults }: { defaults: Partial<Task> }) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defaults));
  const [more, setMore] = useState(() => load('createMore', false));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const close = () => (createDialog.value = null);

  useEffect(() => save('createMore', more), [more]);

  const project = projects.value[draft.projectId];
  const status = statuses.value[draft.statusId];
  const assignee = draft.assigneeId ? users.value[draft.assigneeId] : null;
  const reviewer = draft.reviewerId ? users.value[draft.reviewerId] : null;
  const sprint = draft.sprintId ? sprints.value[draft.sprintId] : null;
  const draftLabels = draft.labelIds.map((l) => labels.value[l]).filter(Boolean);

  const submit = async () => {
    const title = draft.title.trim();
    if (!title || !draft.projectId) return;
    save('lastProject', draft.projectId);
    const payload = { ...draft, title };
    if (more) {
      setDraft((d) => ({ ...d, title: '', description: '' }));
      document.querySelector<HTMLInputElement>('.create-title')?.focus();
    } else close();
    const created = await createTask(payload);
    if (created) {
      toast(t('toast.created', { ref: `${projects.value[created.projectId]?.key}-${created.number}` }), {
        action: { label: t('common.open'), run: () => openTaskPanel(created) },
      });
    }
  };

  const chooseProject = (anchor: Element) =>
    openPicker(anchor, {
      placeholder: t('picker.project'),
      selected: [draft.projectId],
      items: projectList.value.map((p) => ({ id: p.id, label: p.name, hint: p.key, icon: <span class="project-badge sm" style={{ background: p.color }}>{p.key[0]}</span> })),
      onSelect: (id) => setDraft((d) => ({ ...d, projectId: id, sprintId: null })),
    });

  return (
    <Modal
      onClose={close}
      width={680}
      class="create-modal"
      title={
        <span class="crumbs">
          <button class="crumb-btn" onClick={(e) => chooseProject(e.currentTarget)} disabled={projectList.value.length < 2}>
            <span class="project-badge sm" style={{ background: project?.color }}>
              {project?.key[0]}
            </span>
            {project?.name}
          </button>
          <span class="muted">›</span>
          <span>{t('task.new')}</span>
        </span>
      }
      footer={
        <>
          <label class="toggle">
            <input type="checkbox" checked={more} onChange={(e) => setMore((e.target as HTMLInputElement).checked)} />
            <span class="toggle-track" />
            {t('task.createMore')}
          </label>
          <span class="grow" />
          <button class="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button class="btn primary" disabled={!draft.title.trim()} onClick={submit}>
            {t('task.create')}
            <kbd class="kbd-inline">{modKey}↵</kbd>
          </button>
        </>
      }
    >
      <div
        class="create-form"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <input
          class="create-title"
          placeholder={t('task.titlePlaceholder')}
          value={draft.title}
          autoFocus
          onInput={(e) => set('title', (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <MentionTextarea
          class="create-desc"
          value={draft.description}
          onValue={(v) => set('description', v)}
          minRows={3}
          placeholder={t('task.descriptionPlaceholder')}
        />
        <div class="create-props">
          <button class="prop-pill" onClick={(e) => pickStatus(e.currentTarget, [], (id) => set('statusId', id), draft.statusId)}>
            {status && <StatusIcon category={status.category} color={status.color} />}
            {status?.name}
          </button>
          <button class={`prop-pill prio-${draft.priority}`} onClick={(e) => pickPriority(e.currentTarget, [], (p) => set('priority', p), draft.priority)}>
            <PriorityIcon priority={draft.priority} />
            {draft.priority ? priorityName(draft.priority) : t('prop.priority')}
          </button>
          <button class="prop-pill" onClick={(e) => pickAssignee(e.currentTarget, [], (id) => set('assigneeId', id), draft.assigneeId)}>
            <Avatar user={assignee} size={16} />
            {assignee?.name ?? t('prop.assignee')}
          </button>
          {/* The eye tells it apart from the assignee once a name is shown. */}
          <button class="prop-pill" title={t('prop.reviewer')} onClick={(e) => pickReviewer(e.currentTarget, [], (id) => set('reviewerId', id), draft.reviewerId)}>
            <Eye size={14} />
            {reviewer?.name ?? t('prop.reviewer')}
          </button>
          <button
            class="prop-pill"
            onClick={(e) =>
              pickLabels(
                e.currentTarget,
                [],
                (id, on) => setDraft((d) => ({ ...d, labelIds: on ? [...d.labelIds, id] : d.labelIds.filter((l) => l !== id) })),
                draft.labelIds,
              )
            }
          >
            {draftLabels.length ? (
              draftLabels.map((l) => (
                <span class="label-chip bare" key={l.id}>
                  <span class="label-dot" style={{ background: l.color }} />
                  {l.name}
                </span>
              ))
            ) : (
              <>
                <Plus size={14} />
                {t('prop.labels')}
              </>
            )}
          </button>
          <button class="prop-pill" onClick={(e) => pickEstimate(e.currentTarget, [], (v) => set('estimate', v), draft.estimate)}>
            <Hash size={14} />
            {draft.estimate == null ? t('prop.estimate') : t('common.points', { count: draft.estimate })}
          </button>
          <button
            class="prop-pill"
            onClick={(e) => pickSprint(e.currentTarget, [], draft.projectId, (id) => set('sprintId', id), draft.sprintId)}
            title={activeSprint(draft.projectId) ? undefined : t('picker.noSprints')}
          >
            {sprint ? <span class={`sprint-dot ${sprint.state}`} /> : <CircleSlash size={14} />}
            {sprint?.name ?? t('prop.sprint')}
          </button>
          <button class="prop-pill" onClick={(e) => pickDueDate(e.currentTarget, [], (d) => set('dueDate', d), draft.dueDate)}>
            <CalendarClock size={14} />
            {draft.dueDate ? dueLabel(draft.dueDate) : t('prop.dueDate')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function openCreateTask(defaults: Partial<Task> = {}) {
  createDialog.value = { defaults };
}
