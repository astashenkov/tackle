import { CalendarClock, CircleDot, SignalHigh, Tag, Timer, Trash2, User as UserIcon, X } from 'lucide-preact';
import { t } from '../lib/i18n';
import { tasks } from '../store/data';
import { clearSelection, selectedIds } from '../store/ui';
import { pickAssignee, pickDueDate, pickLabels, pickPriority, pickSprint, pickStatus } from './pickers';
import { confirmDelete } from './TaskPanel';

export function BulkBar() {
  const ids = [...selectedIds.value].filter((id) => tasks.value[id]);
  if (!ids.length) return null;
  const sameProject = new Set(ids.map((id) => tasks.value[id].projectId)).size === 1;
  return (
    <div class="bulkbar" role="toolbar">
      <span class="bulk-count">{t('bulk.selected', { count: ids.length })}</span>
      <span class="divider-v" />
      <button class="btn ghost sm" onClick={(e) => pickStatus(e.currentTarget, ids)}>
        <CircleDot size={14} />
        <span class="hide-sm">{t('prop.status')}</span>
      </button>
      <button class="btn ghost sm" onClick={(e) => pickPriority(e.currentTarget, ids)}>
        <SignalHigh size={14} />
        <span class="hide-sm">{t('prop.priority')}</span>
      </button>
      <button class="btn ghost sm" onClick={(e) => pickAssignee(e.currentTarget, ids)}>
        <UserIcon size={14} />
        <span class="hide-sm">{t('prop.assignee')}</span>
      </button>
      <button class="btn ghost sm" onClick={(e) => pickLabels(e.currentTarget, ids)}>
        <Tag size={14} />
        <span class="hide-sm">{t('prop.labels')}</span>
      </button>
      {sameProject && (
        <button class="btn ghost sm" onClick={(e) => pickSprint(e.currentTarget, ids)}>
          <Timer size={14} />
          <span class="hide-sm">{t('prop.sprint')}</span>
        </button>
      )}
      <button class="btn ghost sm" onClick={(e) => pickDueDate(e.currentTarget, ids)}>
        <CalendarClock size={14} />
      </button>
      <button class="btn ghost sm danger" onClick={() => confirmDelete(ids)} title={t('common.delete')}>
        <Trash2 size={14} />
      </button>
      <span class="divider-v" />
      <button class="icon-btn sm" onClick={clearSelection} title={`${t('common.clear')} (Esc)`}>
        <X size={14} />
      </button>
    </div>
  );
}
