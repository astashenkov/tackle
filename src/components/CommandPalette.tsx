import type { ComponentChildren } from 'preact';
import {
  Archive,
  CalendarClock,
  CircleDot,
  Columns3,
  GitBranch,
  Hash,
  Inbox,
  Keyboard,
  Languages,
  Link2,
  List,
  Monitor,
  Moon,
  Paperclip,
  Plus,
  Settings,
  SignalHigh,
  Sun,
  Tag,
  Timer,
  Trash2,
  User as UserIcon,
  UserCheck,
  Eye,
} from 'lucide-preact';
import type { Task } from '../../shared/types';
import { keyLabel } from '../lib/hotkeys';
import { lang, setLang, t } from '../lib/i18n';
import { navigate, route, matchRoute } from '../lib/router';
import { isClosed, projectList, projectsByKey, statuses, taskList, taskRef, tasks } from '../store/data';
import { paletteOpen, shortcutsOpen, targetIds, theme } from '../store/ui';
import { StatusIcon } from './Icons';
import { openPopover } from './Popover';
import { PickerList, matchScore, type PickerItem } from './Picker';
import { pickAssignee, pickDueDate, pickEstimate, pickLabels, pickPriority, pickReviewer, pickSprint, pickStatus, toggleAssignMe } from './pickers';
import { attachFiles } from './Attachments';
import { branchName, confirmDelete, copyText, openTaskPanel, taskUrl } from './TaskPanel';
import { openCreateTask } from './CreateTask';
import { openProjectDialog, openSprintDialog } from './Dialogs';

const kbd = (combo: string): ComponentChildren => (
  <span class="kbd-group">
    {keyLabel(combo).map((k) => (
      <kbd>{k}</kbd>
    ))}
  </span>
);

function currentProjectId(): string | undefined {
  const r = matchRoute(route.value.path);
  return r.name === 'project' ? projectsByKey.value[r.key]?.id : undefined;
}

function taskResults(query: string): PickerItem[] {
  const q = query.trim();
  if (!q) return [];
  const scored: { task: Task; score: number }[] = [];
  for (const task of taskList.value) {
    if (!task.number) continue;
    const ref = taskRef(task);
    const score = ref.toLowerCase() === q.toLowerCase() ? -10 : matchScore(`${ref} ${task.title}`, q);
    if (score !== null) scored.push({ task, score: score + (isClosed(task) ? 5 : 0) });
  }
  return scored
    .sort((a, b) => a.score - b.score || b.task.updatedAt - a.task.updatedAt)
    .slice(0, 12)
    .map(({ task }) => {
      const s = statuses.value[task.statusId];
      return {
        id: `task:${task.id}`,
        label: task.title,
        section: t('palette.tasks'),
        icon: s ? <StatusIcon category={s.category} color={s.color} /> : undefined,
        hint: taskRef(task),
      };
    });
}

type Command = PickerItem & { run: () => void };

