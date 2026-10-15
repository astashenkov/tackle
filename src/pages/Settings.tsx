import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ArrowDown, ArrowUp, Copy, Download, KeyRound, Link2, Plus, Trash2, UserX, UserCheck, Archive, ArchiveRestore, Pencil } from 'lucide-preact';
import { STATUS_CATEGORIES, PALETTE } from '../../shared/constants';
import type { Invite, Label, Role, Status, StatusCategory } from '../../shared/types';
import { api } from '../lib/api';
import { relativeTime } from '../lib/date';
import { lang, setLang, t } from '../lib/i18n';
import { navigate } from '../lib/router';
import { allProjects, labelList, me, statusList, taskList, users, workspace } from '../store/data';
import {
  deleteLabel,
  deleteProject,
  deleteStatus,
  renameWorkspace,
  reportError,
  saveLabel,
  saveProject,
  saveStatus,
  updateMe,
  updateUser,
} from '../store/actions';
import { theme, type Theme } from '../store/ui';
import { Avatar } from '../components/Avatar';
import { StatusIcon } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { ColorPicker, openProjectDialog } from '../components/Dialogs';
import { confirm } from '../components/Modal';
import { openPopover } from '../components/Popover';
import { copyText } from '../components/TaskPanel';
import { toast } from '../components/Toasts';

const TABS = ['profile', 'preferences', 'workspace', 'members', 'projects', 'labels', 'workflow', 'data'] as const;
type Tab = (typeof TABS)[number];

function Section({ title, description, children }: { title: string; description?: string; children: ComponentChildren }) {
  return (
    <section class="settings-section">
      <div class="settings-section-head">
        <h2>{title}</h2>
        {description && <p class="muted">{description}</p>}
      </div>
      <div class="settings-card">{children}</div>
    </section>
  );
}

function colorMenu(anchor: Element, value: string, onChange: (c: string) => void) {
  openPopover(
    anchor,
    (close) => (
      <div class="pad-sm">
        <ColorPicker
          value={value}
          onChange={(c) => {
            close();
            onChange(c);
          }}
        />
      </div>
    ),
    { width: 236 },
  );
}

/* --------------------------------- profile --------------------------------- */

function Profile() {
  const user = me.value!;
  const [name, setName] = useState(user.name);
  const [handle, setHandle] = useState(user.handle);
  const [color, setColor] = useState(user.color);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const dirty = name !== user.name || handle !== user.handle || color !== user.color;

  return (
    <>
      <Section title={t('settings.profile')} description={t('settings.profileText')}>
        <form
          class="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await updateMe({ name, handle, color })) toast(t('toast.saved'));
          }}
        >
          <div class="profile-preview">
            <Avatar user={{ ...user, name, color }} size={48} />
            <div>
              <strong>{name || user.name}</strong>
              <div class="muted">
                @{handle} · {user.email}
              </div>
            </div>
          </div>
          <div class="field-row">
            <label class="field">
              <span>{t('settings.name')}</span>
              <input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
            <label class="field">
              <span>{t('settings.handle')}</span>
              <input class="input" value={handle} onInput={(e) => setHandle((e.target as HTMLInputElement).value.toLowerCase())} />
            </label>
          </div>
          <div class="field">
            <span>{t('settings.avatarColor')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div class="form-actions">
            <button class="btn primary" disabled={!dirty || !name.trim()}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </Section>
      <Section title={t('settings.password')}>
        <form
          class="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await updateMe({ currentPassword: current, newPassword: next })) {
              setCurrent('');
              setNext('');
              toast(t('settings.passwordChanged'));
            }
          }}
        >
          <div class="field-row">
            <label class="field">
              <span>{t('settings.currentPassword')}</span>
              <input class="input" type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent((e.target as HTMLInputElement).value)} />
            </label>
            <label class="field">
              <span>{t('settings.newPassword')}</span>
              <input class="input" type="password" autocomplete="new-password" minLength={8} value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} />
            </label>
          </div>
          <div class="form-actions">
            <button class="btn" disabled={!current || next.length < 8}>
              {t('settings.changePassword')}
            </button>
          </div>
        </form>
      </Section>
    </>
  );
}

/* ------------------------------- preferences ------------------------------- */

