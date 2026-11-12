
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, safeText, type MessageContent } from '@/lib/assistant/contracts';
import { MemoryService, type MemoryEntry } from '@/lib/assistant/memory/long-term';
import { privateMemoryScope } from '@/lib/assistant/memory/scope';
import { ToolExecutor } from '@/lib/assistant/tools/executor';
import { ToolRegistry } from '@/lib/assistant/tools/registry';
import { publishedSiteRecord } from '@/lib/construction/site-publications';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { readSiteIssueBase } from '@/lib/construction/site-issues';
import { readSiteResolution } from '@/lib/construction/site-resolution';
import { validResult } from '@/lib/construction/site-results';
import { checkDelegationStandards } from './delegation-knowledge';
import { delegationExternalResult, delegationOwnerInput, outcome, type ReviewDelegation, type ReviewDelegationEvidence } from './delegation-state';
import { delegationActor, reviewDelegationOrigin, type ReviewDelegationEvent } from './delegation-review-store';


const ownerResultType = 'construction.site.issue.result.v1';
const numericId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,17}$/.test(value);

async function designers(tx: PostgresTransaction, d: ReviewDelegation) {
  return rows(tx, sql`select m.admin_id::text from app.construction_members m join app.admin_users a on a.id=m.admin_id
    and a.enterprise_id=m.enterprise_id and a.status='active'
    where m.enterprise_id=${d.enterpriseId} and m.project_id=${d.projectId} and m.active and m.role='designer'
    and app.construction_actor_access(m.admin_id,m.enterprise_id)='member' order by m.admin_id limit 2 for share of m,a`);
}

async function authorizedIssue(tx: PostgresTransaction, d: ReviewDelegation) {
  const { enterpriseId: eid, projectId: pid, scope } = d;
  if (!scope.roomId) return null;
  const material = await sharedMaterials(tx, eid, pid, scope.roomId);
  const grant = material.sources.find(source => source.kind === 'need' && source.customerId === d.ownerId
    && source.conversationId === d.conversationId);
  if (!grant) return null;
  const boundIssue = scope.issueId || d.evidence?.issueId;
  const found = await rows(tx, sql`select id::text from app.domain_event_outbox
    where enterprise_id=${eid} and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid}
    and payload->>'roomId'=${scope.roomId}
    ${boundIssue ? sql`and id=${boundIssue}` : sql``} order by app.domain_event_outbox.id desc limit 30`);
  const matches = [];
  for (const candidate of found) {
    const issue = await readSiteIssueBase(tx, eid, pid, String(candidate.id));
    if (issue?.sourceAvailable && issue.status !== 'cancelled' && issue.materialVersion === material.version
      && (boundIssue || issue.text.includes(scope.subject))) matches.push(issue);
  }
  // An explicitly linked matter keeps its identity. For a new rectification
  // follow-up, a matching onsite matter is the relevant source when the same
  // owner has also opened a design-only review of the shared need.
  const onsite = !boundIssue && scope.kind === 'rectification_review' ? matches.filter(issue => issue.sourceKind !== 'need') : [];
  const eligible = onsite.length ? onsite : matches;
  if (eligible.length !== 1) return { grant, issue: null, returned: null };
  const issue = eligible[0];
  const returned = await one(tx, sql`select e.*,m.id::text as message_id from app.domain_event_outbox e
    left join app.assistant_messages m on m.enterprise_id=e.enterprise_id and m.conversation_id=${d.conversationId}
      and m.source_event_id=e.id and m.purpose='construction.result'
    where e.enterprise_id=${eid} and e.type=${ownerResultType} and e.aggregate_id=${issue.issueId}
      and e.payload->>'customerId'=${d.ownerId} and e.payload->>'conversationId'=${d.conversationId}
      and e.payload->>'needGrantId'=${grant.id} order by e.id desc limit 1`);
  return { grant, issue, returned: returned && await validResult(tx, eid, d.conversationId, returned) ? returned : null };
}

async function designReview(tx: PostgresTransaction, d: ReviewDelegation, related: MemoryEntry[]) {
  const allowed = await authorizedIssue(tx, d);
  if (!allowed) return outcome('waiting_for_authorization', '等你在原咨询确认共享本事项需要的资料', 'owner');
  const changedNeed = related.some(item => item.room === d.scope.roomName && ['need/desk','need/devices','need/use'].includes(item.topic)
    && (item.state === 'conflict' || item.state === 'current' && !allowed.grant.text.includes(item.value)));
  if (changedNeed) return outcome('waiting_for_authorization', '本事项的需求已更新，等你确认共享当前版本', 'owner');
  const staff = await designers(tx, d), { issue, returned } = allowed;
  if (issue?.progressMessageId && returned && (returned.payload as Row).state === 'awaiting_review') {
    const reply = await one(tx, sql`select m.admin_id::text,m.id::text from app.assistant_messages m
      join app.construction_chats c on c.enterprise_id=m.enterprise_id and c.conversation_id=m.conversation_id
      join app.construction_members cm on cm.enterprise_id=c.enterprise_id and cm.project_id=c.project_id and cm.admin_id=m.admin_id
      join app.admin_users a on a.id=m.admin_id and a.status='active' and a.enterprise_id=m.enterprise_id
      where m.enterprise_id=${d.enterpriseId} and c.project_id=${d.projectId} and m.id=${issue.progressMessageId}
        and m.author_kind='admin' and cm.active and cm.role='designer' and app.construction_actor_access(cm.admin_id,cm.enterprise_id)='member'
        for share of m,cm,a`);
    if (reply) return outcome('completed', returned.message_id ? '设计师的核对回复已由团队回传原咨询'
      : '团队已授权将设计师核对回复回传原咨询', null,
      { type: 'designer_reply', id: String(returned.id), version: String(returned.aggregate_version), issueId: issue.issueId,
        ...(returned.message_id ? { messageId: String(returned.message_id) } : {}) }, String(reply.admin_id));
  }
  return outcome('waiting_for_designer', staff.length
    ? '等设计师核对和项目负责人回传'
    : '等项目负责人安排有权核对的设计师', 'designer', null, staff.length === 1 ? String(staff[0].admin_id) : null);
}

