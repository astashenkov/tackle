/**
 * A small, safe Markdown renderer for task descriptions and comments.
 *
 * Everything is HTML-escaped first and only a fixed set of tags is produced, so the output
 * can be injected with innerHTML. Supports headings, paragraphs, line breaks, lists (nested,
 * ordered, task lists), blockquotes, fenced code, horizontal rules, emphasis, inline code,
 * links, images, auto-links, task references ("WEB-12") and @mentions.
 */

export interface MarkdownContext {
  /** Returns a link target for a task reference like "WEB-12", or null if it doesn't exist. */
  task?: (ref: string) => { href: string; title: string; closed: boolean } | null;
  /** Returns the display name for an @handle, or null if there is no such user. */
  user?: (handle: string) => string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('/') || u.startsWith('#')) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // javascript:, data:, etc.
  return u;
}

function inline(src: string, ctx: MarkdownContext): string {
  // 1. Pull out code spans so nothing inside them is formatted.
  const slots: string[] = [];
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = src.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => hold(`<code>${esc(code.trim())}</code>`));

  // 2. Images and links (before escaping, so we can see the brackets).
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const safe = safeUrl(url);
    return safe ? hold(`<img src="${esc(safe)}" alt="${esc(alt)}" loading="lazy">`) : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    const external = /^https?:/i.test(safe);
    return hold(`<a href="${esc(safe)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inline(text, ctx)}</a>`);
  });
  s = s.replace(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g, (url) => hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`));

  // 3. Escape the rest and apply emphasis.
  s = esc(s);
  s = s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

  // 4. Task references and mentions.
  if (ctx.task) {
    s = s.replace(/(^|[^\w-])([A-Z][A-Z0-9]{1,5}-\d+)\b/g, (m, pre, ref) => {
      const t = ctx.task!(ref);
      if (!t) return m;
      return pre + hold(`<a class="md-ref${t.closed ? ' closed' : ''}" href="${esc(t.href)}" title="${esc(t.title)}">${ref}</a>`);
    });
  }
  if (ctx.user) {
    s = s.replace(/(^|[^\w@.;])@([a-z0-9][a-z0-9._-]{0,30})/gi, (m, pre, handle) => {
      const clean = handle.toLowerCase().replace(/[._-]+$/, '');
      const name = ctx.user!(clean);
      if (!name) return m;
      return pre + hold(`<span class="md-mention" title="${esc(name)}">@${esc(clean)}</span>`) + handle.slice(clean.length);
    });
  }

  // 5. Line breaks, then restore held fragments.
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

interface ListItem {
  indent: number;
  ordered: boolean;
  checked: boolean | null;
  text: string;
  line: number;
}

/** Renders Markdown to safe HTML. Checkboxes get `data-line` with their source line index. */
export function renderMarkdown(src: string, ctx: MarkdownContext = {}): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const isBlank = (l: string) => !l.trim();
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const startsBlock = (l: string) => /^(#{1,6})\s|^```|^>\s?|^(\s*)([-*+]|\d+[.)])\s+|^(\*\s*){3,}$|^(-\s*){3,}$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code${fence[1] ? ` data-lang="${esc(fence[1])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 1, 6); // h1 in a description would be too loud
      out.push(`<h${level}>${inline(h[2], ctx)}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), ctx)}</blockquote>`);
      continue;
    }

    // Lists
    if (listRe.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = listRe.exec(lines[i]);
        if (m) {
          const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
          items.push({
            indent: m[1].replace(/\t/g, '    ').length,
            ordered: /\d/.test(m[2]),
            checked: task ? task[1] !== ' ' : null,
            text: task ? task[2] : m[3],
            line: i,
          });
          i++;
        } else if (!isBlank(lines[i]) && /^\s+/.test(lines[i]) && items.length) {
          items[items.length - 1].text += '\n' + lines[i].trim(); // continuation line
          i++;
        } else break;
      }
      out.push(renderList(items, ctx));
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++]);
    out.push(`<p>${inline(para.join('\n'), ctx)}</p>`);
  }
  return out.join('');
}

function renderList(items: ListItem[], ctx: MarkdownContext): string {
  let html = '';
  let idx = 0;
  const walk = (indent: number): string => {
    const first = items[idx];
    const tag = first.ordered ? 'ol' : 'ul';
    const isTaskList = first.checked !== null;
    let s = `<${tag}${isTaskList ? ' class="md-tasks"' : ''}>`;
    while (idx < items.length && items[idx].indent >= indent) {
      const it = items[idx];
      if (it.indent > indent) {
        s = s.replace(/<\/li>$/, '') + walk(it.indent) + '</li>';
        continue;
      }
      idx++;
      const box =
        it.checked === null ? '' : `<input type="checkbox" data-line="${it.line}"${it.checked ? ' checked' : ''}> `;
      s += `<li${it.checked ? ' class="done"' : ''}>${box}<span>${inline(it.text, ctx)}</span></li>`;
    }
    return s + `</${tag}>`;
  };
  while (idx < items.length) html += walk(items[idx].indent);
  return html;
}

/** Flips the checkbox on the given source line ("- [ ]" ⇄ "- [x]"). */
export function toggleCheckbox(src: string, line: number): string {
  const lines = src.split('\n');
  const l = lines[line];
  if (l === undefined) return src;
  lines[line] = l.replace(/^(\s*[-*+]\s+)\[([ xX])\]/, (_, pre, mark) => `${pre}[${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** Plain-text excerpt for previews (notifications, cards). */
export function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#]+/g, '')
    .replace(/^\s*[-+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
