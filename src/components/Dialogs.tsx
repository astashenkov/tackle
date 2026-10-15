import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { CLOSED_CATEGORIES, PALETTE, PROJECT_KEY_RE, transliterate } from '../../shared/constants';
import type { ID, Project, Sprint } from '../../shared/types';
import { addDays, daysBetween, formatDate, isoDate } from '../lib/date';
import { keyLabel } from '../lib/hotkeys';
import { t } from '../lib/i18n';
import { navigate } from '../lib/router';
import { projectSprints, projects, sprints, statuses, taskList } from '../store/data';
import { completeSprint, saveProject, saveSprint, startSprint } from '../store/actions';
import { shortcutsOpen } from '../store/ui';
import { Modal } from './Modal';

/* ------------------------------- project dialog ------------------------------- */

const projectDialog = signal<{ project?: Project } | null>(null);
export const openProjectDialog = (project?: Project) => (projectDialog.value = { project });

export function suggestKey(name: string): string {
  const words = transliterate(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const key = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : words[0].slice(0, 3);
  return /^[A-Z]/.test(key) ? key : `P${key}`.slice(0, 4);
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div class="color-picker" role="radiogroup">
      {PALETTE.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={c === value}
          class={`swatch${c === value ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function ProjectDialog({ project }: { project?: Project }) {
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(!!project);
  const [color, setColor] = useState(project?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const [description, setDescription] = useState(project?.description ?? '');
  const [busy, setBusy] = useState(false);
  const close = () => (projectDialog.value = null);
  const effectiveKey = keyTouched ? key : suggestKey(name);
  const keyValid = PROJECT_KEY_RE.test(effectiveKey);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || !keyValid || busy) return;
    setBusy(true);
    const saved = await saveProject(project ? { id: project.id, name, color, description } : { name, key: effectiveKey, color, description });
    setBusy(false);
    if (saved) {
      close();
      if (!project) navigate(`/p/${saved.key}/board`);
    }
  };

  return (
    <Modal
      title={project ? t('project.edit') : t('project.new')}
      onClose={close}
      width={460}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button class="btn primary" form="project-form" disabled={!name.trim() || !keyValid || busy}>
            {project ? t('common.save') : t('project.create')}
          </button>
        </>
      }
    >
      <form id="project-form" class="form" onSubmit={submit}>
        <label class="field">
          <span>{t('project.name')}</span>
          <input class="input" value={name} autoFocus placeholder={t('project.namePlaceholder')} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{t('project.key')}</span>
          <input
            class="input mono"
            value={effectiveKey}
            disabled={!!project}
            maxLength={6}
            onInput={(e) => {
              setKeyTouched(true);
              setKey((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            }}
          />
          <small class="muted">{project ? t('project.keyLocked') : t('project.keyHint', { example: `${effectiveKey || 'KEY'}-1` })}</small>
        </label>
        <div class="field">
          <span>{t('project.color')}</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <label class="field">
          <span>{t('project.description')}</span>
          <textarea class="textarea" rows={2} value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
        </label>
      </form>
    </Modal>
  );
}

/* -------------------------------- sprint dialog -------------------------------- */

const sprintDialog = signal<{ projectId: ID; sprint?: Sprint; mode: 'create' | 'edit' | 'start' } | null>(null);
export const openSprintDialog = (projectId: ID, sprint?: Sprint, mode: 'create' | 'edit' | 'start' = sprint ? 'edit' : 'create') =>
  (sprintDialog.value = { projectId, sprint, mode });

function nextSprintDefaults(projectId: ID) {
  const list = projectSprints(projectId);
  const last = list[list.length - 1];
  const today = isoDate();
  const start = last && last.endDate >= today ? addDays(last.endDate, 1) : today;
  const length = last ? daysBetween(last.startDate, last.endDate) + 1 : 14;
  const n = list.reduce((m, s) => Math.max(m, s.number), 0) + 1;
  return { start, length: [7, 14, 21, 28].includes(length) ? length : 14, name: t('sprint.defaultName', { n }) };
}

function SprintDialog({ projectId, sprint, mode }: { projectId: ID; sprint?: Sprint; mode: 'create' | 'edit' | 'start' }) {
  const defaults = nextSprintDefaults(projectId);
  const [name, setName] = useState(sprint?.name ?? '');
  const [goal, setGoal] = useState(sprint?.goal ?? '');
  const [start, setStart] = useState(mode === 'start' ? isoDate() : (sprint?.startDate ?? defaults.start));
  const initialLength = sprint ? daysBetween(sprint.startDate, sprint.endDate) + 1 : defaults.length;
  const [end, setEnd] = useState(addDays(mode === 'start' ? isoDate() : (sprint?.startDate ?? defaults.start), initialLength - 1));
  const [busy, setBusy] = useState(false);
  const close = () => (sprintDialog.value = null);
  const valid = start && end && end >= start;

  const setDuration = (days: number) => setEnd(addDays(start, days - 1));
  const duration = valid ? daysBetween(start, end) + 1 : 0;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const saved = await saveSprint({ id: sprint?.id, projectId, name: name.trim() || (sprint ? sprint.name : defaults.name), goal, startDate: start, endDate: end });
    if (saved && mode === 'start') await startSprint(saved.id, { startDate: start, endDate: end });
    setBusy(false);
    if (saved) close();
  };

  const title = mode === 'start' ? t('sprint.startTitle', { name: sprint?.name ?? '' }) : mode === 'edit' ? t('sprint.edit') : t('sprint.new');
  return (
    <Modal
      title={title}
      onClose={close}
      width={480}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button class="btn primary" form="sprint-form" disabled={!valid || busy}>
            {mode === 'start' ? t('sprint.start') : mode === 'edit' ? t('common.save') : t('sprint.create')}
          </button>
        </>
      }
    >
      <form id="sprint-form" class="form" onSubmit={submit}>
        <label class="field">
          <span>{t('sprint.name')}</span>
          <input class="input" value={name} autoFocus placeholder={sprint?.name ?? defaults.name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <div class="field-row">
          <label class="field">
            <span>{t('sprint.startDate')}</span>
            <input
              class="input"
              type="date"
              value={start}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v && duration) setEnd(addDays(v, duration - 1));
                setStart(v);
              }}
            />
          </label>
          <label class="field">
            <span>{t('sprint.endDate')}</span>
            <input class="input" type="date" value={end} min={start} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="segmented">
          {[7, 14, 21, 28].map((d) => (
            <button type="button" class={duration === d ? 'on' : ''} onClick={() => setDuration(d)}>
              {t('sprint.weeks', { count: d / 7 })}
            </button>
          ))}
        </div>
        <label class="field">
          <span>{t('sprint.goal')}</span>
          <textarea class="textarea" rows={2} value={goal} placeholder={t('sprint.goalPlaceholder')} onInput={(e) => setGoal((e.target as HTMLTextAreaElement).value)} />
        </label>
      </form>
    </Modal>
  );
}

/* ---------------------------- complete sprint dialog ---------------------------- */

const completeDialog = signal<Sprint | null>(null);
export const openCompleteSprint = (sprint: Sprint) => (completeDialog.value = sprint);

function CompleteSprintDialog({ sprint }: { sprint: Sprint }) {
  const sprintTasks = taskList.value.filter((x) => x.sprintId === sprint.id);
  const open = sprintTasks.filter((x) => !CLOSED_CATEGORIES.has(statuses.value[x.statusId]?.category ?? 'unstarted'));
  const done = sprintTasks.filter((x) => statuses.value[x.statusId]?.category === 'completed');
  const upcoming = projectSprints(sprint.projectId).filter((s) => s.state === 'planned');
  const [moveTo, setMoveTo] = useState<string>(upcoming[0]?.id ?? 'new');
  const [busy, setBusy] = useState(false);
  const close = () => (completeDialog.value = null);

  const submit = async () => {
    setBusy(true);
    await completeSprint(sprint.id, moveTo);
    setBusy(false);
    close();
  };

  return (
    <Modal
      title={t('sprint.completeTitle', { name: sprint.name })}
      onClose={close}
      width={460}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button class="btn primary" disabled={busy} onClick={submit}>
            {t('sprint.complete')}
          </button>
        </>
      }
    >
      <div class="complete-stats">
        <div>
          <strong>{done.length}</strong>
          <span>{t('sprint.statCompleted')}</span>
        </div>
        <div>
          <strong>{open.length}</strong>
          <span>{t('sprint.statOpen')}</span>
        </div>
        <div>
          <strong>{sprintTasks.length ? Math.round((done.length / sprintTasks.length) * 100) : 0}%</strong>
          <span>{t('sprint.statRate')}</span>
        </div>
      </div>
      {open.length > 0 ? (
        <label class="field">
          <span>{t('sprint.moveOpen', { count: open.length })}</span>
          <select class="input" value={moveTo} onChange={(e) => setMoveTo((e.target as HTMLSelectElement).value)}>
            {upcoming.map((s) => (
              <option value={s.id}>
                {s.name} · {formatDate(s.startDate)}
              </option>
            ))}
            <option value="new">{t('sprint.moveNew')}</option>
            <option value="backlog">{t('sprint.backlog')}</option>
          </select>
        </label>
      ) : (
        <p class="muted">{t('sprint.allDone')}</p>
      )}
    </Modal>
  );
}

/* ------------------------------- shortcuts dialog ------------------------------- */

const SHORTCUTS: [string, [string, string][]][] = [
  [
    'shortcuts.general',
    [
      ['mod+k', 'shortcuts.palette'],
      ['c', 'shortcuts.create'],
      ['/', 'shortcuts.search'],
      ['?', 'shortcuts.help'],
      ['escape', 'shortcuts.close'],
    ],
  ],
  [
    'shortcuts.navigation',
    [
      ['g m', 'nav.myTasks'],
      ['g i', 'nav.inbox'],
      ['g b', 'view.board'],
      ['g l', 'view.list'],
      ['g s', 'view.sprints'],
      ['g ,', 'nav.settings'],
    ],
  ],
  [
    'shortcuts.tasks',
    [
      ['j', 'shortcuts.down'],
      ['k', 'shortcuts.up'],
      ['enter', 'shortcuts.open'],
      ['x', 'shortcuts.select'],
      ['shift+arrowdown', 'shortcuts.extend'],
      ['mod+a', 'shortcuts.selectAll'],
    ],
  ],
  [
    'shortcuts.properties',
    [
      ['s', 'prop.status'],
      ['p', 'prop.priority'],
      ['a', 'prop.assignee'],
      ['i', 'palette.assignMe'],
      ['l', 'prop.labels'],
      ['e', 'prop.estimate'],
      ['d', 'prop.dueDate'],
      ['shift+s', 'prop.sprint'],
      ['mod+backspace', 'common.delete'],
    ],
  ],
];

function ShortcutsDialog() {
  return (
    <Modal title={t('shortcuts.title')} onClose={() => (shortcutsOpen.value = false)} width={640}>
      <div class="shortcuts">
        {SHORTCUTS.map(([section, rows]) => (
          <div class="shortcut-section" key={section}>
            <h4>{t(section as 'shortcuts.general')}</h4>
            {rows.map(([combo, label]) => (
              <div class="shortcut-row" key={combo}>
                <span>{t(label as 'shortcuts.general')}</span>
                <span class="kbd-group">
                  {keyLabel(combo).map((k, i) => (
                    <>
                      {i > 0 && <span class="kbd-then">{t('shortcuts.then')}</span>}
                      <kbd>{k}</kbd>
                    </>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const p = projectDialog.value;
  const s = sprintDialog.value;
  const c = completeDialog.value;
  return (
    <>
      {p && <ProjectDialog project={p.project && projects.value[p.project.id]} />}
      {s && <SprintDialog projectId={s.projectId} sprint={s.sprint && sprints.value[s.sprint.id]} mode={s.mode} />}
      {c && <CompleteSprintDialog sprint={c} />}
      {shortcutsOpen.value && <ShortcutsDialog />}
    </>
  );
}