async function latestRecord(tx: PostgresTransaction, d: ReviewDelegation, issueId?: string, requireUnique = false) {
  const { scope, enterpriseId: eid, projectId: pid } = d;
  if (!scope.roomId) return null;
  const subject = scope.subject.toLowerCase();
  const results = await rows(tx, sql`select r.id::text,r.version,r.published_version from app.construction_site_records r
    where r.enterprise_id=${eid} and r.project_id=${pid} and r.room_id=${scope.roomId} and r.status='published'
    and r.audience='customer' and r.published_customer_id=${d.ownerId} and r.published_at>=${d.createdAt}
    and (strpos(lower(coalesce(r.data->>'title','')),${subject})>0
      or strpos(lower(coalesce(r.data->>'completed','')),${subject})>0
      or strpos(lower(coalesce(r.data->>'pending','')),${subject})>0
      or strpos(lower(coalesce(r.data->>'note','')),${subject})>0)
    ${issueId ? sql`and exists(select 1 from app.assistant_messages m where m.enterprise_id=r.enterprise_id and m.id=r.source_message_id
      and m.conversation_id=r.conversation_id and m.author_kind='admin' and m.admin_id=r.author_id
      and m.content::text ~ ${'事项[[:space:]]*' + issueId + '([^0-9]|$)'})` : sql``}
    order by r.published_at desc,r.id desc limit ${requireUnique ? 2 : 1}`);
  if (requireUnique && results.length !== 1) return null;
  const selected = results[0];
  if (!selected) return null;
  const r = await publishedSiteRecord(tx, eid, d.ownerId, String(selected.id), Number(selected.published_version), true);
  if (!r) return null;
  const photo = await one(tx, sql`select a.media_id from app.construction_site_attachments a
    join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id and m.deleted_at is null
    where a.enterprise_id=${eid} and a.project_id=${pid} and a.record_id=${String(r.id)} limit 1 for share of a,m`);
  const data = r.data as Row, completed = String(data.completed || '').toLowerCase(), pending = String(data.pending || '').toLowerCase();
  return { id: String(r.id), version: String(r.published_version), photo: !!photo,
    completed: completed.includes(subject) && !pending.includes(subject) && !/部分|未完|待核|未确认|说不准/u.test(completed) };
}

async function roomProgress(tx: PostgresTransaction, d: ReviewDelegation) {
  const record = await latestRecord(tx, d);
  if (!record) return outcome('waiting_for_worker', '等项目团队发布该房间对应的工作进展', 'worker');
  const evidence: ReviewDelegationEvidence = { type: 'record', id: record.id, version: record.version,
    state: record.completed && record.photo ? 'reported_done' : 'pending' };
  return record.completed && record.photo
    ? outcome('completed', '团队已发布本项完成记录及现场照片，工程验收仍沿原流程', null, evidence)
    : outcome('waiting_for_worker', '该房间已有发布记录，本项仍等补充完成进展和照片', 'worker', evidence);
}

async function rectification(tx: PostgresTransaction, d: ReviewDelegation) {
  const allowed = await authorizedIssue(tx, d);
  if (!allowed) return outcome('waiting_for_authorization', '等该事项的获权资料或回传依据', 'owner');
  const issue = allowed.issue;
  if (!issue) return outcome('waiting_for_worker', '等项目团队明确关联原事项和整改材料', 'worker');
  const resolution = await readSiteResolution(tx, d.enterpriseId, d.projectId, issue.issueId, issue);
  if (allowed.returned?.message_id && resolution?.available && ['resolved','closed'].includes(resolution.state)
    && (allowed.returned.payload as Row).lifecycleId === resolution.id) {
    return outcome('completed', '有权人员已复核并授权回传原事项结论', null,
      { type: 'review', id: resolution.id, version: String(resolution.revision), issueId: issue.issueId,
        messageId: String(allowed.returned.message_id) });
  }
  if (resolution?.available && resolution.evidence) {
    return outcome('waiting_for_authorization', '已关联发布的整改照片，等待有权人员复核或回传', 'reviewer',
      { type: 'rectification', id: resolution.evidence.recordId, version: String(resolution.evidence.recordVersion), issueId: issue.issueId });
  }
  const record = await latestRecord(tx, d, issue.issueId);
  if (record?.photo) return outcome('waiting_for_authorization', '已关联发布的整改照片，等待有权人员复核', 'reviewer',
    { type: 'rectification', id: record.id, version: record.version, issueId: issue.issueId });
  const candidate = await latestRecord(tx, d, undefined, true);
  if (candidate?.completed && candidate.photo) {
    return outcome('waiting_for_authorization', '已有该房间对应施工的发布照片，等待有权人员关联事项并复核', 'reviewer',
      { type: 'rectification', id: candidate.id, version: candidate.version, issueId: issue.issueId, state: 'awaiting_link' });
  }
  return outcome('waiting_for_worker', '等项目团队发布与原事项明确关联的整改照片', 'worker',
    { type: 'issue', id: issue.issueId, version: String(issue.revision), issueId: issue.issueId });
}

