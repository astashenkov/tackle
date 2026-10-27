import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { ChevronRight, Plus } from 'lucide-preact';
import type { Priority, Task } from '../../shared/types';
import { formatMonth } from '../lib/date';
import { t, priorityName, sprintLabel } from '../lib/i18n';
import { useDnd } from '../lib/dnd';
import { positionBetween, type Group, type OrderBy } from '../lib/view';
import { labels, sprints, statuses, statusList, tasks as allTasks, users } from '../store/data';
import { updateTask } from '../store/actions';
import { load, save } from '../store/ui';
import { Avatar } from './Avatar';
import { PriorityIcon, StatusIcon } from './Icons';
import { QuickAdd } from './QuickAdd';
import { TaskRow } from './TaskItems';
import { useTaskNav } from './useTaskNav';

export function GroupLabel({ group }: { group: Group }) {
  const { kind, key } = group;
  if (kind === 'status') {
    const s = statuses.value[key];
    return s ? (
      <>
        <StatusIcon category={s.category} color={s.color} />
        <span class="group-name">{s.name}</span>
      </>
    ) : null;
  }
  if (kind === 'priority') {
    const p = Number(key) as Priority;
    return (
      <>
        <PriorityIcon priority={p} />
        <span class="group-name">{priorityName(p)}</span>
      </>
    );
  }
  if (kind === 'assignee') {
    const u = key === 'none' ? null : users.value[key];
    return (
      <>
        <Avatar user={u} size={18} />
        <span class="group-name">{u ? u.name : t('common.noAssignee')}</span>
      </>
    );
  }
  if (kind === 'sprint') {
    const s = key === 'none' ? null : sprints.value[key];
    return (
      <>
        <span class={`sprint-dot ${s?.state ?? 'none'}`} />
        <span class="group-name">{s ? s.name : t('sprint.backlog')}</span>
        {s && <span class="group-meta">{sprintLabel(s)}</span>}
      </>
    );
  }
  if (kind === 'month') return <span class="group-name">{formatMonth(key)}</span>;
  if (kind === 'label') {
    const l = key === 'none' ? null : labels.value[key];
    return (
      <>
        <span class="label-dot" style={{ background: l?.color ?? 'var(--text-3)' }} />
        <span class="group-name">{l ? l.name : t('common.noLabels')}</span>
      </>
    );
  }
  return null;
}

/** Fields a task created inside a group should get. */
function groupDefaults(group: Group, defaults: Partial<Task> & { projectId: string }): Partial<Task> & { projectId: string; statusId: string } {
  const statusId =
    (group.kind === 'status' ? group.key : defaults.statusId) ?? statusList.value.find((s) => s.category === 'unstarted')?.id ?? statusList.value[0]?.id ?? '';
  const p = group.patch ?? {};
  return {
    ...defaults,
    statusId,
    ...(p.priority !== undefined ? { priority: p.priority } : {}),
    ...(p.assigneeId !== undefined ? { assigneeId: p.assigneeId } : {}),
    ...(p.sprintId !== undefined ? { sprintId: p.sprintId } : {}),
    ...(p.addLabelIds ? { labelIds: p.addLabelIds } : {}),
  };
}

export function ListView({
  groups,
  orderBy,
  defaults,
  viewKey,
  showSprint = false,
  emptyGroupText,
  renderGroupActions,
}: {
  groups: Group[];
  orderBy: OrderBy;
  defaults?: Partial<Task> & { projectId: string };
  viewKey: string;
  showSprint?: boolean;
  emptyGroupText?: string;
  renderGroupActions?: (group: Group) => ComponentChildren;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => load(`collapsed:${viewKey}`, {}));
  const [adding, setAdding] = useState<string | null>(null);
  const visible = groups.map((g) => (collapsed[g.key] ? [] : g.tasks.map((x) => x.id)));
  const ordered = () => visible.flat();
  useTaskNav([visible.flat()]);

  const toggle = (key: string) => {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    save(`collapsed:${viewKey}`, next);
  };

  const ref = useDnd({
    canReorder: () => orderBy === 'manual',
    onDrop: (id, key, beforeId) => {
      const task = allTasks.value[id];
      const group = groups.find((g) => g.key === key);
      if (!task || !group) return;
      const source = groups.find((g) => g.tasks.some((x) => x.id === id));
      const patch: Record<string, unknown> = {};
      if (group !== source && group.patch) {
        Object.assign(patch, group.patch);
        // Moving between label groups swaps the label instead of piling labels up.
        if (group.kind === 'label' && source?.kind === 'label' && source.key !== 'none') patch.removeLabelIds = [source.key];
      }
      if (orderBy === 'manual') {
        const position = positionBetween(group.tasks, id, beforeId);
        if (position !== task.position) patch.position = position;
      }
      if (Object.keys(patch).length) void updateTask(id, patch);
    },
  });

  const single = groups.length === 1 && groups[0].kind === 'none';

  return (
    <div class="list" ref={ref}>
      {groups.map((group) => {
        const isCollapsed = !!collapsed[group.key];
        const points = group.tasks.reduce((s, x) => s + (x.estimate ?? 0), 0);
        return (
          <section class="group" key={group.key}>
            {!single && (
              <header class="group-header" data-dnd-container={group.key}>
                <button class="group-toggle" onClick={() => toggle(group.key)} aria-expanded={!isCollapsed}>
                  <ChevronRight size={14} class={`chevron${isCollapsed ? '' : ' open'}`} />
                  <GroupLabel group={group} />
                  <span class="group-count">{group.tasks.length}</span>
                  {points > 0 && <span class="group-meta">{t('common.pointsShort', { count: points })}</span>}
                </button>
                <span class="grow" />
                {renderGroupActions?.(group)}
                {defaults && (group.patch || group.kind === 'none') && (
                  <button class="icon-btn sm" title={t('task.new')} onClick={() => setAdding(group.key)}>
                    <Plus size={15} />
                  </button>
                )}
              </header>
            )}
            {!isCollapsed && (
              <div class="group-body" data-dnd-container={group.key}>
                {adding === group.key && defaults && (
                  <QuickAdd
                    defaults={groupDefaults(group, defaults)}
                    position={() => (group.tasks[0]?.position ?? 1024) - 1024}
                    onDone={() => setAdding(null)}
                  />
                )}
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} ordered={ordered} showSprint={showSprint} />
                ))}
                {!group.tasks.length && adding !== group.key && emptyGroupText && <div class="group-empty">{emptyGroupText}</div>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
