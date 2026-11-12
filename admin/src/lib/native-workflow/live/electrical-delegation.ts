import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { readSiteIssueBase, type IssueView } from '@/lib/construction/site-issues';
import { readPlan } from '@/lib/construction/site-plans';
import { readSiteResolution } from '@/lib/construction/site-resolution';
import { collaborationEnabled } from '@/lib/construction/collaboration-scope';
import { delegationOwnerReceipt } from './delegation-chat';
import { activeProjectStaff, electricalEvidence, electricalInputs, soleProjectStaff, type DelegationInput } from './delegation-inputs';
import { delegationNotice, setDelegationWait, type Delegation, type DelegationAction, type DelegationTask, type DelegationWait } from './delegation-state';
import { appendDelegationEvent, type DelegationEvent } from './delegation-store';

async function findIssue(tx: PostgresTransaction, d: Delegation, task: DelegationTask, needGrantId?: string) {
  if (needGrantId && collaborationEnabled(d.enterpriseId)) {
    const opened = await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${d.enterpriseId}
      and type='construction.site.issue.opened.v1' and payload->>'sourceKind'='need' and payload->>'projectId'=${d.projectId}
      and payload->>'roomId'=${task.roomId} and payload->>'customerId'=${d.requesterId} order by id desc limit 1`);
    if (opened) {
      const issue = await readSiteIssueBase(tx, d.enterpriseId, d.projectId, String(opened.id));
      if (issue?.needGrantId === needGrantId) return issue;
    }
  }
  if (task.issueId) return readSiteIssueBase(tx, d.enterpriseId, d.projectId, task.issueId);
  const candidates = await rows(tx, sql`select id::text,payload from app.domain_event_outbox
    where enterprise_id=${d.enterpriseId} and type='construction.site.issue.opened.v1'
      and payload->>'projectId'=${d.projectId} and payload->>'roomId'=${task.roomId} order by id desc limit 12`);
  const matched: IssueView[] = [];
  for (const candidate of candidates) {
    const issue = await readSiteIssueBase(tx, d.enterpriseId, d.projectId, String(candidate.id));
    if (issue && issue.status !== 'cancelled' && /插座|底盒/.test(issue.text)) matched.push(issue);
  }
  // Binding by room alone is ambiguous if multiple existing outlet issues match.
  return matched.length === 1 ? matched[0] : null;
}

async function findOpinion(tx: PostgresTransaction, d: Delegation, issue: IssueView | null, drawingGrantId: string | null) {
  if (!issue || !issue.sourceAvailable || issue.status !== 'awaiting_review' || !issue.progressMessageId) return null;
  if (drawingGrantId && issue.drawingGrantId !== drawingGrantId) return null;
  const reply = await one(tx, sql`select id::text,actor_ref from app.domain_event_outbox
    where enterprise_id=${d.enterpriseId} and type='construction.site.issue.progress.v1'
      and aggregate_id=${issue.issueId} and correlation_id=${issue.progressMessageId} and payload->>'action'='reply'`);
  const author = (reply?.actor_ref as Row | undefined)?.adminId;
  return author && await activeProjectStaff(tx, d.enterpriseId, d.projectId, String(author)) === 'designer' ? String(reply!.id) : null;
}

async function currentPlan(tx: PostgresTransaction, d: Delegation, issue: IssueView | null) {
  if (!issue?.sourceAvailable) return null;
  const saved = await one(tx, sql`select id::text from app.domain_event_outbox
    where enterprise_id=${d.enterpriseId} and type='construction.plan.published.v1'
    and aggregate_type='construction_site_issue' and aggregate_id=${issue.issueId}
    order by aggregate_version desc limit 1`);
  const plan = saved && await readPlan(tx, d.enterpriseId, String(saved.id));
  return plan && plan.conversationId === d.conversationId && plan.customerId === d.requesterId ? plan : null;
}

async function verifiedResult(tx: PostgresTransaction, d: Delegation, issue: IssueView) {
  const resolution = await readSiteResolution(tx, d.enterpriseId, d.projectId, issue.issueId, issue);
  const result = resolution?.available && ['resolved','closed'].includes(resolution.state)
    ? await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${d.enterpriseId} and type='construction.site.issue.result.v1'
      and aggregate_id=${issue.issueId} and payload->>'lifecycleId'=${resolution.id}
      and payload->>'conversationId'=${d.conversationId} and payload->>'customerId'=${d.requesterId}`)
    : null;
  return { resolution, resultEventId: result ? String(result.id) : undefined };
}

