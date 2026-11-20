import { CLOSED_CATEGORIES } from '../shared/constants';
import type { StatusCategory, Task, TelegramChat, TelegramSettings } from '../shared/types';
import { config } from './config';
import { loadTask, type DB } from './db';
import { taskRef } from './notify';
import { asBody, badRequest, idList, oneOf, str } from './util';

const META_KEY = 'telegram';
/**
 * A task has to stay in its new status this long before the message goes out. Dragging a card
 * through a few columns or moving it back by mistake posts nothing extra, and the assignee has a
 * moment to leave a comment right after moving the task.
 */
const DELAY_MS = 10_000;
/** Longer comments are cut: a Telegram message holds 4096 characters, the title takes up to 500. */
const COMMENT_MAX = 2500;
/** A comment longer than this (characters or lines) folds into an expandable quote. */
const FOLD_CHARS = 400;
const FOLD_LINES = 8;
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;

type Lang = TelegramSettings['lang'];

/** What the meta table holds: the settings and the bot token. */
interface Stored extends Omit<TelegramSettings, 'tokenHint'> {
  token: string;
}

export interface TelegramOptions {
  /** Bot API address (TELEGRAM_API_URL by default). */
  apiUrl?: string;
  /** How long a task has to stay in its new status before the message goes out. */
  delayMs?: number;
  fetch?: typeof fetch;
}

const TEXT: Record<Lang, Record<'assignee' | 'noAssignee' | 'comment' | 'noComment' | 'movedBy' | 'test', string>> = {
  en: {
    assignee: 'Assignee',
    noAssignee: 'none',
    comment: 'Assignee’s comment',
    noComment: 'none',
    movedBy: 'Moved by',
    test: 'Tackle is connected. Messages about tasks will arrive in this chat.',
  },
  ru: {
    assignee: 'Исполнитель',
    noAssignee: 'не назначен',
    comment: 'Комментарий исполнителя',
    noComment: 'нет',
    movedBy: 'Перевёл(а)',
    test: 'Tackle подключён. Сообщения о задачах будут приходить в этот чат.',
  },
};

const ICONS: Partial<Record<StatusCategory, string>> = { started: '👀', completed: '✅', canceled: '🚫' };

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Message {
  lang: Lang;
  /** "WEB-42" */
  ref: string;
  title: string;
  status: { name: string; category: StatusCategory };
  assignee: string | null;
  /** Who moved the task, when that wasn't the assignee. */
  movedBy: string | null;
  /** The assignee's latest comment on the task, already Telegram HTML (see commentHtml). */
  comment: string | null;
  url: string | null;
}

/** The chat message (Telegram HTML) about a task that moved. Missing details are spelled out. */
export function composeMessage(m: Message): string {
  const s = TEXT[m.lang];
  const lines = [
    `${ICONS[m.status.category] ?? '📌'} <b>${escape(m.ref)}</b> → ${escape(m.status.name)}`,
    escape(m.title),
    '',
    `${s.assignee}: ${m.assignee ? `<b>${escape(m.assignee)}</b>` : `<i>${s.noAssignee}</i>`}`,
  ];
  if (m.movedBy) lines.push(`${s.movedBy}: ${escape(m.movedBy)}`);
  if (m.comment) {
    // A long comment folds so it doesn't take over the chat; Telegram shows its first lines.
    const visible = plainText(m.comment);
    const fold = visible.length > FOLD_CHARS || visible.split('\n').length > FOLD_LINES;
    lines.push(`${s.comment}:\n<blockquote${fold ? ' expandable' : ''}>${m.comment}</blockquote>`);
  } else {
    lines.push(`${s.comment}: <i>${s.noComment}</i>`);
  }
  if (m.url) lines.push('', escape(m.url));
  return lines.join('\n');
}

/** Telegram HTML as plain text: what a reader sees, for a message sent without formatting. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export interface CommentLinks {
  /** Tackle's address, for links inside Tackle ("/t/WEB-1"); without it they stay plain text. */
  appUrl?: string;
  /** Whether "WEB-12" is a task, so it can become a link. */
  isTask?: (ref: string) => boolean;
}

/**
 * A Markdown comment as Telegram HTML, which goes inside the message's quote. Telegram knows only
 * a few tags (no lists, headings or line-break tags) and allows no code or nested quote inside a
 * quote, so: emphasis and links stay, headings turn bold, list items get "•" / "1." / "☐", quoted
 * lines get "»", and code shows as plain text. Attached files become their names.
 */
