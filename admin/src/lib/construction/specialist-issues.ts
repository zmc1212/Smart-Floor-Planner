import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, safeText, type MessageContent } from '@/lib/assistant/contracts';
import type { ReviewDelegation } from '@/lib/native-workflow/live/delegation-state';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import { getNativeWorkflowService } from '@/lib/native-workflow/server';
import { reviewDelegationOrigin, reviewDelegationFromRow } from '@/lib/native-workflow/live/delegation-review-store';
import { collaborationEnabled, collaborationMember } from './collaboration-scope';
import { currentRecord, openRecordIssue, readSiteIssue } from './site-issues';
import { publishedSiteRecord } from './site-publications';
import { siteAccessRevoked } from './site-access';

export async function specialistIssueOrigin(tx: PostgresTransaction, eid: string, pid: string, delegationId: string) {
  const row = await one(tx, sql`select * from app.native_workflow_delegations where enterprise_id=${eid}
    and project_id=${pid} and id::text=${delegationId} and scope->'workflow' is not null for share`);
  if (!row) return null;
  const delegation = reviewDelegationFromRow(row);
  return await reviewDelegationOrigin(tx, delegation) ? delegation : null;
}

export async function specialistResultRequired(tx: PostgresTransaction, eid: string, pid: string, delegationId: string, state: 'resolved' | 'closed') {
  const origin = await specialistIssueOrigin(tx, eid, pid, delegationId);
  const binding = origin?.scope.workflow;
  if (!binding) return false;
  try {
    const { record } = await getNativeWorkflowService().getDefinition(binding.templateId);
    const published = record.versions.find(version => version.revision === binding.revision && version.digest === binding.digest);
    const output = published?.definition.nodes.find(node => node.capabilityRef === 'deliver.specialist_result');
    return !!output && (state === 'closed' || output.config?.milestone !== 'closed');
  } catch (error) {
    if (error instanceof WorkflowOperationError && error.status === 404) return false;
    throw error;
  }
}

type SpecialistSiteRecord = { id: string; version: number } & Record<string, string | number>;
export async function specialistSiteRecord(tx: PostgresTransaction, d: ReviewDelegation,
  options?: { requireCurrentStaff: boolean; managerOnly?: boolean }): Promise<SpecialistSiteRecord | null> {
  const items = await rows(tx, sql`select r.id::text,r.published_version from app.construction_site_records r
    where r.enterprise_id=${d.enterpriseId} and r.project_id=${d.projectId} and r.room_id=${d.scope.roomId}
    and r.status='published' and r.audience='customer' and r.published_customer_id=${d.ownerId}
    and r.published_at>=${d.createdAt} and exists(select 1 from app.construction_site_attachments a
      join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id and m.deleted_at is null)
    and strpos(concat_ws(' ',r.data->>'pending',r.data->>'coordination'),${d.scope.subject})>0
    and (not ${options?.managerOnly ?? false} or exists(select 1 from app.construction_members m
      where m.enterprise_id=r.enterprise_id and m.project_id=r.project_id and m.admin_id=r.author_id and m.role='manager' and m.active))
    order by r.published_at desc,r.id desc limit 2`);
  if (items.length !== 1) return null;
  const record = items[0], id = String(record.id), version = Number(record.published_version);
  const publication = await publishedSiteRecord(tx, d.enterpriseId, d.ownerId, id, version, true);
  if (!publication) return null;
  if (options?.requireCurrentStaff) {
    const source = await currentRecord(tx, d.enterpriseId, d.projectId, id);
    const pending = (publication.data as { pending?: string }).pending?.trim();
    if (!source?.media.length || !pending?.includes(d.scope.subject) || !safeText(source.row.content as MessageContent).includes(pending)) return null;
    const authorId = String(publication.author_id), reviewerId = String(publication.approved_by);
    const author = await collaborationMember(tx, d.enterpriseId, d.projectId, authorId);
    const reviewer = publication.approved_by && await collaborationMember(tx, d.enterpriseId, d.projectId, reviewerId);
    if (author !== 'manager' && (options.managerOnly || author !== 'worker') || reviewer !== 'manager'
      || await siteAccessRevoked(tx, d.enterpriseId, d.projectId, [authorId, reviewerId], publication.published_at as Date, { managers: [reviewerId] })) return null;
    return { id, version, hash: source.hash, messageId: String(source.row.source_message_id) };
  }
  return { id, version };
}

/** The owner's explicit, scoped request may register a pending matter tied to
 * a current customer-visible photo. Confirmation and review use staff actions. */
export async function openSpecialistSiteIssue(tx: PostgresTransaction, d: ReviewDelegation,
  input?: { id: string; version: number }, policy: 'open_or_reuse' | 'manager_only' = 'open_or_reuse') {
  const { enterpriseId: eid, projectId: pid } = d;
  if (!collaborationEnabled(eid) || !await reviewDelegationOrigin(tx, d)) fail('construction_forbidden', 403);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'site-material:' + eid + ':' + pid},0))`);
  if (!input) {
    const saved = await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${eid}
      and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid}
      and payload->>'specialistDelegationId'=${d.id}`);
    if (saved) {
      const issue = await readSiteIssue(tx, eid, pid, String(saved.id));
      if (!issue?.sourceAvailable) fail('context_changed');
      return issue;
    }
    input = await specialistSiteRecord(tx, d, { requireCurrentStaff: true, managerOnly: policy === 'manager_only' }) ?? undefined;
    if (!input) return null;
  }
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
  if (policy === 'manager_only' && (!published
    || await collaborationMember(tx, eid, pid, String(published.author_id)) !== 'manager')) return null;
  const source = published && await currentRecord(tx, eid, pid, input.id);
  if (!source?.media.length || String(source.row.room_id) !== d.scope.roomId) fail('site_review_required', 422);
  return openRecordIssue(tx, eid, pid, input.id, source, {
    openedBy: '', projectReview: true, specialistDelegationId: d.id,
    customerId: d.ownerId, conversationId: d.conversationId, requestText: d.scope.subject,
  }, { kind: 'user', userId: d.ownerId }, d.originMessageId);
}
