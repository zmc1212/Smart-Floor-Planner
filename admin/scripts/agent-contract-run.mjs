import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const admin = path.resolve(import.meta.dirname, '..'), root = path.dirname(admin);
createRequire(path.join(admin, 'package.json'))('@next/env').loadEnvConfig(admin, true);
const database = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const url = new URL(database);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
const mode = process.argv[2] || 'services'; assert.ok(['services', 'transport', 'live', 'protocol'].includes(mode));
let release;
try {
  release = await lockAssistantAcceptance(database, { waitForLock: true });
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(admin, 'scripts/agent-contract.ts'), mode], {
    cwd: admin, windowsHide: true, stdio: 'inherit', env: { ...process.env, DATABASE_URL: database, SFP_COMPARISON_ISOLATED: '1', LANGCHAIN_TRACING_V2: 'false', LANGSMITH_TRACING: 'false' },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
} finally { if (release) await release(); }
