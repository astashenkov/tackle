import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  ChevronRight,
  CircleSlash,
  GitBranch,
  Hash,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-preact';
import { slugify } from '../../shared/constants';
import type { Activity, Comment, ID, Task } from '../../shared/types';
import { api, newId } from '../lib/api';
import { dueLabel, dueState, formatDate, formatDateTime, relativeTime } from '../lib/date';
import { t, tx, priorityName } from '../lib/i18n';
import { useHotkeys } from '../lib/hotkeys';
import { setQuery } from '../lib/router';
import { isClosed, labels, me, projects, ready, sprints, statuses, taskRef, tasks, timelineVersion, users } from '../store/data';
import { deleteTasks, reportError, updateTask } from '../store/actions';
import { openTask, openTaskRef, visibleIds } from '../store/ui';
import { Avatar } from './Avatar';
import { PriorityIcon, StatusIcon } from './Icons';
import { Markdown } from './Markdown';
import { MentionTextarea } from './MentionTextarea';
import { openPicker } from './Picker';
import { pickAssignee, pickDueDate, pickEstimate, pickLabels, pickPriority, pickSprint, pickStatus } from './pickers';
import { statusProgress } from './TaskBits';
import { toast } from './Toasts';
import { confirm } from './Modal';

export function openTaskPanel(task: Task, opts: { replace?: boolean } = {}) {
  if (!task.number) return; // still being created
  setQuery({ task: taskRef(task) }, { replace: opts.replace ?? !!openTaskRef.value });
}

export function closeTaskPanel() {
  setQuery({ task: null });
}

export async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(text);
  }
}

export const taskUrl = (task: Task) => `${window.location.origin}/t/${taskRef(task)}`;
export const branchName = (task: Task) => `${taskRef(task).toLowerCase()}-${slugify(task.title)}`;

/* --------------------------------- title --------------------------------- */

