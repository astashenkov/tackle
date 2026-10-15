// Runs the API server (with auto-reload) and the Vite dev server side by side.
import { spawn } from 'node:child_process';

const procs = [
  ['api ', '\x1b[35m', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts']],
  ['web ', '\x1b[36m', ['vite']],
].map(([name, color, args]) => {
  const child = spawn('npx', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = `${color}${name}\x1b[0m│ `;
  const forward = (stream) => (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) stream.write(prefix + line + '\n');
  };
  child.stdout.on('data', forward(process.stdout));
  child.stderr.on('data', forward(process.stderr));
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    for (const p of procs) p.kill();
    process.exit(code ?? 0);
  });
  return child;
});

console.log('\n  Open http://localhost:5173 (API on http://localhost:3000)\n');
