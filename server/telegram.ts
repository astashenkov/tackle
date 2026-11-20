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
const COMMENT_MAX = 1000;
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
  /** The assignee's latest comment on the task. */
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
  lines.push(m.comment ? `${s.comment}:\n<blockquote>${escape(m.comment)}</blockquote>` : `${s.comment}: <i>${s.noComment}</i>`);
  if (m.url) lines.push('', escape(m.url));
  return lines.join('\n');
}

/** A comment as plain text: attached files become their names, long text is cut short. */
export function commentText(body: string): string {
  const text = body.replace(/!?\[([^\]]*)\]\(\/api\/attachments\/[^)\s]+\)/g, '📎 $1').trim();
  return text.length > COMMENT_MAX ? `${text.slice(0, COMMENT_MAX).trimEnd()}…` : text;
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
    return {
      lang: s.lang,
      ref,
      title: task.title,
      status,
      assignee: name(task.assigneeId),
      movedBy: actorId === task.assigneeId ? null : name(actorId),
      comment: comment ? commentText(comment) || null : null,
      url: s.appUrl ? `${s.appUrl}/t/${ref}` : null,
    };
  }

  private async send(s: Pick<Stored, 'token' | 'chatId'>, text: string): Promise<void> {
    await this.call(s.token, 'sendMessage', { chat_id: s.chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
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
