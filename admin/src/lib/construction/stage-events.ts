import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { siteAccessRevoked } from './site-access';

type ProgressAnchor = { stageKey: string; progressRevision: number; projectVersion: number; progressNote: string };

function stageEventAudit(tx: PostgresTransaction, eid: string, eventId: string, projectId: string) {
  return one(tx, sql`select a.id,a.snapshot from app.construction_audits a
    join app.domain_event_outbox e on e.enterprise_id=a.enterprise_id and e.id=${eventId} and e.aggregate_id=a.project_id::text
    where a.enterprise_id=${eid} and a.project_id=${projectId} and a.action='progress'
    and a.created_at=e.created_at and a.snapshot->>'stageKey'=e.payload->>'stageKey'
    order by a.id desc limit 1`);
}

/** A server-owned stage/review snapshot may survive later note edits, while
 * every non-note progress revision keeps its original revocation semantics. */
export async function notesPreserveProgress(tx: PostgresTransaction, eid: string, projectId: string, anchor: ProgressAnchor) {
  const project = await one(tx, sql`select current_stage_key,progress_revision,version from app.construction_projects
    where enterprise_id=${eid} and id=${projectId} for share`);
  if (!project || project.current_stage_key !== anchor.stageKey || Number(project.version) < anchor.projectVersion
    || Number(project.progress_revision) < anchor.progressRevision) return false;
  const audits = await rows(tx, sql`select snapshot from app.construction_audits
    where enterprise_id=${eid} and project_id=${projectId} and action='progress'
      and (snapshot->>'expectedVersion')::bigint>=${anchor.projectVersion}
    order by (snapshot->>'expectedVersion')::bigint,id`);
  let note = anchor.progressNote, revision = anchor.progressRevision;
  for (const audit of audits) {
    const input = audit.snapshot as Row;
    if (input.stageKey !== anchor.stageKey || input.sendReminder === true) return false;
    const next = String(input.note ?? '').trim();
    if (next !== note) revision++;
    note = next;
  }
  return revision === Number(project.progress_revision);
}

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
  const origin = await stageEventAudit(tx, eid, eventId, String(event.aggregate_id));
  if (!origin) return;
  const input = origin.snapshot as Row;
  return await notesPreserveProgress(tx, eid, String(event.aggregate_id), { stageKey: String(event.project_stage_key),
    progressRevision: Number(event.aggregate_version), projectVersion: Number(input.expectedVersion) + 1,
    progressNote: String(input.note ?? '').trim() }) ? event : undefined;
}

/** Only the latest event of an active construction stage may produce a new
 * private reminder. A pause/resume cannot revive the old event. */
export async function currentReportStageEvent(tx: PostgresTransaction, eid: string, eventId: unknown, recipient?: Row) {
  if (!eventId) return;
  const event = await currentStageEvent(tx, eid, String(eventId), true);
  if (event?.project_status !== 'active' || ['completion', 'move_in'].includes(String(event.project_stage_key))) return;
  if (recipient?.admin_id && (recipient.audience === 'worker' || recipient.audience === 'designer')) {
    const projectId = String(event.aggregate_id);
    const origin = await stageEventAudit(tx, eid, String(event.id), projectId);
    // Both audits are inserted under the project lock. Transaction timestamps
    // can be out of order when a concurrent member update waits for that lock.
    if (!origin || await siteAccessRevoked(tx, eid, projectId, [String(recipient.admin_id)], { afterAuditId: String(origin.id) })) return;
  }
  return event;
}
