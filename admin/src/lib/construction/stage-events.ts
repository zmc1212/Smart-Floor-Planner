import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';

/** Lock the project before the fresh latest-event check. A correction away and
 * back to the same key must never revive an older event. */
export async function currentStageEvent(tx: PostgresTransaction, eid: string, eventId: string, notesOnly = false) {
  const event = await one(tx, sql`select e.*,p.current_stage_key as project_stage_key,p.status as project_status,
      p.progress_revision as project_progress_revision
    from app.domain_event_outbox e join app.construction_projects p on p.enterprise_id=e.enterprise_id and p.id::text=e.aggregate_id
    where e.enterprise_id=${eid} and e.id=${eventId} and e.type='construction.stage.updated.v1' for share of p`);
  if (!event || event.project_stage_key !== (event.payload as Row).stageKey) return;
  const newer = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.stage.updated.v1' and aggregate_id=${String(event.aggregate_id)}
    and aggregate_version>${Number(event.aggregate_version)} limit 1`);
  if (newer) return;
  if (!notesOnly || Number(event.project_progress_revision) === Number(event.aggregate_version)) return event;
  // Ordinary notices retain their original progress/revocation boundary. Prove
  // every intervening revision is a real note change from existing service
  // audits, rather than accepting any same-key revision (e.g. revoke/regrant).
  // Join timestamps inside PostgreSQL: JS Date loses sub-millisecond precision.
  const audits = await rows(tx, sql`with origin as (
    select a.snapshot->>'expectedVersion' as version from app.construction_audits a
    join app.domain_event_outbox e on e.enterprise_id=a.enterprise_id and e.id=${eventId} and e.aggregate_id=a.project_id::text
    where a.enterprise_id=${eid} and a.project_id=${String(event.aggregate_id)} and a.action='progress'
      and a.created_at=e.created_at and a.snapshot->>'stageKey'=e.payload->>'stageKey'
    order by a.id desc limit 1)
    select a.snapshot from app.construction_audits a,origin o
    where a.enterprise_id=${eid} and a.project_id=${String(event.aggregate_id)} and a.action='progress'
      and (a.snapshot->>'expectedVersion')::bigint>=o.version::bigint
    order by (a.snapshot->>'expectedVersion')::bigint,a.id`);
  if (!audits.length) return;
  let note = String((audits[0].snapshot as Row).note ?? '').trim(), revisions = 0;
  for (const audit of audits.slice(1)) {
    const input = audit.snapshot as Row;
    if (input.stageKey !== event.project_stage_key) return;
    const next = String(input.note ?? '').trim();
    if (next !== note) revisions++;
    note = next;
  }
  return Number(event.aggregate_version) + revisions === Number(event.project_progress_revision) ? event : undefined;
}
