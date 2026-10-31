import { sql, type SQL } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { reportDayStart } from './report-calendar';
import { hasLateReportRecord, projectReportFacts, type ReportFacts } from './report-scope';
import { enqueueReportCorrection } from './report-store';

const consumer = 'construction:report-day-close';
/** Reuse the facts-ready outbox and its durable consumer receipt. At most seven
 * closed Shanghai days are eligible; each tick examines twenty saved reports.
 * A consumed no-change/revoked snapshot cannot starve later recipients. */
export function dailySupplementCandidates(eid: string | SQL, now: Date) {
  const today = reportDayStart(now);
  return sql`from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    join app.assistant_conversations c on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id
    join app.domain_event_outbox event on event.enterprise_id=r.enterprise_id and event.aggregate_id=r.id::text
      and event.aggregate_version=r.latest_revision and event.type='construction.report.facts_ready.v1'
    where r.enterprise_id=${eid} and r.kind='daily' and r.period_start>=${new Date(today - 7 * 86400000)} and r.period_start<${new Date(today)}
    and v.period_end<r.period_start+interval '24 hours' and v.status='facts_ready' and run.status='succeeded'
    and b.status='enabled' and c.id=run.conversation_id and c.context_revision=run.context_revision
    and coalesce(c.entry_snapshot->>'retentionRedacted','false')<>'true'
    and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=r.enterprise_id and d.event_id=event.id and d.consumer_key=${consumer})`;
}

export async function supplementClosedDailyReports(tx: PostgresTransaction, eid: string, settings: Row, now: Date) {
  const candidates = await rows(tx, sql`select r.*,v.period_end as fact_period_end,v.facts,v.generated_at,event.id as event_id
    ${dailySupplementCandidates(eid, now)} order by r.period_start,r.id limit 20 for update of r skip locked`);
  let queued = 0;
  for (const r of candidates) {
    const receipt = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
      values(${eid},${String(r.event_id)},${consumer},'processing') on conflict do nothing returning id`);
    if (!receipt) continue;
    const b = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(r.binding_id)} for update`))!;
    const end = new Date(new Date(String(r.period_start)).getTime() + 86400000);
    const facts = await projectReportFacts(tx, eid, b, r.facts as ReportFacts, new Date(String(r.generated_at)));
    if (facts.projects.length && await hasLateReportRecord(tx, eid, b, facts, new Date(String(r.fact_period_end)), end)) {
      if (await enqueueReportCorrection(tx, eid, r, settings, end, true)) queued++;
    }
    // This acknowledges the internal day-close check, never a user message/read.
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(receipt.id)}`);
  }
  return queued;
}
