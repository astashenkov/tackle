import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { backupDatabase, defaultBackupPath } from './backup';
import { config } from './config';
import { DB } from './db';

const [command, arg] = process.argv.slice(2);

if (command === 'backup') {
  // node dist/server.mjs backup [target.db] — consistent snapshot, safe while the server runs.
  const db = new DB(config.databasePath);
  const file = backupDatabase(db, arg ?? defaultBackupPath(config.databasePath));
  db.close();
  console.log(`Backup written to ${file}`);
  if (fs.existsSync(config.attachmentsDir)) console.log(`Attached files are not part of it: back up ${config.attachmentsDir} as well.`);
  process.exit(0);
}

const db = new DB(config.databasePath);
const { app, ctx } = createApp({ db, publicDir: config.publicDir });
ctx.files.sweep();

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