async function observedEvidence(tx: PostgresTransaction, d: Delegation, task: DelegationTask,
  input: DelegationInput, event: DelegationEvent, approvedPlanId?: string) {
  const before = task.evidence;
  const ids = new Set<string>();
  if (before) ids.add(before.recordId);
  if (input.recordId && (!before || BigInt(input.recordId) >= BigInt(before.recordId))) ids.add(input.recordId);
  if (input.kind === 'refresh') {
    const candidates = await rows(tx, sql`select id::text from app.construction_site_records
      where enterprise_id=${d.enterpriseId} and project_id=${d.projectId} and room_id=${task.roomId}
        and status in ('organizing','draft','published') order by id desc limit 12`);
    for (const candidate of candidates) ids.add(String(candidate.id));
  }
  for (const recordId of [...ids].sort((a, b) => BigInt(a) > BigInt(b) ? -1 : 1)) {
    const evidence = await electricalEvidence(tx, d, task, recordId, event, task.kind);
    if (!evidence) continue;
    if (approvedPlanId) {
      // A same-room upload can be submitted for review only after exact plan
      // approval. Formal implementation still requires the existing explicit binding.
      const afterApproval = await one(tx, sql`select r.id from app.construction_site_records r
        join app.domain_event_outbox e on e.enterprise_id=r.enterprise_id and e.type='construction.plan.status.v1'
          and e.aggregate_id=${approvedPlanId} and e.payload->>'status'='approved'
        where r.enterprise_id=${d.enterpriseId} and r.project_id=${d.projectId} and r.id=${recordId} and r.created_at>=e.created_at limit 1`);
      if (!afterApproval || !evidence.photoIds.length || !evidence.complete) continue;
    }
    return evidence;
  }
  return undefined;
}

async function followProgress(tx: PostgresTransaction, d: Delegation, task: DelegationTask, input: DelegationInput, event: DelegationEvent, now: Date) {
  const evidence = await observedEvidence(tx, d, task, input, event);
  const next = !evidence ? 'collect_report' : evidence.status === 'failed' ? 'retry_report'
    : evidence.status === 'organizing' ? 'organize_report' : evidence.status === 'reported' ? 'review_report'
    : evidence.complete ? 'done' : 'collect_report';
  const target = next === 'review_report' ? { for: 'manager' as const, personId: await soleProjectStaff(tx, d, 'manager'), requested: ['核对现场水电记录'] }
    : next === 'collect_report' ? { for: 'worker' as const, personId: await soleProjectStaff(tx, d, 'worker'), requested: ['上报现场水电进展'] } : null;
  return setDelegationWait({ ...task, evidence }, next, event.id, now, target);
}

function missingOwnerInputs(facts: Awaited<ReturnType<typeof electricalInputs>>['facts']) {
  return [
    ...(!facts.some(fact => fact.field === 'desk') ? ['书桌放在哪里'] : []),
    ...(!facts.some(fact => fact.field === 'devices' || fact.field === 'use') ? ['插座主要供哪些设备使用'] : []),
  ];
}

