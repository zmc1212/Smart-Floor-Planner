import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
nextEnv.loadEnvConfig(root);
const folder = path.resolve(root, '../tmp/xiaok-vector');
const evidencePath = path.join(folder, 'phase1-operations-acceptance.json');
const commands = [
  'test:assistant', 'test:assistant:knowledge', 'test:assistant:answers',
  'test:assistant:usage', 'test:assistant:operations', 'test:assistant:retention',
];
const results = [];
let release;
await mkdir(folder, { recursive: true });
try {
  release = await lockAssistantAcceptance();
  await writeFile(evidencePath, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), passed: false, status: 'running', results }, null, 2));
  for (const command of commands) {
    const started = Date.now();
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [process.env.npm_execpath, 'run', command], {
        cwd: root, stdio: 'inherit', env: {
          ...process.env, ASSISTANT_LIVE_TEXT: '0', ASSISTANT_OPERATIONS_ACCEPTANCE: '1',
          ASSISTANT_RETENTION_DATABASE_URL: process.env.DATABASE_URL,
          ASSISTANT_OPERATIONS_DATABASE_URL: process.env.DATABASE_URL,
        },
      });
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    results.push({ command, exitCode, durationMs: Date.now() - started });
    // Preserve completed suites if the caller/session stops before the full run.
    await writeFile(evidencePath, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), passed: false, status: 'running', results }, null, 2));
    if (exitCode !== 0) break;
  }
  const passed = results.length === commands.length && results.every(result => result.exitCode === 0);
  await writeFile(evidencePath, JSON.stringify({
    schemaVersion: 1, createdAt: new Date().toISOString(), passed, results,
    scope: 'Isolated backend operations regressions; real Embedding, deterministic text adapters. Live text, full backup/restore, production deployment, UI and real-enterprise A10 are separate gates.',
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally { if (release) await release(); }
