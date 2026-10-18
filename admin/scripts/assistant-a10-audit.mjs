import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const folder = path.resolve(process.argv[2]);
const evidence = JSON.parse(await readFile(path.join(folder, 'evidence.json'), 'utf8'));
const connection = JSON.parse((await readFile('../tmp/xiaok-vector/connection.private.json', 'utf8')).replace(/^\uFEFF/, ''));
const url = new URL(connection.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') throw new Error('Isolated evaluation connection required.');
const client = new pg.Client({ connectionString: url.toString() });
try {
  await client.connect();
  await client.query('begin read only');
  await client.query("select set_config('app.current_enterprise_id',$1,true),set_config('app.is_platform_admin','false',true)", [evidence.executionEnterpriseId]);
  const { rows: attempts } = await client.query(`select id::text, assistant_run_id::text as "runId", status, accepted, error_code as "errorCode",
    duration_ms as "durationMs", remote_task_id as "remoteTaskId", remote_model as model
    from app.ai_provider_attempts where enterprise_id=$1 and assistant_run_id is not null order by id`, [evidence.executionEnterpriseId]);
  const { rows: reservations } = await client.query('select run_id::text as "runId",status from app.assistant_quota_reservations where enterprise_id=$1 order by run_id', [evidence.executionEnterpriseId]);
  const { rows: jobs } = await client.query('select status,count(*)::int as count from app.assistant_jobs where enterprise_id=$1 group by status', [evidence.executionEnterpriseId]);
  await client.query('rollback');
  const audit = { capturedAt: new Date().toISOString(), executionEnterpriseId: evidence.executionEnterpriseId, attempts, reservations, jobs };
  await writeFile(path.join(folder, 'provider-audit-' + Date.now() + '.json'), JSON.stringify(audit, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ attempts: attempts.length, unknown: attempts.filter(a => a.status === 'unknown'), jobs }));
} finally { await client.end(); }
