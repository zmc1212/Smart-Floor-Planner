import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import type { ReviewDelegation } from '@/lib/native-workflow/live/delegation-state';
import { reviewDelegationOrigin, reviewDelegationFromRow } from '@/lib/native-workflow/live/delegation-review-store';
import { collaborationEnabled } from './collaboration-scope';
import { currentRecord, openRecordIssue, readSiteIssue } from './site-issues';
import { publishedSiteRecord } from './site-publications';

export async function specialistIssueOrigin(tx: PostgresTransaction, eid: string, pid: string, delegationId: string) {
  const row = await one(tx, sql`select * from app.native_workflow_delegations where enterprise_id=${eid}
    and project_id=${pid} and id::text=${delegationId} and scope->'workflow' is not null for share`);
  if (!row) return null;
  const delegation = reviewDelegationFromRow(row);
  return await reviewDelegationOrigin(tx, delegation) ? delegation : null;
}

export async function specialistSiteRecord(tx: PostgresTransaction, d: ReviewDelegation) {
  const items = await rows(tx, sql`select r.id::text,r.published_version from app.construction_site_records r
    where r.enterprise_id=${d.enterpriseId} and r.project_id=${d.projectId} and r.room_id=${d.scope.roomId}
    and r.status='published' and r.audience='customer' and r.published_customer_id=${d.ownerId}
    and r.published_at>=${d.createdAt} and exists(select 1 from app.construction_site_attachments a
      join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id and m.deleted_at is null)
    and strpos(concat_ws(' ',r.data->>'pending',r.data->>'coordination'),${d.scope.subject})>0
    order by r.published_at desc,r.id desc limit 2`);
  if (items.length !== 1) return null;
  const record = items[0], id = String(record.id), version = Number(record.published_version);
  return await publishedSiteRecord(tx, d.enterpriseId, d.ownerId, id, version, true) ? { id, version } : null;
}

/** The owner's explicit, scoped request may register a pending matter tied to
 * a current customer-visible photo. Confirmation and review use staff actions. */
export async function openSpecialistSiteIssue(tx: PostgresTransaction, d: ReviewDelegation, input: { id: string; version: number }) {
  const { enterpriseId: eid, projectId: pid } = d;
  if (!collaborationEnabled(eid) || !await reviewDelegationOrigin(tx, d)) fail('construction_forbidden', 403);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'site-material:' + eid + ':' + pid},0))`);
  const existing = await one(tx, sql`select id::text,payload->>'specialistDelegationId' as delegation from app.domain_event_outbox
    where enterprise_id=${eid} and type='construction.site.issue.opened.v1' and aggregate_type='construction_site_record'
    and aggregate_id=${input.id} and payload->>'projectId'=${pid}`);
  if (existing?.delegation && existing.delegation !== d.id) fail('site_review_required', 422);
  if (existing && !existing.delegation) fail('site_review_required', 422);
  if (existing) {
    const issue = await readSiteIssue(tx, eid, pid, String(existing.id));
    if (!issue?.sourceAvailable) fail('context_changed');
    return issue;
  }
  const published = await publishedSiteRecord(tx, eid, d.ownerId, input.id, input.version, true);
  const source = published && await currentRecord(tx, eid, pid, input.id);
  if (!source?.media.length || String(source.row.room_id) !== d.scope.roomId) fail('site_review_required', 422);
  return openRecordIssue(tx, eid, pid, input.id, source, {
    openedBy: '', projectReview: true, specialistDelegationId: d.id,
    customerId: d.ownerId, conversationId: d.conversationId, requestText: d.scope.subject,
  }, { kind: 'user', userId: d.ownerId }, d.originMessageId);
}
