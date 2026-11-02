import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { newRun } from '@/lib/assistant/core/conversation';
import { deliveryActor, followupAvailable } from './report-scope';
import { reportCompositionProtocol } from './report-composition';

/** Called in the original facts transaction. A quota rejection must not roll
 * back facts/delivery or release anybody else's unresolved reservation. */
export async function enqueueReportBody(tx: PostgresTransaction, eid: string, reportId: string, revision: number) {
  const v = await one(tx, sql`select v.*,r.binding_id from app.construction_report_versions v join app.construction_reports r
    on r.enterprise_id=v.enterprise_id and r.id=v.report_id where v.enterprise_id=${eid} and v.report_id=${reportId}
    and v.revision=${revision} and v.status='facts_ready' for update of v`);
  if (!v) fail('context_changed');
  if (v.knowledge_status === 'ready') return { runId: String(v.body_run_id), status: 'ready' };
  if (Number(v.body_attempts) >= 3) fail('context_changed');
  if (v.body_run_id) {
    const old = await one(tx, sql`select r.status,j.provider_started_at,exists(select 1 from app.assistant_usage_records u
      where u.enterprise_id=r.enterprise_id and u.run_id=r.id and u.category='query_embedding' and u.quantity is null) as query_unknown from app.assistant_runs r join app.assistant_jobs j
      on j.enterprise_id=r.enterprise_id and j.run_id=r.id where r.enterprise_id=${eid} and r.id=${String(v.body_run_id)} for update of r,j`);
    // A known model result is already durable. Retrying it is not a new free
    // generation; only an explicit pre-dispatch failure can create another run.
    if (old && ['queued','running'].includes(String(old.status))) return { runId: String(v.body_run_id), status: String(old.status) };
    if (!old || old.status !== 'failed' || old.provider_started_at || old.query_unknown) fail('context_changed');
  }
  const b = await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(v.binding_id)} and status='enabled' for update`);
  const settings = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for update`);
  const plan = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for share`);
  if (!b || !settings || !plan || !await followupAvailable(tx, eid, b)) fail('context_changed');
  const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(b.conversation_id)} for update`);
  const parent = await one(tx, sql`select context_revision,conversation_id,policy_snapshot from app.assistant_runs where enterprise_id=${eid} and id=${String(v.run_id)}`);
  if (!c || !parent || c.id !== parent.conversation_id || c.context_revision !== parent.context_revision
    || Number((parent.policy_snapshot as Row).reportDispatchEpoch || 1) !== Number(plan.dispatch_epoch)) fail('context_changed');
  const recipient = deliveryActor(eid, b);
  const actor = { ...recipient, capabilities: [...recipient.capabilities, 'assistant.followup.self',
    recipient.principal.kind === 'user' ? 'assistant.chat.self' : 'assistant.preview.self'] };
  await tx.execute(sql`savepoint report_body_admission`);
  try {
    const result = await newRun(tx, actor, c, settings, null, v.body_run_id ? String(v.body_run_id) : undefined,
      { kind: 'scheduled_task', occurrenceKey: `report-body:${reportId}:${revision}:${v.body_run_id || 'initial'}` }, 'construction.report.compose',
      { protocol: reportCompositionProtocol, reportId, revision, bindingId: String(b.id), dispatchEpoch: Number(plan.dispatch_epoch), factsHash: String(v.facts_hash) });
    await tx.execute(sql`update app.construction_report_versions set body_run_id=${result.runId},knowledge_status='queued',body_error_code=null,body_attempts=body_attempts+1
      where enterprise_id=${eid} and report_id=${reportId} and revision=${revision}`);
    await tx.execute(sql`release savepoint report_body_admission`);
    return result;
  } catch (error) {
    await tx.execute(sql`rollback to savepoint report_body_admission`);
    await tx.execute(sql`release savepoint report_body_admission`);
    const code = error instanceof AssistantError ? error.code : 'construction_report_enqueue_unavailable';
    const cause = error as { code?: string; cause?: { code?: string } };
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
      values(${eid},${String(v.run_id)},720,'report_body_admission','failed',
      ${JSON.stringify({ code, databaseCode: cause.cause?.code || cause.code || null, providerDispatched: false })}::jsonb)
      on conflict(enterprise_id,run_id,step_seq) do nothing`);
    await tx.execute(sql`update app.construction_report_versions set knowledge_status='failed',body_error_code=${code}
      where enterprise_id=${eid} and report_id=${reportId} and revision=${revision}`);
    return { runId: null, status: 'failed', errorCode: code };
  }
}
