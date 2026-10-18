import { effect, signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import type { Priority, Sprint } from '../../shared/types';

type Plural = { one: string; few?: string; many?: string; other: string };
export type Entry = string | Plural;
export type Lang = 'en' | 'ru';

const en = {
  'common.actions': 'Actions…',
  'common.add': 'Add',
  'common.addLabel': 'Add label',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.clear': 'Clear',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.continue': 'Continue',
  'common.copy': 'Copy',
  'common.delete': 'Delete',
  'common.deletedSprint': 'a deleted sprint',
  'common.deletedStatus': 'a deleted status',
  'common.edit': 'Edit',
  'common.more': 'More',
  'common.noAssignee': 'No assignee',
  'common.noReviewer': 'No reviewer',
  'common.noDueDate': 'No due date',
  'common.noEstimate': 'No estimate',
  'common.noLabels': 'No labels',
  'common.noResults': 'Nothing found',
  'common.noSprint': 'No sprint',
  'common.open': 'Open',
  'common.points': { one: '{count} point', other: '{count} points' },
  'common.pointsShort': '{count} pts',
  'common.retry': 'Try again',
  'common.save': 'Save',
  'common.search': 'Search…',
  'common.set': 'Set',
  'common.someone': 'Someone',
  'common.tasks': { one: '{count} task', other: '{count} tasks' },
  'common.undo': 'Undo',
  'common.you': 'you',

  'priority.0': 'No priority',
  'priority.1': 'Urgent',
  'priority.2': 'High',
  'priority.3': 'Medium',
  'priority.4': 'Low',

  'category.backlog': 'Backlog',
  'category.unstarted': 'Not started',
  'category.started': 'In progress',
  'category.completed': 'Completed',
  'category.canceled': 'Canceled',

  'prop.status': 'Status',
  'prop.priority': 'Priority',
  'prop.assignee': 'Assignee',
  'prop.reviewer': 'Reviewer',
  'prop.labels': 'Labels',
  'prop.estimate': 'Estimate',
  'prop.sprint': 'Sprint',
  'prop.dueDate': 'Due date',
  'prop.checklist': 'Checklist',
  'prop.attachments': 'Attachments',

  'nav.inbox': 'Inbox',
  'nav.myTasks': 'My tasks',
  'nav.projects': 'Projects',
  'nav.settings': 'Settings',
  'nav.menu': 'Menu',

  'view.board': 'Board',
  'view.list': 'List',
  'view.sprints': 'Sprints',

  'conn.reconnecting': 'Reconnecting…',

  'auth.welcome': 'Welcome back',
  'auth.loginSubtitle': 'Sign in to your workspace',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordHint': 'At least 8 characters',
  'auth.name': 'Your name',
  'auth.login': 'Sign in',
  'auth.logout': 'Sign out',
  'auth.forgot': 'Forgot your password? Ask a workspace admin for a reset link.',

  'setup.title': 'Create your workspace',
  'setup.subtitle': 'Tackle keeps your team’s work in one fast, simple place.',
  'setup.workspace': 'Workspace name',
  'setup.projectTitle': 'Your first project',
  'setup.projectSubtitle': 'Projects group tasks. Each task gets a short id like WEB-12.',
  'setup.finish': 'Create workspace',

  'join.title': 'Join {name}',
  'join.subtitle': 'Create your account to start collaborating.',
  'join.submit': 'Create account',
  'join.invalid': 'This link has expired',
  'join.invalidText': 'Ask a workspace admin for a new link.',

  'reset.title': 'Choose a new password',
  'reset.subtitle': 'for {email}',
  'reset.submit': 'Set password',

  'task.new': 'New task',
  'task.create': 'Create task',
  'task.createMore': 'Create more',
  'task.title': 'Task title',
  'task.titlePlaceholder': 'Task title',
  'task.descriptionPlaceholder': 'Add a description… Markdown, checklists and @mentions are supported',
  'task.markdownHint': 'Markdown supported · Esc or ⌘↵ to save',
  'task.quickAddPlaceholder': 'Task title…',
  'task.quickAddHint': 'Enter to add · Esc to close',
  'task.addTo': 'Add task to {name}',
  'task.activity': 'Activity',
  'task.copyLink': 'Copy link',
  'task.copyRef': 'Copy ID',
  'task.copyBranch': 'Copy git branch name',
  'task.delete': 'Delete task',
  'task.deleteMany': { one: 'Delete {count} task?', other: 'Delete {count} tasks?' },
  'task.previous': 'Previous task',
  'task.next': 'Next task',
  'task.notFound': 'Task {ref} was not found. It may have been deleted.',
  'task.createdBy': '{name} created this {time}',
  'task.updated': 'updated {time}',

  'comment.placeholder': 'Leave a comment…',
  'comment.hint': 'Markdown & @mentions · ⌘↵ to send',
  'comment.send': 'Comment',
  'comment.edited': 'edited',
  'comment.deleteTitle': 'Delete this comment?',

  'attach.add': 'Attach files',
  'attach.drop': 'Drop files to attach them to {ref}',
  'attach.download': 'Download',
  'attach.delete': 'Delete file',
  'attach.deleteTitle': 'Delete “{name}”?',
  'attach.deleteText': 'The file will be deleted for everyone.',
  'attach.tooLarge': '{name} is too large: files can be at most {limit}',
  'attach.uploading': 'Uploading…',

  'activity.created': '{actor} created the task',
  'activity.title': '{actor} renamed the task to {to}',
  'activity.description': '{actor} updated the description',
  'activity.status': '{actor} changed status from {from} to {to}',
  'activity.priority': '{actor} set priority to {to}',
  'activity.priorityRemoved': '{actor} removed the priority',
  'activity.assigned': '{actor} assigned the task to {to}',
  'activity.selfAssigned': '{actor} took the task',
  'activity.unassigned': '{actor} unassigned {from}',
  'activity.reviewer': '{actor} asked {to} to review the task',
  'activity.selfReviewer': '{actor} took the task for review',
  'activity.reviewerRemoved': '{actor} removed {from} as reviewer',
  'activity.sprint': '{actor} moved the task to {to}',
  'activity.sprintRemoved': '{actor} removed the task from {from}',
  'activity.estimate': '{actor} estimated the task at {to}',
  'activity.estimateRemoved': '{actor} removed the estimate',
  'activity.due': '{actor} set the due date to {to}',
  'activity.dueRemoved': '{actor} removed the due date',
  'activity.labelsAdded': '{actor} added {labels}',
  'activity.labelsRemoved': '{actor} removed {labels}',
  'activity.labelsRemovedAnd': ' and removed {labels}',
  'activity.attached': '{actor} attached {files}',
  'activity.attachmentsRemoved': '{actor} deleted {files}',
  'activity.attachmentsRemovedAnd': ' and deleted {files}',
  'activity.deleted': '{actor} deleted the task',
  'activity.restored': '{actor} restored the task',

  'picker.status': 'Change status…',
  'picker.priority': 'Set priority…',
  'picker.assignee': 'Assign to…',
  'picker.reviewer': 'Set reviewer…',
  'picker.labels': 'Labels…',
  'picker.estimate': 'Estimate…',
  'picker.sprint': 'Move to sprint…',
  'picker.project': 'Project…',
  'picker.createLabel': 'Create label “{name}”',
  'picker.noSprints': 'This project has no upcoming sprints',

  'date.today': 'Today',
  'date.tomorrow': 'Tomorrow',
  'date.nextWeek': 'Next week',
  'date.inTwoWeeks': 'In two weeks',
  'date.clear': 'Remove due date',

  'board.emptyColumn': 'No tasks',

  'filter.search': 'Filter by title…',
  'filter.filter': 'Filter',
  'filter.add': 'Filter by…',
  'filter.clearAll': 'Clear filters',
  'filter.nSelected': { one: '{count} selected', other: '{count} selected' },
  'filter.activeSprint': 'Current sprint',
  'filter.noSprint': 'Backlog (no sprint)',

  'display.title': 'Display',
  'display.groupBy': 'Grouping',
  'display.orderBy': 'Ordering',
  'display.noGrouping': 'No grouping',
  'display.manual': 'Manual',
  'display.updated': 'Last updated',
  'display.created': 'Newest',
  'display.completed': 'Completed tasks',
  'display.completed_recent': 'Recent',
  'display.completed_all': 'All',
  'display.completed_none': 'None',
  'display.showEmpty': 'Show empty groups',

  'bulk.selected': { one: '{count} selected', other: '{count} selected' },

  'empty.projectTitle': 'No tasks yet',
  'empty.projectText': 'Create the first task for this project. Press C anywhere to add one quickly.',
  'empty.noMatches': 'No tasks match the current filters.',
  'empty.myTitle': 'Nothing assigned to you',
  'empty.createdTitle': 'You haven’t created any tasks yet',
  'empty.reviewTitle': 'Nothing to review',
  'empty.myText': 'Tasks appear here as soon as they are assigned to you, sent to you for review or created by you.',

  'my.assigned': 'Assigned',
  'my.review': 'To review',
  'my.created': 'Created',

  'inbox.all': 'All',
  'inbox.unread': 'Unread',
  'inbox.markAll': 'Mark all read',
  'inbox.markRead': 'Mark as read',
  'inbox.markUnread': 'Mark as unread',
  'inbox.empty': 'Your inbox is empty',
  'inbox.emptyUnread': 'You’re all caught up',
  'inbox.emptyText': 'You’ll be notified when someone assigns you a task or a review, mentions you or comments on your tasks.',
  'inbox.assigned': '{actor} assigned this to you',
  'inbox.review': '{actor} asked you to review this',
  'inbox.comment': '{actor} commented',
  'inbox.mention': '{actor} mentioned you',
  'inbox.status': '{actor} moved this to {status}',

  'palette.placeholder': 'Type a command or search tasks…',
  'palette.tasks': 'Tasks',
  'palette.task': 'Task',
  'palette.selected': { one: '{count} selected task', other: '{count} selected tasks' },
  'palette.changeStatus': 'Change status…',
  'palette.changePriority': 'Change priority…',
  'palette.assign': 'Assign to…',
  'palette.assignMe': 'Assign to me',
  'palette.reviewer': 'Set reviewer…',
  'palette.attach': 'Attach files…',
  'palette.labels': 'Change labels…',
  'palette.estimate': 'Set estimate…',
  'palette.due': 'Set due date…',
  'palette.sprint': 'Move to sprint…',
  'palette.create': 'Create',
  'palette.navigate': 'Go to',
  'palette.preferences': 'Preferences',

  'project.new': 'New project',
  'project.edit': 'Edit project',
  'project.create': 'Create project',
  'project.name': 'Project name',
  'project.namePlaceholder': 'e.g. Web app',
  'project.key': 'Key',
  'project.keyHint': 'Used in task ids, e.g. {example}',
  'project.keyLocked': 'The key can’t be changed after the project is created',
  'project.color': 'Color',
  'project.description': 'Description',
  'project.archive': 'Archive project',
  'project.unarchive': 'Restore project',
  'project.archived': 'Archived',
  'project.archiveTitle': 'Archive {name}?',
  'project.archiveText': 'The project will be hidden from the sidebar. You can restore it in Settings → Projects.',
  'project.deleteTitle': 'Delete {name} permanently?',
  'project.deleteText': { one: 'This deletes the project and its {count} task. This can’t be undone.', other: 'This deletes the project and its {count} tasks. This can’t be undone.' },

  'sprint.new': 'New sprint',
  'sprint.edit': 'Edit sprint',
  'sprint.create': 'Create sprint',
  'sprint.delete': 'Delete sprint',
  'sprint.deleteTitle': 'Delete {name}?',
  'sprint.deleteText': 'Its tasks move back to the backlog.',
  'sprint.name': 'Name',
  'sprint.defaultName': 'Sprint {n}',
  'sprint.startDate': 'Start',
  'sprint.endDate': 'End',
  'sprint.weeks': { one: '{count} week', other: '{count} weeks' },
  'sprint.goal': 'Goal',
  'sprint.goalPlaceholder': 'What should this sprint achieve?',
  'sprint.start': 'Start sprint',
  'sprint.startNamed': 'Start {name}',
  'sprint.startTitle': 'Start {name}',
  'sprint.started': 'Sprint started. Good luck!',
  'sprint.complete': 'Complete sprint',
  'sprint.completeTitle': 'Complete {name}',
  'sprint.completedToast': { one: 'Sprint completed · {count} open task moved', other: 'Sprint completed · {count} open tasks moved' },
  'sprint.statCompleted': 'Done',
  'sprint.statOpen': 'Open',
  'sprint.statRate': 'Completion',
  'sprint.statInProgress': 'In progress',
  'sprint.statTodo': 'To do',
  'sprint.moveOpen': { one: 'Move {count} unfinished task to', other: 'Move {count} unfinished tasks to' },
  'sprint.moveNew': 'A new sprint',
  'sprint.backlog': 'Backlog',
  'sprint.allDone': 'Every task in this sprint is done. Nice work!',
  'sprint.active': 'Active sprint',
  'sprint.daysLeft': { one: '{count} day left', other: '{count} days left' },
  'sprint.lastDay': 'Last day',
  'sprint.overdue': { one: '{count} day over', other: '{count} days over' },
  'sprint.openBoard': 'Open board',
  'sprint.progress': 'Progress',
  'sprint.doneOf': '{done} of {total} done',
  'sprint.dayOf': 'Day {day} of {total}',
  'sprint.noneActive': 'No active sprint',
  'sprint.startHint': 'Start the next planned sprint when the team is ready.',
  'sprint.createHint': 'Sprints are short, time-boxed iterations. Plan one to focus the team.',
  'sprint.planning': 'Planning',
  'sprint.planningHint': 'Drag tasks between sprints and the backlog',
  'sprint.dropHere': 'Drag tasks here',
  'sprint.completedSprints': { one: '{count} completed sprint', other: '{count} completed sprints' },
  'sprint.pastStats': '{done}/{total} done',

  'burndown.remaining': 'Remaining',
  'burndown.ideal': 'Ideal',
  'burndown.scope': 'Scope: {value}',
  'burndown.aria': 'Burndown chart: {remaining} remaining of {scope}',

  'toast.created': '{ref} created',
  'toast.deleted': { one: 'Task deleted', other: '{count} tasks deleted' },
  'toast.linkCopied': 'Link copied',
  'toast.branchCopied': 'Branch name copied',
  'toast.copied': 'Copied',
  'toast.saved': 'Saved',

  'error.network': 'Can’t reach the server. Check your connection.',
  'error.generic': 'Something went wrong',
  'error.boot': 'Tackle couldn’t connect to the server.',

  'notFound.title': 'Page not found',
  'notFound.text': 'The page you’re looking for doesn’t exist or was moved.',
  'notFound.home': 'Go home',

  'role.admin': 'Admin',
  'role.member': 'Member',

  'settings.profile': 'Profile',
  'settings.profileText': 'How teammates see you. Your handle is used for @mentions.',
  'settings.preferences': 'Preferences',
  'settings.preferencesText': 'Appearance and language for this browser.',
  'settings.workspace': 'Workspace',
  'settings.workspaceText': 'General workspace settings.',
  'settings.workspaceName': 'Workspace name',
  'settings.members': 'Members',
  'settings.membersText': { one: '{count} active member', other: '{count} active members' },
  'settings.projects': 'Projects',
  'settings.projectsText': 'Archive projects you no longer work on to keep the sidebar tidy.',
  'settings.labels': 'Labels',
  'settings.labelsText': 'Labels are shared across all projects.',
  'settings.workflow': 'Workflow',
  'settings.workflowText': 'Statuses define the board columns. The category controls how a status counts in sprints and filters.',
  'settings.data': 'Data',
  'settings.dataText': 'Your data lives in a single SQLite file on your server, attached files in a folder next to it.',
  'settings.backupText': 'To back up Tackle, copy the database file (data/tackle.db by default) and the attachments folder, or download a JSON export (it lists attached files but doesn’t include them).',
  'settings.export': 'Download JSON export',
  'settings.adminOnly': 'Only admins can export data.',
  'settings.name': 'Name',
  'settings.handle': 'Handle',
  'settings.avatarColor': 'Avatar color',
  'settings.password': 'Password',
  'settings.currentPassword': 'Current password',
  'settings.newPassword': 'New password',
  'settings.changePassword': 'Change password',
  'settings.passwordChanged': 'Password changed',
  'settings.theme': 'Theme',
  'settings.themeSystem': 'System',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.language': 'Language',
  'settings.invite': 'Invite people',
  'settings.inviteText': 'Create a one-time link and send it to a teammate. Links expire after 7 days.',
  'settings.createInvite': 'Create invite link',
  'settings.inviteCopied': 'Invite link copied',
  'settings.expires': 'expires {time}',
  'settings.revoke': 'Revoke',
  'settings.deactivated': 'Deactivated',
  'settings.resetPassword': 'Copy password reset link',
  'settings.resetCopied': 'Password reset link copied',
  'settings.deactivate': 'Deactivate',
  'settings.reactivate': 'Reactivate',
  'settings.deactivateTitle': 'Deactivate {name}?',
  'settings.deactivateText': 'They will be signed out and won’t be able to sign in. Their tasks stay as they are.',
  'settings.deleteLabel': 'Delete label “{name}”?',
  'settings.deleteLabelText': { one: 'It will be removed from {count} task.', other: 'It will be removed from {count} tasks.' },
  'settings.newLabel': 'New label name',
  'settings.newStatus': 'New status name',
  'settings.deleteStatus': 'Delete status “{name}”?',
  'settings.deleteStatusText': { one: '{count} task will move to “{target}”.', other: '{count} tasks will move to “{target}”.' },
  'settings.moveUp': 'Move up',
  'settings.moveDown': 'Move down',

  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.then': 'then',
  'shortcuts.general': 'General',
  'shortcuts.navigation': 'Navigation',
  'shortcuts.tasks': 'Task lists',
  'shortcuts.properties': 'Change selected or open task',
  'shortcuts.palette': 'Command menu',
  'shortcuts.create': 'Create task',
  'shortcuts.search': 'Filter current view',
  'shortcuts.help': 'Show shortcuts',
  'shortcuts.close': 'Close panel / clear selection',
  'shortcuts.down': 'Next task',
  'shortcuts.up': 'Previous task',
  'shortcuts.open': 'Open task',
  'shortcuts.select': 'Select task',
  'shortcuts.extend': 'Extend selection',
  'shortcuts.selectAll': 'Select all',
} satisfies Record<string, Entry>;

export type Key = keyof typeof en;


const dictionaries: Partial<Record<Lang, Record<Key, Entry>>> = { en };

/** Loads a translation chunk (English is built in). */
export async function loadLocale(l: Lang) {
  if (!dictionaries[l] && l === 'ru') dictionaries.ru = (await import('./locales/ru')).default;
}

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem('tackle:lang');
    if (stored === '"ru"' || stored === '"en"') return JSON.parse(stored);
  } catch {
    /* ignore */
  }
  return (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export const lang = signal<Lang>(initialLang());

effect(() => {
  document.documentElement.lang = lang.value;
  try {
    localStorage.setItem('tackle:lang', JSON.stringify(lang.value));
  } catch {
    /* ignore */
  }
});

export async function setLang(next: Lang) {
  await loadLocale(next);
  lang.value = next;
}

const pluralRules: Record<string, Intl.PluralRules> = {};

function resolve(key: Key, vars?: Record<string, unknown>): string {
  const entry: Entry = dictionaries[lang.value]?.[key] ?? en[key] ?? key;
  if (typeof entry === 'string') return entry;
  const count = Number(vars?.count ?? 0);
  const rules = (pluralRules[lang.value] ??= new Intl.PluralRules(lang.value));
  const form = rules.select(count) as keyof Plural;
  return entry[form] ?? entry.other;
}

/** Translates a key, interpolating {placeholders} and choosing plural forms by `count`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const template = resolve(key, vars);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Like t(), but placeholders can be rich nodes (names in bold, status icons…). */
export function tx(key: Key, nodes: Record<string, ComponentChildren>): ComponentChildren[] {
  const template = resolve(key, nodes as Record<string, unknown>);
  return template.split(/(\{\w+\})/g).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in nodes ? nodes[m[1]] : part;
  });
}

export const priorityName = (p: Priority) => t(`priority.${p}` as Key);

/** File size in the current language: "740 bytes", "2.4 MB". */
export function formatSize(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let i = 0;
  for (; value >= 1024 && i < units.length - 1; i++) value /= 1024;
  return new Intl.NumberFormat(lang.value, {
    style: 'unit',
    unit: units[i],
    unitDisplay: i === 0 ? 'long' : 'short', // "740 byte" reads oddly
    maximumFractionDigits: i > 0 && value < 10 ? 1 : 0,
  }).format(value);
}

/** "Oct 9 – Oct 22" */
export function sprintLabel(s: Pick<Sprint, 'startDate' | 'endDate'>): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(lang.value, { month: 'short', day: 'numeric' });
  };
  return `${fmt(s.startDate)} – ${fmt(s.endDate)}`;
}
