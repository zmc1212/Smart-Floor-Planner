import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type MessageContent } from '@/lib/assistant/contracts';
import type { SpecialistEvidenceRef } from '@/lib/assistant/specialists/registry';
import { specialistWorkflowRunId, type ReviewDelegation } from '@/lib/native-workflow/live/delegation-state';
import { createPostgresWorkflowRunStore } from '@/lib/native-workflow/live/runtime-postgres-stores';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import { getNativeWorkflowService } from '@/lib/native-workflow/server';
import { reviewDelegationOrigin, reviewDelegationFromRow } from '@/lib/native-workflow/live/delegation-review-store';
import { collaborationEnabled, collaborationMember } from './collaboration-scope';
import { currentRecord, openRecordIssue, readSiteIssue, type SpecialistIssueSource } from './site-issues';
import { publishedSiteRecord } from './site-publications';
import { siteAccessRevoked } from './site-access';

export function specialistIssueSource(d: ReviewDelegation): SpecialistIssueSource | undefined {
  const binding = d.scope.workflow;
  if (!binding?.originBound || !d.scope.roomId) return;
  return { enterpriseId: d.enterpriseId, projectId: d.projectId, roomId: d.scope.roomId, customerId: d.ownerId,
    conversationId: d.conversationId, originalMessageId: d.originMessageId, specialistAgentId: binding.agentId,
    specialistAgentVersion: binding.agentVersion, workflowRunId: specialistWorkflowRunId(d.id),
    workflowRevision: binding.revision, workflowDigest: binding.digest };
}

export async function specialistIssueOrigin(tx: PostgresTransaction, eid: string, pid: string, delegationId: string) {
  const row = await one(tx, sql`select * from app.native_workflow_delegations where enterprise_id=${eid}
    and project_id=${pid} and id::text=${delegationId} and scope->'workflow' is not null for share`);
  if (!row) return null;
  const delegation = reviewDelegationFromRow(row);
  if (!await reviewDelegationOrigin(tx, delegation)) return null;
  if (delegation.scope.workflow?.originBound) {
    const source = specialistIssueSource(delegation);
    if (!source) return null;
    const run = await createPostgresWorkflowRunStore(eid, tx).get(source.workflowRunId);
    const origin = run?.binding.businessEvent.specialistOrigin;
    if (!run || run.projectId !== pid || run.binding.revision !== source.workflowRevision || run.binding.digest !== source.workflowDigest
      || !origin || origin.delegationId !== delegation.id || origin.customerId !== source.customerId
      || origin.conversationId !== source.conversationId || origin.originalMessageId !== source.originalMessageId
      || origin.roomId !== source.roomId || origin.agentId !== source.specialistAgentId || origin.agentVersion !== source.specialistAgentVersion) return null;
  }
  return delegation;
}

export async function specialistResultRequired(tx: PostgresTransaction, eid: string, pid: string, delegationId: string, state: 'resolved' | 'closed') {
  const origin = await specialistIssueOrigin(tx, eid, pid, delegationId);
  const binding = origin?.scope.workflow;
  if (!binding || origin?.status === 'cancelled') return false;
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

export async function specialistPublicationAuthorized(tx: PostgresTransaction, d: ReviewDelegation,
  publication: NonNullable<Awaited<ReturnType<typeof publishedSiteRecord>>>, managerOnly = false) {
  if (String(publication.project_id) !== d.projectId || String(publication.room_id) !== d.scope.roomId) return false;
  const authorId = String(publication.author_id), reviewerId = String(publication.approved_by);
  if (!publication.approved_by) return false;
  const author = await collaborationMember(tx, d.enterpriseId, d.projectId, authorId);
  return (author === 'manager' || !managerOnly && author === 'worker')
    && await collaborationMember(tx, d.enterpriseId, d.projectId, reviewerId) === 'manager'
    && !await siteAccessRevoked(tx, d.enterpriseId, d.projectId, [authorId, reviewerId],
      publication.published_at as Date, { managers: managerOnly ? [authorId, reviewerId] : [reviewerId] });
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
    if (!await specialistPublicationAuthorized(tx, d, publication, options.managerOnly)) return null;
    return { id, version, hash: source.hash, messageId: String(source.row.source_message_id) };
  }
  return { id, version };
}

/** The owner's explicit, scoped request may register a pending matter tied to
 * a current customer-visible photo. Confirmation and review use staff actions. */
export async function openSpecialistSiteIssue(tx: PostgresTransaction, d: ReviewDelegation,
  input?: { id: string; version: number }, policy: 'open_or_reuse' | 'manager_only' = 'open_or_reuse',
  evidenceRefs?: readonly SpecialistEvidenceRef[]) {
  const { enterpriseId: eid, projectId: pid } = d;
  const origin = await specialistIssueOrigin(tx, eid, pid, d.id);
  if (!collaborationEnabled(eid) || !origin || ['cancelled', 'paused'].includes(origin.status)
    || fingerprint(specialistIssueSource(origin) ?? null) !== fingerprint(specialistIssueSource(d) ?? null)) fail('construction_forbidden', 403);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'site-material:' + eid + ':' + pid},0))`);
  const saved = await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${eid}
      and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid}
      and payload->>'specialistDelegationId'=${d.id}`);
  if (saved) {
    const issue = await readSiteIssue(tx, eid, pid, String(saved.id));
    if (!issue?.sourceAvailable || input && (issue.recordId !== input.id || issue.recordVersion !== input.version)) fail('context_changed');
    return issue;
  }
  if (!input) {
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
  if (!published || !await specialistPublicationAuthorized(tx, d, published, policy === 'manager_only')) return null;
  const source = published && await currentRecord(tx, eid, pid, input.id);
  if (!source?.media.length || String(source.row.room_id) !== d.scope.roomId) fail('site_review_required', 422);
  const issueSource = specialistIssueSource(origin);
  const recordRef: SpecialistEvidenceRef = { kind: 'project_fact',
    ref: { type: 'site_record', id: input.id, version: String(input.version) }, hash: source.hash };
  const refs = (evidenceRefs ?? []).filter(item => item.ref.type !== recordRef.ref.type || item.ref.id !== recordRef.ref.id);
  return openRecordIssue(tx, eid, pid, input.id, source, {
    openedBy: '', projectReview: true, specialistDelegationId: d.id,
    ...(policy === 'manager_only' ? { specialistManagerOnly: true } : {}),
    customerId: d.ownerId, conversationId: d.conversationId, requestText: d.scope.subject,
    ...(issueSource ? { specialistSource: issueSource, specialistEvidenceRefs: [...refs, recordRef] } : {}),
  }, { kind: 'user', userId: d.ownerId }, d.originMessageId);
}
