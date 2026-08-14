import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'safari16'],
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  logLevel: 'info'
});

await Promise.all([
  cp(path.join(root, 'index.html'), path.join(dist, 'index.html')),
  cp(path.join(root, 'src/styles.css'), path.join(dist, 'styles.css'))
]);
