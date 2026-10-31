import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, principalKey, type ActorContext } from '@/lib/assistant/contracts';
import { deliveryActor, followupAvailable, followupProjects, type FollowupAudience } from './report-scope';

export async function ensureFollowupBinding(tx: PostgresTransaction, eid: string, recipient: { kind: 'user' | 'admin'; id: string;
  audience: FollowupAudience; projectId?: string }) {
  const who = recipient.kind + ':' + recipient.id, scope = recipient.projectId ? 'project:' + recipient.projectId : 'enterprise';
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`followup:${eid}:${who}:${recipient.audience}:${scope}`},0))`);
  const old = await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${who}
    and audience=${recipient.audience} and scope_key=${scope} for update`);
  // An automatic discovery is never consent to resurrect a stopped/deleted chat.
  if (old) return old;
  const c = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
    select ${eid},'construction_followup',${JSON.stringify({ kind: 'construction_followup', audience: recipient.audience, scope })}::jsonb,policy_version
    from app.assistant_enterprise_settings where enterprise_id=${eid} returning *`))!;
  if (!c) fail('assistant_disabled', 403);
  const b = (await one(tx, sql`insert into app.construction_followup_bindings(enterprise_id,principal_key,audience,user_id,admin_id,project_id,scope_key,conversation_id)
    values(${eid},${who},${recipient.audience},${recipient.kind === 'user' ? recipient.id : null},${recipient.kind === 'admin' ? recipient.id : null},
      ${recipient.projectId || null},${scope},${String(c.id)}) returning *`))!;
  await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,admin_id,grant_basis)
    values(${eid},${String(c.id)},${recipient.kind},${recipient.kind === 'user' ? recipient.id : null},${recipient.kind === 'admin' ? recipient.id : null},
    ${JSON.stringify({ kind: 'construction_followup', bindingId: String(b.id) })}::jsonb)`);
  return b;
}
export async function bindingForActor(tx: PostgresTransaction, actor: ActorContext, bindingId: string, includeDeleted = false) {
  const b = await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${actor.enterpriseId} and id=${bindingId}
    and principal_key=${principalKey(actor)} ${includeDeleted ? sql`` : sql`and status<>'deleted'`} for update`);
  if (!b) fail('assistant_resource_not_found', 404);
  return b;
}
export async function enqueueReport(tx: PostgresTransaction, eid: string, binding: Row, settings: Row, input: {
  kind: 'daily' | 'weekly' | 'stage'; start: Date; end: Date; cutoff: Date; scheduledAt: Date; stageEventId?: string;
}, correction?: Row) {
  if (binding.status !== 'enabled') return null;
  if (!await followupAvailable(tx, eid, binding)) return null;
  let projects = await followupProjects(tx, eid, binding, true, settings.project_ids as string[], settings.stage_keys as string[]);
  if (input.stageEventId) {
    const event = await one(tx, sql`select aggregate_id from app.domain_event_outbox where enterprise_id=${eid} and id=${input.stageEventId} and type='construction.stage.updated.v1'`);
    projects = projects.filter(p => String(p.id) === String(event?.aggregate_id));
  }
  if (!projects.length) return null;
  const reportKey = fingerprint({ kind: input.kind, start: input.start.toISOString(), end: input.end.toISOString(), event: input.stageEventId || null });
  const report = correction || await one(tx, sql`insert into app.construction_reports(enterprise_id,binding_id,report_key,kind,period_start,period_end,cutoff_at,scheduled_at,stage_event_id)
    values(${eid},${String(binding.id)},${reportKey},${input.kind},${input.start},${input.end},${input.cutoff},${input.scheduledAt},${input.stageEventId || null})
    on conflict(enterprise_id,binding_id,report_key) do nothing returning *`);
  if (!report) return null;
  const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(binding.conversation_id)} for update`))!;
  const assistant = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
  const revision = Number(report.latest_revision), actor = deliveryActor(eid, binding);
  const run = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_schedule_key,purpose,policy_snapshot,context_revision,knowledge_epoch)
    values(${eid},${String(c.id)},'scheduled_task',${`report:${String(report.id)}:${revision}`},'construction.report.facts',
      ${JSON.stringify({ actor, policyVersion: Number(assistant.policy_version), localWorkflow: 'construction-report-facts-v1', reportId: String(report.id), revision,
        scope: { project_ids: settings.project_ids, stage_keys: settings.stage_keys }, reportSettingsVersion: settings.version })}::jsonb,
      ${Number(c.context_revision)},${Number(assistant.knowledge_epoch)}) returning id`))!;
  await tx.execute(sql`insert into app.construction_report_versions(enterprise_id,report_id,revision,run_id,period_end,cutoff_at)
    values(${eid},${String(report.id)},${revision},${String(run.id)},${input.end},${input.cutoff})`);
  await tx.execute(sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key)
    values(${eid},'chat_turn',${String(run.id)},${`construction-report:${String(report.id)}:${revision}`})`);
  return { reportId: String(report.id), revision, runId: String(run.id), conversationId: String(c.id) };
}
export async function discoverFollowups(tx: PostgresTransaction, eid: string, settings: Row) {
  const projects = await rows(tx, sql`select p.id,l.customer_user_id from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.status='active' and l.archived_at is null
    and (jsonb_array_length(${JSON.stringify(settings.project_ids)}::jsonb)=0 or ${JSON.stringify(settings.project_ids)}::jsonb ? p.id::text)
    and (jsonb_array_length(${JSON.stringify(settings.stage_keys)}::jsonb)=0 or ${JSON.stringify(settings.stage_keys)}::jsonb ? p.current_stage_key)
    order by p.id limit 21 for share of p,l`);
  if (projects.length > 20) fail('construction_report_scope_too_large', 409);
  const result: Row[] = [];
  for (const p of projects) {
    if (p.customer_user_id && (await one(tx, sql`select customer_access from app.construction_projects where enterprise_id=${eid} and id=${String(p.id)}`))?.customer_access)
      result.push(await ensureFollowupBinding(tx, eid, { kind: 'user', id: String(p.customer_user_id), audience: 'customer', projectId: String(p.id) }));
  }
  const staff = await rows(tx, sql`select a.id,a.role from app.admin_users a where a.enterprise_id=${eid} and a.status='active'
    and a.role in ('enterprise_admin','construction_staff','designer')
    and (a.role='enterprise_admin' or exists(select 1 from app.construction_members m where m.enterprise_id=a.enterprise_id and m.admin_id=a.id and m.active
      and ${JSON.stringify(projects.map(p => String(p.id)))}::jsonb ? m.project_id::text)) order by a.id limit 201`);
  if (staff.length > 200) fail('construction_report_scope_too_large', 409);
  for (const a of staff) {
    if (!(await one(tx, sql`select app.construction_followup_staff_access(${String(a.id)}::bigint,${eid}::bigint) as role`))?.role) continue;
    result.push(await ensureFollowupBinding(tx, eid, { kind: 'admin', id: String(a.id), audience: a.role === 'enterprise_admin' ? 'boss' : a.role === 'designer' ? 'designer' : 'worker' }));
  }
  // Platform administrators participate only after explicit selected-enterprise opt-in.
  result.push(...await rows(tx, sql`select b.* from app.construction_followup_bindings b join app.admin_users a on a.id=b.admin_id
    where b.enterprise_id=${eid} and b.audience='boss' and a.role in ('admin','super_admin') and b.status='enabled'`));
  return result;
}
