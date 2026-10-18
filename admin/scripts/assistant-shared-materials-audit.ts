/** Read-only audit of this batch's labelled development fixtures; never scans customer content. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

async function main() {
  loadEnvConfig(process.cwd(), true);
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname)
    && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const output = path.resolve('../tmp/xiaok-material-projection');
  const reports = fs.readdirSync(output).filter(f => /^(?:live|native-driver).*\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(output,f),'utf8'))).filter(r => r.fixture?.enterpriseId && r.prefix);
  const expected = new Map<string,string>(reports.map(r => [String(r.fixture.enterpriseId),String(r.prefix)]));
  const failures = JSON.parse(fs.readFileSync(path.join(output,'initial-failures.json'),'utf8'));
  for(const failure of failures.failures || [])if(failure.enterpriseId&&!expected.has(failure.enterpriseId))expected.set(failure.enterpriseId,'synthetic-shared-live-');
  assert.ok(expected.size>0&&expected.size<=16);
  for(const [eid,prefix] of expected){assert.match(eid,/^[1-9]\d{0,18}$/);assert.ok(prefix.startsWith('synthetic-shared-live-'));}
  const ids = JSON.stringify([...expected.keys()]);
  try {
    const result = await withPlatformTransaction(async tx => {
      const enterprises = await rows(tx, sql`select e.id::text,e.code,e.status,s.enabled,
        (select count(*)::integer from app.admin_users a where a.enterprise_id=e.id and a.status='active') active_staff,
        (select count(*)::integer from app.assistant_runs r where r.enterprise_id=e.id and r.status in ('queued','running')) active_runs,
        (select count(*)::integer from app.assistant_jobs j where j.enterprise_id=e.id and j.status in ('queued','running')) active_jobs,
        (select count(*)::integer from app.construction_site_records r where r.enterprise_id=e.id) source_records,
        (select count(*)::integer from app.domain_event_outbox o where o.enterprise_id=e.id and
          (o.type like 'construction.site.plan.%' or o.type='construction.site.issue.lifecycle.v1')) formal_events
        from app.enterprises e join app.assistant_enterprise_settings s on s.enterprise_id=e.id
        where e.id in (select value::bigint from jsonb_array_elements_text(${ids}::jsonb)) order by e.id`);
      assert.equal(enterprises.length, expected.size);
      for (const e of enterprises) {
        assert.ok(String(e.code).startsWith(expected.get(String(e.id))!)); assert.equal(e.enabled, false);
        assert.equal(e.active_staff, 0); assert.equal(e.active_runs, 0); assert.equal(e.active_jobs, 0); assert.equal(e.formal_events, 0);
      }
      const runs = await rows(tx, sql`select r.id::text,r.enterprise_id::text,r.purpose,r.status,r.error_code,r.created_at,r.completed_at,
        r.policy_snapshot->'agent'->>'runtime' runtime,r.policy_snapshot->'agent'->>'providerKey' provider,
        r.policy_snapshot->'agent'->>'model' model,
        (select s.input_summary->>'promptVersion' from app.assistant_run_steps s where s.enterprise_id=r.enterprise_id and s.run_id=r.id
          and s.kind='agent_checkpoint' order by s.step_seq desc limit 1) prompt_version
        from app.assistant_runs r where r.enterprise_id in (select value::bigint from jsonb_array_elements_text(${ids}::jsonb)) order by r.id`);
      const usage = await rows(tx, sql`select u.enterprise_id::text,u.run_id::text,r.purpose,u.category,u.measurement_kind,
        u.quantity::text,u.input_tokens::text,u.output_tokens::text,u.cost_micros::text
        from app.assistant_usage_records u join app.assistant_runs r on r.enterprise_id=u.enterprise_id and r.id=u.run_id
        where u.enterprise_id in (select value::bigint from jsonb_array_elements_text(${ids}::jsonb)) order by u.id`);
      const attempts = await rows(tx, sql`select a.id::text,a.enterprise_id::text,a.assistant_run_id::text,a.knowledge_job_id::text,
        a.capability,a.provider_key,a.adapter_type,a.remote_model,a.status,a.error_code,a.duration_ms,
        a.metadata->>'promptVersion' prompt_version
        from app.ai_provider_attempts a where a.enterprise_id in (select value::bigint from jsonb_array_elements_text(${ids}::jsonb)) order by a.id`);
      const indexUsage = await rows(tx, sql`select j.id::text,j.enterprise_id::text,j.kind,j.status,j.attempts
        from app.assistant_jobs j where j.enterprise_id in (select value::bigint from jsonb_array_elements_text(${ids}::jsonb))
        and j.kind='knowledge_index' order by j.id`);
      return { generated: new Date().toISOString(), target: 'approved development5432', scope: 'only exact synthetic fixture IDs from this batch reports',
        enterprises, runs, usage, attempts, indexJobs: indexUsage, costMicros: null,
        limits: 'Cost remains unknown. Query/text usage does not include all index work. No sample percentile/production-quality claim.' };
    });
    fs.writeFileSync(path.join(output, 'development-audit.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ fixtures: result.enterprises, runs: result.runs.length, attempts: result.attempts.length,
      usageCategories: [...new Set(result.usage.map(u => u.category))], costMicros: null }));
  } finally { await closePostgresPool(); }
}
main().catch(e => { console.error((e as Error).message); process.exitCode = 1; });
