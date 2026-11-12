import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import type { ActorContext } from '@/lib/assistant/contracts';
import { sharedMaterial, sharedMaterials } from './site-materials';
import { readSiteIssue, readSiteIssueBase } from './site-issues';
import { collaborationMember } from './collaboration-scope';
import { issueDelivery } from './site-results';

const openedType = 'construction.site.issue.opened.v1';
const progressType = 'construction.site.issue.progress.v1';

/** Called in the same project lock and transaction as the owner's exact material grant. */
export async function openNeedReviewFromGrant(tx: PostgresTransaction, actor: ActorContext, c: Row, projectId: string, grantId: string) {
  if (actor.principal.kind !== 'user') return null;
  const eid = actor.enterpriseId, cid = String(c.id), uid = actor.principal.userId;
  const grant = await sharedMaterial(tx, eid, projectId, grantId);
  if (grant?.kind !== 'need' || grant.customerId !== uid || grant.conversationId !== cid) return null;

  const opened = await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${eid} and type=${openedType}
    and payload->>'sourceKind'='need' and payload->>'projectId'=${projectId} and payload->>'roomId'=${grant.roomId}
    and payload->>'customerId'=${uid} order by id desc limit 1`);
  const issueId = opened ? String(opened.id) : '';
  const existing = issueId ? await readSiteIssueBase(tx, eid, projectId, issueId) : null;
  if (existing?.needGrantId === grantId) return issueId;
  const designers = await rows(tx, sql`select admin_id::text from app.construction_members
    where enterprise_id=${eid} and project_id=${projectId} and role='designer' and active order by admin_id`);
  const eligible = [];
  for (const row of designers) {
    const adminId = String(row.admin_id);
    if (await collaborationMember(tx, eid, projectId, adminId) === 'designer') eligible.push(adminId);
  }
  const ownerId = existing?.ownerId && eligible.includes(existing.ownerId) ? existing.ownerId : eligible.length === 1 ? eligible[0] : null;
  const materials = await sharedMaterials(tx, eid, projectId, grant.roomId);
  const revision = (existing?.revision ?? 0) + 1;
  const payload = { issueId, revision, projectId, recordId: '', recordVersion: 0, sourceHash: grant.sourceHash,
    sourceMessageId: grant.consentMessageId || grant.sourceMessageId, roomId: grant.roomId, roomName: grant.roomName,
    openedBy: '', ownerId, state: 'awaiting_owner', progressMessageId: null, action: existing ? 'refresh' : 'open',
    sourceKind: 'need', needGrantId: grantId, customerId: uid, conversationId: cid, materialVersion: materials.version };
  const event = await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${existing ? progressType : openedType},${existing ? 'construction_site_issue' : 'construction_site_need'},
      ${existing ? issueId : grantId},${revision},${JSON.stringify(actor.principal)}::jsonb,${grantId},${JSON.stringify(payload)}::jsonb)
    returning id::text`);
  return existing ? issueId : String(event!.id);
}

/** Only the current grant's original consultation sees this bounded matter status. */
export async function customerNeedReviews(tx: PostgresTransaction, eid: string, uid: string, cid: string) {
  const opens = await rows(tx, sql`select id::text,payload->>'projectId' as project_id from app.domain_event_outbox
    where enterprise_id=${eid} and type=${openedType} and payload->>'sourceKind'='need' and payload->>'customerId'=${uid}
    order by id desc`);
  const result = [];
  for (const open of opens) {
    const projectId = String(open.project_id), issueId = String(open.id);
    const issue = await readSiteIssue(tx, eid, projectId, issueId);
    if (!issue || issue.customerId !== uid || issue.conversationId !== cid || !issue.needGrantId) continue;
    const grant = await sharedMaterial(tx, eid, projectId, issue.needGrantId);
    if (!grant) continue;
    const waitingFor = ['resolved', 'closed', 'dismissed', 'cancelled'].includes(issue.status) ? 'none' as const
      : !issue.ownerId ? 'unassigned' as const : issue.status === 'awaiting_owner' ? 'designer' as const : 'team' as const;
    result.push({ issueId, revision: issue.revision, projectId, room: issue.roomName, status: issue.status,
      classification: issue.classification, lifecycleRevision: issue.lifecycleRevision, lifecycleId: issue.lifecycleId,
      waitingFor, ownerName: issue.ownerName, sourceMessageId: grant.consentMessageId || grant.sourceMessageId,
      sync: await issueDelivery(tx, eid, issue),
      text: `${issue.roomName}事项${issueId} · ${issue.classificationLabel}。${issue.ownerName ? '负责人：' + issue.ownerName + '。' : ''}` });
  }
  return result;
}
