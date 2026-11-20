import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentHtml, composeMessage, plainText, type Message } from '../../server/telegram';

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
  const text = composeMessage({ ...base, title: '<b>bold</b> & co', assignee: 'Tom <script>', comment: commentHtml('a < b') });
  assert.ok(text.includes('\n&lt;b&gt;bold&lt;/b&gt; &amp; co\n'));
  assert.ok(text.includes('<b>Tom &lt;script&gt;</b>'));
  assert.ok(text.includes('<blockquote>a &lt; b</blockquote>'));

  assert.equal(commentHtml('Done, see\n![screen.png](/api/attachments/abcdefgh1234) and [log.txt](/api/attachments/ijklmnop5678)'), 'Done, see\n📎 screen.png and 📎 log.txt');
  const long = commentHtml(`${'word '.repeat(1000)}`);
  assert.ok(long.length <= 2501, String(long.length));
  assert.ok(long.endsWith('word…'), 'cut between words');
});

test('Markdown in a comment turns into what Telegram can show', () => {
  // The comment that showed up with raw asterisks.
  assert.equal(
    commentHtml('Сделано.\n\n**Вопрос.** Открытый вопрос, где сказано, о ком.\n\n**«Помочь сформулировать».** Оракул переписывает вопрос'),
    'Сделано.\n\n<b>Вопрос.</b> Открытый вопрос, где сказано, о ком.\n\n<b>«Помочь сформулировать».</b> Оракул переписывает вопрос',
  );
  assert.equal(commentHtml('*i* _i_ __b__ ~~s~~ snake_case_name 2*3*4'), '<i>i</i> <i>i</i> <b>b</b> <s>s</s> snake_case_name 2*3*4');
  assert.equal(commentHtml('**bold with *italic* inside**'), '<b>bold with <i>italic</i> inside</b>');
  assert.equal(commentHtml('**a *b** c*'), '**a <i>b</i>* c*', 'crossing pairs never produce crossing tags');
  assert.equal(commentHtml('## Итог\n\n---'), '<b>Итог</b>\n\n———');
  assert.equal(commentHtml('- one\n  - nested\n1. first\n2) second\n- [ ] todo\n- [x] done'), '• one\n    • nested\n1. first\n2. second\n☐ todo\n☑ done');
  assert.equal(commentHtml('> quoted **text**'), '» <i>quoted <b>text</b></i>');
  assert.equal(commentHtml('Run `a < b` then\n```\nnpm *test*\n```\n\n\nok'), 'Run a &lt; b then\nnpm *test*\n\nok', 'code stays as typed, unformatted');
});

test('links in a comment', () => {
  const links = { appUrl: 'https://t.example.com', isTask: (ref: string) => ref === 'WEB-1' };
  assert.equal(commentHtml('[**docs**](https://example.com/?a=1&b="2")'), '<a href="https://example.com/?a=1&amp;b=&quot;2&quot;"><b>docs</b></a>');
  assert.equal(commentHtml('see [it](/t/WEB-1), WEB-1 and WEB-2', links), 'see <a href="https://t.example.com/t/WEB-1">it</a>, <a href="https://t.example.com/t/WEB-1">WEB-1</a> and WEB-2');
  assert.equal(commentHtml('see [it](/t/WEB-1) and WEB-1'), 'see it and WEB-1', 'no address, no links into Tackle');
  assert.equal(commentHtml('[x](javascript:alert(1))'), 'x)', 'not a link, as in Tackle itself');
});

test('a long comment folds; plain text is what the reader sees', () => {
  assert.ok(composeMessage({ ...base, comment: 'short' }).includes('<blockquote>short</blockquote>'));
  assert.ok(composeMessage({ ...base, comment: 'x'.repeat(401) }).includes('<blockquote expandable>'));
  assert.ok(composeMessage({ ...base, comment: Array(9).fill('line').join('\n') }).includes('<blockquote expandable>'));
  assert.equal(plainText('<b>a &lt; b</b> &amp; <a href="x">c</a>'), 'a < b & c');
});
