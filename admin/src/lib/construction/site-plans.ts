import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, idempotent } from '@/lib/assistant/core/conversation';
import { object, text } from './contracts';
import { readSiteIssue, type SiteVersions } from './site-issues';
import { sharedMaterial, sharedMaterials } from './site-materials';

const publishedType = 'construction.plan.published.v1', statusType = 'construction.plan.status.v1';
export type PlanData = {
  projectId: string; issueId: string; issueRevision: number; roomId: string; roomName: string;
  conversationId: string; customerId: string; needGrantId: string; materialVersion: string;
  publisherId: string; mediaId: string; mediaHash: string; sourceMessageId: string;
  number: number; previousVersionId: string | null; title: string; difference: string; costDeltaCents: number; scheduleDeltaDays: number;
};
export type PlanView = PlanData & { id: string; revision: number; status: string; previewed: boolean; reason: string; hash: string };
type PlanCommand = { action: 'publish'; issueId: string; title: string; difference: string; costDeltaCents: number; scheduleDeltaDays: number }
  | { action: 'withdraw'; versionId: string; reason: string };

/** An explicit enterprise publication, never inferred from a customer image, AI render or an acknowledgement. */
export function planCommand(raw: string): PlanCommand | null {
  const withdraw = /^撤回方案\s*([1-9]\d{0,18})[：:]\s*([\s\S]{1,500})$/.exec(raw);
  if (withdraw) return { action: 'withdraw', versionId: id(withdraw[1]), reason: text(withdraw[2], 500) };
  const match = /^发布方案事项\s*([1-9]\d{0,18})\s*\n标题[：:]([^\n]+)\n差异[：:]([^\n]+)\n费用变化[：:]([+-]?\d+(?:\.\d{1,2})?)元\n工期变化[：:]([+-]?\d+)天\s*$/.exec(raw);
  if (!match) {
    if (/^发布方案事项\s*[1-9]\d*\s*(?:\n|[：:])/.test(raw)) fail('invalid_plan', 422);
    return null;
  }
  const costDeltaCents = Math.round(Number(match[4]) * 100), scheduleDeltaDays = Number(match[5]);
  if (!Number.isSafeInteger(costDeltaCents) || Math.abs(costDeltaCents) > 100000000 || !Number.isSafeInteger(scheduleDeltaDays) || Math.abs(scheduleDeltaDays) > 365) fail('invalid_plan', 422);
  return { action: 'publish', issueId: id(match[1]), title: text(match[2], 80), difference: text(match[3], 1200), costDeltaCents, scheduleDeltaDays };
}
export const planStatusLabels: Record<string, string> = { pending_customer: '待你决定', deferred: '稍后决定', approved: '已同意这一版', declined: '未同意这一版', changes_requested: '已要求修改', withdrawn: '已撤回' };
export function planText(p: PlanView) {
  return `方案${p.id} · V${p.number} · ${p.roomName} · ${planStatusLabels[p.status] || p.status}\n${p.title}\n差异：${p.difference}\n费用变化：${p.costDeltaCents >= 0 ? '+' : ''}${(p.costDeltaCents / 100).toFixed(2)}元；工期变化：${p.scheduleDeltaDays >= 0 ? '+' : ''}${p.scheduleDeltaDays}天。`
    + (p.reason ? `\n客户说明：${p.reason}` : '') + '\n这是此版本的方案决定；发出、客户同意与现场落实分别记录，事项尚未关闭。';
}
function customerPlanDto(p: PlanView) {
  const { id, issueId, number, previousVersionId, roomName, title, difference, costDeltaCents, scheduleDeltaDays, mediaId, revision, status, previewed, reason, hash } = p;
  return { id, issueId, number, previousVersionId, roomName, title, difference, costDeltaCents, scheduleDeltaDays, mediaId, revision, status, previewed, reason, hash };
}
async function planEvent(tx: PostgresTransaction, eid: string, versionId: string) {
  return one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${eid} and id=${versionId} and type=${publishedType}`);
}
async function latestPlan(tx: PostgresTransaction, eid: string, issueId: string) {
  return one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${eid} and type=${publishedType}
    and aggregate_type='construction_site_issue' and aggregate_id=${issueId} order by aggregate_version desc limit 1`);
}
async function state(tx: PostgresTransaction, eid: string, versionId: string) {
  const e = await one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${eid} and type=${statusType}
    and aggregate_type='construction_plan' and aggregate_id=${versionId} order by aggregate_version desc limit 1`);
  return { event: e, revision: Number(e?.aggregate_version || 1), status: String((e?.payload as Row)?.status || 'pending_customer'),
    previewed: (e?.payload as Row)?.previewed === true, reason: String((e?.payload as Row)?.reason || '') };
}
async function publisherAvailable(tx: PostgresTransaction, eid: string, p: PlanData) {
  const access = await one(tx, sql`select app.construction_actor_access(${p.publisherId}::bigint,${eid}::bigint) as role,
    exists(select 1 from app.construction_members m join app.admin_users a on a.id=m.admin_id and a.enterprise_id=m.enterprise_id
      where m.enterprise_id=${eid} and m.project_id=${p.projectId} and m.admin_id=${p.publisherId} and m.active
      and a.status='active' and m.role in ('manager','designer')) as member`);
  return access?.role === 'owner' || access?.role === 'member' && access.member === true;
}
export async function readPlan(tx: PostgresTransaction, eid: string, versionId: string): Promise<PlanView | null> {
  const event = await planEvent(tx, eid, versionId); if (!event) return null;
  const p = event.payload as PlanData, last = await latestPlan(tx, eid, p.issueId), s = await state(tx, eid, versionId);
  if (String(last?.id) !== versionId || s.status === 'withdrawn') return null;
  const issue = await readSiteIssue(tx, eid, p.projectId, p.issueId);
  if (!issue || ['invalidated','cancelled','awaiting_owner'].includes(issue.status) || issue.revision !== p.issueRevision || !issue.ownerId) return null;
  const grant = await sharedMaterial(tx, eid, p.projectId, p.needGrantId);
  if (!grant || grant.conversationId !== p.conversationId || grant.customerId !== p.customerId || grant.roomId !== p.roomId) return null;
  const materials = await sharedMaterials(tx, eid, p.projectId, p.roomId);
  if (materials.version !== p.materialVersion || !await publisherAvailable(tx, eid, p)) return null;
  const media = await one(tx, sql`select id from app.construction_site_media where enterprise_id=${eid} and project_id=${p.projectId}
    and id=${p.mediaId} and source_hash=${p.mediaHash} and deleted_at is null for share`);
  if (!media) return null;
  return { ...p, id: versionId, revision: s.revision, status: s.status, previewed: s.previewed, reason: s.reason,
    hash: fingerprint({ versionId, ...p, revision: s.revision, status: s.status, reason: s.reason }) };
}
export async function projectPlans(tx: PostgresTransaction, eid: string, pid: string) {
  const events = await rows(tx, sql`select distinct on (aggregate_id) id,payload from app.domain_event_outbox
    where enterprise_id=${eid} and type=${publishedType} and payload->>'projectId'=${pid} order by aggregate_id,aggregate_version desc limit 50`);
  const result = [];
  for (const e of events) {
    const p = await readPlan(tx, eid, String(e.id)), s = await state(tx, eid, String(e.id));
    result.push(p ? { ...customerPlanDto(p), roomId: p.roomId, sourceMessageId: p.sourceMessageId, available: true, text: planText(p) } : { id: String(e.id), revision: s.revision, available: false, status: 'invalidated', text: `方案${e.id}已撤回或依据已变化，旧版不能继续使用。` });
  }
  return result;
}
export async function handlePlan(tx: PostgresTransaction, actor: ActorContext, pid: string, messageId: string, raw: string, mediaIds: string[], versions: SiteVersions, manage: boolean) {
  const cmd = planCommand(raw); if (!cmd) return null;
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, aid = actor.principal.adminId;
  if (cmd.action === 'withdraw') {
    const e = await planEvent(tx, eid, cmd.versionId), p = e?.payload as PlanData | undefined;
    if (!p || p.projectId !== pid || !manage && p.publisherId !== aid) fail('construction_forbidden', 403);
    await one(tx, sql`select id from app.assistant_conversations where enterprise_id=${eid} and id=${p.conversationId} for share`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
    const s = await state(tx, eid, cmd.versionId);
    if (versions.plans?.[cmd.versionId] !== s.revision) fail('version_conflict');
    await writeState(tx, actor, cmd.versionId, s.revision + 1, { status: 'withdrawn', previewed: false, reason: cmd.reason, action: 'withdraw' }, messageId);
    return { id: cmd.versionId, text: `方案${cmd.versionId}已撤回：${cmd.reason}。不回退或恢复旧版同意，现场事项仍独立核对。` };
  }
  const issue = await readSiteIssue(tx, eid, pid, cmd.issueId);
  // Source conversations are locked by readSiteIssue before the material lock,
  // matching customer consent/decision order and avoiding a cross-chat cycle.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${eid}:${pid}`},0))`);
  if (!issue || issue.status !== 'awaiting_review' || !issue.roomId || !issue.ownerId) fail('site_review_required', 422);
  if (versions.issues[cmd.issueId] !== issue.revision || versions.records[issue.recordId] !== issue.recordVersion) fail('version_conflict');
  const author = await one(tx, sql`select role from app.admin_users where enterprise_id=${eid} and id=${aid} and status='active'`);
  if (!manage && (issue.ownerId !== aid || author?.role !== 'designer')) fail('construction_forbidden', 403);
  const materials = await sharedMaterials(tx, eid, pid, issue.roomId), need = materials.sources.find(s => s.kind === 'need');
  if (!need || issue.materialVersion !== materials.version || versions.materials?.[issue.roomId] !== materials.version) fail('context_changed');
  if (materials.sources.some(s => s.kind === 'drawing') && !issue.drawingGrantId) fail('site_review_required', 422);
  if (mediaIds.length !== 1) fail('plan_original_required', 422);
  const media = await one(tx, sql`select id,source_hash from app.construction_site_media where enterprise_id=${eid} and project_id=${pid}
    and id=${mediaIds[0]} and uploader_id=${aid} and deleted_at is null for share`);
  if (!media) fail('plan_original_required', 422);
  const previous = await latestPlan(tx, eid, cmd.issueId);
  if (previous && versions.plans?.[String(previous.id)] !== (await state(tx, eid, String(previous.id))).revision) fail('version_conflict');
  const p: PlanData = { projectId: pid, issueId: issue.issueId, issueRevision: issue.revision, roomId: issue.roomId, roomName: issue.roomName,
    conversationId: need.conversationId, customerId: need.customerId, needGrantId: need.id, materialVersion: materials.version,
    publisherId: aid, mediaId: String(media.id), mediaHash: String(media.source_hash), sourceMessageId: messageId,
    number: Number(previous?.aggregate_version || 0) + 1, previousVersionId: previous ? String(previous.id) : null,
    title: cmd.title, difference: cmd.difference, costDeltaCents: cmd.costDeltaCents, scheduleDeltaDays: cmd.scheduleDeltaDays };
  if (!await publisherAvailable(tx, eid, p)) fail('construction_forbidden', 403);
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${publishedType},'construction_site_issue',${issue.issueId},${p.number},${JSON.stringify(actor.principal)}::jsonb,${messageId},${JSON.stringify(p)}::jsonb) returning id`))!;
  const view = await readPlan(tx, eid, String(event.id)); if (!view) fail('context_changed');
  return { id: String(event.id), text: planText(view) + '\n已发往原授权咨询；接待期间延后，未经客户明确决定不视为同意。' };
}
async function writeState(tx: PostgresTransaction, actor: ActorContext, versionId: string, revision: number, payload: Row, correlation: string) {
  return (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},${statusType},'construction_plan',${versionId},${revision},${JSON.stringify(actor.principal)}::jsonb,${correlation},${JSON.stringify({ versionId, ...payload })}::jsonb) returning id`))!;
}
export async function planMessageProjection(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const e = await one(tx, sql`select e.* from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.plan'`);
  if (!e) return null;
  const versionId = e.type === publishedType ? String(e.id) : String((e.payload as Row).versionId), p = await readPlan(tx, eid, versionId);
  if (!p || p.conversationId !== cid) return { available: false };
  const latestNotice = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type=${statusType}
    and aggregate_type='construction_plan' and aggregate_id=${versionId} and payload->>'action'<>'preview' order by aggregate_version desc limit 1`);
  if (String(latestNotice?.id || versionId) !== String(e.id)) return { available: false };
  return { available: true, planDecision: customerPlanDto(p) };
}
export async function customerPlans(tx: PostgresTransaction, eid: string, uid: string, cid: string) {
  const events = await rows(tx, sql`select e.id from app.domain_event_outbox e where e.enterprise_id=${eid} and e.type=${publishedType}
    and e.payload->>'conversationId'=${cid} and e.payload->>'customerId'=${uid} order by e.id desc limit 30`);
  const result = [];
  for (const e of events) {
    const p = await readPlan(tx, eid, String(e.id)); if (!p) continue;
    const message = await one(tx, sql`select m.id::text from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
      where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.purpose='construction.plan'
      and (e.id=${p.id} or e.type=${statusType} and e.aggregate_id=${p.id}) order by m.seq desc limit 1`);
    if (message) result.push({ ...p, messageId: String(message.id), text: planText(p) });
  }
  return result;
}
export class PlanCustomerService {
  constructor(readonly actor: ActorContext, readonly cid: string) { requireCapability(actor, 'assistant.chat.self'); id(cid); if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403); }
  private scope<T>(versionId: string, write: boolean, fn: (tx: PostgresTransaction, p: PlanView, c: Row) => Promise<T>) {
    id(versionId);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor); await repo.settings(write); const c = await repo.conversation(this.cid);
      const e = await planEvent(tx, this.actor.enterpriseId, versionId); if (!e) fail('plan_unavailable', 404);
      const data = e.payload as PlanData;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-material:${this.actor.enterpriseId}:${data.projectId}`},0))`);
      const p = await readPlan(tx, this.actor.enterpriseId, versionId);
      if (!p || p.conversationId !== this.cid || this.actor.principal.kind !== 'user' || p.customerId !== this.actor.principal.userId) fail('plan_unavailable', 404);
      return fn(tx, p, c);
    });
  }
  read(versionId: string) { return this.scope(versionId, false, async (_tx, p) => customerPlanDto(p)); }
  media(versionId: string) { return this.scope(versionId, false, async (tx, p) => {
    const m = (await one(tx, sql`select data,mime_type from app.construction_site_media where enterprise_id=${this.actor.enterpriseId} and project_id=${p.projectId} and id=${p.mediaId} and deleted_at is null`))!;
    return { data: m.data as Buffer, mime: String(m.mime_type) };
  }); }
  decide(versionId: string, action: string, input: Row, requestKey: string) {
    key(requestKey); object(input, ['expectedRevision','reason']);
    if (!['preview','approve','decline','request-changes','defer'].includes(action) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) fail('invalid_plan', 422);
    const reason = input.reason === undefined ? '' : text(input.reason, 500, false);
    if (action === 'request-changes' && !reason) fail('invalid_plan', 422);
    return this.scope(versionId, true, async (tx, p, c) => idempotent(tx, this.actor, 'plan:decision:' + versionId, requestKey, { action, ...input }, async () => {
      if (p.revision !== input.expectedRevision) fail('version_conflict');
      if (c.status !== 'open' || !['pending_customer','deferred'].includes(p.status)) fail('plan_state_conflict');
      if (action === 'approve' && !p.previewed) fail('plan_preview_required', 422);
      const status = ({ preview: p.status, approve: 'approved', decline: 'declined', 'request-changes': 'changes_requested', defer: 'deferred' })[action]!;
      const payload = { status, previewed: action === 'preview' || p.previewed, reason, action };
      const event = await writeState(tx, this.actor, versionId, p.revision + 1, payload, requestKey);
      if (action !== 'preview') await appendMessage(tx, this.actor, this.cid, { author: 'system', eventId: String(event.id), purpose: 'construction.plan',
        content: { version: 1, blocks: [{ type: 'text', text: `你对此版本选择了“${planStatusLabels[status]}”。其他聊天可以继续，现场事项仍需团队核对落实。` }] } });
      const current = await readPlan(tx, this.actor.enterpriseId, versionId); if (!current) fail('context_changed');
      return { id: versionId, revision: current.revision, status: current.status, ...(action === 'preview' ? { material: customerPlanDto(current) } : {}) };
    }));
  }
}
export async function syncPlans(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  if (actor.principal.kind !== 'user' || c.purpose !== 'customer_consultation' || c.status !== 'open' || c.mode !== 'ai') return 0;
  const eid = actor.enterpriseId, cid = String(c.id), consumer = 'construction:plan:' + cid;
  if (!await one(tx, sql`select ent.id from app.enterprises ent join app.assistant_enterprise_settings s on s.enterprise_id=ent.id
    where ent.id=${eid} and ent.status='active' and s.enabled for share of ent,s`)) return 0;
  const events = await rows(tx, sql`select e.id from app.domain_event_outbox e where e.enterprise_id=${eid} and e.type=${publishedType}
    and e.payload->>'conversationId'=${cid} and e.payload->>'customerId'=${actor.principal.userId}
    and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key=${consumer}) order by e.id limit 20`);
  let delivered = 0;
  for (const e of events) {
    const p = await readPlan(tx, eid, String(e.id));
    const receipt = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status,last_error)
      values(${eid},${String(e.id)},${consumer},${p ? 'delivered' : 'dead'},${p ? null : 'source_or_version_changed'}) on conflict do nothing returning id`);
    if (!p || !receipt) continue;
    await appendMessage(tx, actor, cid, { author: 'system', eventId: String(e.id), purpose: 'construction.plan',
      content: { version: 1, blocks: [{ type: 'text', text: '项目团队发布了一份具体方案，请查看此版本图纸、差异和影响后再决定。' }] } }); delivered++;
  }
  return delivered;
}
export async function deliverPlans() {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select distinct e.enterprise_id,c.id,e.payload->>'customerId' as uid
    from app.domain_event_outbox e join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId'
    join app.enterprises ent on ent.id=e.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=e.enterprise_id and s.enabled
    where e.type=${publishedType} and c.status='open' and c.mode='ai' and not exists(select 1 from app.domain_event_deliveries d
      where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key='construction:plan:' || c.id::text) limit 20`));
  let count = 0;
  for (const row of candidates) await withTenantTransaction(String(row.enterprise_id), async tx => {
    const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${String(row.enterprise_id)} and id=${String(row.id)} for update`);
    if (c) count += await syncPlans(tx, { enterpriseId: String(row.enterprise_id), principal: { kind: 'user', userId: String(row.uid) }, contextVersion: 0, capabilities: [] }, c);
  });
  return count;
}
