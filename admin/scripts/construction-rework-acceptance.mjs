/** Repeatable isolated service checks. --migrate --development applies only migration0098. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin = path.resolve(import.meta.dirname, '..'), root = path.resolve(admin, '..');
nextEnv.loadEnvConfig(admin, true);
const config = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
const output = path.resolve(process.env.CONSTRUCTION_REWORK_OUTPUT || path.join(root, 'tmp/construction-retake-20261028/service'));
fs.mkdirSync(output, { recursive: true });
process.env.DATABASE_URL = config.DATABASE_URL;
const files = ['src/lib/construction/site-chat.ts', 'src/lib/construction/site-worker.ts', 'src/lib/construction/site-contract.ts', 'src/lib/construction/site-publications.ts',
  'src/lib/__tests__/construction-site-contract.test.ts', 'scripts/construction-rework-acceptance.mjs',
  'src/db/__tests__/construction-site-chat.test.ts', 'drizzle/0098_construction_record_rework.sql', 'src/db/construction-schema.ts',
  'src/db/repositories/construction-cleanup.ts', 'src/db/repositories/assistant-repository.ts', 'src/db/transaction.ts',
  'src/lib/assistant/core/conversation.ts', 'src/lib/assistant/infrastructure/job-queue.ts', 'src/lib/assistant/agent/config.ts',
  'src/db/__tests__/construction-chat-queries.test.ts', 'src/db/__tests__/construction-resolution.test.ts', 'src/db/__tests__/construction-public-sites.test.ts',
  'package.json', 'package-lock.json', '.env.local'];
const binding = () => Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(admin, f))).digest('hex')]));
const report = { started: new Date().toISOString(), before: binding(), migration: null, exitCode: null };
let release;
try {
  release = await lockAssistantAcceptance(config.DATABASE_URL, { waitForLock: process.argv.includes('--wait') });
  if (process.argv.includes('--migrate')) {
    if (!process.argv.includes('--development')) throw Error('Migration requires --development');
    const u = new URL(config.EMBEDDING_EVAL_OWNER_URL);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== '55432' || u.pathname !== '/xiaok_embedding_eval' || decodeURIComponent(u.username) !== 'vector_probe_owner') throw Error('Exact isolated migration target/owner required');
    const client = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 5000 });
    try {
      await client.connect(); await client.query('begin'); await client.query("set local lock_timeout='5s'");
      const journal = JSON.parse(fs.readFileSync(path.join(admin, 'drizzle/meta/_journal.json'), 'utf8'));
      const entries = journal.entries.filter(e => e.idx === 98 || process.argv.includes('--prepare-cleanup-schema') && e.idx >= 90 && e.idx <= 94);
      const migrations = [];
      for (const entry of entries) {
        const source = fs.readFileSync(path.join(admin, 'drizzle', entry.tag + '.sql'), 'utf8');
        const hash = crypto.createHash('sha256').update(source).digest('hex');
        const { rows } = await client.query('select hash from app.__drizzle_migrations where created_at=$1', [entry.when]);
        if (rows.length && (rows.length !== 1 || rows[0].hash !== hash)) throw Error('Migration hash conflict: ' + entry.tag);
        if (!rows.length) {
          await client.query(source);
          await client.query('insert into app.__drizzle_migrations(hash,created_at) values($1,$2)', [hash, entry.when]);
        }
        migrations.push({ tag: entry.tag, hash, applied: !rows.length });
      }
      await client.query('commit'); report.migration = { migrations, target: 'loopback:55432/xiaok_embedding_eval' };
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
    finally { await client.end(); }
  }
  const tests = process.argv.includes('--read-compat') ? ['src/db/__tests__/construction-chat-queries.test.ts'] : process.argv.includes('--compat')
    ? ['src/db/__tests__/construction-chat-queries.test.ts', 'src/db/__tests__/construction-resolution.test.ts', 'src/db/__tests__/construction-public-sites.test.ts']
    : ['src/db/__tests__/construction-site-chat.test.ts'];
  const logPath = path.join(output, 'tests.log'); fs.writeFileSync(logPath, '');
  const pattern = process.argv.includes('--rework-only') ? ['--test-name-pattern=shared conversation is project-owned|manager returns require instructions'] : [];
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...pattern, ...tests], { cwd: admin, env: { ...process.env, CONSTRUCTION_LIVE_MODEL: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { log += c; fs.appendFileSync(logPath, c); });
  report.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  console.log(log.split('\n').filter(l => /^(✔|✖|ℹ|not ok|ok |# tests|# pass|# fail|# skip)|error:|Error:|actual:|expected:/.test(l)).slice(-35).join('\n'));
  process.exitCode = report.exitCode;
} catch (e) { report.error = e.message; console.error(e.message); process.exitCode = 1; }
finally {
  report.after = binding(); report.drift = files.filter(f => report.before[f] !== report.after[f]);
  if (report.drift.length) process.exitCode = 1;
  report.finished = new Date().toISOString(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await release?.(); console.log(JSON.stringify({ exitCode: process.exitCode || 0, drift: report.drift, report: path.join(output, 'report.json') }));
}
