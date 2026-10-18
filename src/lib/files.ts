/* Attachment helpers that don't touch the DOM or the store, so they can be unit-tested. */

export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

/** Types shown as a picture (in tiles and as Markdown images). */
export const isImage = (type: string) => /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(type);

/** Types the browser shows itself when opened; everything else is downloaded (mirrors the server). */
export const opensInBrowser = (type: string) => /^(image\/(png|jpeg|gif|webp|avif|bmp)$|video\/|audio\/|text\/|application\/(pdf|json)$)/.test(type);

/**
 * Files from a paste. Copying from Excel or Word puts a picture of the selection next to the
 * text and HTML; such a paste is text. (A file copied in Finder comes with just its name as text.)
 */
export function pastedFiles(data: Pick<DataTransfer, 'files' | 'types' | 'getData'> | null): File[] {
  if (!data?.files.length || (data.getData('text/plain') && data.types.includes('text/html'))) return [];
  return [...data.files];
}

/** Markdown that shows (pictures) or links (other files) attachments, one per line. */
export function attachmentMarkdown(files: { id: string; name: string; type: string }[]): string {
  return files.map((f) => `${isImage(f.type) ? '!' : ''}[${f.name.replace(/[[\]]/g, '')}](${attachmentUrl(f.id)})`).join('\n');
}
