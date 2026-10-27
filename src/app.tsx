import { batch, effect, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { User, Workspace } from '../shared/types';
import { api, setUnauthorizedHandler } from './lib/api';
import { useHotkeys } from './lib/hotkeys';
import { t } from './lib/i18n';
import { matchRoute, navigate, route } from './lib/router';
import { clearData, findTaskByRef, me, projectList, projectsByKey, ready, unreadCount, workspace } from './store/data';
import { connectEvents, disconnectEvents, loadSnapshot } from './store/sync';
import { clearSelection, createDialog, load, openTask, save, shortcutsOpen, targetIds } from './store/ui';
import { BulkBar } from './components/BulkBar';
import { CreateTaskDialog, openCreateTask } from './components/CreateTask';
import { openPalette } from './components/CommandPalette';
import { Dialogs } from './components/Dialogs';
import { ConfirmDialog } from './components/Modal';
import { Popovers, closeAllPopovers } from './components/Popover';
import { Sidebar } from './components/Sidebar';
import { TaskPanel, confirmDelete, openTaskPanel } from './components/TaskPanel';
import { Toasts } from './components/Toasts';
import { anchorFor, pickAssignee, pickDueDate, pickEstimate, pickLabels, pickPriority, pickReviewer, pickSprint, pickStatus, toggleAssignMe } from './components/pickers';
import { Join, Login, Logo, Reset, Setup } from './pages/Auth';
import { Inbox } from './pages/Inbox';
import { MyTasks } from './pages/MyTasks';
import { NotFound } from './pages/NotFound';
import { ProjectPage } from './pages/ProjectPage';
import { Settings } from './pages/Settings';

type Phase = 'loading' | 'setup' | 'anonymous' | 'ready' | 'error';
const phase = signal<Phase>('loading');

const PUBLIC_ROUTES = new Set(['login', 'setup', 'join', 'reset']);

export async function afterSignIn() {
  await loadSnapshot();
  connectEvents();
  phase.value = 'ready';
  const r = matchRoute(route.value.path);
  if (PUBLIC_ROUTES.has(r.name)) navigate('/', { replace: true });
}

export async function logout() {
  await api.post('/logout').catch(() => {});
  disconnectEvents();
  closeAllPopovers();
  batch(() => {
    clearData();
    phase.value = 'anonymous';
  });
  navigate('/login', { replace: true });
}

async function boot() {
  try {
    const state = await api.get<{ needsSetup: boolean; user: User | null; workspace: Workspace }>('/state');
    workspace.value = state.workspace;
    const r = matchRoute(route.value.path);
    if (state.needsSetup) {
      phase.value = 'setup';
      if (r.name !== 'setup') navigate('/setup', { replace: true });
      return;
    }
    if (!state.user) {
      phase.value = 'anonymous';
      if (!PUBLIC_ROUTES.has(r.name) || r.name === 'setup') navigate('/login', { replace: true });
      return;
    }
    await afterSignIn();
  } catch {
    phase.value = 'error';
  }
}

setUnauthorizedHandler(() => {
  if (phase.value === 'ready') {
    disconnectEvents();
    clearData();
    phase.value = 'anonymous';
    navigate('/login', { replace: true });
  }
});

// Document title with unread count.
effect(() => {
  const n = unreadCount.value;
  const task = openTask.value;
  const base = workspace.value.name ? `${workspace.value.name} · Tackle` : 'Tackle';
  document.title = `${n ? `(${n}) ` : ''}${task ? `${task.title} · ` : ''}${base}`;
});

// Remember the last visited project view so "/" brings you back to it.
effect(() => {
  const r = matchRoute(route.value.path);
  if (r.name === 'project') save('lastView', route.value.path);
});

function currentProjectId(): string | undefined {
  const r = matchRoute(route.value.path);
  if (r.name === 'project') return projectsByKey.value[r.key]?.id;
  return openTask.value?.projectId;
}

function GlobalHotkeys() {
  const act = (fn: (ids: string[]) => void) => () => {
    const ids = targetIds();
    if (!ids.length) return false;
    fn(ids);
  };
  const projectPath = (view: string) => () => {
    const r = matchRoute(route.value.path);
    const key = r.name === 'project' ? r.key : projectList.value[0]?.key;
    if (key) navigate(`/p/${key}/${view}`);
  };
  useHotkeys({
    'mod+k': () => openPalette(),
    c: () => openCreateTask(currentProjectId() ? { projectId: currentProjectId() } : {}),
    '?': () => {
      shortcutsOpen.value = true;
    },
    'g m': () => navigate('/my'),
    'g i': () => navigate('/inbox'),
    'g b': projectPath('board'),
    'g l': projectPath('list'),
    'g s': projectPath('sprints'),
    'g a': projectPath('archive'),
    'g ,': () => navigate('/settings'),
    s: act((ids) => pickStatus(anchorFor(ids[0], 'status'), ids)),
    p: act((ids) => pickPriority(anchorFor(ids[0], 'priority'), ids)),
    a: act((ids) => pickAssignee(anchorFor(ids[0], 'assignee'), ids)),
    r: act((ids) => pickReviewer(anchorFor(ids[0], 'reviewer'), ids)),
    l: act((ids) => pickLabels(anchorFor(ids[0], 'labels'), ids)),
    e: act((ids) => pickEstimate(anchorFor(ids[0], 'estimate'), ids)),
    d: act((ids) => pickDueDate(anchorFor(ids[0], 'due'), ids)),
    'shift+s': act((ids) => pickSprint(anchorFor(ids[0], 'sprint'), ids)),
    i: act((ids) => toggleAssignMe(ids)),
    'mod+backspace': act((ids) => void confirmDelete(ids)),
    delete: act((ids) => void confirmDelete(ids)),
  });
  return null;
}

function Main() {
  const r = matchRoute(route.value.path);
  useEffect(() => clearSelection(), [route.value.path]);

  if (r.name === 'home') {
    const last = load<string | null>('lastView', null);
    const lastKey = last ? matchRoute(last) : null;
    const target = lastKey?.name === 'project' && projectsByKey.value[lastKey.key] && !projectsByKey.value[lastKey.key].archived ? last! : projectList.value[0] ? `/p/${projectList.value[0].key}/board` : '/my';
    queueMicrotask(() => navigate(target + route.value.search, { replace: true }));
    return null;
  }
  if (r.name === 'task') {
    const task = findTaskByRef(r.ref);
    const project = task ? projectsByKey.value[r.ref.split('-')[0]] : undefined;
    queueMicrotask(() => {
      navigate(project ? `/p/${project.key}/list?task=${r.ref}` : '/my', { replace: true });
      if (task && !project) openTaskPanel(task);
    });
    return null;
  }
  switch (r.name) {
    case 'my':
      return <MyTasks />;
    case 'inbox':
      return <Inbox />;
    case 'project':
      return <ProjectPage projectKey={r.key} view={r.view} />;
    case 'settings':
      return <Settings tab={r.tab} />;
    default:
      return <NotFound />;
  }
}

function Splash({ error }: { error?: boolean }) {
  return (
    <div class="splash">
      <Logo size={36} />
      {error && (
        <div class="splash-error">
          <p>{t('error.boot')}</p>
          <button class="btn" onClick={() => location.reload()}>
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}

// A file dropped anywhere but a drop zone would make the browser open it in place of Tackle.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  });
}

export function App() {
  useEffect(() => void boot(), []);
  const r = matchRoute(route.value.path);

  if (phase.value === 'loading') return <Splash />;
  if (phase.value === 'error') return <Splash error />;
  if (phase.value === 'setup') return <Setup />;
  if (phase.value === 'anonymous' || !me.value || !ready.value) {
    if (r.name === 'join') return <Join token={r.token} />;
    if (r.name === 'reset') return <Reset token={r.token} />;
    return <Login />;
  }

  return (
    <div class={`app${openTask.value ? ' with-panel' : ''}`}>
      <GlobalHotkeys />
      <Sidebar />
      <main class="main">
        <Main />
      </main>
      <TaskPanel />
      <BulkBar />
      {createDialog.value && <CreateTaskDialog />}
      <Dialogs />
      <ConfirmDialog />
      <Popovers />
      <Toasts />
    </div>
  );
}