function buildCommands(): Command[] {
  const ids = targetIds();
  const one = ids.length === 1 ? tasks.value[ids[0]] : undefined;
  const cmds: Command[] = [];
  const add = (section: string, id: string, label: string, icon: ComponentChildren, run: () => void, hint?: ComponentChildren, keywords?: string) =>
    cmds.push({ id, label, icon, run, hint, section, keywords });

  if (ids.length) {
    const sec = ids.length === 1 && one ? `${t('palette.task')} · ${taskRef(one)}` : t('palette.selected', { count: ids.length });
    add(sec, 'status', t('palette.changeStatus'), <CircleDot size={14} />, () => pickStatus(null, ids), kbd('s'), 'status');
    add(sec, 'priority', t('palette.changePriority'), <SignalHigh size={14} />, () => pickPriority(null, ids), kbd('p'), 'priority');
    add(sec, 'assignee', t('palette.assign'), <UserIcon size={14} />, () => pickAssignee(null, ids), kbd('a'), 'assignee');
    add(sec, 'me', t('palette.assignMe'), <UserCheck size={14} />, () => toggleAssignMe(ids), kbd('i'));
    add(sec, 'reviewer', t('palette.reviewer'), <Eye size={14} />, () => pickReviewer(null, ids), kbd('r'), 'review reviewer');
    add(sec, 'labels', t('palette.labels'), <Tag size={14} />, () => pickLabels(null, ids), kbd('l'), 'labels tags');
    add(sec, 'estimate', t('palette.estimate'), <Hash size={14} />, () => pickEstimate(null, ids), kbd('e'), 'points');
    add(sec, 'due', t('palette.due'), <CalendarClock size={14} />, () => pickDueDate(null, ids), kbd('d'), 'deadline');
    add(sec, 'sprint', t('palette.sprint'), <Timer size={14} />, () => pickSprint(null, ids), kbd('shift+s'), 'cycle');
    if (one) {
      add(sec, 'attach', t('palette.attach'), <Paperclip size={14} />, () => attachFiles(one.id), undefined, 'attachment upload file');
      add(sec, 'link', t('task.copyLink'), <Link2 size={14} />, () => copyText(taskUrl(one), t('toast.linkCopied')));
      add(sec, 'branch', t('task.copyBranch'), <GitBranch size={14} />, () => copyText(branchName(one), t('toast.branchCopied')), undefined, 'git');
    }
    add(sec, 'delete', ids.length > 1 ? t('task.deleteMany', { count: ids.length }) : t('task.delete'), <Trash2 size={14} />, () => confirmDelete(ids), kbd('mod+backspace'));
  }

  const create = t('palette.create');
  const pid = currentProjectId();
  add(create, 'new-task', t('task.new'), <Plus size={14} />, () => openCreateTask(pid ? { projectId: pid } : {}), kbd('c'), 'create add issue');
  add(create, 'new-project', t('project.new'), <Plus size={14} />, () => openProjectDialog(), undefined, 'create');
  if (pid) add(create, 'new-sprint', t('sprint.new'), <Plus size={14} />, () => openSprintDialog(pid), undefined, 'create cycle');

  const nav = t('palette.navigate');
  add(nav, 'go-my', t('nav.myTasks'), <UserIcon size={14} />, () => navigate('/my'), kbd('g m'));
  add(nav, 'go-inbox', t('nav.inbox'), <Inbox size={14} />, () => navigate('/inbox'), kbd('g i'), 'notifications');
  for (const p of projectList.value) {
    add(nav, `go-${p.key}-board`, `${p.name} · ${t('view.board')}`, <Columns3 size={14} />, () => navigate(`/p/${p.key}/board`), undefined, `${p.key} kanban`);
    add(nav, `go-${p.key}-list`, `${p.name} · ${t('view.list')}`, <List size={14} />, () => navigate(`/p/${p.key}/list`), undefined, p.key);
    add(nav, `go-${p.key}-sprints`, `${p.name} · ${t('view.sprints')}`, <Timer size={14} />, () => navigate(`/p/${p.key}/sprints`), undefined, `${p.key} cycles`);
    add(nav, `go-${p.key}-archive`, `${p.name} · ${t('view.archive')}`, <Archive size={14} />, () => navigate(`/p/${p.key}/archive`), undefined, `${p.key} done completed`);
  }
  add(nav, 'go-settings', t('nav.settings'), <Settings size={14} />, () => navigate('/settings'), kbd('g ,'), 'preferences');

  const prefs = t('palette.preferences');
  add(prefs, 'theme-light', t('settings.themeLight'), <Sun size={14} />, () => (theme.value = 'light'), undefined, 'theme appearance');
  add(prefs, 'theme-dark', t('settings.themeDark'), <Moon size={14} />, () => (theme.value = 'dark'), undefined, 'theme appearance');
  add(prefs, 'theme-system', t('settings.themeSystem'), <Monitor size={14} />, () => (theme.value = 'system'), undefined, 'theme appearance');
  add(prefs, 'lang', lang.value === 'ru' ? 'Switch to English' : 'Переключить на русский', <Languages size={14} />, () => setLang(lang.value === 'ru' ? 'en' : 'ru'), undefined, 'language язык');
  add(prefs, 'shortcuts', t('shortcuts.title'), <Keyboard size={14} />, () => (shortcutsOpen.value = true), kbd('?'), 'help keys');
  return cmds;
}

export function openPalette() {
  if (paletteOpen.value) return;
  paletteOpen.value = true;
  const commands = buildCommands();
  openPopover(
    null,
    (close) => (
      <PickerList
        close={close}
        opts={{
          placeholder: t('palette.placeholder'),
          items: commands,
          search: taskResults,
          onSelect: (id) => {
            if (id.startsWith('task:')) {
              const task = tasks.value[id.slice(5)];
              if (task) openTaskPanel(task);
              return;
            }
            // Let the palette close before opening a follow-up picker.
            const cmd = commands.find((c) => c.id === id);
            if (cmd) setTimeout(cmd.run, 0);
          },
        }}
      />
    ),
    { width: 620, onClose: () => (paletteOpen.value = false) },
  );
}