async function ownerFollowup(tx: PostgresTransaction, d: ReviewDelegation, event: ReviewDelegationEvent) {
  const messageId = event.payload.messageId;
  if (event.type === delegationOwnerInput && numericId(messageId) && event.payload.conversationId === d.conversationId
    && messageId !== d.originMessageId) {
    const message = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${d.enterpriseId}
      and conversation_id=${d.conversationId} and id=${messageId} and user_id=${d.ownerId} and author_kind='user' for share`);
    if (message && safeText(message.content as MessageContent).includes(d.scope.subject)) {
      return outcome('running', '已关联你补充的原话，待核对后继续', 'owner',
        { type: 'owner_reply', id: messageId, version: fingerprint(message.content) });
    }
  }
  return d.evidence?.type === 'owner_reply' ? outcome(d.status, d.nextAction, d.waitingFor, d.evidence, d.assignedTo)
    : outcome('waiting_for_user', '等你在原咨询补充本事项的资料', 'owner');
}

async function externalReview(tx: PostgresTransaction, d: ReviewDelegation, event: ReviewDelegationEvent) {
  const runId = event.payload.runId;
  if (event.type === delegationExternalResult && numericId(runId) && event.payload.conversationId === d.conversationId) {
    const result = await one(tx, sql`select r.id::text,m.content from app.assistant_runs r join app.assistant_messages m
      on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.trigger_message_id
      where r.enterprise_id=${d.enterpriseId} and r.conversation_id=${d.conversationId} and r.id=${runId}
        and r.status='succeeded' and m.user_id=${d.ownerId} for share of m`);
    if (result && safeText(result.content as MessageContent).includes(d.scope.subject)) {
      return outcome('completed', '本次咨询已有新的公开资料，来源沿原回答核对', null,
        { type: 'external_result', id: runId, version: event.id });
    }
  }
  return d.evidence?.type === 'external_result' ? outcome(d.status, d.nextAction, d.waitingFor, d.evidence, d.assignedTo)
    : outcome('waiting_for_external', '等原咨询取得与事项相关的公开来源', 'external');
}

export async function observeDelegation(tx: PostgresTransaction, d: ReviewDelegation, conversation: Row, event: ReviewDelegationEvent,
  checkStandards = false) {
  const actor = delegationActor(d);
  const definition = new ToolRegistry().register({
    name: 'observe_delegation_sources', description: '读取委托对应的当前获权原始记录', risk: 'read', requiresProject: true,
    parameters: { type: 'object', additionalProperties: false, required: ['eventId'], properties: { eventId: { type: 'string' } } },
    authorize: async () => await reviewDelegationOrigin(tx, d, conversation) ? { allowed: true } : { allowed: false, reason: 'delegation_origin_unavailable' },
    execute: async ({ signal }) => {
      const scope = await privateMemoryScope(tx, actor, conversation);
      if (!scope) throw new Error('delegation_origin_unavailable');
      const relatedMemory = await new MemoryService(tx, scope).retrieve([d.scope.roomName, d.scope.subject].join(' '), 8, true);
      signal.throwIfAborted();
      const next = d.scope.kind === 'design_review' ? await designReview(tx, d, relatedMemory)
        : d.scope.kind === 'room_progress' ? await roomProgress(tx, d)
        : d.scope.kind === 'rectification_review' ? await rectification(tx, d)
        : d.scope.kind === 'external_review' ? await externalReview(tx, d, event) : await ownerFollowup(tx, d, event);
      signal.throwIfAborted();
      const standardCheck = checkStandards && d.scope.kind === 'rectification_review'
        ? await checkDelegationStandards(tx, d, conversation, signal) : undefined;
      return { next, standardCheck, memoryRefs: relatedMemory.map(({ key, revision }) => ({ key, revision })) };
    },
  });
  return new ToolExecutor(definition, { defaultTimeoutMs: 15_000 }).execute({
    id: d.id + ':' + event.id, name: 'observe_delegation_sources', arguments: JSON.stringify({ eventId: event.id }),
  }, { actor, projectId: d.projectId, conversationId: d.conversationId, turn: 0 });
}
