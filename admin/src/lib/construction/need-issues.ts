import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelTool } from '@/lib/assistant/contracts/model';
import { readMemory, type NeedFact } from '@/lib/assistant/agent/memory';
import { availableNeedMemory } from '@/lib/assistant/agent/memory-sources';
import { constructionFollowUpScope, constructionNoticeAvailable } from './customer';
import { customerSiteResults } from './site-results';
import { customerNeedReviews } from './site-need-reviews';
import { customerPlans } from './site-plans';
import { currentHandoffOwner } from '@/lib/assistant/handoff/owner';
import { notesPreserveProgress } from './stage-events';

export const needIssueTool: ModelTool = {
  name: 'query_followups', description: '查询当前本人咨询中节点补充事项、本人明确共享给项目团队的插座/点位需求当前由哪位设计师核对及处理到哪一步（不含内部回复）、团队明确回传的事项取消/恢复后的等待状态与负责人、现场落实证据及正式解决/关闭结果，以及发给本咨询的具体方案版本、差异、费用/工期变化和客户真实决定。只读；不取消/恢复或批准方案、不解决或关闭事项，不开放内部会话或未回传内容。恢复不复活旧回复或批准；普通回复或客户同意不等于现场落实、解决或关闭；关闭不等于验收付款。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};
export type IssueState = { issueId: string; revision: number; projectId: string; room: string; field: string;
  status: 'awaiting_customer' | 'awaiting_owner' | 'awaiting_review' | 'cancelled' | 'invalidated' | 'approved' | 'declined' | 'changes_requested' | 'deferred' | 'implemented' | 'resolved' | 'closed'; waitingFor: 'customer' | 'designer' | 'unassigned' | 'team' | 'none';
  ownerName: string; sourceMessageId: string | null; sourceFactId: string | null; lastProgress: string; question: string; value: string;
  kind?: 'team_result' | 'formal_plan' | 'need_review'; sourceVersion?: string };
export type NeedIssueSnapshot = { query: { domain: 'followups'; conversationId: string }; customerId: string; leadIds: string[];
  version: string; displayText: string; data: IssueState[]; queriedAt: string };
export type NeedIssueDependency = Pick<NeedIssueSnapshot, 'query' | 'customerId' | 'version'>;

async function questions(tx: PostgresTransaction, eid: string, cid: string) {
  return rows(tx, sql`select e.*,m.id as question_message_id from app.domain_event_outbox e join app.assistant_messages m
    on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id and m.purpose='construction.followup'
    where e.enterprise_id=${eid} and m.conversation_id=${cid} and e.type='construction.need.asked.v1' order by e.id limit 30`);
}
async function progress(tx: PostgresTransaction, eid: string, issueId: string) {
  return one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${eid} and type='construction.need.progress.v1'
    and aggregate_type='construction_need_issue' and aggregate_id=${issueId} order by aggregate_version desc limit 1`);
}
/** An append-only projection over the existing outbox, not a second customer-data store. Caller holds the conversation lock. */
async function appendProgress(tx: PostgresTransaction, actor: ActorContext, opened: Row, operationId: string, patch: Row) {
  const issueId = String(opened.id), eid = actor.enterpriseId;
  if (await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.need.progress.v1'
    and aggregate_type='construction_need_issue' and aggregate_id=${issueId} and correlation_id=${operationId}`)) return;
  const previous = await progress(tx, eid, issueId), revision = Number(previous?.aggregate_version || 1) + 1;
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.need.progress.v1','construction_need_issue',${issueId},${revision},${JSON.stringify(actor.principal)}::jsonb,${operationId},
      ${JSON.stringify({ ...(previous?.payload as Row || {}), issueId, revision, projectId: (opened.payload as Row).projectId, ...patch })}::jsonb)
    on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do nothing`);
}

/** A staff review continues a pending task, never the unavailable memory or old
 * stage question. Its immutable review and original remain separate sources. */
async function reviewedStageAvailable(tx: PostgresTransaction, eid: string, cid: string, opened: Row, current: Row | undefined) {
  const binding = current?.stageReview as Row | undefined;
  if (!binding) return false;
  const scope = await constructionFollowUpScope(tx, eid, cid, opened.payload as Row, true);
  if (!scope || scope.stageKey !== binding.stageKey
    || scope.settingsVersion !== binding.settingsVersion || scope.settingsVersion !== Number((opened.payload as Row).settingsVersion)) return false;
  if (scope.progressRevision !== binding.progressRevision && !(Number.isSafeInteger(binding.projectVersion)
    && typeof binding.progressNote === 'string' && await notesPreserveProgress(tx, eid, String((opened.payload as Row).projectId), {
      stageKey: String(binding.stageKey), progressRevision: Number(binding.progressRevision),
      projectVersion: Number(binding.projectVersion), progressNote: binding.progressNote,
    }))) return false;
  const review = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='assistant.handoff.review.v1'
    and aggregate_id=${cid} and correlation_id=${String(binding.reviewKey)} and actor_ref->>'adminId'=${String(binding.reviewerId)}
    and payload->>'action'='correct' and payload->>'field'=${String((opened.payload as Row).field)}`);
  const origin = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid}
    and id=${String(binding.sourceMessageId)} and author_kind='user' for share`);
  return !!review && !!origin && fingerprint(origin.content) === binding.sourceMessageHash;
}

async function storedSupplement(tx: PostgresTransaction, eid: string, cid: string, opened: Row, current: Row) {
  const conversation = await one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`);
  const fact = readMemory(conversation?.entry_snapshot).facts.find(f => f.id === current.sourceFactId && f.status === 'current'
    && f.sourceMessageId === current.sourceMessageId && fingerprint(f) === current.sourceHash
    && f.room === (opened.payload as Row).room && f.field === (opened.payload as Row).field);
  if (!fact) return null;
  const origin = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid}
    and id=${fact.sourceMessageId} and author_kind='user' for share`);
  if (!origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)) return null;
  let originalHash = current.sourceMessageHash as string | undefined;
  if (!originalHash) {
    // Legacy progress may use its existing durable write receipt as proof. A
    // missing proof needs fresh customer input; do not infer an original hash.
    const receipts = await rows(tx, sql`select s.source_refs,s.private_checkpoint from app.assistant_runs r join app.assistant_run_steps s
      on s.enterprise_id=r.enterprise_id and s.run_id=r.id where r.enterprise_id=${eid} and r.conversation_id=${cid}
      and r.trigger_message_id=${fact.sourceMessageId} and s.kind='agent_need_write' and s.status='succeeded'`);
    const receipt = receipts.find(r => ((r.private_checkpoint as { receipt?: { savedFacts?: Array<{ id: string }> } })?.receipt?.savedFacts || []).some(f => f.id === fact.id));
    originalHash = (receipt?.source_refs as Array<{ messageId: string; hash: string }> | undefined)?.find(r => r.messageId === fact.sourceMessageId)?.hash;
  }
  return originalHash && fingerprint(origin.content) === originalHash ? { fact, originalHash } : null;
}

/** Only obsolete node notices of this same project/room may be replaced as a
 * task context. Revoked records, another home's sources and settings cannot. */
async function onlyStageDependencies(tx: PostgresTransaction, eid: string, cid: string, opened: Row, messageId: string) {
  const contexts = await rows(tx, sql`select s.source_refs from app.assistant_runs r join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id
    where r.enterprise_id=${eid} and r.conversation_id=${cid} and r.trigger_message_id=${messageId} and s.kind='agent_construction_context'`);
  const payload = opened.payload as Row;
  for (const mid of contexts.flatMap(c => (c.source_refs || []) as string[])) {
    if (await constructionNoticeAvailable(tx, eid, cid, mid, true, true)) continue;
    const notice = await one(tx, sql`select m.purpose,e.aggregate_id,e.payload from app.assistant_messages m join app.domain_event_outbox e
      on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid}`);
    const source = notice?.payload as Row | undefined, followUp = notice?.purpose === 'construction.followup';
    if (!source || !['construction.stage','construction.followup'].includes(String(notice?.purpose))
      || String(followUp ? source.projectId : notice!.aggregate_id) !== String(payload.projectId)
      || Number(source.settingsVersion) !== Number(payload.settingsVersion)
      || (followUp && (String(source.customerId) !== String(payload.customerId) || source.room !== payload.room))) return false;
  }
  return true;
}

export async function recordNeedIssueSupplement(tx: PostgresTransaction, actor: ActorContext, conversation: Row, fact: NeedFact) {
  if (actor.principal.kind !== 'user') return;
  const eid = actor.enterpriseId, cid = String(conversation.id);
  for (const opened of await questions(tx, eid, cid)) {
    const payload = opened.payload as Row;
    const prior = await progress(tx, eid, String(opened.id));
    if (String(payload.customerId) !== actor.principal.userId || payload.field !== fact.field || payload.room !== fact.room
      || (!await constructionNoticeAvailable(tx, eid, cid, String(opened.question_message_id), true, true)
        && !await reviewedStageAvailable(tx, eid, cid, opened, prior?.payload as Row | undefined))) continue;
    const origin = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid}
      and id=${fact.sourceMessageId} and author_kind='user' for share`);
    if (!origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)) continue;
    await appendProgress(tx, actor, opened, 'need:' + fact.id, { status: 'awaiting_review', sourceMessageId: fact.sourceMessageId,
      sourceFactId: fact.id, sourceHash: fingerprint(fact), sourceMessageHash: fingerprint(origin.content), lastProgress: 'customer_supplement' });
  }
}

