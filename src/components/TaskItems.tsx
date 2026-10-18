import type { Task } from '../../shared/types';
import { relativeTime } from '../lib/date';
import { isClosed, taskRef } from '../store/data';
import { focusedId, openTaskRef, selectedIds, toggleSelected } from '../store/ui';
import {
  TaskAssigneeButton,
  TaskAttachments,
  TaskChecklist,
  TaskDue,
  TaskEstimate,
  TaskLabels,
  TaskPriorityButton,
  TaskSprint,
  TaskStatusButton,
  taskItemHandlers,
} from './TaskBits';

export function TaskCard({ task, ordered, showStatus = false }: { task: Task; ordered: () => string[]; showStatus?: boolean }) {
  const ref = taskRef(task);
  const cls = [
    'card',
    focusedId.value === task.id ? 'focused' : '',
    selectedIds.value.has(task.id) ? 'selected' : '',
    openTaskRef.value === ref ? 'open' : '',
    isClosed(task) ? 'closed' : '',
    task.number === 0 ? 'pending' : '',
  ].join(' ');
  return (
    <div class={cls} data-task-id={task.id} data-dnd-id={task.id} {...taskItemHandlers(task, ordered)} role="button" tabIndex={-1}>
      <div class="card-top">
        {showStatus && <TaskStatusButton task={task} />}
        <span class="task-ref">{ref}</span>
        <span class="grow" />
        <TaskAssigneeButton task={task} size={20} />
      </div>
      <div class="card-title">{task.title}</div>
      <div class="card-props">
        <TaskPriorityButton task={task} />
        <TaskDue task={task} />
        <TaskEstimate task={task} />
        <TaskChecklist task={task} />
        <TaskAttachments task={task} />
        <TaskLabels task={task} max={2} />
      </div>
    </div>
  );
}

export function TaskRow({
  task,
  ordered,
  showSprint = false,
  showStatus = true,
}: {
  task: Task;
  ordered: () => string[];
  showSprint?: boolean;
  showStatus?: boolean;
}) {
  const ref = taskRef(task);
  const selected = selectedIds.value.has(task.id);
  const cls = [
    'row',
    focusedId.value === task.id ? 'focused' : '',
    selected ? 'selected' : '',
    openTaskRef.value === ref ? 'open' : '',
    isClosed(task) ? 'closed' : '',
    task.number === 0 ? 'pending' : '',
  ].join(' ');
  return (
    <div class={cls} data-task-id={task.id} data-dnd-id={task.id} {...taskItemHandlers(task, ordered)} role="button" tabIndex={-1}>
      <span class="row-select" data-no-drag>
        <input
          type="checkbox"
          checked={selected}
          aria-label="Select"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelected(task.id);
          }}
        />
      </span>
      <TaskPriorityButton task={task} />
      <span class="task-ref">{ref}</span>
      {showStatus && <TaskStatusButton task={task} />}
      <span class="row-title">{task.title}</span>
      <span class="row-props">
        <TaskChecklist task={task} />
        <TaskAttachments task={task} />
        <TaskLabels task={task} max={3} />
        {showSprint && <TaskSprint task={task} />}
        <TaskDue task={task} />
        <TaskEstimate task={task} />
        <span class="row-date" title={new Date(task.updatedAt).toLocaleString()}>
          {relativeTime(task.updatedAt)}
        </span>
        <TaskAssigneeButton task={task} size={20} />
      </span>
    </div>
  );
}
