import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { id, type ActorContext } from '@/lib/assistant/contracts';
import { sharedMaterial, sharedMaterials } from './site-materials';
import { readSiteIssue } from './site-issues';

const sharedType = 'construction.material.shared.v1';
const openedType = 'construction.site.issue.opened.v1';
const progressType = 'construction.site.issue.progress.v1';

export type CustomerNeedReview = { issueId: string; revision: number; projectId: string; room: string;
  status: string; waitingFor: 'designer' | 'team' | 'unassigned' | 'none'; ownerName: string; text: string };

/** The only active designer can be assigned without guessing; multiple or none stay unassigned. */
async function activeDesigner(tx: PostgresTransaction, eid: string, pid: string, preferred?: string | null) {
  if (preferred && await one(tx, sql`select m.admin_id from app.construction_members m join app.admin_users a
    on a.enterprise_id=m.enterprise_id and a.id=m.admin_id where m.enterprise_id=${eid} and m.project_id=${pid}
    and m.admin_id=${preferred} and m.role='designer' and m.active and a.status='active' for share of m,a`)) return preferred;
  const candidates = await rows(tx, sql`select m.admin_id from app.construction_members m join app.admin_users a
    on a.enterprise_id=m.enterprise_id and a.id=m.admin_id where m.enterprise_id=${eid} and m.project_id=${pid}
    and m.role='designer' and m.active and a.status='active' order by m.admin_id limit 2 for share of m,a`);
  return candidates.length === 1 ? String(candidates[0].admin_id) : null;
}

/**
 * A customer's explicitly confirmed need share becomes one durable design-review
 * item per project/room. A newer share refreshes that same item instead of
 * creating a second matter; cancelled/closed items stay historical.
 */
export async function openNeedReviewFromGrant(tx: PostgresTransaction, actor: ActorContext, c: Row, grantId: string) {
  if (actor.principal.kind !== 'user') return null;
  const eid = actor.enterpriseId, cid = String(c.id), uid = actor.principal.userId;
  const event = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid} and id=${id(grantId)} and type=${sharedType} for share`);
  if (!event) return null;
  const grantPayload = event.payload as Row;
  if (grantPayload.kind !== 'need' || grantPayload.customerId !== uid || grantPayload.conversationId !== cid) return null;
  const pid = String(grantPayload.projectId);
  const grant = await sharedMaterial(tx, eid, pid, grantId);
  if (!grant) return null;
  const materials = await sharedMaterials(tx, eid, pid, grant.roomId);
  const designerId = await activeDesigner(tx, eid, pid);
  const opened = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type=${openedType}
    and payload->>'sourceKind'='need' and payload->>'projectId'=${pid} and payload->>'roomId'=${grant.roomId} order by id desc limit 1`);
  const existing = opened ? await readSiteIssue(tx, eid, pid, String(opened.id)) : null;
  if (existing && existing.needGrantId === grantId && existing.sourceAvailable) return existing.issueId;
  if (existing && !['cancelled', 'resolved', 'closed'].includes(existing.status)) {
    const ownerId = existing.ownerId ? await activeDesigner(tx, eid, pid, existing.ownerId) : designerId;
    const payload = { issueId: existing.issueId, revision: existing.revision + 1, projectId: pid, recordId: '', recordVersion: 0,
      sourceHash: grant.sourceHash, sourceMessageId: grant.consentMessageId || grant.sourceMessageId,
      roomId: grant.roomId, roomName: grant.roomName, openedBy: existing.openedBy || '', ownerId,
      state: 'awaiting_owner', progressMessageId: null, action: 'refresh', sourceKind: 'need', needGrantId: grantId,
      customerId: uid, conversationId: cid, requestMessageId: grant.sourceMessageId, requestHash: grant.sourceHash,
      requestText: grant.text, materialVersion: materials.version };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${eid},${progressType},'construction_site_issue',${existing.issueId},${payload.revision},${JSON.stringify(actor.principal)}::jsonb,${grantId},
        ${JSON.stringify(payload)}::jsonb)`);
    return existing.issueId;
  }
  const issue = { issueId: '', revision: 1, projectId: pid, recordId: '', recordVersion: 0, sourceHash: grant.sourceHash,
    sourceMessageId: grant.consentMessageId || grant.sourceMessageId, roomId: grant.roomId, roomName: grant.roomName,
    openedBy: '', ownerId: designerId, state: 'awaiting_owner', progressMessageId: null, action: 'open',
    sourceKind: 'need', needGrantId: grantId, customerId: uid, conversationId: cid,
    requestMessageId: grant.sourceMessageId, requestHash: grant.sourceHash, requestText: grant.text, materialVersion: materials.version };
  const row = await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${openedType},'construction_site_need',${grantId},1,${JSON.stringify(actor.principal)}::jsonb,${grantId},${JSON.stringify(issue)}::jsonb) returning id`);
  return row ? String(row.id) : null;
}

/** Owner-facing progress only: status and assignee, never internal replies, plans or evidence. */
export async function customerNeedReviews(tx: PostgresTransaction, eid: string, uid: string, cid: string): Promise<CustomerNeedReview[]> {
  const opens = await rows(tx, sql`select id,payload from app.domain_event_outbox where enterprise_id=${eid} and type=${openedType}
    and payload->>'sourceKind'='need' and payload->>'customerId'=${uid} and payload->>'conversationId'=${cid} order by id desc limit 30`);
  const result: CustomerNeedReview[] = [], seen = new Set<string>();
  for (const open of opens) {
    const pid = String((open.payload as Row).projectId), issueId = String(open.id);
    if (seen.has(issueId)) continue;
    seen.add(issueId);
    const issue = await readSiteIssue(tx, eid, pid, issueId);
    if (!issue || issue.customerId !== uid || issue.conversationId !== cid || issue.status === 'cancelled') continue;
    // An open onsite item in the same room is the more concrete follow-up; the
    // owner follows that one instead of reading two parallel matters for one room.
    const recordItem = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type=${openedType}
      and payload->>'projectId'=${pid} and payload->>'roomId'=${issue.roomId}
      and coalesce(payload->>'sourceKind','record')='record' order by id desc limit 1`);
    if (recordItem) {
      const onsite = await readSiteIssue(tx, eid, pid, String(recordItem.id));
      if (onsite && !['cancelled', 'closed'].includes(onsite.status)) continue;
    }
    const waitingFor = issue.status === 'invalidated' ? 'team' as const
      : issue.status === 'awaiting_owner' ? issue.ownerId ? 'designer' as const : 'unassigned' as const : 'team' as const;
    const label = issue.status === 'invalidated' ? '资料已变化，等待团队重新核对'
      : issue.status === 'awaiting_owner' ? issue.ownerId ? `已转给${issue.ownerName}核对，等待处理` : '已记录，等待分配设计师'
      : issue.status === 'awaiting_review' ? '已有处理回复，团队核对中'
      : '团队已提交处理，具体结果以团队回传为准';
    result.push({ issueId, revision: issue.revision, projectId: pid, room: issue.roomName, status: issue.status, waitingFor,
      ownerName: issue.ownerName, text: `${issue.roomName}的插座需求已记录：${label}。这不仅不代表方案、费用或施工已批准；团队回传的明确结果会另发给你。` });
  }
  return result;
}
