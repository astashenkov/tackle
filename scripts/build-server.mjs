// Bundles the server into a single dependency-free file and pre-compresses client assets.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const COMPRESSIBLE = /\.(js|css|html|svg|json|webmanifest|txt)$/;
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (COMPRESSIBLE.test(entry.name)) {
      const data = fs.readFileSync(file);
      if (data.length < 1024) continue;
      fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
      fs.writeFileSync(`${file}.gz`, zlib.gzipSync(data, { level: 9 }));
      count++;
    }
  }
}
walk('dist/public');
console.log(`Server bundled to dist/server.mjs, ${count} assets pre-compressed.`);
