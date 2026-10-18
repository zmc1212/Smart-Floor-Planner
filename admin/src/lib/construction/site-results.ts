import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { currentRecord, readSiteIssue } from './site-issues';
import { sharedMaterial, sharedMaterials } from './site-materials';
import { readSiteResolution } from './site-resolution';
import { fingerprint } from '@/lib/assistant/contracts';
import { siteAccessRevoked } from './site-access';

const resultType = 'construction.site.issue.result.v1';
type ReturnedState = 'closed' | 'resolved' | 'awaiting_review' | 'awaiting_owner' | 'cancelled' | 'invalidated';

/** The recipient is the original opt-in consultation, never the latest or another customer thread. */
async function validResult(tx: PostgresTransaction, eid: string, cid: string, event: Row) {
  const p = event.payload as Row;
  if (p.conversationId !== cid) return false;
  const need = await sharedMaterial(tx, eid, String(p.projectId), String(p.needGrantId));
  if (!need || need.conversationId !== cid || need.customerId !== p.customerId) return false;
  const issue = await readSiteIssue(tx, eid, String(p.projectId), String(p.issueId));
  if (!issue || !issue.sourceAvailable) return false;
  if (p.lifecycleId) {
    const resolution = await readSiteResolution(tx, eid, String(p.projectId), String(p.issueId));
    if (!resolution?.available || resolution.id !== p.lifecycleId || resolution.revision !== p.revision || resolution.state !== p.state
      || resolution.planId !== p.planId || resolution.evidenceId !== p.evidenceId || issue.revision !== p.issueRevision) return false;
  } else if (issue.status !== (p.state || 'awaiting_review') || issue.revision !== p.revision
    || (p.state ? issue.ownerId !== p.ownerId || issue.ownerName !== p.ownerName : !issue.ownerId)) return false;
  const materials = await sharedMaterials(tx, eid, String(p.projectId), need.roomId);
  if (materials.version !== p.materialVersion || issue.materialVersion !== p.materialVersion) return false;
  const publisher = (event.actor_ref as Row)?.adminId;
  if (typeof publisher !== 'string') return false;
  const permission = await one(tx, sql`select app.construction_actor_access(${publisher}::bigint,${eid}::bigint) as role,
    exists(select 1 from app.construction_members where enterprise_id=${eid} and project_id=${String(p.projectId)}
      and admin_id=${publisher} and active and role='manager') as manager`);
  if (!(permission?.role === 'owner' || (permission?.role === 'member' && permission.manager === true))) return false;
  return !await siteAccessRevoked(tx, eid, String(p.projectId),
    [publisher, issue.ownerId].filter(Boolean) as string[], event.created_at as Date, { managers: [publisher] });
}

async function resultText(tx: PostgresTransaction, eid: string, p: Row) {
  if (!p.lifecycleId) {
    if (!p.state) return String(p.text);
    const status = p.state === 'cancelled' ? '已取消跟进，当前没有待执行安排'
      : p.state === 'awaiting_review' ? '已有处理回复，仍待团队核对' : '等待团队处理';
    const waiting = p.state === 'cancelled' ? '如需继续，由有权人员沿原事项明确恢复并重新核对。'
      : p.ownerName ? `当前负责人：${p.ownerName}。` : '尚未分配有效负责人。';
    return `${status}。\n${p.text}\n${waiting}\n这是本次团队回传状态，不代表方案、费用、工期、现场落实或验收批准；没有已确认期限，不推断逾期。`;
  }
  const resolution = (await readSiteResolution(tx, eid, String(p.projectId), String(p.issueId)))!;
  const proof = resolution.evidence!;
  return `方案V${p.planNumber} · ${p.state === 'closed' ? '已正式关闭' : '已正式解决，尚未关闭'}。\n${p.text}`
    + `\n依据：本次获同意方案、现场记录${proof.recordId} · 版本${proof.recordVersion}，${proof.media.length}张落实原件。`
    + (p.shareOriginals ? '\n团队已明确向本咨询回传这些现场原件。' : '\n本次仅回传结果节选，现场原件未向本咨询开放。')
    + '\n解决与关闭由有权人员分别确认；不代表工程验收通过、付款或结算。';
}

/** A manager's exact result grants selected originals only to the original consultation. */
export async function siteResultRecords(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const event = await one(tx, sql`select e.* from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.result' and e.type=${resultType}`);
  if (!event || (event.payload as Row).shareOriginals !== true || !await validResult(tx, eid, cid, event)) return [];
  const p = event.payload as Row, resolution = (await readSiteResolution(tx, eid, String(p.projectId), String(p.issueId)))!;
  const e = resolution.evidence!;
  return [{ available: true, id: e.recordId, version: e.recordVersion, assets: e.media.map(m => m.id) }];
}
export async function returnedEvidenceRecord(tx: PostgresTransaction, eid: string, uid: string, cid: string, recordId: string, version: number) {
  const events = await rows(tx, sql`select e.*,m.id as result_message_id from app.domain_event_outbox e join app.assistant_messages m
    on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id and m.conversation_id=${cid} and m.purpose='construction.result'
    where e.enterprise_id=${eid} and e.type=${resultType} and e.payload->>'customerId'=${uid} and e.payload->>'conversationId'=${cid}
      and e.payload->>'shareOriginals'='true' order by e.id desc limit 30`);
  for (const event of events) {
    if (!await validResult(tx, eid, cid, event)) continue;
    const p = event.payload as Row, resolution = (await readSiteResolution(tx, eid, String(p.projectId), String(p.issueId)))!;
    if (resolution.evidence?.recordId === recordId && resolution.evidence.recordVersion === version)
      return (await currentRecord(tx, eid, String(p.projectId), recordId))?.row || null;
  }
  return null;
}

