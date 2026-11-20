import type { Hono } from 'hono';
import { requireAdmin, type AppEnv } from '../auth';
import type { Ctx } from '../notify';

/** Settings for messages to a Telegram chat. Admins only: they hold the bot token. */
export function telegramRoutes(api: Hono<AppEnv>, { telegram }: Ctx) {
  api.get('/telegram', (c) => {
    requireAdmin(c);
    return c.json(telegram.settings());
  });

  api.patch('/telegram', async (c) => {
    requireAdmin(c);
    return c.json(telegram.update(await c.req.json()));
  });

  api.post('/telegram/chats', async (c) => {
    requireAdmin(c);
    return c.json(await telegram.chats(await c.req.json()));
  });

  api.post('/telegram/test', async (c) => {
    requireAdmin(c);
    await telegram.test();
    return c.json({ ok: true });
  });
}