/** Existing S01 consent, owner and optimistic-version gates must have passed before this adapter runs. */
export async function recordNeedIssueReview(tx: PostgresTransaction, actor: ActorContext, cid: string, operationId: string, input: Row) {
  if (actor.principal.kind !== 'admin' || input.action !== 'correct') return;
  for (const opened of await questions(tx, actor.enterpriseId, cid)) {
    const prior = await progress(tx, actor.enterpriseId, String(opened.id)), payload = prior?.payload as Row | undefined;
    if (!payload?.sourceFactId || payload.sourceMessageId !== input.sourceMessageId || (opened.payload as Row).field !== input.field) continue;
    let stageReview: Row | undefined;
    if (!await constructionNoticeAvailable(tx, actor.enterpriseId, cid, String(opened.question_message_id), true, true)
      && !await reviewedStageAvailable(tx, actor.enterpriseId, cid, opened, payload)) {
      const scope = await constructionFollowUpScope(tx, actor.enterpriseId, cid, opened.payload as Row, true);
      const oldStage = (payload.stageReview as Row | undefined)?.stageKey || (opened.payload as Row).stageKey;
      if (!scope || scope.stageKey === oldStage || scope.settingsVersion !== Number((opened.payload as Row).settingsVersion)) continue;
      const original = await storedSupplement(tx, actor.enterpriseId, cid, opened, payload);
      if (!original || !await onlyStageDependencies(tx, actor.enterpriseId, cid, opened, original.fact.sourceMessageId)) continue;
      stageReview = { ...scope, reviewKey: operationId, reviewerId: actor.principal.adminId,
        sourceMessageId: original.fact.sourceMessageId, sourceMessageHash: original.originalHash };
    }
    await appendProgress(tx, actor, opened, 'staff:' + operationId, { status: 'awaiting_review', lastProgress: 'designer_review', ...(stageReview ? { stageReview } : {}) });
  }
}

