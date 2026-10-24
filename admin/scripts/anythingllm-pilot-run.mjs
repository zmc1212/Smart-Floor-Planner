import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(admin);
const load = createRequire(path.join(admin, 'package.json'));
load('@next/env').loadEnvConfig(admin, true);
const connection = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
const isolated = connection.DATABASE_URL;
const url = new URL(isolated);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval', 'Only the approved isolated database is allowed');
const mode = process.argv[2] || 'probe';
assert.ok(['probe', 'services', 'live', 'natural'].includes(mode));
let release;
try {
  if (mode !== 'probe') release = await lockAssistantAcceptance(isolated, { waitForLock: true });
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(admin, 'scripts/anythingllm-pilot.ts'), mode], {
    cwd: admin,
    env: { ...process.env, DATABASE_URL: isolated, SFP_PILOT_DATABASE_VERIFIED: '1' },
    windowsHide: true,
    stdio: 'inherit',
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
} finally {
  if (release) await release();
}
