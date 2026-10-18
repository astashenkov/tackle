import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { loadTask, toAttachment } from '../db';
import { tooLarge } from '../files';
import type { Ctx } from '../notify';
import { badRequest, forbidden, id, newId, notFound, now } from '../util';
import { recordActivity } from './tasks';

/** Keeps a file name readable but harmless: no path separators or control characters, at most 200 characters. */
export function cleanFileName(raw: string): string {
  let name = raw.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name || 'file';
}

/** The MIME type from a Content-Type header, or a generic one when it is missing or malformed. */
function mimeType(header: string | undefined): string {
  const type = (header ?? '').split(';')[0].trim().toLowerCase();
  return type.length <= 100 && /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
}

/**
 * How a stored file is sent back. Only types that browsers display without running code are
 * shown inline; everything else (HTML, archives, documents…) is downloaded, so an uploaded page
 * can never run scripts on Tackle's origin. SVG keeps its type so it still works in <img>, which
 * doesn't run scripts, but opening it directly downloads it.
 */
export function deliveryOf(type: string): { contentType: string; inline: boolean } {
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(type) || /^(video|audio)\//.test(type) || type === 'application/pdf') {
    return { contentType: type, inline: true };
  }
  if (type === 'image/svg+xml') return { contentType: type, inline: false };
  if (type.startsWith('text/') || type === 'application/json') return { contentType: 'text/plain; charset=utf-8', inline: true };
  return { contentType: 'application/octet-stream', inline: false };
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentRoutes(api: Hono<AppEnv>, ctx: Ctx) {
  const { db, hub, files } = ctx;

  /**
   * Attaches one file to a task. The request body is the file itself; its name goes in `?name=`
   * and its type in Content-Type. Clients may choose the id (`?id=`) so they can link to the file
   * before the upload finishes.
   */
  api.post('/tasks/:id/attachments', async (c) => {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const rawId = c.req.query('id');
    const attachmentId = rawId === undefined ? newId() : id(rawId, 'id');
    const name = cleanFileName(c.req.query('name') ?? '');
    const type = mimeType(c.req.header('content-type'));
    if (!loadTask(db, taskId)) throw notFound('Task not found');
    if (db.get('SELECT 1 FROM attachments WHERE id = ?', attachmentId)) throw badRequest('An attachment with this id already exists', 'conflict');
    if (Number(c.req.header('content-length')) > files.maxBytes) throw tooLarge(files.maxBytes);

    const size = await files.save(attachmentId, c.req.raw.body);
    try {
      const attachment = db.tx(() => {
        if (!loadTask(db, taskId)) throw notFound('Task not found');
        db.run(
          'INSERT INTO attachments (id, task_id, uploader_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          attachmentId,
          taskId,
          user.id,
          name,
          type,
          size,
          now(),
        );
        recordActivity(ctx, taskId, user.id, 'attachments', { added: [name] });
        return toAttachment(db.get('SELECT * FROM attachments WHERE id = ?', attachmentId)!);
      });
      hub.broadcast({ type: 'attachment.upsert', data: attachment }, c.get('clientId'));
      hub.broadcast({ type: 'timeline', data: { taskId } });
      return c.json(attachment, 201);
    } catch (err) {
      files.remove(attachmentId);
      throw err;
    }
  });

  /** Sends a file to signed-in users. Supports byte ranges so videos can be seeked. */
  api.get('/attachments/:id', (c) => {
    const row = db.get('SELECT * FROM attachments WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('Attachment not found');
    const attachment = toAttachment(row);
    const file = files.path(attachment.id);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      throw notFound('The file is missing on the server');
    }

    const { contentType, inline } = deliveryOf(attachment.type);
    const download = c.req.query('download') !== undefined;
    c.header('Content-Type', contentType);
    c.header('Content-Disposition', contentDisposition(inline && !download ? 'inline' : 'attachment', attachment.name));
    // The content behind an id never changes. "private" keeps shared caches (a CDN in front) from storing it.
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    c.header('Accept-Ranges', 'bytes');
    // No scripts even if a browser renders the file itself. Chrome can't show PDFs in a sandbox.
    if (attachment.type !== 'application/pdf') {
      c.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    }

    let start = 0;
    let end = size - 1;
    let status: 200 | 206 = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range')?.trim() ?? '');
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(range[2]));
      }
      if (start > end) {
        c.header('Content-Range', `bytes */${size}`);
        return c.body(null, 416);
      }
      c.header('Content-Range', `bytes ${start}-${end}/${size}`);
      status = 206;
    }
    c.header('Content-Length', String(end - start + 1));
    // HEAD gets the headers only: don't open a file nobody will read. end < start: an empty file.
    if (c.req.raw.method === 'HEAD' || end < start) return c.body(null, status);
    return c.body(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, status);
  });

  api.delete('/attachments/:id', (c) => {
    const user = c.get('user');
    const row = db.get('SELECT * FROM attachments WHERE id = ?', c.req.param('id'));
    if (!row) throw notFound('Attachment not found');
    const attachment = toAttachment(row);
    if (attachment.uploaderId !== user.id && user.role !== 'admin') throw forbidden('You can only delete files you attached');
    db.tx(() => {
      db.run('DELETE FROM attachments WHERE id = ?', attachment.id);
      recordActivity(ctx, attachment.taskId, user.id, 'attachments', { removed: [attachment.name] });
    });
    files.remove(attachment.id);
    hub.broadcast({ type: 'attachment.delete', data: { id: attachment.id } }, c.get('clientId'));
    hub.broadcast({ type: 'timeline', data: { taskId: attachment.taskId } });
    return c.json({ ok: true });
  });
}
