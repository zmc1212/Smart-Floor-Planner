#!/usr/bin/env node
/**
 * Next may copy build-time .env files into `.next/standalone`. Production
 * runtime configuration is injected by Compose/secrets, so remove every env
 * file from the local artifact as a defense in depth step.
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.env.NEXT_DIST_DIR || '.next');
const standalone = path.join(output, 'standalone');
const manifest = await readFile(path.join(output, 'required-server-files.json'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '{}';
  throw error;
});
const appDirectory = path.resolve(standalone, JSON.parse(manifest).relativeAppDir ?? '');
const relative = path.relative(standalone, appDirectory);
if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
  throw new Error('Standalone app path must stay inside the build output');
}
const names = ['.env', '.env.local', '.env.production', '.env.development', '.env.test'];
for (const directory of new Set([standalone, appDirectory])) {
  for (const name of names) {
    await rm(path.join(directory, name), { force: true });
  }
}
console.log('[prune-standalone-env] removed local env files from standalone output');
