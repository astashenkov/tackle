import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentMarkdown, isImage, opensInBrowser, pastedFiles } from '../../src/lib/files';
import { renderMarkdown } from '../../src/lib/markdown';

/** A clipboard as the browser hands it to a paste handler. */
function clipboard(files: File[], data: Record<string, string> = {}) {
  return {
    files: files as unknown as FileList,
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    getData: (type: string) => data[type] ?? '',
  };
}

test('a pasted screenshot or copied file is attached, copied spreadsheet cells stay text', () => {
  const shot = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
  const doc = new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' });
  assert.deepEqual(pastedFiles(clipboard([shot])), [shot], 'a screenshot');
  assert.deepEqual(pastedFiles(clipboard([doc], { 'text/plain': 'spec.pdf' })), [doc], 'a file copied in Finder');
  assert.deepEqual(pastedFiles(clipboard([shot], { 'text/plain': 'a\tb', 'text/html': '<table><tr><td>a</td><td>b</td></tr></table>' })), [], 'Excel adds a picture of the cells');
  assert.deepEqual(pastedFiles(clipboard([], { 'text/plain': 'hello' })), []);
  assert.deepEqual(pastedFiles(null), []);
});

test('attachments become Markdown that renders as pictures and links', () => {
  const md = attachmentMarkdown([
    { id: 'abcdefgh1234', name: 'image.png', type: 'image/png' },
    { id: 'ijklmnop5678', name: '[draft] spec.pdf', type: 'application/pdf' },
  ]);
  assert.equal(md, '![image.png](/api/attachments/abcdefgh1234)\n[draft spec.pdf](/api/attachments/ijklmnop5678)');
  const html = renderMarkdown(md);
  assert.match(html, /<img src="\/api\/attachments\/abcdefgh1234" alt="image.png" loading="lazy">/);
  assert.match(html, /<a href="\/api\/attachments\/ijklmnop5678">draft spec.pdf<\/a>/);
});

test('only types a browser shows without running code open in it', () => {
  assert.ok(isImage('image/png') && isImage('image/svg+xml') && !isImage('application/pdf'));
  for (const type of ['image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf', 'text/csv', 'application/json']) assert.ok(opensInBrowser(type), type);
  for (const type of ['image/svg+xml', 'application/zip', 'application/octet-stream', 'application/x-msdownload']) assert.ok(!opensInBrowser(type), type);
});
