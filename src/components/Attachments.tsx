import { Download, File, Paperclip, Plus, Trash2 } from 'lucide-preact';
import type { Attachment, ID, Task } from '../../shared/types';
import { formatDateTime, relativeTime } from '../lib/date';
import { formatSize, t } from '../lib/i18n';
import { attachmentsByTask, me, uploads, users } from '../store/data';
import { attachmentUrl, deleteAttachment, isImage, uploadFiles } from '../store/actions';
import { confirm } from './Modal';

/** Lets the user pick files on their device and attaches them to a task. */
export function attachFiles(taskId: ID) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.addEventListener('change', () => {
    if (input.files?.length) uploadFiles(taskId, [...input.files]);
    input.remove();
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input); // Safari only opens the picker for inputs in the document
  input.click();
}

/**
 * Files from a paste. Copying from Excel or Word puts a picture of the selection next to the
 * text and HTML; such a paste is text. (A file copied in Finder comes with just its name as text.)
 */
export function pastedFiles(data: DataTransfer | null): File[] {
  if (!data?.files.length || (data.getData('text/plain') && data.types.includes('text/html'))) return [];
  return [...data.files];
}

/** Uploads files to a task and returns Markdown that shows (images) or links them, one per line. */
export function attachAndLink(taskId: ID, files: File[]): string {
  return uploadFiles(taskId, files)
    .map((f) => {
      const label = f.name.replace(/[[\]]/g, '');
      return `${isImage(f.type) ? '!' : ''}[${label}](${attachmentUrl(f.id)})`;
    })
    .join('\n');
}

/** Types the browser shows itself when opened; everything else is downloaded (mirrors the server). */
const opensInBrowser = (type: string) => /^(image\/(png|jpeg|gif|webp|avif|bmp)$|video\/|audio\/|text\/|application\/(pdf|json)$)/.test(type);

/** A file glyph with the extension under it ("PDF", "ZIP"): enough to tell files apart at a glance. */
function FileIcon({ name }: { name: string }) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? '';
  return (
    <span class="file-icon">
      <File size={22} />
      {ext && <span class="file-ext">{ext}</span>}
    </span>
  );
}

function AttachmentTile({ attachment: a }: { attachment: Attachment }) {
  const url = attachmentUrl(a.id);
  const uploader = a.uploaderId ? users.value[a.uploaderId] : null;
  const canDelete = !!me.value && (a.uploaderId === me.value.id || me.value.role === 'admin');
  // Viewable files open in a new tab, the rest download right away.
  const link = opensInBrowser(a.type) ? { href: url, target: '_blank', rel: 'noopener' } : { href: `${url}?download`, download: a.name };
  const remove = async () => {
    const ok = await confirm({ title: t('attach.deleteTitle', { name: a.name }), message: t('attach.deleteText'), confirmLabel: t('common.delete'), danger: true });
    if (ok) void deleteAttachment(a.id);
  };
  return (
    <div class="attachment" data-attachment-id={a.id}>
      <a class="attachment-preview" {...link} title={a.name}>
        {isImage(a.type) ? <img src={url} alt="" loading="lazy" /> : <FileIcon name={a.name} />}
      </a>
      <div class="attachment-info">
        <a class="attachment-name" {...link} title={a.name}>
          {a.name}
        </a>
        <span class="attachment-meta" title={`${uploader?.name ?? t('common.someone')} · ${formatDateTime(a.createdAt)}`}>
          {formatSize(a.size)} · {relativeTime(a.createdAt)}
        </span>
      </div>
      <div class="attachment-actions">
        <a class="icon-btn xs" href={`${url}?download`} download={a.name} title={t('attach.download')}>
          <Download size={13} />
        </a>
        {canDelete && (
          <button class="icon-btn xs" title={t('attach.delete')} onClick={remove}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The task panel's list of files, with uploads in progress at the end. */
export function Attachments({ task }: { task: Task }) {
  const list = attachmentsByTask.value[task.id] ?? [];
  const pending = Object.values(uploads.value).filter((u) => u.taskId === task.id && !list.some((a) => a.id === u.id));
  if (!list.length && !pending.length) {
    return (
      <button class="attach-empty" onClick={() => attachFiles(task.id)}>
        <Paperclip size={14} />
        {t('attach.add')}
      </button>
    );
  }
  return (
    <section class="attachments">
      <div class="attachments-head">
        <h3 class="section-title">
          {t('prop.attachments')}
          <span class="section-count">{list.length + pending.length}</span>
        </h3>
        <button class="icon-btn sm" title={t('attach.add')} onClick={() => attachFiles(task.id)}>
          <Plus size={15} />
        </button>
      </div>
      <div class="attachment-grid">
        {list.map((a) => (
          <AttachmentTile key={a.id} attachment={a} />
        ))}
        {pending.map((u) => {
          const pct = u.size ? Math.min(100, Math.round((u.loaded / u.size) * 100)) : 100;
          return (
            <div class="attachment uploading" key={u.id}>
              <span class="attachment-preview">
                <FileIcon name={u.name} />
              </span>
              <div class="attachment-info">
                <span class="attachment-name" title={u.name}>
                  {u.name}
                </span>
                <span class="attachment-meta">
                  {t('attach.uploading')} {pct}%
                </span>
              </div>
              <span class="attachment-progress" style={{ width: `${pct}%` }} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
