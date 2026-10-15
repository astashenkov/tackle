import type { ComponentChildren } from 'preact';
import { Menu, WifiOff } from 'lucide-preact';
import { t } from '../lib/i18n';
import { connection } from '../store/data';
import { sidebarOpen } from '../store/ui';
import type { ViewContext } from '../lib/view';
import { labelList, labels, projects, statusList, statuses, userList, users, projectSprints, sprints } from '../store/data';

export function PageHeader({ title, icon, tabs, actions }: { title: ComponentChildren; icon?: ComponentChildren; tabs?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <header class="page-header">
      <button class="icon-btn mobile-only" onClick={() => (sidebarOpen.value = true)} aria-label={t('nav.menu')}>
        <Menu size={18} />
      </button>
      {icon}
      <h1 class="page-title">{title}</h1>
      {tabs && <div class="tabs">{tabs}</div>}
      <span class="grow" />
      {connection.value !== 'online' && (
        <span class="conn-pill" title={t('conn.reconnecting')}>
          <WifiOff size={13} />
          <span class="hide-sm">{t('conn.reconnecting')}</span>
        </span>
      )}
      {actions}
    </header>
  );
}

/** Everything the pure view functions need, read from the store. */
export function viewContext(projectId?: string): ViewContext {
  const projectKeys: Record<string, string> = {};
  for (const p of Object.values(projects.value)) projectKeys[p.id] = p.key;
  return {
    statuses: statuses.value,
    statusList: statusList.value,
    users: users.value,
    userList: userList.value,
    labels: labels.value,
    labelList: labelList.value,
    sprints: projectId ? projectSprints(projectId) : Object.values(sprints.value),
    projectKeys,
    now: Date.now(),
  };
}

export function EmptyState({ icon, title, text, children }: { icon?: ComponentChildren; title: string; text?: string; children?: ComponentChildren }) {
  return (
    <div class="empty-state">
      {icon && <div class="empty-icon">{icon}</div>}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children && <div class="empty-actions">{children}</div>}
    </div>
  );
}
