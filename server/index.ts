import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import { DB } from './db';

const db = new DB(config.databasePath);
const { app } = createApp({ db, publicDir: config.publicDir });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`Tackle is running at http://${host}:${info.port}  (database: ${config.databasePath})`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
