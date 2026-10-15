import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainText, renderMarkdown, toggleCheckbox } from '../../src/lib/markdown';

test('escapes raw HTML', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script>');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('drops dangerous link protocols', () => {
  const html = renderMarkdown('[click](javascript:alert(1)) [ok](https://example.com)');
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('attribute values are escaped', () => {
  const html = renderMarkdown('![x" onload="alert(1)](https://e.com/a.png)');
  assert.ok(html.includes('alt="x&quot; onload=&quot;alert(1)"'));
  assert.ok(!html.includes('onload="'));
});

test('renders emphasis, code and headings', () => {
  const html = renderMarkdown('# Title\n\n**bold** _it_ ~~gone~~ `a **not bold** b`');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>it<\/em>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<code>a \*\*not bold\*\* b<\/code>/);
});

test('renders fenced code without formatting', () => {
  const html = renderMarkdown('```js\nconst a = **1** < 2;\n```');
  assert.match(html, /<pre><code data-lang="js">const a = \*\*1\*\* &lt; 2;<\/code><\/pre>/);
});

test('task lists carry their source line', () => {
  const src = 'Intro\n\n- [ ] one\n- [x] two\n  - [ ] nested';
  const html = renderMarkdown(src);
  assert.match(html, /data-line="2"/);
  assert.match(html, /data-line="3" checked/);
  assert.match(html, /data-line="4"/);
  assert.equal(toggleCheckbox(src, 2), 'Intro\n\n- [x] one\n- [x] two\n  - [ ] nested');
  assert.equal(toggleCheckbox(src, 3), 'Intro\n\n- [ ] one\n- [ ] two\n  - [ ] nested');
});

test('links task references and mentions through the context', () => {
  const html = renderMarkdown('See WEB-12 and WEB-99, ping @alex and @nobody', {
    task: (ref) => (ref === 'WEB-12' ? { href: '/p/WEB/list?task=WEB-12', title: 'A "quoted" title', closed: true } : null),
    user: (h) => (h === 'alex' ? 'Alex <Admin>' : null),
  });
  assert.match(html, /<a class="md-ref closed" href="\/p\/WEB\/list\?task=WEB-12" title="A &quot;quoted&quot; title">WEB-12<\/a>/);
  assert.ok(html.includes('WEB-99'));
  assert.ok(!html.includes('>WEB-99</a>'));
  assert.match(html, /<span class="md-mention" title="Alex &lt;Admin&gt;">@alex<\/span>/);
  assert.ok(html.includes('@nobody'));
});

test('mentions inside a task title attribute do not break markup', () => {
  const html = renderMarkdown('WEB-1', {
    task: () => ({ href: '/x', title: 'ask @alex', closed: false }),
    user: () => 'Alex',
  });
  assert.equal(html, '<p><a class="md-ref" href="/x" title="ask @alex">WEB-1</a></p>');
});

test('plainText strips markup', () => {
  assert.equal(plainText('**Hi** [there](https://x.y)\n- [ ] task `code`'), 'Hi there task code');
});