async function requestStaffReview(tx: PostgresTransaction, d: Delegation, next: DelegationTask, previous: DelegationTask, event: DelegationEvent) {
  const shouldNotify = ['assign_designer','review_design','review_work','recheck_source'].includes(next.next);
  if (!shouldNotify) return { ...next, staffNoticeId: undefined };
  const sameBasis = previous.basis?.materialVersion === next.basis?.materialVersion && previous.basis?.scheduleVersion === next.basis?.scheduleVersion
    && previous.issueId === next.issueId && previous.issueRevision === next.issueRevision
    && previous.evidence?.recordId === next.evidence?.recordId && previous.evidence?.version === next.evidence?.version;
  if (previous.staffNoticeId && next.wait?.key === previous.wait?.key && previous.next === next.next && sameBasis)
    return { ...next, staffNoticeId: previous.staffNoticeId };

  const issue = next.issueId ? `（事项${next.issueId}）` : '';
  const text = next.next === 'review_work' ? `${next.roomName}插座${issue}有现场材料待复核。请核对对应方案、现场记录和照片。`
    : next.next === 'recheck_source' ? `${next.roomName}插座${issue}的执行依据已变化，请重新核对当前资料与正式方案。`
    : next.next === 'assign_designer' ? `请项目负责人为${next.roomName}插座${issue}安排有权核对的设计师。`
    : `请核对${next.roomName}插座${issue}的需求和有效图纸，再走现有的方案确认流程。`;
  const basisKey = fingerprint({ action: next.next, issue: next.issueId, revision: next.issueRevision,
    material: next.basis?.materialVersion, schedule: next.basis?.scheduleVersion,
    record: next.evidence?.recordId, recordVersion: next.evidence?.version, assignee: next.wait?.personId });
  const key = `staff:${d.projectId}:${next.roomId}:${basisKey}`;
  const inserted = await appendDelegationEvent(tx, d.enterpriseId, delegationNotice, key, 1,
    { projectId: d.projectId, roomId: next.roomId, sourceEventId: event.id, audience: 'staff', text });
  const prior = !inserted && await one(tx, sql`select id::text from app.domain_event_outbox where enterprise_id=${d.enterpriseId}
    and type=${delegationNotice} and aggregate_type='native_workflow_delegation' and aggregate_id=${key} and aggregate_version=1`);
  return { ...next, staffNoticeId: inserted ?? (prior ? String(prior.id) : undefined) };
}

