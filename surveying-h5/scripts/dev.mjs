import { context } from 'esbuild';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '..');
const dist = path.join(root, 'dist');
const portArg = process.argv.find((value) => value.startsWith('--port='));
const port = Number(portArg ? portArg.split('=')[1] : process.env.PORT) || 4173;

const buildContext = await context({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'safari16'],
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  logLevel: 'warning'
});
await buildContext.watch();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function resolveRequest(urlPath) {
  const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (cleanPath === '/' || cleanPath === '/index.html') return path.join(root, 'index.html');
  if (cleanPath === '/styles.css') return path.join(root, 'src/styles.css');
  if (cleanPath.startsWith('/dist/')) return path.join(root, cleanPath.slice(1));
  if (cleanPath.startsWith('/packages/') || cleanPath.startsWith('/images/')) {
    return path.join(workspace, 'miniprogram', cleanPath.slice(1));
  }
  return path.join(root, cleanPath.replace(/^\/+/, ''));
}

const server = createServer((request, response) => {
  const filePath = resolveRequest(request.url);
  if (!filePath.startsWith(root) && !filePath.startsWith(path.join(workspace, 'miniprogram'))) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, 'localhost', () => {
  console.log(`Surveying H5: http://localhost:${port}`);
});

const shutdown = async () => {
  server.close();
  await buildContext.dispose();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
