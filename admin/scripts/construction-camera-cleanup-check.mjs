import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..'), workspace = path.dirname(root), out = path.join(workspace, 'tmp/cloud-camera');
const config = JSON.parse(fs.readFileSync(path.join(workspace, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
const soak = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8'));
const own = ['admin/src/lib/construction/camera-cleanup.ts', 'admin/src/lib/construction/camera-cleanup-contract.ts', 'admin/src/components/construction/camera-panel.tsx', 'admin/src/components/construction/camera-cleanup.tsx', 'admin/src/lib/construction/__tests__/camera-cleanup-contract.test.ts', 'admin/src/db/__tests__/construction-camera-cleanup.test.ts', 'admin/src/app/api/construction/video-cleanup/projects/[projectId]/bindings/[bindingId]/route.ts', 'admin/scripts/construction-camera-cleanup-check.mjs', 'admin/scripts/construction-camera-cleanup-http.ts', 'admin/scripts/construction-camera-typecheck.mjs', 'tmp/xiaok-vector/connection.private.json'];
const files = [...new Set([...Object.keys(soak.before), ...own])];
const bind = () => Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(path.resolve(workspace, f))).digest('hex')]));
const report = { started: new Date().toISOString(), soakRunId: soak.runId, before: bind() };
for (const [file, hash] of Object.entries(soak.before)) if (report.before[file] !== hash) throw Error('Long-soak source drift; do not proceed');
const owner = new URL(config.EMBEDDING_EVAL_OWNER_URL), app = new URL(config.DATABASE_URL), database = 'cloud_camera_cleanup_eval';
for (const url of [owner, app]) if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432') throw Error('Approved isolated evaluation PostgreSQL only');
const control = new pg.Client({ connectionString: owner.href });
try {
  await control.connect();
  if (!(await control.query('select 1 from pg_database where datname=$1', [database])).rowCount) await control.query('create database ' + database);
} finally { await control.end(); }
owner.pathname = app.pathname = '/' + database;
const pool = new pg.Pool({ connectionString: owner.href, max: 1 });
try { await migrate(drizzle(pool), { migrationsFolder: path.join(root, 'drizzle'), migrationsSchema: 'app' }); } finally { await pool.end(); }
const run = cp.spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', 'src/lib/construction/__tests__/camera-cleanup-contract.test.ts', 'src/db/__tests__/construction-camera-cleanup.test.ts'], { cwd: root, env: { ...process.env, DATABASE_URL: app.href, NODE_ENV: 'test' }, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
fs.mkdirSync(out, { recursive: true });
const log = path.join(out, 'cleanup-check-' + report.started.replace(/[:.]/g, '-') + '.log');
fs.writeFileSync(log, (run.stdout || '') + (run.stderr || ''));
const after = bind(), drift = files.filter(f => report.before[f] !== after[f]);
const receipt = { ...report, after, drift, exit: run.status, passed: run.status === 0 && !drift.length, finished: new Date().toISOString(), log };
fs.writeFileSync(log.replace(/\.log$/, '.json'), JSON.stringify(receipt, null, 2));
fs.writeFileSync(path.join(out, 'cleanup-check.json'), JSON.stringify(receipt, null, 2));
console.log((run.stdout || '').split('\n').filter(line => /✔|✖|tests |pass |fail |error:|expected:|actual:/.test(line)).slice(-25).join('\n'));
console.log(JSON.stringify({ passed: receipt.passed, exit: run.status, log, bindings: files.length, drift }));
process.exitCode = receipt.passed ? 0 : 1;
