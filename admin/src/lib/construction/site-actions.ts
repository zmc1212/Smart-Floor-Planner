import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { cancelRuns, newRun } from '@/lib/assistant/core/conversation';
import { runUsageReconciled, unresolvedProviderOutcome } from '@/lib/assistant/core/usage-review';
import { agentConfig } from '@/lib/assistant/agent/config';
import { currentRecord, executeSiteIssue, projectSiteIssues, readSiteIssue, parseSiteVersions, type SiteVersions } from './site-issues';
import { sharedMaterials } from './site-materials';
import { siteActionAcknowledgement, siteActionConfirmation, type SiteAction } from './site-action-contract';
import { executePlanCommand, preparePlanPublication, readPlan, planText } from './site-plans';
import { naturalPlanInput } from './site-plan-input';
import { SiteChatService } from './site-chat';

export const siteActionWaiting = '原话已保留在本项目。需要查资料时请说明房间；现场进展可直接发文字或照片。';
const unavailable = '原材料或权限已变化，请重新读取并核对。';
type Marker = { runId: string; sourceMessageId: string; sourceHash: string; status: string };
export type SiteActionProposal = { runId: string; projectId: string; projectVersion: number; conversationId: string; sourceMessageId: string; sourceHash: string;
  actor: ActorContext; selection: SiteAction; versions: SiteVersions; targetHash: string; originalText: string; roomName: string; expiresAt: string; mediaIds?: string[] };
const proposalType = 'construction.site.action.proposed.v1';
const confirmedType = 'construction.site.action.confirmed.v1';
const aid = (actor: ActorContext) => { if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403); return actor.principal.adminId; };
export async function siteActionMarker(tx: PostgresTransaction, actor: ActorContext, cid: string) {
  const c = await one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${cid} for update`);
  return ((c?.entry_snapshot as Row)?.siteActionProposals as Row)?.[aid(actor)] as Marker | undefined;
}
async function marker(tx: PostgresTransaction, actor: ActorContext, cid: string, value: Marker) {
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{siteActionProposals}',
    coalesce(entry_snapshot->'siteActionProposals','{}'::jsonb)||jsonb_build_object(${aid(actor)}::text,${JSON.stringify(value)}::jsonb))
    where enterprise_id=${actor.enterpriseId} and id=${cid}`);
}
/** Any new substantive message cancels only this member's unconfirmed request.
 * An in-flight provider hold is retained by the existing cancellation service. */