function Preferences() {
  const themes: [Theme, string][] = [
    ['system', t('settings.themeSystem')],
    ['light', t('settings.themeLight')],
    ['dark', t('settings.themeDark')],
  ];
  return (
    <Section title={t('settings.preferences')} description={t('settings.preferencesText')}>
      <div class="form">
        <div class="field">
          <span>{t('settings.theme')}</span>
          <div class="theme-cards">
            {themes.map(([value, label]) => (
              <button class={`theme-card ${value}${theme.value === value ? ' on' : ''}`} onClick={() => (theme.value = value)}>
                <span class="theme-preview">
                  <span />
                  <span />
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label class="field">
          <span>{t('settings.language')}</span>
          <select class="input" value={lang.value} onChange={(e) => setLang((e.target as HTMLSelectElement).value as 'en' | 'ru')}>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </label>
      </div>
    </Section>
  );
}

/* -------------------------------- workspace -------------------------------- */

function WorkspaceSettings() {
  const [name, setName] = useState(workspace.value.name);
  const admin = me.value?.role === 'admin';
  return (
    <Section title={t('settings.workspace')} description={t('settings.workspaceText')}>
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          await renameWorkspace(name);
          toast(t('toast.saved'));
        }}
      >
        <label class="field">
          <span>{t('settings.workspaceName')}</span>
          <input class="input" value={name} disabled={!admin} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        {admin && (
          <div class="form-actions">
            <button class="btn primary" disabled={!name.trim() || name === workspace.value.name}>
              {t('common.save')}
            </button>
          </div>
        )}
      </form>
    </Section>
  );
}

/* --------------------------------- members --------------------------------- */

function Members() {
  const admin = me.value?.role === 'admin';
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState<Role>('member');
  const people = Object.values(users.value).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  const loadInvites = () => admin && api.get<Invite[]>('/invites').then(setInvites).catch(() => {});
  useEffect(() => void loadInvites(), []);

  const createInvite = async () => {
    try {
      const inv = await api.post<Invite>('/invites', { role });
      setInvites([inv, ...invites]);
      void copyText(`${location.origin}/join/${inv.token}`, t('settings.inviteCopied'));
    } catch (err) {
      reportError(err);
    }
  };

  const resetLink = async (userId: string) => {
    try {
      const res = await api.post<{ path: string }>(`/users/${userId}/reset`);
      void copyText(`${location.origin}${res.path}`, t('settings.resetCopied'));
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <>
      {admin && (
        <Section title={t('settings.invite')} description={t('settings.inviteText')}>
          <div class="invite-row">
            <select class="input" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>
              <option value="member">{t('role.member')}</option>
              <option value="admin">{t('role.admin')}</option>
            </select>
            <button class="btn primary" onClick={createInvite}>
              <Link2 size={14} />
              {t('settings.createInvite')}
            </button>
          </div>
          {invites.length > 0 && (
            <div class="table compact">
              {invites.map((inv) => (
                <div class="table-row" key={inv.token}>
                  <Link2 size={14} class="muted" />
                  <code class="grow ellipsis">{`${location.origin}/join/${inv.token}`}</code>
                  <span class="badge">{t(`role.${inv.role}`)}</span>
                  <span class="muted hide-sm">{t('settings.expires', { time: relativeTime(inv.expiresAt) })}</span>
                  <button class="icon-btn sm" title={t('common.copy')} onClick={() => copyText(`${location.origin}/join/${inv.token}`, t('settings.inviteCopied'))}>
                    <Copy size={14} />
                  </button>
                  <button
                    class="icon-btn sm"
                    title={t('settings.revoke')}
                    onClick={async () => {
                      await api.del(`/invites/${inv.token}`).catch(reportError);
                      setInvites(invites.filter((i) => i.token !== inv.token));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
      <Section title={t('settings.members')} description={t('settings.membersText', { count: people.filter((p) => p.active).length })}>
        <div class="table">
          {people.map((u) => (
            <div class={`table-row${u.active ? '' : ' inactive'}`} key={u.id}>
              <Avatar user={u} size={28} />
              <div class="grow member-info">
                <strong>
                  {u.name}
                  {u.id === me.value?.id && <span class="muted"> ({t('common.you')})</span>}
                </strong>
                <span class="muted">
                  @{u.handle} · {u.email}
                </span>
              </div>
              {!u.active && <span class="badge">{t('settings.deactivated')}</span>}
              {admin && u.id !== me.value?.id ? (
                <select class="input sm" value={u.role} onChange={(e) => updateUser(u.id, { role: (e.target as HTMLSelectElement).value as Role })}>
                  <option value="member">{t('role.member')}</option>
                  <option value="admin">{t('role.admin')}</option>
                </select>
              ) : (
                <span class="badge">{t(`role.${u.role}`)}</span>
              )}
              {admin && u.id !== me.value?.id && (
                <>
                  <button class="icon-btn sm" title={t('settings.resetPassword')} onClick={() => resetLink(u.id)}>
                    <KeyRound size={14} />
                  </button>
                  <button
                    class="icon-btn sm"
                    title={u.active ? t('settings.deactivate') : t('settings.reactivate')}
                    onClick={async () => {
                      if (u.active && !(await confirm({ title: t('settings.deactivateTitle', { name: u.name }), message: t('settings.deactivateText'), confirmLabel: t('settings.deactivate'), danger: true }))) return;
                      void updateUser(u.id, { active: !u.active });
                    }}
                  >
                    {u.active ? <UserX size={14} /> : <UserCheck size={14} />}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

/* --------------------------------- projects --------------------------------- */

function Projects() {
  const admin = me.value?.role === 'admin';
  const counts: Record<string, number> = {};
  for (const x of taskList.value) counts[x.projectId] = (counts[x.projectId] ?? 0) + 1;
  return (
    <Section title={t('settings.projects')} description={t('settings.projectsText')}>
      <div class="table">
        {allProjects.value.map((p) => (
          <div class={`table-row${p.archived ? ' inactive' : ''}`} key={p.id}>
            <span class="project-badge" style={{ background: p.color }}>
              {p.key[0]}
            </span>
            <div class="grow member-info">
              <strong>
                {p.name} <span class="muted mono">{p.key}</span>
              </strong>
              <span class="muted">{t('common.tasks', { count: counts[p.id] ?? 0 })}</span>
            </div>
            {p.archived && <span class="badge">{t('project.archived')}</span>}
            <button class="icon-btn sm" title={t('project.edit')} onClick={() => openProjectDialog(p)}>
              <Pencil size={14} />
            </button>
            <button class="icon-btn sm" title={p.archived ? t('project.unarchive') : t('project.archive')} onClick={() => saveProject({ id: p.id, archived: !p.archived })}>
              {p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </button>
            {admin && (
              <button
                class="icon-btn sm danger"
                title={t('common.delete')}
                onClick={async () => {
                  if (await confirm({ title: t('project.deleteTitle', { name: p.name }), message: t('project.deleteText', { count: counts[p.id] ?? 0 }), confirmLabel: t('common.delete'), danger: true })) {
                    void deleteProject(p.id);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div class="card-footer">
        <button class="btn" onClick={() => openProjectDialog()}>
          <Plus size={14} />
          {t('project.new')}
        </button>
      </div>
    </Section>
  );
}

/* ---------------------------------- labels ---------------------------------- */

function LabelRow({ label, count }: { label: Label; count: number }) {
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  return (
    <div class="table-row">
      <button class="swatch-btn" style={{ background: label.color }} title={t('project.color')} onClick={(e) => colorMenu(e.currentTarget, label.color, (color) => saveLabel({ id: label.id, color }))} />
      <input
        class="input inline grow"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={() => name.trim() && name !== label.name && saveLabel({ id: label.id, name: name.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span class="muted">{t('common.tasks', { count })}</span>
      <button
        class="icon-btn sm"
        title={t('common.delete')}
        onClick={async () => {
          if (await confirm({ title: t('settings.deleteLabel', { name: label.name }), message: count ? t('settings.deleteLabelText', { count }) : undefined, confirmLabel: t('common.delete'), danger: true })) {
            void deleteLabel(label.id);
          }
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function Labels() {
  const [name, setName] = useState('');
  const counts: Record<string, number> = {};
  for (const x of taskList.value) for (const l of x.labelIds) counts[l] = (counts[l] ?? 0) + 1;
  return (
    <Section title={t('settings.labels')} description={t('settings.labelsText')}>
      <div class="table">
        {labelList.value.map((l) => (
          <LabelRow key={l.id} label={l} count={counts[l.id] ?? 0} />
        ))}
      </div>
      <form
        class="card-footer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (await saveLabel({ name: name.trim(), color: PALETTE[labelList.value.length % PALETTE.length] })) setName('');
        }}
      >
        <input class="input grow" placeholder={t('settings.newLabel')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <button class="btn" disabled={!name.trim()}>
          <Plus size={14} />
          {t('common.add')}
        </button>
      </form>
    </Section>
  );
}

/* --------------------------------- workflow --------------------------------- */

function StatusRow({ status, index, list, admin, count }: { status: Status; index: number; list: Status[]; admin: boolean; count: number }) {
  const [name, setName] = useState(status.name);
  useEffect(() => setName(status.name), [status.name]);
  const move = (dir: -1 | 1) => {
    const other = list[index + dir];
    if (!other) return;
    const beyond = list[index + dir * 2];
    const position = beyond ? (other.position + beyond.position) / 2 : other.position + dir;
    void saveStatus({ id: status.id, position });
  };
  const remove = async () => {
    const others = list.filter((s) => s.id !== status.id);
    let replacement: string | undefined;
    if (count) {
      replacement = others.find((s) => s.category === status.category)?.id ?? others[0]?.id;
      const target = others.find((s) => s.id === replacement);
      if (!(await confirm({ title: t('settings.deleteStatus', { name: status.name }), message: t('settings.deleteStatusText', { count, target: target?.name ?? '' }), confirmLabel: t('common.delete'), danger: true }))) return;
    }
    void deleteStatus(status.id, replacement);
  };
  return (
    <div class="table-row">
      <button class="swatch-btn plain" disabled={!admin} onClick={(e) => colorMenu(e.currentTarget, status.color, (color) => saveStatus({ id: status.id, color }))} title={t('project.color')}>
        <StatusIcon category={status.category} color={status.color} size={16} />
      </button>
      <input
        class="input inline grow"
        value={name}
        disabled={!admin}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={() => name.trim() && name !== status.name && saveStatus({ id: status.id, name: name.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <select class="input sm" value={status.category} disabled={!admin} onChange={(e) => saveStatus({ id: status.id, category: (e.target as HTMLSelectElement).value as StatusCategory })}>
        {STATUS_CATEGORIES.map((c) => (
          <option value={c}>{t(`category.${c}`)}</option>
        ))}
      </select>
      <span class="muted count-col">{t('common.tasks', { count })}</span>
      {admin && (
        <>
          <button class="icon-btn sm" disabled={index === 0} onClick={() => move(-1)} title={t('settings.moveUp')}>
            <ArrowUp size={14} />
          </button>
          <button class="icon-btn sm" disabled={index === list.length - 1} onClick={() => move(1)} title={t('settings.moveDown')}>
            <ArrowDown size={14} />
          </button>
          <button class="icon-btn sm" disabled={list.length <= 1} onClick={remove} title={t('common.delete')}>
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

function Workflow() {
  const admin = me.value?.role === 'admin';
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('started');
  const counts: Record<string, number> = {};
  for (const x of taskList.value) counts[x.statusId] = (counts[x.statusId] ?? 0) + 1;
  const list = statusList.value;
  return (
    <Section title={t('settings.workflow')} description={t('settings.workflowText')}>
      <div class="table">
        {list.map((s, i) => (
          <StatusRow key={s.id} status={s} index={i} list={list} admin={admin} count={counts[s.id] ?? 0} />
        ))}
      </div>
      {admin && (
        <form
          class="card-footer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            // Insert after the last status of the same category so the board order stays logical.
            const order = STATUS_CATEGORIES.indexOf(category);
            const before = list.filter((s) => STATUS_CATEGORIES.indexOf(s.category) <= order).pop();
            const after = before ? list[list.indexOf(before) + 1] : list[0];
            const position = before && after ? (before.position + after.position) / 2 : before ? before.position + 1 : (after?.position ?? 1) - 1;
            if (await saveStatus({ name: name.trim(), category, color: category === 'completed' ? '#6366f1' : category === 'started' ? '#eab308' : '#94a3b8', position })) setName('');
          }}
        >
          <input class="input grow" placeholder={t('settings.newStatus')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <select class="input" value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value as StatusCategory)}>
            {STATUS_CATEGORIES.map((c) => (
              <option value={c}>{t(`category.${c}`)}</option>
            ))}
          </select>
          <button class="btn" disabled={!name.trim()}>
            <Plus size={14} />
            {t('common.add')}
          </button>
        </form>
      )}
    </Section>
  );
}

/* ----------------------------------- data ----------------------------------- */

function Data() {
  const admin = me.value?.role === 'admin';
  return (
    <Section title={t('settings.data')} description={t('settings.dataText')}>
      <div class="form">
        <p class="muted">{t('settings.backupText')}</p>
        {admin ? (
          <div>
            <a class="btn" href="/api/export" download>
              <Download size={14} />
              {t('settings.export')}
            </a>
          </div>
        ) : (
          <p class="muted">{t('settings.adminOnly')}</p>
        )}
      </div>
    </Section>
  );
}

export function Settings({ tab }: { tab: string }) {
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'profile';
  const admin = me.value?.role === 'admin';
  const visible = TABS.filter((x) => admin || x !== 'data');
  return (
    <div class="page">
      <PageHeader title={t('nav.settings')} />
      <div class="settings">
        <nav class="settings-nav">
          {visible.map((x) => (
            <button class={`settings-tab${x === current ? ' active' : ''}`} onClick={() => navigate(`/settings/${x}`, { replace: true })}>
              {t(`settings.${x}`)}
            </button>
          ))}
        </nav>
        <div class="settings-content page-scroll">
          {current === 'profile' && <Profile />}
          {current === 'preferences' && <Preferences />}
          {current === 'workspace' && <WorkspaceSettings />}
          {current === 'members' && <Members />}
          {current === 'projects' && <Projects />}
          {current === 'labels' && <Labels />}
          {current === 'workflow' && <Workflow />}
          {current === 'data' && <Data />}
        </div>
      </div>
    </div>
  );
}