function TitleEditor({ task }: { task: Task }) {
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setValue(task.title);
  }, [task.title, task.id]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  const commit = () => {
    const v = value.replace(/\s+/g, ' ').trim();
    if (!v) setValue(task.title);
    else if (v !== task.title) void updateTask(task.id, { title: v });
  };
  return (
    <textarea
      ref={ref}
      class="panel-title"
      rows={1}
      value={value}
      aria-label={t('task.title')}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

/* ------------------------------ description ------------------------------ */

function DescriptionEditor({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(task.description);
  }, [task.description, task.id]);
  useEffect(() => setEditing(false), [task.id]);

  const save = () => {
    setEditing(false);
    if (draft !== task.description) void updateTask(task.id, { description: draft });
  };

  if (editing) {
    return (
      <div class="description editing">
        <MentionTextarea
          textareaRef={textRef}
          value={draft}
          onValue={setDraft}
          minRows={6}
          autoFocus
          placeholder={t('task.descriptionPlaceholder')}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              e.stopPropagation();
              save();
            }
          }}
        />
        <div class="editor-hint">{t('task.markdownHint')}</div>
      </div>
    );
  }
  return (
    <div
      class={`description${task.description ? '' : ' empty'}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, input')) return;
        setEditing(true);
      }}
    >
      {task.description ? (
        <Markdown source={task.description} onChange={(next) => updateTask(task.id, { description: next })} />
      ) : (
        <span class="placeholder">{t('task.descriptionPlaceholder')}</span>
      )}
    </div>
  );
}

/* ------------------------------- properties ------------------------------- */

function Prop({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="prop-row">
      <span class="prop-label">{label}</span>
      <div class="prop-value">{children}</div>
    </div>
  );
}

function Properties({ task }: { task: Task }) {
  const status = statuses.value[task.statusId];
  const assignee = task.assigneeId ? users.value[task.assigneeId] : null;
  const sprint = task.sprintId ? sprints.value[task.sprintId] : null;
  const taskLabels = task.labelIds.map((l) => labels.value[l]).filter(Boolean);
  const ids = [task.id];
  return (
    <div class="props-grid">
      <Prop label={t('prop.status')}>
        <button class="prop-pill" data-prop="status" onClick={(e) => pickStatus(e.currentTarget, ids)}>
          {status && <StatusIcon category={status.category} color={status.color} progress={statusProgress(task)} />}
          {status?.name ?? '—'}
        </button>
      </Prop>
      <Prop label={t('prop.priority')}>
        <button class={`prop-pill prio-${task.priority}`} data-prop="priority" onClick={(e) => pickPriority(e.currentTarget, ids)}>
          <PriorityIcon priority={task.priority} />
          {priorityName(task.priority)}
        </button>
      </Prop>
      <Prop label={t('prop.assignee')}>
        <button class={`prop-pill${assignee ? '' : ' muted'}`} data-prop="assignee" onClick={(e) => pickAssignee(e.currentTarget, ids)}>
          <Avatar user={assignee} size={18} />
          {assignee?.name ?? t('common.noAssignee')}
        </button>
      </Prop>
      <Prop label={t('prop.labels')}>
        <div class="prop-labels">
          {taskLabels.map((l) => (
            <button class="label-chip" key={l.id} onClick={(e) => pickLabels(e.currentTarget, ids)}>
              <span class="label-dot" style={{ background: l.color }} />
              {l.name}
            </button>
          ))}
          <button class={`prop-pill${taskLabels.length ? ' icon-only' : ' muted'}`} data-prop="labels" onClick={(e) => pickLabels(e.currentTarget, ids)} title={t('picker.labels')}>
            <Plus size={14} />
            {!taskLabels.length && t('common.addLabel')}
          </button>
        </div>
      </Prop>
      <Prop label={t('prop.estimate')}>
        <button class={`prop-pill${task.estimate == null ? ' muted' : ''}`} data-prop="estimate" onClick={(e) => pickEstimate(e.currentTarget, ids)}>
          <Hash size={14} />
          {task.estimate == null ? t('common.noEstimate') : t('common.points', { count: task.estimate })}
        </button>
      </Prop>
      <Prop label={t('prop.sprint')}>
        <button class={`prop-pill${sprint ? '' : ' muted'}`} data-prop="sprint" onClick={(e) => pickSprint(e.currentTarget, ids)}>
          {sprint ? <span class={`sprint-dot ${sprint.state}`} /> : <CircleSlash size={14} />}
          {sprint?.name ?? t('common.noSprint')}
        </button>
      </Prop>
      <Prop label={t('prop.dueDate')}>
        <button
          class={`prop-pill${task.dueDate ? ` due ${isClosed(task) ? 'later' : dueState(task.dueDate)}` : ' muted'}`}
          data-prop="due"
          onClick={(e) => pickDueDate(e.currentTarget, ids)}
        >
          <CalendarClock size={14} />
          {task.dueDate ? `${dueLabel(task.dueDate)}${dueLabel(task.dueDate) !== formatDate(task.dueDate) ? ` · ${formatDate(task.dueDate)}` : ''}` : t('common.noDueDate')}
        </button>
      </Prop>
    </div>
  );
}

/* -------------------------------- timeline -------------------------------- */

function userName(id: unknown): ComponentChildren {
  const u = typeof id === 'string' ? users.value[id] : null;
  return <strong>{u?.name ?? t('common.someone')}</strong>;
}

function statusNode(id: unknown): ComponentChildren {
  const s = typeof id === 'string' ? statuses.value[id] : null;
  if (!s) return <strong>{t('common.deletedStatus')}</strong>;
  return (
    <strong class="inline-status">
      <StatusIcon category={s.category} color={s.color} size={12} />
      {s.name}
    </strong>
  );
}

function sprintNode(id: unknown): ComponentChildren {
  const s = typeof id === 'string' ? sprints.value[id] : null;
  return <strong>{s?.name ?? t('common.deletedSprint')}</strong>;
}

function labelNodes(ids: ID[] | undefined): ComponentChildren {
  return (ids ?? []).map((id, i) => (
    <>
      {i > 0 && ', '}
      <strong>{labels.value[id]?.name ?? '—'}</strong>
    </>
  ));
}

function describeActivity(a: Activity): ComponentChildren {
  const actor = userName(a.actorId);
  const { from, to } = a.data;
  switch (a.kind) {
    case 'created':
      return tx('activity.created', { actor });
    case 'title':
      return tx('activity.title', { actor, to: <strong>{String(to)}</strong> });
    case 'description':
      return tx('activity.description', { actor });
    case 'status':
      return tx('activity.status', { actor, from: statusNode(from), to: statusNode(to) });
    case 'priority':
      return to ? tx('activity.priority', { actor, to: <strong>{priorityName(to as 0)}</strong> }) : tx('activity.priorityRemoved', { actor });
    case 'assignee':
      if (!to) return tx('activity.unassigned', { actor, from: userName(from) });
      if (to === a.actorId) return tx('activity.selfAssigned', { actor });
      return tx('activity.assigned', { actor, to: userName(to) });
    case 'sprint':
      return to ? tx('activity.sprint', { actor, to: sprintNode(to) }) : tx('activity.sprintRemoved', { actor, from: sprintNode(from) });
    case 'estimate':
      return to != null ? tx('activity.estimate', { actor, to: <strong>{t('common.points', { count: Number(to) })}</strong> }) : tx('activity.estimateRemoved', { actor });
    case 'due':
      return to ? tx('activity.due', { actor, to: <strong>{formatDate(String(to))}</strong> }) : tx('activity.dueRemoved', { actor });
    case 'labels': {
      const parts: ComponentChildren[] = [];
      if (a.data.added?.length) parts.push(tx('activity.labelsAdded', { actor, labels: labelNodes(a.data.added) }));
      if (a.data.removed?.length) parts.push(tx(a.data.added?.length ? 'activity.labelsRemovedAnd' : 'activity.labelsRemoved', { actor, labels: labelNodes(a.data.removed) }));
      return parts;
    }
    case 'deleted':
      return tx('activity.deleted', { actor });
    case 'restored':
      return tx('activity.restored', { actor });
  }
}

function CommentItem({ comment, onChanged }: { comment: Comment; onChanged: () => void }) {
  const author = comment.authorId ? users.value[comment.authorId] : null;
  const mine = comment.authorId === me.value?.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const save = async () => {
    const body = draft.trim();
    if (!body || body === comment.body) return setEditing(false);
    try {
      await api.patch(`/comments/${comment.id}`, { body });
      setEditing(false);
      onChanged();
    } catch (err) {
      reportError(err);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: t('comment.deleteTitle'), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.del(`/comments/${comment.id}`);
      onChanged();
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <div class="comment" id={`comment-${comment.id}`}>
      <Avatar user={author} size={24} />
      <div class="comment-main">
        <div class="comment-head">
          <strong>{author?.name ?? t('common.someone')}</strong>
          <span class="muted" title={formatDateTime(comment.createdAt)}>
            {relativeTime(comment.createdAt)}
            {comment.updatedAt - comment.createdAt > 1000 && ` · ${t('comment.edited')}`}
          </span>
          <span class="grow" />
          {(mine || me.value?.role === 'admin') && !editing && (
            <span class="comment-actions">
              {mine && (
                <button class="icon-btn sm" title={t('common.edit')} onClick={() => setEditing(true)}>
                  <Pencil size={13} />
                </button>
              )}
              <button class="icon-btn sm" title={t('common.delete')} onClick={remove}>
                <Trash2 size={13} />
              </button>
            </span>
          )}
        </div>
        {editing ? (
          <div class="comment-edit">
            <MentionTextarea
              value={draft}
              onValue={setDraft}
              minRows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
            <div class="row-actions">
              <button class="btn sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
              <button class="btn primary sm" onClick={save}>
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <Markdown source={comment.body} class="comment-body" />
        )}
      </div>
    </div>
  );
}

function Timeline({ task }: { task: Task }) {
  const [data, setData] = useState<{ taskId: ID; comments: Comment[]; activity: Activity[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const version = timelineVersion.value[task.id] ?? 0;

  const refresh = async () => {
    try {
      const res = await api.get<{ comments: Comment[]; activity: Activity[] }>(`/tasks/${task.id}/timeline`);
      setData({ taskId: task.id, ...res });
    } catch {
      /* keep what we have */
    }
  };

  useEffect(() => {
    if (data?.taskId !== task.id) setData(null);
    void refresh();
  }, [task.id, version]);

  useEffect(() => setDraft(''), [task.id]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const optimistic: Comment = { id: newId(), taskId: task.id, authorId: me.value!.id, body, createdAt: Date.now(), updatedAt: Date.now() };
    setData((d) => (d ? { ...d, comments: [...d.comments, optimistic] } : d));
    setDraft('');
    try {
      await api.post(`/tasks/${task.id}/comments`, { id: optimistic.id, body });
    } catch (err) {
      reportError(err);
      setDraft(body);
      setData((d) => (d ? { ...d, comments: d.comments.filter((c) => c.id !== optimistic.id) } : d));
    } finally {
      setSending(false);
    }
  };

  type Item = { at: number; key: string; node: ComponentChildren };
  const items: Item[] = [];
  if (data && data.taskId === task.id) {
    for (const a of data.activity) {
      items.push({
        at: a.createdAt,
        key: `a${a.id}`,
        node: (
          <div class="activity">
            <span class="activity-dot" />
            <span class="activity-text">
              {describeActivity(a)}
              <span class="muted" title={formatDateTime(a.createdAt)}>
                {' · '}
                {relativeTime(a.createdAt)}
              </span>
            </span>
          </div>
        ),
      });
    }
    for (const c of data.comments) items.push({ at: c.createdAt, key: `c${c.id}`, node: <CommentItem comment={c} onChanged={refresh} /> });
  }
  items.sort((a, b) => a.at - b.at);

  return (
    <section class="timeline">
      <h3 class="section-title">{t('task.activity')}</h3>
      {!data && <div class="skeleton-lines"><div /><div /></div>}
      {items.map((i) => (
        <div key={i.key}>{i.node}</div>
      ))}
      <div class="composer">
        <Avatar user={me.value} size={24} />
        <div class="composer-main">
          <MentionTextarea
            value={draft}
            onValue={setDraft}
            minRows={2}
            placeholder={t('comment.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div class="composer-bar">
            <span class="editor-hint">{t('comment.hint')}</span>
            <button class="btn primary sm" disabled={!draft.trim() || sending} onClick={send}>
              {t('comment.send')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------- panel ---------------------------------- */

function moreMenu(anchor: Element, task: Task) {
  openPicker(anchor, {
    width: 230,
    align: 'end',
    placeholder: t('common.actions'),
    items: [
      { id: 'link', label: t('task.copyLink'), icon: <Link2 size={14} /> },
      { id: 'ref', label: t('task.copyRef'), icon: <Hash size={14} />, hint: taskRef(task) },
      { id: 'branch', label: t('task.copyBranch'), icon: <GitBranch size={14} /> },
      { id: 'delete', label: t('task.delete'), icon: <Trash2 size={14} />, danger: true },
    ],
    onSelect: (id) => {
      if (id === 'link') void copyText(taskUrl(task), t('toast.linkCopied'));
      if (id === 'ref') void copyText(taskRef(task), t('toast.copied'));
      if (id === 'branch') void copyText(branchName(task), t('toast.branchCopied'));
      if (id === 'delete') {
        closeTaskPanel();
        void deleteTasks([task.id]);
      }
    },
  });
}

export function TaskPanel() {
  const ref = openTaskRef.value;
  const task = openTask.value;
  const panelRef = useRef<HTMLElement>(null);

  useHotkeys({
    escape: () => {
      if (!openTaskRef.value) return false;
      closeTaskPanel();
    },
  });

  useEffect(() => {
    panelRef.current?.querySelector('.panel-body')?.scrollTo({ top: 0 });
  }, [task?.id]);

  if (!ref) return null;
  if (!task) {
    return (
      <aside class="panel" ref={panelRef}>
        <div class="panel-header">
          <span class="grow" />
          <button class="icon-btn" onClick={closeTaskPanel} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>
        <div class="panel-empty">{ready.value ? t('task.notFound', { ref }) : null}</div>
      </aside>
    );
  }

  const project = projects.value[task.projectId];
  const ids = visibleIds.value;
  const idx = ids.indexOf(task.id);
  const go = (delta: number) => {
    const next = tasks.value[ids[idx + delta]];
    if (next) openTaskPanel(next, { replace: true });
  };
  const creator = task.creatorId ? users.value[task.creatorId] : null;

  return (
    <aside class="panel" ref={panelRef} aria-label={task.title} data-task-id={task.id}>
      <div class="panel-header">
        <span class="crumbs">
          <span class="project-badge" style={{ background: project?.color }}>
            {project?.key.slice(0, 1)}
          </span>
          <span class="muted">{project?.name}</span>
          <ChevronRight size={12} class="muted" />
          <button class="crumb-ref" title={t('task.copyRef')} onClick={() => copyText(taskRef(task), t('toast.copied'))}>
            {taskRef(task)}
          </button>
        </span>
        <span class="grow" />
        <button class="icon-btn" disabled={idx <= 0} onClick={() => go(-1)} title={`${t('task.previous')} (K)`}>
          <ArrowUp size={16} />
        </button>
        <button class="icon-btn" disabled={idx < 0 || idx >= ids.length - 1} onClick={() => go(1)} title={`${t('task.next')} (J)`}>
          <ArrowDown size={16} />
        </button>
        <span class="divider-v" />
        <button class="icon-btn" title={t('task.copyLink')} onClick={() => copyText(taskUrl(task), t('toast.linkCopied'))}>
          <Link2 size={16} />
        </button>
        <button class="icon-btn" title={t('task.copyBranch')} onClick={() => copyText(branchName(task), t('toast.branchCopied'))}>
          <GitBranch size={16} />
        </button>
        <button class="icon-btn" title={t('common.more')} onClick={(e) => moreMenu(e.currentTarget, task)}>
          <MoreHorizontal size={16} />
        </button>
        <button class="icon-btn" onClick={closeTaskPanel} title={`${t('common.close')} (Esc)`}>
          <X size={16} />
        </button>
      </div>
      <div class="panel-body">
        <TitleEditor task={task} />
        <Properties task={task} />
        <DescriptionEditor task={task} />
        <div class="panel-meta">
          {tx('task.createdBy', { name: <strong>{creator?.name ?? t('common.someone')}</strong>, time: relativeTime(task.createdAt) })}
          {task.updatedAt - task.createdAt > 60_000 && <> · {t('task.updated', { time: relativeTime(task.updatedAt) })}</>}
        </div>
        <Timeline task={task} />
      </div>
    </aside>
  );
}

/** Confirms and deletes the given tasks (used by shortcuts and the bulk bar). */
export async function confirmDelete(ids: ID[]) {
  if (!ids.length) return;
  if (ids.length > 1 && !(await confirm({ title: t('task.deleteMany', { count: ids.length }), confirmLabel: t('common.delete'), danger: true }))) return;
  if (openTask.value && ids.includes(openTask.value.id)) closeTaskPanel();
  await deleteTasks(ids);
}