export async function invalidateSiteAction(tx: PostgresTransaction, actor: ActorContext, cid: string, raw: string) {
  if (siteActionAcknowledgement(raw)) return;
  const previous = await siteActionMarker(tx, actor, cid);
  if (!previous || !['processing', 'pending'].includes(previous.status)) return;
  const run = await one(tx, sql`select id from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${cid}
    and id=${previous.runId} and purpose='site.action' and policy_snapshot->'actor'->'principal'->>'adminId'=${aid(actor)}`);
  if (!run) fail('context_changed');
  await cancelRuns(tx, actor, cid, previous.runId);
  await marker(tx, actor, cid, { ...previous, status: 'cancelled' });
}
export async function requestSiteAction(tx: PostgresTransaction, actor: ActorContext, c: Row, settings: Row, message: Row) {
  if (!agentConfig(settings.agent_config)?.tools) return null;
  const actorId = aid(actor), cid = String(c.id);
  if (await one(tx, sql`select r.id from app.assistant_runs r where r.enterprise_id=${actor.enterpriseId} and r.conversation_id=${cid}
    and r.purpose='site.action' and r.policy_snapshot->'actor'->'principal'->>'adminId'=${actorId}
    and (${unresolvedProviderOutcome()} or (r.status='cancelled' and exists(select 1 from app.assistant_jobs j
      where j.enterprise_id=r.enterprise_id and j.run_id=r.id and j.provider_started_at is not null)
      and not exists(select 1 from app.assistant_usage_records u where u.enterprise_id=r.enterprise_id and u.run_id=r.id and u.category='tokens' and u.quantity is not null)))
    and not ${runUsageReconciled()} limit 1`)) fail('provider_outcome_unknown');
  const result = await newRun(tx, actor, c, settings, String(message.id), undefined, { kind: 'user_message', messageId: String(message.id) }, 'site.action');
  await marker(tx, actor, cid, { runId: result.runId, sourceMessageId: String(message.id), sourceHash: fingerprint(message.content), status: 'processing' });
  return result;
}
export async function siteActionRequest(tx: PostgresTransaction, actor: ActorContext, cid: string, runId: string) {
  const row = await one(tx, sql`select e.payload,m.id,m.content from app.domain_event_outbox e join app.assistant_messages m
    on m.enterprise_id=e.enterprise_id and m.id::text=e.aggregate_id and m.conversation_id=${cid}
    where e.enterprise_id=${actor.enterpriseId} and e.type='construction.chat.response.v1' and e.payload->>'actionRunId'=${runId}
      and e.payload->>'conversationId'=${cid} and m.author_kind='admin' and m.admin_id=${aid(actor)} for share of m`);
  if (!row) fail('context_changed');
  const current = await siteActionMarker(tx, actor, cid), payload = row.payload as Row;
  if (!current || current.runId !== runId || current.sourceMessageId !== String(row.id) || !['processing', 'pending'].includes(current.status)
    || current.sourceHash !== fingerprint(row.content) || payload.sourceHash !== current.sourceHash) fail('context_changed');
  const project = await one(tx, sql`select version from app.construction_projects where enterprise_id=${actor.enterpriseId} and id=${String(payload.projectId)} for share`);
  if (!project || Number(project.version) !== payload.actionProjectVersion) fail('context_changed');
  return { row, projectId: String(payload.projectId), projectVersion: Number(project.version), versions: parseSiteVersions(payload.actionVersions), sourceHash: current.sourceHash,
    mediaIds: (payload.mediaIds || []) as string[] };
}
export async function siteActionContext(tx: PostgresTransaction, eid: string, pid: string, versions: SiteVersions) {
  const rooms = await rows(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} order by id`);
  const records = [];
  for (const recordId of Object.keys(versions.records).sort((a, b) => BigInt(a) > BigInt(b) ? -1 : 1).slice(0, 12)) {
    const record = await currentRecord(tx, eid, pid, recordId);
    if (record && Number(record.row.version) === versions.records[recordId]) records.push({ id: recordId, room: record.row.room_name_snapshot,
      original: safeText(record.row.content as MessageContent).slice(0, 1000), data: record.row.data });
  }
  const issues = (await projectSiteIssues(tx, eid, pid)).filter(i => versions.issues[i.issueId] === i.revision && i.sourceAvailable && !['cancelled', 'implemented', 'resolved', 'closed'].includes(i.status)).slice(0, 12);
  const candidates = [];
  for (const i of issues) {
    const materials = i.roomId ? await sharedMaterials(tx, eid, pid, i.roomId) : null;
    const sources = materials && materials.version === versions.materials?.[i.roomId!] ? materials.sources : [];
    candidates.push({ id: i.issueId, room: i.roomName, status: i.status, ownerId: i.ownerId, text: i.text.slice(0, 1500),
      drawings: sources.filter(s => s.kind === 'drawing').map(s => ({ id: s.id, description: s.text.slice(0, 500) })),
      originalConsultation: sources.find(s => s.kind === 'need')?.conversationId || '' });
  }
  return { rooms, records, issues: candidates };
}
async function target(tx: PostgresTransaction, proposal: Pick<SiteActionProposal, 'projectId' | 'projectVersion' | 'actor' | 'selection' | 'versions'>
  & Partial<Pick<SiteActionProposal, 'originalText' | 'sourceMessageId' | 'mediaIds'>>) {
  const { projectId: pid, actor, selection, versions } = proposal, eid = actor.enterpriseId;
  const project = await one(tx, sql`select version from app.construction_projects where enterprise_id=${eid} and id=${pid} for share`);
  if (!project || Number(project.version) !== proposal.projectVersion) fail('context_changed');
  if (selection.action === 'plan') {
    const input = naturalPlanInput(proposal.originalText || '', selection.target, selection.plan!, proposal.mediaIds || []);
    if (!input.command || !proposal.sourceMessageId || actor.principal.kind !== 'admin') fail('invalid_plan', 422);
    const service = new SiteChatService({ enterpriseId: eid, adminId: actor.principal.adminId,
      miniProgramUserId: actor.entry?.miniProgramUserId as string | undefined, miniProgramContextVersion: actor.entry?.miniProgramContextVersion as number | undefined }, tx);
    const plan = await service.withWriteScope(pid, (inner, _c, _p, permission) =>
      preparePlanPublication(inner, actor, pid, proposal.sourceMessageId!, input.command!, proposal.mediaIds || [], versions, permission.manage));
    return { hash: fingerprint(plan), roomName: plan.roomName, plan,
      text: `正式方案待发布 · V${plan.number} · ${plan.roomName}\n名称：${plan.title}\n完整变更原话：${plan.difference}\n费用变化：${(plan.costDeltaCents / 100).toFixed(2)}元；工期变化：${plan.scheduleDeltaDays}天。\n原咨询：${plan.conversationId}；原图：${plan.mediaId}。新版不继承旧版预览或决定。` };
  }
  if (['none', 'report'].includes(selection.action)) return null;
  if (selection.action === 'open') {
    const r = await currentRecord(tx, eid, pid, selection.target);
    if (!r || Number(r.row.version) !== versions.records[selection.target]) fail('context_changed');
    return { hash: r.hash, roomName: String(r.row.room_name_snapshot), text: safeText(r.row.content as MessageContent) };
  }
  const issue = await readSiteIssue(tx, eid, pid, selection.target);
  if (!issue || !issue.sourceAvailable || issue.revision !== versions.issues[selection.target]
    || ['cancelled', 'implemented', 'resolved', 'closed'].includes(issue.status)) fail('context_changed');
  const materials = issue.roomId ? await sharedMaterials(tx, eid, pid, issue.roomId) : null;
  if (issue.roomId && ['reply', 'check', 'return'].includes(selection.action) && materials?.version !== versions.materials?.[issue.roomId]) fail('context_changed');
  if (selection.action === 'check') {
    const drawings = materials?.sources.filter(s => s.kind === 'drawing') || [];
    if (drawings.length !== 1) fail('site_review_required', 422);
    const drawing = drawings[0];
    return { hash: fingerprint({ issue, drawing }), roomName: issue.roomName, drawingGrantId: drawing.id,
      text: issue.text + `\n本次人工核对关联：图纸资料${drawing.id}，${drawing.text}；原资料版本${materials!.version}。` };
  }
  if (selection.action === 'return') {
    const need = materials?.sources.find(s => s.kind === 'need'); if (!need) fail('site_review_required', 422);
    return { hash: fingerprint({ issue, need }), roomName: issue.roomName,
      text: issue.text + `\n回传目标：原咨询${need.conversationId}，需求资料${need.id}；仅回传下面你的本条原话，内部对话不会自动复制。` };
  }
  return { hash: fingerprint(issue), roomName: issue.roomName, text: issue.text };
}
export async function proposeSiteAction(tx: PostgresTransaction, actor: ActorContext, c: Row, pid: string, runId: string, selection: SiteAction, manage = false) {
  const request = await siteActionRequest(tx, actor, String(c.id), runId);
  if (request.projectId !== pid) fail('context_changed');
  if (selection.action === 'none') { await marker(tx, actor, String(c.id), { runId, sourceMessageId: String(request.row.id), sourceHash: request.sourceHash, status: 'none' }); return siteActionWaiting; }
  if (selection.action === 'report') {
    const settings = (await new AssistantRepository(tx, actor).settings(true))!;
    const next = await newRun(tx, actor, c, settings, String(request.row.id), undefined, { kind: 'user_message', messageId: String(request.row.id) }, 'site.record');
    const record = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,run_id)
      values(${actor.enterpriseId},${pid},${String(c.id)},${String(request.row.id)},${aid(actor)},${next.runId}) returning id`))!;
    const mediaIds = (request.row.payload as Row).mediaIds as string[];
    for (const [position, mid] of mediaIds.entries()) {
      if (!await one(tx, sql`select id from app.construction_site_media m where enterprise_id=${actor.enterpriseId} and project_id=${pid} and id=${mid}
        and uploader_id=${aid(actor)} and deleted_at is null and not exists(select 1 from app.construction_site_attachments a where a.enterprise_id=m.enterprise_id and a.project_id=m.project_id and a.media_id=m.id) for share`)) fail('context_changed');
      await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${actor.enterpriseId},${pid},${String(record.id)},${mid},${position})`);
    }
    await marker(tx, actor, String(c.id), { runId, sourceMessageId: String(request.row.id), sourceHash: request.sourceHash, status: 'report' });
    return siteActionWaiting;
  }
  const originalText = safeText(request.row.content as MessageContent);
  if (selection.action === 'plan') {
    const input = naturalPlanInput(originalText, selection.target, selection.plan!, request.mediaIds);
    if (input.missing.length) {
      await marker(tx, actor, String(c.id), { runId, sourceMessageId: String(request.row.id), sourceHash: request.sourceHash, status: 'none' });
      return `正式方案还缺：${input.missing.join('、')}。请补齐本次方案的原图和说明后重新提交，我会先给你核对预览；费用和工期不会按默认值填写。本次尚未发布。`;
    }
  }
  const current = await target(tx, { actor, projectId: pid, projectVersion: request.projectVersion, selection, versions: request.versions,
    originalText, sourceMessageId: String(request.row.id), mediaIds: request.mediaIds });
  if (selection.action === 'return' && !manage) fail('construction_forbidden', 403);
  const proposal: SiteActionProposal = { runId, projectId: pid, projectVersion: request.projectVersion, conversationId: String(c.id), sourceMessageId: String(request.row.id), sourceHash: request.sourceHash,
    actor, selection, versions: request.versions, targetHash: current!.hash, originalText, roomName: current!.roomName,
    ...(selection.action === 'plan' ? { mediaIds: request.mediaIds } : {}),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
  const verb = { open: '跟进', claim: '接手', reply: '回复', check: '核对图纸', return: '回传', plan: '发布方案' }[selection.action];
  const consequence = selection.action === 'plan' ? '确认后会向上述原咨询发布这张原图、完整变更原话及费用／工期影响，由客户对本版本决定；不会批准施工或自动落实／关闭事项。'
    : selection.action === 'return' ? '确认后会向上述原咨询回传你的本条节选，不代表方案、费用、工期、施工或验收批准。' : '这不会发布给业主或批准施工。';
  const text = `待你核对：${verb}${selection.action === 'open' ? '记录' : '事项'}${selection.target}（${proposal.roomName}）。\n${current!.text}\n你的原话：${proposal.originalText}\n尚未执行。确认请回复“确认${verb}”；取消这次操作可回复“取消这次操作”。${consequence}`;
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},${proposalType},'assistant_run',${runId},1,${JSON.stringify(actor.principal)}::jsonb,${proposal.sourceMessageId},${JSON.stringify(proposal)}::jsonb)`);
  await marker(tx, actor, String(c.id), { runId, sourceMessageId: proposal.sourceMessageId, sourceHash: proposal.sourceHash, status: 'pending' });
  return text;
}
export async function confirmSiteAction(tx: PostgresTransaction, actor: ActorContext, c: Row, pid: string, message: Row, raw: string, manage: boolean) {
  const confirmation = siteActionConfirmation(raw); if (!confirmation) return null;
  const current = await siteActionMarker(tx, actor, String(c.id));
  if (confirmation === 'cancel') { await invalidateSiteAction(tx, actor, String(c.id), raw); return { text: '这次待确认操作已取消，原事项状态没有改变。' }; }
  if (!current || current.status !== 'pending') return { text: siteActionWaiting };
  const event = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${actor.enterpriseId} and type=${proposalType}
    and aggregate_type='assistant_run' and aggregate_id=${current.runId} and actor_ref=${JSON.stringify(actor.principal)}::jsonb for share`);
  if (!event) fail('context_changed');
  const proposal = event.payload as SiteActionProposal;
  if (proposal.projectId !== pid || proposal.conversationId !== String(c.id) || proposal.selection.action !== confirmation || Date.parse(proposal.expiresAt) <= Date.now()) fail('context_changed');
  await siteActionRequest(tx, actor, String(c.id), current.runId);
  const now = await target(tx, proposal); if (!now || now.hash !== proposal.targetHash) fail('context_changed');
  if (confirmation === 'plan') {
    const p = now.plan!;
    const published = await executePlanCommand(tx, actor, pid, proposal.sourceMessageId, { action: 'publish', issueId: proposal.selection.target,
      title: p.title, difference: proposal.originalText, costDeltaCents: p.costDeltaCents, scheduleDeltaDays: p.scheduleDeltaDays }, proposal.mediaIds || [], proposal.versions, manage);
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${actor.enterpriseId},${confirmedType},'assistant_run',${current.runId},1,${JSON.stringify(actor.principal)}::jsonb,${String(message.id)},
        ${JSON.stringify({ projectId: pid, conversationId: String(c.id), sourceMessageId: proposal.sourceMessageId, confirmationMessageId: String(message.id), planId: published.id })}::jsonb)`);
    await marker(tx, actor, String(c.id), { ...current, status: 'confirmed' });
    return { text: published.text, planId: published.id };
  }
  // Reuse the domain writer, original full staff statement and original seen
  // versions. The confirmation is a separate audit, never a synthetic command.
  const issue = await executeSiteIssue(tx, actor, pid, proposal.sourceMessageId,
    { action: confirmation, target: proposal.selection.target, value: confirmation === 'check' ? now.drawingGrantId! : proposal.originalText }, proposal.versions, manage);
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},${confirmedType},'assistant_run',${current.runId},1,${JSON.stringify(actor.principal)}::jsonb,${String(message.id)},
      ${JSON.stringify({ projectId: pid, conversationId: String(c.id), sourceMessageId: proposal.sourceMessageId, confirmationMessageId: String(message.id), issueId: issue.issueId, revision: issue.revision })}::jsonb)`);
  await marker(tx, actor, String(c.id), { ...current, status: 'confirmed' });
  return { text: issue.text, issue };
}
export async function readSiteActionResponse(tx: PostgresTransaction, eid: string, pid: string, cid: string, payload: Row) {
  const run = await one(tx, sql`select status,error_code,output_message_id,policy_snapshot from app.assistant_runs where enterprise_id=${eid} and conversation_id=${cid}
    and id=${String(payload.actionRunId)} and purpose='site.action'`);
  if (!run) return unavailable;
  const actor = (run.policy_snapshot as Row).actor as ActorContext;
  const original = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid} and id=${String(payload.sourceMessageId)}`);
  if (!original || fingerprint(original.content) !== payload.sourceHash) return unavailable;
  const confirmed = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and type=${confirmedType} and aggregate_id=${String(payload.actionRunId)}`);
  if (confirmed) {
    const result = confirmed.payload as Row;
    if (result.planId) { const plan = await readPlan(tx, eid, String(result.planId)); return plan?.projectId === pid ? planText(plan) : unavailable; }
    return (await readSiteIssue(tx, eid, pid, String(result.issueId)))?.text || unavailable;
  }
  const current = await siteActionMarker(tx, actor, cid);
  if (!current || current.runId !== payload.actionRunId || current.status === 'cancelled') return unavailable;
  if (['queued', 'running'].includes(String(run.status))) return siteActionWaiting;
  if (run.error_code === 'provider_outcome_unknown') return '提交结果待核对，原内容和版本已保留。';
  if (run.status !== 'succeeded') return '本次整理未完成，原话和照片已保留。可以稍后重试，或先人工核对内容。';
  const proposal = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and type=${proposalType} and aggregate_id=${String(payload.actionRunId)}`);
  if (proposal) {
    const p = proposal.payload as SiteActionProposal;
    try {
      const repo = new AssistantRepository(tx, actor); await repo.settings(true); await repo.conversation(cid);
      const value = await target(tx, p); if (Date.parse(p.expiresAt) <= Date.now() || value?.hash !== p.targetHash) return unavailable;
    } catch { return unavailable; }
  }
  const output = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid} and id=${String(run.output_message_id)} and run_id=${String(payload.actionRunId)}`);
  return output ? safeText(output.content as MessageContent) : unavailable;
}
