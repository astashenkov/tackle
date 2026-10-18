import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email = 'alex@tackle.dev') {
  await page.goto('/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button.primary');
  await expect(page.locator('.sidebar')).toBeVisible();
}

const column = (page: Page, name: string) => page.locator('.column', { has: page.locator('.column-title', { hasText: name }) });

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
