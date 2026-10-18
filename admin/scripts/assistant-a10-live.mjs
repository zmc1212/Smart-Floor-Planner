import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import nextEnv from '@next/env';
import { validateDataset, digest } from './assistant-a10.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
nextEnv.loadEnvConfig(root, true);
if (process.env.ASSISTANT_LIVE_TEXT !== '1') throw new Error('Explicit ASSISTANT_LIVE_TEXT=1 is required for live provider calls.');
const dataset = validateDataset(JSON.parse(await readFile('../docs/xiaok-assistant-a10-cases.zh-CN.json', 'utf8')));
const sourceUrl = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(sourceUrl.hostname) || sourceUrl.port !== '5432' || sourceUrl.pathname !== '/smart_floor_planner') throw new Error('Only the recorded local development source is supported.');
const connection = JSON.parse((await readFile('../tmp/xiaok-vector/connection.private.json', 'utf8')).replace(/^\uFEFF/, ''));
const evalUrl = new URL(connection.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(evalUrl.hostname) || evalUrl.port !== '55432' || evalUrl.pathname !== '/xiaok_embedding_eval') throw new Error('Isolated evaluation connection required.');
const output = path.resolve('../tmp/xiaok-vector', 'a10-live-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const client = new pg.Client({ connectionString: sourceUrl.toString() });
let snapshot;
try {
  await client.connect();
  await client.query('begin isolation level repeatable read read only');
  const { rows: [role] } = await client.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');
  if (role.rolsuper || role.rolbypassrls) throw new Error('Source snapshot requires a non-superuser, non-BYPASSRLS application role.');
  await client.query("select set_config('app.current_enterprise_id',$1,true),set_config('app.is_platform_admin','false',true)", [dataset.enterpriseId]);
  // Customer-public sources only; no platform flag, customer histories or credentials exported.
  const { rows } = await client.query(`select d.id::text as "documentId", d.title, d.source_type as "sourceType",
    v.id::text as "versionId", v.body, v.faq, v.content_hash as "contentHash"
    from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v
    on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id
    where d.enterprise_id=$1 and d.id between 2 and 8 and d.status='active' and d.audience='customer_public'
    and v.published_at is not null and v.index_status='ready' and v.indexed_hash=v.content_hash
    and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now()) order by d.id`, [dataset.enterpriseId]);
  if (rows.length !== 7) throw new Error('Expected seven current authorized sources; investigate before evaluation.');
  snapshot = { enterpriseId: dataset.enterpriseId, capturedAt: new Date().toISOString(), documents: rows, hash: digest(rows) };
  await client.query('rollback');
} finally { await client.end(); }
await writeFile(path.join(output, 'source-snapshot.json'), JSON.stringify(snapshot, null, 2), { flag: 'wx', mode: 0o600 });
await writeFile(path.join(output, 'dataset.json'), JSON.stringify(dataset, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, sources: snapshot.documents.length, sourceHash: snapshot.hash }));
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/assistant-a10-live-worker.ts', output], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: evalUrl.toString() },
});
child.once('error', () => { console.error('Could not start isolated runner'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