export async function siteResultAvailable(tx: PostgresTransaction, eid: string, cid: string, mid: string) {
  const event = await one(tx, sql`select e.* from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid} and m.purpose='construction.result' and e.type=${resultType}`);
  return !event || await validResult(tx, eid, cid, event);
}

/** Original-consultation read model for query_followups. Never exposes the shared conversation or unpublished replies. */
export async function customerSiteResults(tx: PostgresTransaction, eid: string, uid: string, cid: string) {
  const events = await rows(tx, sql`select distinct on (e.aggregate_id) e.*,m.id::text as result_message_id
    from app.domain_event_outbox e join app.assistant_messages m on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id
    and m.conversation_id=${cid} and m.purpose='construction.result'
    where e.enterprise_id=${eid} and e.type=${resultType} and e.payload->>'customerId'=${uid} and e.payload->>'conversationId'=${cid}
    order by e.aggregate_id,e.id desc limit 30`);
  const projected = [];
  for (const e of events) {
    const p = e.payload as Row, available = await validResult(tx, eid, cid, e);
    const status: ReturnedState = available ? (p.state || 'awaiting_review') as ReturnedState : 'invalidated';
    const waitingFor = !available ? 'unassigned' as const : status === 'closed' || status === 'cancelled' ? 'none' as const
      : p.waitingFor === 'unassigned' ? 'unassigned' as const : 'team' as const;
    // Preserve prior ordinary/formal snapshot hashes across this code upgrade.
    // Only the new ordinary state returns add assignee/waiting dependencies.
    const provenance = { materialVersion: p.materialVersion, lifecycleId: p.lifecycleId || null, text: p.text, shareOriginals: p.shareOriginals === true };
    const sourceVersion = !available ? '' : !p.lifecycleId && p.state ? fingerprint({ ...provenance,
      revision: p.revision, state: p.state, ownerId: p.ownerId || null, ownerName: p.ownerName || '', waitingFor: p.waitingFor || null }) : fingerprint(provenance);
    projected.push({ issueId: String(p.issueId), revision: Number(p.revision), projectId: String(p.projectId),
      room: available ? String(p.roomName) : '', status,
      ownerName: available && !p.lifecycleId ? String(p.ownerName || '') : '',
      waitingFor,
      messageId: String(e.result_message_id), text: available ? await resultText(tx, eid, p) : '',
      sourceVersion });
  }
  return projected;
}

export async function syncSiteResults(tx: PostgresTransaction, actor: ActorContext, c: Row) {
  if (actor.principal.kind !== 'user' || c.status !== 'open' || c.mode !== 'ai' || c.purpose !== 'customer_consultation') return 0;
  const eid = actor.enterpriseId, cid = String(c.id), uid = actor.principal.userId;
  if (!await one(tx, sql`select ent.id from app.enterprises ent join app.assistant_enterprise_settings s on s.enterprise_id=ent.id
    where ent.id=${eid} and ent.status='active' and s.enabled for share of ent,s`)) return 0;
  const events = await rows(tx, sql`select e.* from app.domain_event_outbox e where e.enterprise_id=${eid} and e.type=${resultType}
    and e.payload->>'conversationId'=${cid} and e.payload->>'customerId'=${uid}
    and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key=${'construction:result:' + cid})
    order by e.id limit 20`);
  let delivered = 0;
  for (const event of events) {
    if (!await validResult(tx, eid, cid, event)) {
      await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status,last_error)
        values(${eid},${String(event.id)},${'construction:result:' + cid},'dead','source_or_permission_changed')
        on conflict(enterprise_id,event_id,consumer_key) do nothing`);
      continue;
    }
    const d = await one(tx, sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
      values(${eid},${String(event.id)},${'construction:result:' + cid},'processing') on conflict(enterprise_id,event_id,consumer_key) do nothing returning id`);
    if (!d) continue;
    const p = event.payload as Row;
    const display = p.lifecycleId || p.state ? await resultText(tx, eid, p) : `${p.text}\n这是处理回复，仍待核对，不代表方案、费用、工期或验收批准。`;
    await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.result',
      content: { version: 1, blocks: [{ type: 'text', text: `「${p.roomName}」事项${p.issueId} · 修订${p.revision}，项目团队回传：\n${display}` }] } });
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',updated_at=now() where enterprise_id=${eid} and id=${String(d.id)}`);
    delivered++;
  }
  return delivered;
}

/** Reuses the existing Worker poll; pages may be closed. Human mode defers the same event without consuming it. */
export async function deliverSiteResults() {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select distinct e.enterprise_id,c.id as conversation_id,e.payload->>'customerId' as customer_id
    from app.domain_event_outbox e join app.enterprises ent on ent.id=e.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=e.enterprise_id and s.enabled
    join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId' and c.status='open' and c.mode='ai'
    where e.type=${resultType} and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id
      and d.consumer_key='construction:result:' || c.id::text) limit 20`));
  let count = 0;
  for (const candidate of candidates) await withTenantTransaction(String(candidate.enterprise_id), async tx => {
    const eid = String(candidate.enterprise_id), cid = String(candidate.conversation_id);
    if (!await one(tx, sql`select id from app.enterprises where id=${eid} and status='active' for share`)) return;
    if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for share`)) return;
    const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid} for update`);
    if (c) count += await syncSiteResults(tx, { enterpriseId: eid, principal: { kind: 'user', userId: String(candidate.customer_id) }, contextVersion: 0, capabilities: [] }, c);
  });
  return count;
}
