import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email = 'alex@tackle.dev') {
  await page.goto('/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button.primary');
  await expect(page.locator('.sidebar')).toBeVisible();
}

const column = (page: Page, name: string) => page.locator('.column', { has: page.locator('.column-title', { hasText: name }) });

/** A 1×1 PNG. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
type FakeFile = { name: string; type: string; base64: string };

/** Fires the paste the browser would fire for ⌘V, with files (and optionally text) on the clipboard. */
async function paste(page: Page, selector: string, files: FakeFile[], text?: Record<string, string>) {
  await page.evaluate(
    ({ selector, files, text }) => {
      const data = new DataTransfer();
      for (const f of files) data.items.add(new File([Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0))], f.name, { type: f.type }));
      for (const [type, value] of Object.entries(text ?? {})) data.setData(type, value);
      document.querySelector(selector)!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { selector, files, text },
  );
}

/** Drags files from the desktop over an element and drops them there. */
async function dropFiles(page: Page, selector: string, files: FakeFile[], { drop = true } = {}) {
  await page.evaluate(
    ({ selector, files, drop }) => {
      const data = new DataTransfer();
      for (const f of files) data.items.add(new File([Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0))], f.name, { type: f.type }));
      const target = document.querySelector(selector)!;
      const types = drop ? ['dragenter', 'dragover', 'drop'] : ['dragenter', 'dragover'];
      for (const type of types) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { selector, files, drop },
  );
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
});

test('create a task from the keyboard and drag it across the board', async ({ page }) => {
  await login(page);
  await page.goto('/p/WEB/board');
  await expect(page.locator('.board')).toBeVisible();
  await page.keyboard.press('c');
  await page.locator('.create-title').fill('E2E created task');
  await page.keyboard.press('Enter');

  const card = column(page, 'Todo').locator('.card', { hasText: 'E2E created task' });
  await expect(card).toBeVisible();
  await expect(card.locator('.task-ref')).toHaveText(/^WEB-\d+$/);

  const source = (await card.boundingBox())!;
  const target = (await column(page, 'In Progress').locator('.column-body').boundingBox())!;
  await drag(page, { x: source.x + 30, y: source.y + 20 }, { x: target.x + target.width / 2, y: target.y + 20 });
  await expect(column(page, 'In Progress').locator('.card', { hasText: 'E2E created task' })).toBeVisible();

  await page.reload();
  await expect(column(page, 'In Progress').locator('.card', { hasText: 'E2E created task' })).toBeVisible();
});

