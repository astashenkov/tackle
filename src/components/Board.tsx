import { useState } from 'preact/hooks';
import { Plus } from 'lucide-preact';
import type { Task } from '../../shared/types';
import { t } from '../lib/i18n';
import { useDnd } from '../lib/dnd';
import { positionBetween, type Group, type OrderBy } from '../lib/view';
import { statuses, tasks as allTasks } from '../store/data';
import { updateTask } from '../store/actions';
import { StatusIcon } from './Icons';
import { QuickAdd } from './QuickAdd';
import { TaskCard } from './TaskItems';
import { useTaskNav } from './useTaskNav';

export function Board({ groups, orderBy, defaults }: { groups: Group[]; orderBy: OrderBy; defaults: Partial<Task> & { projectId: string } }) {
  const [adding, setAdding] = useState<string | null>(null);
  const columns = groups.filter((g) => statuses.value[g.key] && (statuses.value[g.key].category !== 'canceled' || g.tasks.length));
  const ordered = () => columns.flatMap((c) => c.tasks.map((x) => x.id));
  useTaskNav(columns.map((c) => c.tasks.map((x) => x.id)));

  const ref = useDnd({
    canReorder: () => orderBy === 'manual',
    onDrop: (id, statusId, beforeId) => {
      const task = allTasks.value[id];
      const column = columns.find((c) => c.key === statusId);
      if (!task || !column) return;
      const patch: { statusId?: string; position?: number } = {};
      if (task.statusId !== statusId) patch.statusId = statusId;
      if (orderBy === 'manual') {
        const position = positionBetween(column.tasks, id, beforeId);
        if (position !== task.position) patch.position = position;
      }
      if (Object.keys(patch).length) void updateTask(id, patch);
    },
  });

  return (
    <div class="board" ref={ref}>
      {columns.map((col) => {
        const status = statuses.value[col.key];
        const points = col.tasks.reduce((sum, x) => sum + (x.estimate ?? 0), 0);
        return (
          <section class="column" key={col.key}>
            <header class="column-header">
              <StatusIcon category={status.category} color={status.color} />
              <span class="column-title">{status.name}</span>
              <span class="column-count">{col.tasks.length}</span>
              {points > 0 && <span class="column-points" title={t('prop.estimate')}>{t('common.pointsShort', { count: points })}</span>}
              <span class="grow" />
              <button class="icon-btn sm" title={t('task.addTo', { name: status.name })} onClick={() => setAdding(col.key)}>
                <Plus size={15} />
              </button>
            </header>
            <div class="column-body" data-dnd-container={col.key}>
              {adding === col.key && (
                <QuickAdd
                  defaults={{ ...defaults, statusId: col.key }}
                  position={() => (col.tasks[0]?.position ?? 1024) - 1024}
                  onDone={() => setAdding(null)}
                />
              )}
              {col.tasks.map((task) => (
                <TaskCard key={task.id} task={task} ordered={ordered} />
              ))}
              {!col.tasks.length && adding !== col.key && <div class="column-empty">{t('board.emptyColumn')}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