export async function queryNeedIssues(tx: PostgresTransaction, actor: ActorContext, conversationId: string): Promise<NeedIssueSnapshot> {
  if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  const eid = actor.enterpriseId, uid = actor.principal.userId, cid = id(conversationId);
  const conversation = await one(tx, sql`select c.* from app.assistant_conversations c join app.assistant_participants p on p.enterprise_id=c.enterprise_id
    and p.conversation_id=c.id and p.user_id=${uid} and p.status='active' where c.enterprise_id=${eid} and c.id=${cid}
    and c.purpose='customer_consultation' and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false) for share of c,p`);
  if (!conversation) fail('assistant_resource_not_found', 404);
  const facts = (await availableNeedMemory(tx, eid, cid, conversation.entry_snapshot)).facts, data: IssueState[] = [], lines: string[] = [];
  for (const opened of await questions(tx, eid, cid)) {
    const payload = opened.payload as Row;
    if (String(payload.customerId) !== uid) continue;
    const last = await progress(tx, eid, String(opened.id)), current = last?.payload as Row | undefined;
    const state: IssueState = { issueId: String(opened.id), revision: Number(last?.aggregate_version || 1), projectId: String(payload.projectId),
      room: '', field: '', status: 'invalidated', waitingFor: 'unassigned', ownerName: '', sourceMessageId: null, sourceFactId: null, lastProgress: '', question: '', value: '' };
    const noticeAvailable = await constructionNoticeAvailable(tx, eid, cid, String(opened.question_message_id), true, true);
    const reviewedStage = !noticeAvailable && await reviewedStageAvailable(tx, eid, cid, opened, current);
    if (!noticeAvailable && !reviewedStage) {
      data.push(state); lines.push('有一项原节点补充已失效，需团队按当前安排重新核对，旧内容不再用于跟进。'); continue;
    }
    const fact = current?.sourceFactId ? facts.find(f => f.id === current.sourceFactId && f.status === 'current' && fingerprint(f) === current.sourceHash) : null;
    const origin = fact ? await one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid}
      and id=${fact.sourceMessageId} and author_kind='user' for share`) : null;
    const pendingReview = reviewedStage && !fact && current?.lastProgress === 'designer_review'
      && !!await storedSupplement(tx, eid, cid, opened, current);
    if (current?.sourceFactId && !pendingReview && (!fact || !origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)
      || (current.sourceMessageHash && fingerprint(origin.content) !== current.sourceMessageHash))) {
      data.push(state); lines.push('有一项补充来源已更正或不可用，需重新核对，不能沿用旧结果。'); continue;
    }
    const handoff = (conversation.entry_snapshot as Row).handoff as Row | undefined;
    const owner = await currentHandoffOwner(tx, eid, cid, handoff);
    Object.assign(state, { room: String(payload.room), field: String(payload.field), question: noticeAvailable ? String(payload.question) : '', value: fact?.value || '',
      status: fact || pendingReview ? 'awaiting_review' : 'awaiting_customer', waitingFor: fact || pendingReview ? owner ? 'designer' : 'unassigned' : 'customer',
      ownerName: owner ? String(owner.display_name || owner.username) : '', sourceMessageId: fact?.sourceMessageId || null, sourceFactId: fact?.id || null,
      lastProgress: String(current?.lastProgress || '') });
    data.push(state);
    lines.push(pendingReview ? `${state.room || '全屋'}补充：已有内部核对记录。${owner ? '当前由' + state.ownerName + '接续核对' : '尚未分配有权接续的设计师'}。仍待核对，不代表正式方案已批准或现场问题已解决。`
      : fact ? `${state.room || '全屋'}补充：“${fact.quote}”。${owner ? '当前由' + state.ownerName + '接续核对' : '尚未分配有权接续的设计师'}。`
      + (state.lastProgress === 'designer_review' ? '已有内部核对记录。' : state.lastProgress === 'designer_reply' ? '设计师已在原对话回复。' : '')
      + '仍待核对，不代表正式方案已批准或现场问题已解决。' : `${state.room || '全屋'}补问：“${state.question}”。等待你方便时补充，可以继续聊其他问题。`);
  }
  const siteResults = await customerSiteResults(tx, eid, uid, cid), returned = new Set(siteResults.map(r => r.issueId));
  for (const result of siteResults) {
    data.push({ issueId: result.issueId, revision: result.revision, projectId: result.projectId, room: result.room, field: 'site_result',
      status: result.status, waitingFor: result.waitingFor, ownerName: result.ownerName, sourceMessageId: result.messageId, sourceFactId: null,
      lastProgress: ['closed','resolved','awaiting_owner','cancelled'].includes(result.status) ? result.status : 'team_result', question: '', value: result.text, kind: 'team_result', sourceVersion: result.sourceVersion });
    lines.push(result.status === 'invalidated' ? `事项${result.issueId}的原团队回传已失效，等待项目团队按当前资料重新核对，旧结果不能沿用。`
      : `${result.room}事项${result.issueId} · 修订${result.revision}，团队明确回传：${result.text}`
        + (result.status === 'awaiting_review' ? '\n仍待项目团队核对，不代表已解决、已正式批准或可以据此施工。' : ''));
  }
  // A shared need is a durable design-review item before any team result exists.
  // Only status/assignee is exposed; internal replies and evidence stay private.
  // Human reception answers through the receptionist, not this read model.
  for (const review of conversation.mode === 'ai' ? await customerNeedReviews(tx, eid, uid, cid) : []) {
    if (returned.has(review.issueId)) continue;
    data.push({ issueId: review.issueId, revision: review.revision, projectId: review.projectId, room: review.room, field: 'need_review',
      status: review.status as IssueState['status'], waitingFor: review.waitingFor, ownerName: review.ownerName, sourceMessageId: null,
      sourceFactId: null, lastProgress: 'need_review', question: '', value: review.text, kind: 'need_review' });
    lines.push(review.text);
  }
  for (const plan of await customerPlans(tx, eid, uid, cid)) {
    const status = plan.status === 'pending_customer' ? 'awaiting_customer' : plan.status as IssueState['status'];
    data.push({ issueId: plan.issueId, revision: plan.revision, projectId: plan.projectId, room: plan.roomName, field: 'formal_plan',
      status, waitingFor: ['pending_customer','deferred'].includes(plan.status) ? 'customer' : 'team', ownerName: '项目团队',
      sourceMessageId: plan.messageId, sourceFactId: null, lastProgress: plan.status, question: '', value: plan.text,
      kind: 'formal_plan', sourceVersion: plan.hash });
    lines.push(plan.text);
  }
  return { query: { domain: 'followups', conversationId: cid }, customerId: uid, leadIds: [], version: fingerprint(data), data,
    displayText: lines.join('\n') || '这次咨询目前没有可接续的节点补充事项或已回传的团队结果。', queriedAt: new Date().toISOString() };
}
export async function needIssueSnapshotAvailable(tx: PostgresTransaction, enterpriseId: string, snapshot: NeedIssueDependency) {
  try { return (await queryNeedIssues(tx, { enterpriseId, principal: { kind: 'user', userId: snapshot.customerId }, contextVersion: 0, capabilities: [] }, snapshot.query.conversationId)).version === snapshot.version; }
  catch { return false; }
}