test('change properties with shortcuts and the command menu', async ({ page }) => {
  await login(page);
  await page.goto('/p/WEB/board');
  const card = page.locator('.card', { hasText: 'Weekly digest email' });
  await expect(card).toBeVisible();
  await card.hover();
  await page.keyboard.press('p');
  await expect(page.locator('.picker')).toBeVisible();
  await page.keyboard.press('2'); // second item: Urgent
  await expect(card.locator('.prio-icon.urgent')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.keyboard.type('Postgres');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel .panel-title')).toHaveValue('Upgrade to Postgres 17');
  await expect(page).toHaveURL(/task=WEB-19/);

  await page.keyboard.press('s');
  await page.locator('.picker-input').fill('done');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel .prop-pill[data-prop=status]')).toHaveText('Done');
  await expect(page.locator('.timeline .activity', { hasText: 'changed status' }).last()).toContainText('Done');

  await page.keyboard.press('Escape');
  await expect(page.locator('.panel')).toHaveCount(0);
});

test('changes and mentions reach teammates in real time', async ({ browser }) => {
  const alexCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mariaCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const alex = await alexCtx.newPage();
  const maria = await mariaCtx.newPage();
  await login(alex);
  await login(maria, 'maria@tackle.dev');

  await maria.goto('/p/WEB/board');
  await alex.goto('/p/WEB/board?task=WEB-12');
  await expect(alex.locator('.panel .panel-title')).toHaveValue('Keyboard shortcuts for common actions');

  // Alex moves the task; Maria's board follows without a reload.
  await alex.keyboard.press('s');
  await alex.locator('.picker-input').fill('in review');
  await alex.keyboard.press('Enter');
  await expect(column(maria, 'In Review').locator('.card', { hasText: 'Keyboard shortcuts for common actions' })).toBeVisible();

  // A mention lands in Maria's inbox.
  const before = Number((await maria.locator('.nav-badge').textContent().catch(() => '0')) || 0);
  await alex.locator('.composer textarea').fill('@maria could you take a look?');
  await alex.keyboard.press('Control+Enter');
  await expect(alex.locator('.comment', { hasText: 'could you take a look' })).toBeVisible();
  await expect(maria.locator('.nav-badge')).toHaveText(String(before + 1));
  await maria.goto('/inbox');
  await expect(maria.locator('.inbox-item.unread', { hasText: 'Keyboard shortcuts for common actions' }).first()).toContainText('mentioned you');

  await alexCtx.close();
  await mariaCtx.close();
});

test('sprint planning by drag and drop', async ({ page }) => {
  await login(page);
  await page.goto('/p/WEB/sprints');
  await expect(page.locator('.sprint-card h2')).toHaveText('Sprint 3');
  await expect(page.locator('.burndown svg')).toBeVisible();

  const row = page.locator('.row', { hasText: 'Remove legacy v1 endpoints' });
  await row.scrollIntoViewIfNeeded();
  const sprintHeader = page.locator('.group-header', { hasText: 'Sprint 4' });
  const from = (await row.boundingBox())!;
  const to = (await sprintHeader.boundingBox())!;
  await drag(page, { x: from.x + 300, y: from.y + from.height / 2 }, { x: to.x + 300, y: to.y + to.height / 2 });
  const sprint4 = page.locator('.group', { has: page.locator('.group-header', { hasText: 'Sprint 4' }) });
  await expect(sprint4.locator('.row', { hasText: 'Remove legacy v1 endpoints' })).toBeVisible();
});

test('edit the description with markdown checklists', async ({ page }) => {
  await login(page);
  await page.goto('/p/WEB/list?task=WEB-20');
  await expect(page.locator('.panel .panel-title')).toHaveValue('Export reports to CSV');
  await page.locator('.panel .description').click();
  // The editor takes focus right after it mounts; typing earlier would trigger shortcuts.
  await expect(page.locator('.panel .description textarea')).toBeFocused();
  await page.keyboard.type('Steps:\n\n- [ ] Pick columns\n- [ ] Add download button');
  await page.keyboard.press('Escape');
  const boxes = page.locator('.panel .description input[type=checkbox]');
  await expect(boxes).toHaveCount(2);
  await boxes.first().click();
  await expect(page.locator('.panel .description li.done')).toHaveText('Pick columns');
  await page.reload();
  await expect(page.locator('.panel .description li.done')).toHaveText('Pick columns');
  await expect(page.locator('.row', { hasText: 'Export reports to CSV' }).locator('.chip.static', { hasText: '/' })).toHaveText('1/2');
});

test('ask a teammate for review and attach files', async ({ page, browser }) => {
  await login(page);
  await page.goto('/p/WEB/board?task=WEB-12');
  await expect(page.locator('.panel .panel-title')).toHaveValue('Keyboard shortcuts for common actions');

  await page.keyboard.press('r');
  await page.locator('.picker-input').fill('ivan');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel [data-prop=reviewer]')).toContainText('Ivan Sokolov');
  await expect(page.locator('.timeline .activity', { hasText: 'to review' }).last()).toContainText('asked Ivan Sokolov to review');

  const chooser = page.waitForEvent('filechooser');
  await page.locator('.panel-header button[title="Attach files"]').click();
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Ship it') });
  const tile = page.locator('.panel .attachment', { hasText: 'notes.txt' });
  await expect(tile).toContainText('7 bytes');
  await expect(page.locator('.card', { hasText: 'Keyboard shortcuts for common actions' }).locator('.chip.static')).toHaveText('1');
  const href = await tile.locator('a.attachment-name').getAttribute('href');
  expect(await (await page.request.get(href!)).text()).toBe('Ship it');

  // The reviewer finds the request in the inbox and under My tasks → To review.
  const ivanCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ivan = await ivanCtx.newPage();
  await login(ivan, 'ivan@tackle.dev');
  await ivan.goto('/inbox');
  await expect(ivan.locator('.inbox-item', { hasText: 'Keyboard shortcuts for common actions' }).first()).toContainText('asked you to review');
  await ivan.goto('/my');
  await ivan.locator('.tab', { hasText: 'To review' }).click();
  await expect(ivan.locator('.row', { hasText: 'Keyboard shortcuts for common actions' })).toBeVisible();
  await ivanCtx.close();

  await tile.hover();
  await tile.locator('button[title="Delete file"]').click();
  await page.locator('.modal button.danger').click();
  await expect(tile).toHaveCount(0);
  await expect(page.locator('.panel .attach-empty')).toBeVisible();
});

test('paste and drop files, refuse big ones, use the command menu', async ({ page }) => {
  await login(page);
  await page.goto('/p/WEB/list?task=WEB-21');
  await expect(page.locator('.panel .panel-title')).toHaveValue('Session expires too early on Safari');
  const files = page.locator('.panel .attachment');

  // A screenshot pasted into a comment is attached to the task and shown in the comment.
  await page.locator('.composer textarea').click();
  await paste(page, '.composer textarea', [{ name: 'image.png', type: 'image/png', base64: PIXEL }]);
  await expect(page.locator('.composer textarea')).toHaveValue(/^!\[image\.png\]\(\/api\/attachments\/[\w-]+\)$/);
  await page.keyboard.type('\nRepro on Safari 18');
  await page.keyboard.press('Control+Enter');
  const shown = page.locator('.comment', { hasText: 'Repro on Safari 18' }).locator('.markdown img');
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(files.filter({ hasText: 'image.png' })).toHaveCount(1);

  // Into the description: a link for a document.
  await page.locator('.panel .description').click();
  await expect(page.locator('.panel .description textarea')).toBeFocused();
  await paste(page, '.panel .description textarea', [{ name: 'har.json', type: 'application/json', base64: btoa('{}') }]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel .description a', { hasText: 'har.json' })).toHaveAttribute('href', /^\/api\/attachments\//);

  // With no text field focused, a pasted file is simply attached.
  await page.locator('.panel-meta').click();
  await paste(page, 'body', [{ name: 'console.log', type: 'text/plain', base64: btoa('TypeError') }]);
  await expect(files.filter({ hasText: 'console.log' })).toHaveCount(1);

  // Cells copied from a spreadsheet bring a picture along; that paste stays text.
  await paste(page, 'body', [{ name: 'cells.png', type: 'image/png', base64: PIXEL }], { 'text/plain': 'a\tb', 'text/html': '<table></table>' });

  // Dropping files on the panel attaches them; an overlay shows while they are dragged over it.
  await dropFiles(page, '.panel .props-grid', [{ name: 'trace.zip', type: 'application/zip', base64: btoa('PK') }], { drop: false });
  await expect(page.locator('.drop-overlay')).toContainText('WEB-21');
  await dropFiles(page, '.panel .props-grid', [{ name: 'trace.zip', type: 'application/zip', base64: btoa('PK') }]);
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await expect(files.filter({ hasText: 'trace.zip' })).toHaveCount(1);
  await expect(files).toHaveCount(4);
  await expect(files.filter({ hasText: 'cells.png' })).toHaveCount(0);

  // Files over the limit (1 MB on the test server) are refused before they are sent.
  const sent: string[] = [];
  page.on('request', (req) => req.method() === 'POST' && req.url().includes('/attachments') && sent.push(req.url()));
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('attach');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'screen-recording.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(page.locator('.toast', { hasText: 'screen-recording.mov is too large' })).toBeVisible();
  await expect(files).toHaveCount(4);
  expect(sent).toEqual([]);

  // The command menu sets the reviewer too.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('reviewer');
  await page.keyboard.press('Enter');
  await page.locator('.picker-input').fill('sofia');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel [data-prop=reviewer]')).toContainText('Sofia Chen');

  // Everything survives a reload.
  await page.reload();
  await expect(files).toHaveCount(4);
  await expect(page.locator('.panel [data-prop=reviewer]')).toContainText('Sofia Chen');
  await expect(page.locator('.card, .row', { hasText: 'Session expires too early on Safari' }).locator('.chip.static', { hasText: '4' })).toBeVisible();
});

test('done tasks from past months wait in the archive', async ({ page }) => {
  await login(page);
  await page.goto('/p/WEB/board');
  // The Done column keeps this month's work; what was finished in earlier months is in the archive.
  await expect(column(page, 'Done').locator('.card', { hasText: 'Export reports to CSV' })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Set up error tracking' })).toHaveCount(0);

  await page.locator('.page-header .tab', { hasText: 'Archive' }).click();
  await expect(page).toHaveURL(/\/p\/WEB\/archive$/);
  const row = page.locator('.row', { hasText: 'Set up error tracking' });
  await expect(row).toBeVisible();
  await expect(page.locator('.group', { has: row }).locator('.group-name')).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
  await expect(page.locator('.row', { hasText: 'Flaky sign-in test on CI' })).toBeVisible();
  await expect(page.locator('.row', { hasText: 'Export reports to CSV' })).toHaveCount(0);

  // An archived task says so; reopening it brings it back to the board.
  await row.click();
  await expect(page.locator('.panel .panel-title')).toHaveValue('Set up error tracking');
  await expect(page.locator('.panel-meta')).toContainText('archived');
  await expect(page.locator('.timeline .activity', { hasText: 'Moved to the archive' })).toBeVisible();
  await page.keyboard.press('s');
  await page.locator('.picker-input').fill('in progress');
  await page.keyboard.press('Enter');
  await expect(row).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.page-header .tab', { hasText: 'Board' }).click();
  await expect(column(page, 'In Progress').locator('.card', { hasText: 'Set up error tracking' })).toBeVisible();
  await page.reload();
  await expect(column(page, 'In Progress').locator('.card', { hasText: 'Set up error tracking' })).toBeVisible();
});
