import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
async function main() {
  const r = await withTenantTransaction('1454', tx => rows(tx, sql`select r.id,r.kind,r.latest_revision,r.created_at,
    v.body_run_id, (v.body is not null) has_body, br.status body_status, br.error_code body_error,
    d.state delivery_state, d.read_at
    from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
    left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision and d.binding_id=r.binding_id
    where r.enterprise_id='1454' and r.binding_id=422 and r.kind='daily' order by r.id desc limit 4`));
  console.log('DAILY ' + JSON.stringify(r));
}
main().finally(() => closePostgresPool());
