#!/usr/bin/env node
/**
 * Next may copy build-time .env files into `.next/standalone`. Production
 * runtime configuration is injected by Compose/secrets, so remove every env
 * file from the local artifact as a defense in depth step.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

const standalone = path.resolve('.next/standalone');
const names = ['.env', '.env.local', '.env.production', '.env.development', '.env.test'];
for (const name of names) {
  await rm(path.join(standalone, name), { force: true });
}
console.log('[prune-standalone-env] removed local env files from standalone output');
