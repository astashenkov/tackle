import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentText, composeMessage, type Message } from '../../server/telegram';

const base: Message = {
  lang: 'ru',
  ref: 'WEB-42',
  title: 'Починить вход',
  status: { name: 'Готово', category: 'completed' },
  assignee: 'Мария Петрова',
  movedBy: null,
  comment: 'Поправила куки',
  url: 'https://tackle.example.com/t/WEB-42',
};

test('a message names the task, its assignee and their comment', () => {
  assert.equal(
    composeMessage(base),
    [
      '✅ <b>WEB-42</b> → Готово',
      'Починить вход',
      '',
      'Исполнитель: <b>Мария Петрова</b>',
      'Комментарий исполнителя:',
      '<blockquote>Поправила куки</blockquote>',
      '',
      'https://tackle.example.com/t/WEB-42',
    ].join('\n'),
  );
});

test('missing details are spelled out instead of left out', () => {
  const text = composeMessage({ ...base, status: { name: 'На ревью', category: 'started' }, assignee: null, movedBy: 'Алекс', comment: null, url: null });
  assert.equal(
    text,
    ['👀 <b>WEB-42</b> → На ревью', 'Починить вход', '', 'Исполнитель: <i>не назначен</i>', 'Перевёл(а): Алекс', 'Комментарий исполнителя: <i>нет</i>'].join('\n'),
  );
  const en = composeMessage({ ...base, lang: 'en', status: { name: 'Canceled', category: 'canceled' }, assignee: null, comment: null, url: null });
  assert.match(en, /^🚫 .*\nAssignee: <i>none<\/i>\nAssignee’s comment: <i>none<\/i>$/s);
});

test('text from people is escaped, files become names, long comments are cut', () => {
  const text = composeMessage({ ...base, title: '<b>bold</b> & co', assignee: 'Tom <script>', comment: 'a < b' });
  assert.ok(text.includes('\n&lt;b&gt;bold&lt;/b&gt; &amp; co\n'));
  assert.ok(text.includes('<b>Tom &lt;script&gt;</b>'));
  assert.ok(text.includes('<blockquote>a &lt; b</blockquote>'));

  assert.equal(commentText('Done, see\n![screen.png](/api/attachments/abcdefgh1234) and [log.txt](/api/attachments/ijklmnop5678)'), 'Done, see\n📎 screen.png and 📎 log.txt');
  assert.equal(commentText('[docs](https://example.com)'), '[docs](https://example.com)', 'other links stay');
  const long = commentText('x'.repeat(5000));
  assert.equal(long.length, 1001);
  assert.ok(long.endsWith('…'));
});