export function commentHtml(body: string, links: CommentLinks = {}): string {
  let src = body.replace(/\r\n?/g, '\n').trim();
  if (src.length > COMMENT_MAX) {
    const cut = src.slice(0, COMMENT_MAX);
    const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
    src = `${(at > COMMENT_MAX * 0.8 ? cut.slice(0, at) : cut).trimEnd()}…`;
  }
  const out: string[] = [];
  let fence = false;
  let blank = false;
  for (const line of src.split('\n')) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) {
      out.push(escape(line));
      continue;
    }
    if (!line.trim()) {
      // Runs of empty lines (around a skipped code fence too) collapse into one.
      if (out.length && !blank) out.push('');
      blank = true;
      continue;
    }
    blank = false;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (heading) out.push(`<b>${inlineHtml(heading[1], links)}</b>`);
    else if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) out.push('———');
    else if (quote) out.push(`» <i>${inlineHtml(quote[1], links)}</i>`);
    else if (item) {
      const [, indent, marker, box, text] = item;
      const depth = Math.min(Math.floor(indent.replace(/\t/g, '    ').length / 2), 4);
      const bullet = box !== undefined ? (box === ' ' ? '☐' : '☑') : /\d/.test(marker) ? marker.replace(')', '.') : '•';
      out.push(`${'    '.repeat(depth)}${bullet} ${inlineHtml(text, links)}`);
    } else out.push(inlineHtml(line.trim(), links));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** One line of Markdown as Telegram HTML; the result is always properly nested. */
function inlineHtml(src: string, links: CommentLinks): string {
  // Code spans, files and links are set aside first, so nothing inside them is formatted and
  // emphasis can only wrap them whole.
  const held: string[] = [];
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;
  const target = (url: string): string | null => {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/') && links.appUrl) return links.appUrl + url;
    return null;
  };
  let s = src
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code: string) => hold(escape(code.trim())))
    .replace(/!?\[([^\]]*)\]\(\/api\/attachments\/[^)\s]+\)/g, (_, name: string) => hold(`📎 ${escape(name)}`))
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => {
      const href = target(url);
      const label = emphasis(escape(text || url));
      return hold(href ? `<a href="${escape(href).replace(/"/g, '&quot;')}">${label}</a>` : label);
    });
  s = emphasis(escape(s));
  if (links.appUrl && links.isTask) {
    s = s.replace(/(^|[^\w/-])([A-Z][A-Z0-9]{1,5}-\d+)\b/g, (m, pre: string, ref: string) =>
      links.isTask!(ref) ? pre + hold(`<a href="${escape(`${links.appUrl}/t/${ref}`)}">${ref}</a>`) : m,
    );
  }
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
}

/**
 * Bold, italic and strikethrough, the way Tackle shows them. Delimiters that would cross another
 * pair's ("**a *b** c*") stay as typed, so the tags always nest and Telegram accepts the message.
 */
function emphasis(s: string): string {
  // Every rule captures (text before, inner text). The inner text may hold no delimiter of its
  // own kind, and a finished tag is set aside, so a later match can only wrap it whole.
  const rules: [RegExp, string][] = [
    [/()\*\*(?=\S)([^*]*?\S)\*\*/g, 'b'],
    [/()__(?=\S)([^_]*?\S)__/g, 'b'],
    [/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, 'i'],
    [/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, 'i'],
    [/()~~(?=\S)([^~]*?\S)~~/g, 's'],
  ];
  const held: string[] = [];
  const hold = (html: string) => `\u0001${held.push(html) - 1}\u0001`;
  for (let changed = true; changed; ) {
    changed = false;
    for (const [re, tag] of rules) {
      s = s.replace(re, (_, pre: string, inner: string) => {
        changed = true;
        return pre + hold(`<${tag}>${inner}</${tag}>`);
      });
    }
  }
  // A tag only holds tags set aside before it, so restoring from the last one leaves none behind.
  for (let i = held.length; i-- > 0; ) s = s.split(`\u0001${i}\u0001`).join(held[i]);
  return s;
}

/** Out of the box: review statuses and the closed ones (Done, Canceled). */
function defaultStatusIds(db: DB): string[] {
  return db
    .all<{ id: string; name: string; category: StatusCategory }>('SELECT id, name, category FROM statuses ORDER BY position')
    .filter((s) => CLOSED_CATEGORIES.has(s.category) || /review|ревью/i.test(s.name))
    .map((s) => s.id);
}

