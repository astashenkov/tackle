import { checklistProgress } from '../../shared/constants';
import type { Task } from '../../shared/types';
import { CalendarClock, CheckSquare, Hash, Paperclip } from 'lucide-preact';
import { dueLabel, dueState } from '../lib/date';
import { t, priorityName } from '../lib/i18n';
import { attachmentsByTask, isClosed, labels, sprints, statuses, users } from '../store/data';
import { focusedId, selectedIds, toggleSelected } from '../store/ui';
import { openTaskPanel } from './TaskPanel';
import { Avatar } from './Avatar';
import { PriorityIcon, StatusIcon } from './Icons';
import { pickAssignee, pickDueDate, pickEstimate, pickLabels, pickPriority, pickStatus } from './pickers';

/* Small building blocks shared by board cards and list rows. */

export function statusProgress(task: Task): number | undefined {
  const s = statuses.value[task.statusId];
  if (s?.category !== 'started') return undefined;
  const started = Object.values(statuses.value).filter((x) => x.category === 'started').sort((a, b) => a.position - b.position);
  const i = started.findIndex((x) => x.id === s.id);
  return started.length > 1 ? 0.25 + (0.5 * i) / (started.length - 1) : 0.5;
}

export function TaskStatusButton({ task, size = 14 }: { task: Task; size?: number }) {
  const s = statuses.value[task.statusId];
  if (!s) return null;
  return (
    <button
      class="prop-btn icon-only"
      data-prop="status"
      data-no-drag
      title={`${t('prop.status')}: ${s.name}`}
      onClick={(e) => {
        e.stopPropagation();
        pickStatus(e.currentTarget, [task.id]);
      }}
    >
      <StatusIcon category={s.category} color={s.color} size={size} progress={statusProgress(task)} />
    </button>
  );
}

export function TaskPriorityButton({ task, hideNone = false }: { task: Task; hideNone?: boolean }) {
  if (hideNone && task.priority === 0) return null;
  return (
    <button
      class={`prop-btn icon-only prio-${task.priority}`}
      data-prop="priority"
      data-no-drag
      title={`${t('prop.priority')}: ${priorityName(task.priority)}`}
      onClick={(e) => {
        e.stopPropagation();
        pickPriority(e.currentTarget, [task.id]);
      }}
    >
      <PriorityIcon priority={task.priority} />
    </button>
  );
}

export function TaskAssigneeButton({ task, size = 20 }: { task: Task; size?: number }) {
  const user = task.assigneeId ? users.value[task.assigneeId] : null;
  return (
    <button
      class="prop-btn icon-only avatar-btn"
      data-prop="assignee"
      data-no-drag
      title={user ? `${t('prop.assignee')}: ${user.name}` : t('common.noAssignee')}
      onClick={(e) => {
        e.stopPropagation();
        pickAssignee(e.currentTarget, [task.id]);
      }}
    >
      <Avatar user={user} size={size} title="" />
    </button>
  );
}

export function TaskLabels({ task, max = 3 }: { task: Task; max?: number }) {
  const list = task.labelIds.map((id) => labels.value[id]).filter(Boolean);
  if (!list.length) return null;
  const shown = list.slice(0, max);
  return (
    <button
      class="prop-btn label-group"
      data-prop="labels"
      data-no-drag
      onClick={(e) => {
        e.stopPropagation();
        pickLabels(e.currentTarget, [task.id]);
      }}
    >
      {shown.map((l) => (
        <span class="label-chip" key={l.id}>
          <span class="label-dot" style={{ background: l.color }} />
          {l.name}
        </span>
      ))}
      {list.length > max && <span class="label-chip more">+{list.length - max}</span>}
    </button>
  );
}

export function TaskDue({ task }: { task: Task }) {
  if (!task.dueDate) return null;
  const state = isClosed(task) ? 'later' : dueState(task.dueDate);
  return (
    <button
      class={`prop-btn chip due ${state}`}
      data-prop="due"
      data-no-drag
      title={t('prop.dueDate')}
      onClick={(e) => {
        e.stopPropagation();
        pickDueDate(e.currentTarget, [task.id]);
      }}
    >
      <CalendarClock size={12} />
      {dueLabel(task.dueDate)}
    </button>
  );
}

export function TaskEstimate({ task }: { task: Task }) {
  if (task.estimate == null) return null;
  return (
    <button
      class="prop-btn chip"
      data-prop="estimate"
      data-no-drag
      title={t('prop.estimate')}
      onClick={(e) => {
        e.stopPropagation();
        pickEstimate(e.currentTarget, [task.id]);
      }}
    >
      <Hash size={11} />
      {task.estimate}
    </button>
  );
}

export function TaskChecklist({ task }: { task: Task }) {
  const { done, total } = checklistProgress(task.description);
  if (!total) return null;
  return (
    <span class={`chip static${done === total ? ' complete' : ''}`} title={t('prop.checklist')}>
      <CheckSquare size={12} />
      {done}/{total}
    </span>
  );
}

export function TaskAttachments({ task }: { task: Task }) {
  const count = attachmentsByTask.value[task.id]?.length;
  if (!count) return null;
  return (
    <span class="chip static" title={t('prop.attachments')}>
      <Paperclip size={12} />
      {count}
    </span>
  );
}

export function TaskSprint({ task }: { task: Task }) {
  const s = task.sprintId ? sprints.value[task.sprintId] : null;
  if (!s) return null;
  return (
    <span class="chip static sprint-chip" title={t('prop.sprint')}>
      <span class={`sprint-dot ${s.state}`} />
      {s.name}
    </span>
  );
}

/** Pointer/keyboard behaviour shared by cards and rows. */
export function taskItemHandlers(task: Task, ordered: () => string[]) {
  return {
    onMouseEnter: () => {
      focusedId.value = task.id;
    },
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        toggleSelected(task.id);
        return;
      }
      if (e.shiftKey) {
        // Range select from the last focused/selected task.
        const ids = ordered();
        const anchor = [...selectedIds.value].pop() ?? focusedId.value;
        const a = anchor ? ids.indexOf(anchor) : -1;
        const b = ids.indexOf(task.id);
        if (a >= 0 && b >= 0) {
          const next = new Set(selectedIds.value);
          for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id);
          selectedIds.value = next;
        } else toggleSelected(task.id);
        return;
      }
      openTaskPanel(task);
    },
  };
}
