import { Archive, ChevronRight, Columns3, Inbox, List, LogOut, Moon, Plus, Search, Settings, SquarePen, Sun, Timer, User as UserIcon, Monitor, Keyboard } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { keyLabel } from '../lib/hotkeys';
import { t } from '../lib/i18n';
import { matchRoute, navigate, route } from '../lib/router';
import { me, projectList, unreadCount, workspace, activeSprint } from '../store/data';
import { shortcutsOpen, sidebarCollapsed, sidebarOpen, theme } from '../store/ui';
import { Avatar } from './Avatar';
import { openCreateTask } from './CreateTask';
import { openPalette } from './CommandPalette';
import { openProjectDialog } from './Dialogs';
import { openPicker } from './Picker';
import { logout } from '../app';

function NavItem({ href, icon, label, active, badge, hint }: { href: string; icon: ComponentChildren; label: string; active: boolean; badge?: number; hint?: string }) {
  return (
    <a href={href} class={`nav-item${active ? ' active' : ''}`} onClick={() => (sidebarOpen.value = false)} title={hint}>
      <span class="nav-icon">{icon}</span>
      <span class="nav-label">{label}</span>
      {!!badge && <span class="nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </a>
  );
}

function userMenu(anchor: Element) {
  openPicker(anchor, {
    width: 240,
    placeholder: me.value?.email,
    items: [
      { id: 'profile', label: t('settings.profile'), icon: <UserIcon size={14} /> },
      { id: 'theme', label: theme.value === 'dark' ? t('settings.themeLight') : t('settings.themeDark'), icon: theme.value === 'dark' ? <Sun size={14} /> : <Moon size={14} /> },
      ...(theme.value !== 'system' ? [{ id: 'system', label: t('settings.themeSystem'), icon: <Monitor size={14} /> }] : []),
      { id: 'shortcuts', label: t('shortcuts.title'), icon: <Keyboard size={14} />, hint: '?' },
      { id: 'logout', label: t('auth.logout'), icon: <LogOut size={14} />, danger: true },
    ],
    onSelect: (id) => {
      if (id === 'profile') navigate('/settings/profile');
      if (id === 'theme') theme.value = theme.value === 'dark' ? 'light' : 'dark';
      if (id === 'system') theme.value = 'system';
      if (id === 'shortcuts') shortcutsOpen.value = true;
      if (id === 'logout') void logout();
    },
  });
}

export function Sidebar() {
  const r = matchRoute(route.value.path);
  const user = me.value;
  const toggleProject = (key: string) => (sidebarCollapsed.value = { ...sidebarCollapsed.value, [key]: !sidebarCollapsed.value[key] });

  return (
    <>
      <div class={`sidebar-scrim${sidebarOpen.value ? ' show' : ''}`} onClick={() => (sidebarOpen.value = false)} />
      <nav class={`sidebar${sidebarOpen.value ? ' open' : ''}`} aria-label="Main">
        <div class="sidebar-top">
          <button class="workspace-btn" onClick={(e) => userMenu(e.currentTarget)}>
            <span class="workspace-logo">{(workspace.value.name || 'T').slice(0, 1).toUpperCase()}</span>
            <span class="workspace-name">{workspace.value.name}</span>
            <Avatar user={user} size={22} />
          </button>
        </div>
        <div class="sidebar-actions">
          <button class="new-task-btn" onClick={() => openCreateTask(r.name === 'project' ? { projectId: projectList.value.find((p) => p.key === r.key)?.id } : {})}>
            <SquarePen size={15} />
            <span>{t('task.new')}</span>
            <kbd>C</kbd>
          </button>
          <button class="icon-btn search-btn" onClick={openPalette} title={`${t('palette.placeholder')} (${keyLabel('mod+k').join('')})`}>
            <Search size={16} />
          </button>
        </div>
        <div class="sidebar-scroll">
          <NavItem href="/inbox" icon={<Inbox size={16} />} label={t('nav.inbox')} active={r.name === 'inbox'} badge={unreadCount.value} />
          <NavItem href="/my" icon={<UserIcon size={16} />} label={t('nav.myTasks')} active={r.name === 'my'} />

          <div class="nav-section">
            <span>{t('nav.projects')}</span>
            <button class="icon-btn xs" onClick={() => openProjectDialog()} title={t('project.new')}>
              <Plus size={14} />
            </button>
          </div>
          {projectList.value.map((p) => {
            const collapsed = sidebarCollapsed.value[p.key];
            const here = r.name === 'project' && r.key === p.key;
            const sprint = activeSprint(p.id);
            return (
              <div class="nav-project" key={p.id}>
                <button class={`nav-item project${here && collapsed ? ' active' : ''}`} onClick={() => toggleProject(p.key)} aria-expanded={!collapsed}>
                  <span class="project-badge sm" style={{ background: p.color }}>
                    {p.key[0]}
                  </span>
                  <span class="nav-label">{p.name}</span>
                  <ChevronRight size={13} class={`chevron${collapsed ? '' : ' open'}`} />
                </button>
                {!collapsed && (
                  <div class="nav-sub">
                    <NavItem href={`/p/${p.key}/board`} icon={<Columns3 size={15} />} label={t('view.board')} active={here && r.view === 'board'} />
                    <NavItem href={`/p/${p.key}/list`} icon={<List size={15} />} label={t('view.list')} active={here && r.view === 'list'} />
                    <NavItem
                      href={`/p/${p.key}/sprints`}
                      icon={<Timer size={15} />}
                      label={sprint ? `${t('view.sprints')} · ${sprint.name}` : t('view.sprints')}
                      active={here && r.view === 'sprints'}
                    />
                    <NavItem href={`/p/${p.key}/archive`} icon={<Archive size={15} />} label={t('view.archive')} active={here && r.view === 'archive'} />
                  </div>
                )}
              </div>
            );
          })}
          {!projectList.value.length && (
            <button class="nav-item muted" onClick={() => openProjectDialog()}>
              <span class="nav-icon">
                <Plus size={15} />
              </span>
              <span class="nav-label">{t('project.new')}</span>
            </button>
          )}
        </div>
        <div class="sidebar-bottom">
          <NavItem href="/settings" icon={<Settings size={16} />} label={t('nav.settings')} active={r.name === 'settings'} />
        </div>
      </nav>
    </>
  );
}