function parseAppUrl(value: unknown): string {
  const v = str(value, 'Address', { max: 500 }).replace(/\/+$/, '');
  if (!v) return '';
  let url: URL | null = null;
  try {
    url = new URL(v);
  } catch {
    // reported below
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw badRequest('The address must be a link like https://tackle.example.com');
  return v;
}

class TelegramError extends Error {
  constructor(
    message: string,
    /** Telegram's HTTP status, 0 when it couldn't be reached. */
    readonly status = 0,
  ) {
    super(message);
  }
}

/**
 * Posts to a Telegram chat when a task moves to one of the chosen statuses (In Review, Done,
 * Canceled out of the box). Messages go out in the background, one at a time, so a slow or
 * unreachable Telegram never holds up the board.
 */
export class Telegram {
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>();
  private queue: Promise<void> = Promise.resolve();
  private readonly apiUrl: string;
  private readonly delayMs: number;
  private readonly fetch: typeof fetch;

  constructor(
    private db: DB,
    opts: TelegramOptions = {},
  ) {
    this.apiUrl = (opts.apiUrl ?? config.telegramApiUrl).replace(/\/+$/, '');
    this.delayMs = opts.delayMs ?? DELAY_MS;
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private stored(): Stored {
    const raw = this.db.getMeta(META_KEY);
    if (raw) return JSON.parse(raw) as Stored;
    return { enabled: false, token: '', chatId: '', statusIds: defaultStatusIds(this.db), lang: 'en', appUrl: '' };
  }

  settings(): TelegramSettings {
    const { token, ...rest } = this.stored();
    return { ...rest, tokenHint: token.slice(-4) };
  }

  /** Changes the settings. A token left out stays as it is; an empty one removes it. */
  update(raw: unknown): TelegramSettings {
    const b = asBody(raw);
    const s = this.stored();
    if (b.token !== undefined) {
      const token = str(b.token, 'Bot token', { max: 200 });
      if (token && !TOKEN_RE.test(token)) throw badRequest('That doesn’t look like a bot token. @BotFather gives one like 123456789:AAH…');
      s.token = token;
    }
    if (b.chatId !== undefined) {
      const chatId = str(b.chatId, 'Chat id', { max: 64 });
      if (chatId && !CHAT_RE.test(chatId)) throw badRequest('The chat id is a number like -1001234567890 or a public @channel');
      s.chatId = chatId;
    }
    if (b.statusIds !== undefined) {
      s.statusIds = idList(b.statusIds, 'statusIds', 100);
      for (const statusId of s.statusIds) if (!this.db.get('SELECT 1 FROM statuses WHERE id = ?', statusId)) throw badRequest('Unknown status');
    }
    if (b.lang !== undefined) s.lang = oneOf(b.lang, 'lang', ['en', 'ru'] as const);
    if (b.appUrl !== undefined) s.appUrl = parseAppUrl(b.appUrl);
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== 'boolean') throw badRequest('enabled must be true or false');
      s.enabled = b.enabled;
    }
    if (s.enabled && (!s.token || !s.chatId)) throw badRequest('Add a bot token and a chat id to turn messages on');
    this.db.setMeta(META_KEY, JSON.stringify(s));
    return this.settings();
  }

  /** Sends a test message with the saved settings and reports what Telegram said. */
  async test(): Promise<void> {
    const s = this.stored();
    if (!s.token || !s.chatId) throw badRequest('Save a bot token and a chat id first');
    await this.ask(() => this.send(s, escape(TEXT[s.lang].test)));
  }

  /**
   * Chats the bot heard from lately, newest first: groups it was added to, messages it got
   * (Telegram keeps a day of them). Saves looking up a group's id by hand. Takes a token that
   * hasn't been saved yet, so the chat can be picked before saving.
   */
  async chats(raw: unknown): Promise<TelegramChat[]> {
    const b = asBody(raw);
    const token = b.token ? str(b.token, 'Bot token', { max: 200 }) : this.stored().token;
    if (!token) throw badRequest('Enter the bot token first');
    if (!TOKEN_RE.test(token)) throw badRequest('That doesn’t look like a bot token. @BotFather gives one like 123456789:AAH…');
    const updates = await this.ask(() =>
      this.call<Record<string, unknown>[]>(token, 'getUpdates', {}).catch((err) => {
        // A bot that already works for another program (a webhook or another getUpdates loop) can
        // still send messages, but its updates aren't ours to read. Its webhook is left alone.
        if (err instanceof TelegramError && err.status === 409) {
          throw badRequest('This bot already works for another program, so Tackle can’t look up its chats. Enter the chat id by hand.', 'telegram_busy');
        }
        throw err;
      }),
    );
    const found = new Map<string, TelegramChat>();
    for (const update of [...updates].reverse()) {
      for (const part of Object.values(update)) {
        const chat = (part as { chat?: { id: number; title?: string; username?: string; first_name?: string; last_name?: string } } | null)?.chat;
        if (!chat || found.has(String(chat.id))) continue;
        const person = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
        found.set(String(chat.id), { id: String(chat.id), title: chat.title ?? (person || (chat.username ? `@${chat.username}` : String(chat.id))) });
      }
    }
    return [...found.values()];
  }

  /** Call when a task moves to another status: the message is scheduled once the change commits. */
  statusChanged(task: Task, actorId: string) {
    this.db.afterCommit(() => this.schedule(task.id, task.statusId, actorId));
  }

  /** Sends what is waiting right away (on shutdown and in tests); resolves once it has all gone out. */
  async flush() {
    for (const { timer, send } of [...this.pending.values()]) {
      clearTimeout(timer);
      send();
    }
    await this.queue;
  }

  private schedule(taskId: string, statusId: string, actorId: string) {
    // Only a task's latest move counts.
    const waiting = this.pending.get(taskId);
    if (waiting) clearTimeout(waiting.timer);
    this.pending.delete(taskId);
    const s = this.stored();
    if (!s.enabled || !s.statusIds.includes(statusId)) return;
    const send = () => {
      this.pending.delete(taskId);
      this.deliver(taskId, statusId, actorId);
    };
    const timer = setTimeout(send, this.delayMs);
    timer.unref?.();
    this.pending.set(taskId, { timer, send });
  }

  private deliver(taskId: string, statusId: string, actorId: string) {
    const s = this.stored();
    const task = loadTask(this.db, taskId);
    // The task may have moved on or been deleted in the meantime, or messages turned off.
    if (!s.enabled || !s.token || !s.chatId || !task || task.statusId !== statusId) return;
    const message = this.describe(task, actorId, s);
    const text = composeMessage(message);
    this.queue = this.queue
      .then(() => this.send(s, text))
      .catch((err) => console.error(`Telegram: couldn’t post about ${message.ref}: ${(err as Error).message}`));
  }

  private describe(task: Task, actorId: string, s: Stored): Message {
    const { db } = this;
    const name = (userId: string | null) => (userId ? (db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId)?.name ?? null) : null);
    const status = db.get<{ name: string; category: StatusCategory }>('SELECT name, category FROM statuses WHERE id = ?', task.statusId)!;
    const comment = task.assigneeId
      ? db.get<{ body: string }>(
          'SELECT body FROM comments WHERE task_id = ? AND author_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
          task.id,
          task.assigneeId,
        )?.body
      : undefined;
    const ref = taskRef(db, task);
    const isTask = (r: string) => {
      const [key, number] = r.split('-');
      return !!db.get('SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.key = ? AND t.number = ? AND t.deleted_at IS NULL', key, Number(number));
    };
    return {
      lang: s.lang,
      ref,
      title: task.title,
      status,
      assignee: name(task.assigneeId),
      movedBy: actorId === task.assigneeId ? null : name(actorId),
      comment: comment ? commentHtml(comment, { appUrl: s.appUrl, isTask }) || null : null,
      url: s.appUrl ? `${s.appUrl}/t/${ref}` : null,
    };
  }

  private async send(s: Pick<Stored, 'token' | 'chatId'>, text: string): Promise<void> {
    const message = { chat_id: s.chatId, link_preview_options: { is_disabled: true } };
    try {
      await this.call(s.token, 'sendMessage', { ...message, text, parse_mode: 'HTML' });
    } catch (err) {
      // Should Telegram reject the formatting after all, the message still goes out, as plain text.
      if (!(err instanceof TelegramError && err.status === 400 && /parse entities/i.test(err.message))) throw err;
      console.error(`Telegram: sending without formatting: ${err.message}`);
      await this.call(s.token, 'sendMessage', { ...message, text: plainText(text) });
    }
  }

  /** Runs a Bot API call for an admin, turning Telegram's complaint into a readable error. */
  private async ask<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof TelegramError) throw badRequest(`Telegram: ${err.message}`, 'telegram');
      throw err;
    }
  }

  /** Calls a Bot API method, waiting out Telegram's flood limit (about 20 messages a minute in a group). */
  private async call<T = unknown>(token: string, method: string, body: object): Promise<T> {
    // Whatever goes wrong, the token must not end up in a log or an error message.
    const hide = (message: string) => message.split(token).join('…');
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(`${this.apiUrl}/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new TelegramError(hide(`can’t reach ${this.apiUrl}: ${(err as Error).message}`));
      }
      const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | null;
      if (res.ok && data?.ok) return data.result as T;
      const wait = data?.parameters?.retry_after;
      if (res.status === 429 && wait !== undefined && attempt < 5) {
        await sleep(Math.min(wait, 60) * 1000);
        continue;
      }
      throw new TelegramError(hide(data?.description ?? `HTTP ${res.status}`), res.status);
    }
  }
}
