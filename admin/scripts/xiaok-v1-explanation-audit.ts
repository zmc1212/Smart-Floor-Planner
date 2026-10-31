/** Read-only audit of an explicitly selected retained development run. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
const runId = process.argv.find(v => v.startsWith('--run-id='))?.slice(9) || '';
assert.match(runId, /^\d+$/);
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
async function main() { try {
  if(process.argv.includes('--probe-private-frame')) {
    const probe=await withTenantTransaction('1454',async tx=>{
      await tx.execute(sql`savepoint private_frame_probe`);
      try {await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint,input_summary)
        values(1454,${runId},999901,'agent_invalid_provider_frame','failed','{"protocol":"synthetic-rollback-probe"}'::jsonb,'{}'::jsonb)`);
        const saved=await one(tx,sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} and step_seq=999901`);
        assert.equal((saved?.private_checkpoint as {protocol?:string})?.protocol,'synthetic-rollback-probe');return {stored:true,modelCalls:0,rolledBack:true};
      }finally{await tx.execute(sql`rollback to savepoint private_frame_probe`);}
    });console.log(JSON.stringify(probe));return;
  }
  const result = await withTenantTransaction('1454', async tx => ({
    run: await one(tx, sql`select id,status,error_code,created_at,started_at,completed_at from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
    attempts: await rows(tx, sql`select id,status,accepted,error_code,duration_ms,remote_model,actual_cost,created_at,updated_at,
      metadata->>'purpose' purpose,metadata->'usage' usage,metadata->'agentUsage' agent_usage,metadata->'providerFailure' provider_failure,
      (select jsonb_agg(k) from jsonb_object_keys(coalesce(metadata,'{}'::jsonb)) k) metadata_keys
      from app.ai_provider_attempts where enterprise_id=1454 and assistant_run_id=${runId} order by id`),
    job: await one(tx, sql`select id,status,attempts,last_error,provider_started_at,heartbeat_at,lease_expires_at from app.assistant_jobs where enterprise_id=1454 and run_id=${runId}`),
    steps: await rows(tx, sql`select step_seq,kind,status,input_summary,created_at,updated_at from app.assistant_run_steps
      where enterprise_id=1454 and run_id=${runId} and kind in ('agent_model','agent_validation','agent_explanation_review') order by step_seq`),
    reservation: await one(tx, sql`select status,reserved_tokens,settled_tokens,reserved_cost_micros,settled_cost_micros from app.assistant_quota_reservations where enterprise_id=1454 and run_id=${runId}`),
  }));
  assert.ok(result.run);
  const file = path.resolve('../tmp/v1-01-weiyun-jingyi/explanation-implementation/audit-' + runId + '.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ run: result.run, attempts: result.attempts, job: result.job, reservation: result.reservation }));
} finally { await closePostgresPool(); } }
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