async function followOutlets(tx: PostgresTransaction, d: Delegation, previous: DelegationTask, input: DelegationInput,
  event: DelegationEvent, origin: Row, now: Date) {
  const { basis, need, drawing, facts } = await electricalInputs(tx, d, previous, origin, event);
  const issue = await findIssue(tx, d, previous, need?.id);
  const plan = await currentPlan(tx, d, issue);
  const opinionEventId = await findOpinion(tx, d, issue, basis.drawingGrantId);
  // A requirement correction is private until explicitly shared. A prior
  // grant remains historical, but may not authorize a changed execution basis.
  const previousGrant = previous.basis?.needGrantId;
  const factChanges = previous.basis && fingerprint(previous.basis.factIds) !== fingerprint(basis.factIds);
  const changePendingShare = !!previousGrant && previousGrant === basis.needGrantId
    && (Boolean(factChanges) || previous.next === 'share_need');
  const planSchedule = previous.plan?.id === plan?.id && previous.plan ? previous.plan.scheduleVersion : basis.scheduleVersion;
  const planBasisChanged = !!plan && planSchedule !== basis.scheduleVersion;
  const materialStale = !!previous.plan && !plan;
  const versionedPlan = plan ? { id: plan.id, hash: plan.hash, revision: plan.revision, status: plan.status, scheduleVersion: planSchedule } : undefined;
  let task: DelegationTask = { ...previous, basis, issueId: issue?.issueId ?? previous.issueId, issueRevision: issue?.revision, issueStatus: issue?.status,
    opinionEventId: opinionEventId ?? undefined, plan: versionedPlan, resultEventId: undefined };

  let next: DelegationAction;
  let target: Omit<DelegationWait, 'key' | 'startedAt' | 'deadlineAt' | 'timedOutAt'> | null = null;
  if (issue?.status === 'cancelled' || planBasisChanged) {
    next = 'recheck_source';
  } else if (changePendingShare) {
    next = 'share_need';
    target = { for: 'owner', personId: d.requesterId, requested: ['确认是否将更新后的需求共享给项目团队'] };
  } else if (plan?.status === 'approved' && issue) {
    const result = await verifiedResult(tx, d, issue);
    const samePlan = previous.plan?.id === plan.id;
    const proof = result.resolution?.available ? result.resolution.evidence : undefined;
    const evidence = collaborationEnabled(d.enterpriseId) ? proof && await electricalEvidence(tx, d, task, proof.recordId, event, task.kind) || undefined
      : await observedEvidence(tx, d, samePlan ? task : { ...task, evidence: undefined }, input, event, plan.id);
    task = { ...task, evidence, issueStatus: result.resolution?.available ? result.resolution.state : task.issueStatus, resultEventId: result.resultEventId };
    next = result.resultEventId ? 'done' : evidence?.photoIds.length || result.resolution?.available && result.resolution.state === 'implemented' ? 'review_work' : 'perform_work';
    if (next === 'review_work') target = { for: 'manager', personId: await soleProjectStaff(tx, d, 'manager'), requested: ['复核现场记录、照片和本次方案'] };
    if (next === 'perform_work') target = { for: 'worker', personId: await soleProjectStaff(tx, d, 'worker'), requested: ['上报已确认方案的现场进展和照片'] };
  } else if (plan && ['pending_customer','deferred'].includes(plan.status)) {
    next = 'authorize_plan';
    target = { for: 'owner', personId: d.requesterId, requested: ['查看并决定当前正式方案版本'] };
  } else if (plan || materialStale || previous.next === 'recheck_source' && issue?.status === 'invalidated') {
    next = 'recheck_source';
  } else if (opinionEventId && need) {
    next = 'authorize_plan';
    target = { for: 'manager', personId: await soleProjectStaff(tx, d, 'manager'), requested: ['按原流程核对并提交正式方案'] };
  } else if (need || drawing) {
    const designer = issue?.ownerId && await activeProjectStaff(tx, d.enterpriseId, d.projectId, issue.ownerId) === 'designer'
      ? issue.ownerId : await soleProjectStaff(tx, d, 'designer');
    next = designer ? 'review_design' : 'assign_designer';
    target = designer ? { for: 'designer', personId: designer, requested: ['核对现有需求和有效图纸，明确仍缺的信息'] }
      : { for: 'manager', personId: await soleProjectStaff(tx, d, 'manager'), requested: ['指定设计核对人'] };
  } else {
    const missing = basis.replyMessageId ? [] : missingOwnerInputs(facts);
    next = missing.length ? 'ask_owner' : 'share_need';
    target = { for: 'owner', personId: d.requesterId, requested: missing.length ? missing : ['确认是否将这次补充共享给项目团队'] };
  }

  if (!['perform_work','review_work','done'].includes(next)) task = { ...task, evidence: undefined };
  task = setDelegationWait(task, next, event.id, now, target);
  task = await requestStaffReview(tx, d, task, previous, event);
  if (task.wait && task.wait.key !== previous.wait?.key && origin.mode === 'ai') {
    if (next === 'ask_owner') await delegationOwnerReceipt(tx, d, `${d.id}:${task.key}:ask:${task.wait.key}`,
      `为了继续核对${task.roomName}的插座，请补充：${task.wait.requested.join('，')}？`, { waitKey: task.wait.key });
    if (next === 'share_need') await delegationOwnerReceipt(tx, d, `${d.id}:${task.key}:share:${task.wait.key}`,
      `已把你的补充接到${task.roomName}插座跟进。请确认要共享给项目团队的这次需求，再请设计师核对。`);
  }
  return task;
}

export async function applyElectricalDelegationTask(tx: PostgresTransaction, d: Delegation, task: DelegationTask,
  input: DelegationInput, event: DelegationEvent, origin: Row, now: Date) {
  const room = await one(tx, sql`select name from app.construction_rooms
    where enterprise_id=${d.enterpriseId} and project_id=${d.projectId} and id=${task.roomId}`);
  if (!room) return { ...task, next: 'room_removed' as const, wait: undefined, staffNoticeId: undefined };
  if (room.name !== task.roomName) return { ...task, next: 'recheck_source' as const, wait: undefined, staffNoticeId: undefined };
  return task.kind === 'progress' ? followProgress(tx, d, task, input, event, now) : followOutlets(tx, d, task, input, event, origin, now);
}
