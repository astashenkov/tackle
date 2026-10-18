// Starts a production build against a fresh demo database for end-to-end tests.
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const db = path.join(os.tmpdir(), `tackle-e2e-${process.pid}.db`);
const files = path.join(os.tmpdir(), `tackle-e2e-${process.pid}-files`);
// A 1 MB upload limit keeps the "file too large" test small.
const env = { ...process.env, DATABASE_PATH: db, ATTACHMENTS_DIR: files, MAX_UPLOAD_MB: '1', PORT: process.env.PORT ?? '3300' };
execFileSync(process.execPath, ['--import', 'tsx', 'server/seed.ts', '--force'], { env, stdio: 'inherit' });
const server = spawn(process.execPath, ['dist/server.mjs'], { env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
