import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { newRun } from '@/lib/assistant/core/conversation';
import { AssistantError, fail, safeText, type MessageContent } from '@/lib/assistant/contracts';
import { currentSynthesisContext } from '@/lib/assistant/agent/synthesis-sources';
import { specialistPolicy } from '@/lib/assistant/specialists/consultation';
import { parseSpecialistOutput, specialists } from '@/lib/assistant/specialists/registry';
import { configuredPublicRead, publicDocumentPages, publicDocumentReadFailures } from '@/lib/assistant/agent/public-research';
import { fetchPublicDocument } from '@/lib/assistant/web-search/page';
import { reviewedStandardTopic } from '@/lib/assistant/web-search/standards';
import { readSiteIssueBase } from '@/lib/construction/site-issues';
import { constructionRead } from '@/lib/construction/customer';
import { openSpecialistSiteIssue, specialistSiteRecord } from '@/lib/construction/specialist-issues';
import { readSiteResolution } from '@/lib/construction/site-resolution';
import { syncSiteResults, validResult } from '@/lib/construction/site-results';
import { workflowIssue } from '../errors';
import { getNativeWorkflowService } from '../server';
import type { PendingOperation, WorkflowValue } from '../types';
import { delegationActor, type ReviewDelegationEvent } from './delegation-review-store';
import { delegationRefresh, outcome, type DelegationOutcome, type ReviewDelegation } from './delegation-state';
import { checkDelegationStandards } from './delegation-knowledge';
import { createPostgresDurableTaskStore } from './durable-task-postgres-store';
import { createDurableTaskRuntime } from './durable-task-runtime';
import type { DurableTaskData } from './durable-task-types';
import { createPostgresWorkflowRunStore } from './runtime-postgres-stores';
import { runPublishedLive } from './runner';
import { LiveOperationFailure, LiveOperationWaiting } from './types';

export const specialistWorkflowRunId = (id: string) => 'specialist:' + id;

async function readWaterproofPublicStandard() {
  const standard = reviewedStandardTopic('防水')!;
  const signal = AbortSignal.timeout(23_000);
  try {
    const notice = await fetchPublicDocument(standard.noticeUrl, { signal });
    const attachment = notice.attachments?.find(link => link.title.replace(/\.pdf$/i, '') === standard.standard.name);
    if (!attachment || notice.injectionSignals.length || notice.standard?.id !== standard.standard.id)
      return { status: 'unavailable', error: 'web_attachment_not_found' };
    const original = await configuredPublicRead(attachment.url, 20_000, signal);
    const pages = publicDocumentPages(original, new Date().toISOString(), '室内防水 管根 验收');
    const sources = pages.filter(page => page.document?.reviewedTextHash).map(page => ({
      url: page.url, hash: page.document!.hash, page: page.document!.page, section: page.document!.section, role: page.standard?.kind,
    }));
    return { status: sources.length ? 'ready' : 'unavailable', standardId: standard.standard.id, sources,
      failures: publicDocumentReadFailures(original, pages) };
  } catch (error) {
    return { status: 'unavailable', error: error instanceof AssistantError ? error.code : 'web_reader_unavailable' };
  }
}

export async function startSpecialistAnalysis(tx: PostgresTransaction, d: ReviewDelegation, conversation: Row, workflowRunId: string) {
  const prior = await one(tx, sql`select id::text,status,output_message_id::text,error_code from app.assistant_runs
    where enterprise_id=${d.enterpriseId} and conversation_id=${d.conversationId} and trigger_message_id=${d.originMessageId}
    and purpose='specialist.workflow' and policy_snapshot#>>'{specialistRun,workflowRunId}'=${workflowRunId}
    order by id desc limit 1`);
  if (prior) return prior;
  // Reuse the original signed owner context. Do not mint a fresh login context
  // for a delegation after its author's session has been revoked.
  const origin = await one(tx, sql`select policy_snapshot->'actor' as actor from app.assistant_runs
    where enterprise_id=${d.enterpriseId} and id=${d.scope.workflow!.originRunId}
    and conversation_id=${d.conversationId} and trigger_message_id=${d.originMessageId}`);
  const actor = origin?.actor as import('@/lib/assistant/contracts').ActorContext | undefined;
  if (!actor || actor.enterpriseId !== d.enterpriseId || actor.principal.kind !== 'user' || actor.principal.userId !== d.ownerId)
    fail('context_changed');
  const settings = await new AssistantRepository(tx, actor).settings(true);
  if (!settings) fail('context_changed');
  const queued = await newRun(tx, actor, conversation, settings, d.originMessageId, undefined, undefined, 'specialist.workflow',
    undefined, { delegationId: d.id, workflowRunId });
  return { id: queued.runId, status: 'queued' };
}

/** One version-bound graph advances inside the existing leased outbox delivery.
 * Reads, construction writes and waiting checkpoints commit with its receipt. */
export async function advanceSpecialistDelegation(tx: PostgresTransaction, d: ReviewDelegation, conversation: Row,
  event: ReviewDelegationEvent, now: Date): Promise<DelegationOutcome> {
  const binding = d.scope.workflow!;
  const agent = specialists.version(binding.agentId, binding.agentVersion);
  if (!agent || agent.status !== 'active' || agent.workflowTemplateId !== binding.templateId) return outcome('waiting_for_authorization');
  const settings = await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${d.enterpriseId}`);
  if (!specialistPolicy(d.enterpriseId, settings?.agent_config as Parameters<typeof specialistPolicy>[1] ?? { tools: false, providerKey: '', model: '' }))
    return outcome('waiting_for_authorization');
  const runId = specialistWorkflowRunId(d.id);
  const store = createPostgresWorkflowRunStore(d.enterpriseId, tx);
  const { record } = await getNativeWorkflowService().getDefinition(binding.templateId);
  const published = record.versions.find(version => version.revision === binding.revision && version.digest === binding.digest);
  if (!published) throw new Error('delegation_workflow_version_unavailable');

  const runtime = createDurableTaskRuntime({ store: createPostgresDurableTaskStore({ tx, enterpriseId: d.enterpriseId }), now: () => now });
  const wait = async (operation: PendingOperation, code: string, result: Readonly<Record<string, DurableTaskData>> | null = null): Promise<Readonly<Record<string, WorkflowValue>>> => {
    const { record } = await runtime.create({
      enterpriseId: d.enterpriseId, projectId: d.projectId, kind: 'workflow.event_wait',
      businessKey: operation.idempotencyKey, delegation: { requestedBy: d.ownerId, conversationId: d.conversationId,
        messageId: d.originMessageId, runId, delegationId: d.id },
      timeouts: { taskTimeoutMs: 30 * 24 * 3600_000 }, data: { capability: operation.capabilityRef, nodeId: operation.nodeId },
    });
    if (record.status === 'succeeded' && record.data.result) return record.data.result as Record<string, WorkflowValue>;
    if (Date.parse(record.deadlineAt) <= now.getTime()) {
      await runtime.recover(d.enterpriseId, { taskId: record.taskId, limit: 1 });
      throw new LiveOperationFailure(workflowIssue('specialist_wait_expired', operation.nodeId, '等待超时'));
    }
    if (record.status === 'pending' || record.status === 'queued' || result) {
      const owner = 'delegation:' + event.id;
      const identity = { enterpriseId: d.enterpriseId, taskId: record.taskId, owner };
      if (record.status === 'pending') await runtime.enqueue(identity);
      const lease = record.status === 'waiting'
        ? await runtime.acquire({ ...identity, token: randomUUID() })
        : await runtime.claim(identity);
      if (!lease) throw new Error('delegation_wait_busy');
      const ref = { ...identity, token: lease.lease.token };
      try {
        if (result) {
          if ((await runtime.complete({ ...ref, data: { eventId: event.id, result } })).status !== 'succeeded')
            throw new Error('delegation_wait_expired');
          return result;
        }
        await runtime.wait({ ...ref, code, reason: code, wakeAt: null });
      } finally {
        await runtime.release(ref);
      }
    }
    throw new LiveOperationWaiting(code);
  };

  const result = await runPublishedLive({
    published, runId, enterpriseId: d.enterpriseId, projectId: d.projectId,
    event: { eventType: 'specialist_followup', eventId: 'request:' + d.id, occurredAt: d.createdAt.toISOString() },
    businessEvent: { source: 'outbox', outboxEventId: null, progressRevision: 0, stageKey: 'waterproof', settingsVersion: 1 },
    store, resume: true, wakeEventId: event.id,
    ports: { async execute(operation): Promise<Readonly<Record<string, WorkflowValue>>> {
      switch (operation.capabilityRef) {
        case 'read.specialist_project': {
          const scope = conversation.entry_snapshot as Row;
          const current = await constructionRead(tx, d.enterpriseId, d.ownerId, String(scope.id), { room: d.scope.roomName });
          const project = current.data[0];
          if (!project || project.projectId !== d.projectId || project.roomId !== d.scope.roomId) {
            throw new LiveOperationFailure(workflowIssue('specialist_project_unavailable', operation.nodeId, '项目或房间已失效'));
          }
          return { project: { id: d.projectId, roomId: d.scope.roomId, roomName: d.scope.roomName, stage: project.stageKey,
            revision: project.version, recordIds: (project.records as Array<{id: string}>).map(row => row.id) } };
        }
        case 'read.specialist_knowledge': {
          const enterprise = await checkDelegationStandards(tx, d, conversation, AbortSignal.timeout(6_000));
          return { enterprise };
        }
        case 'read.specialist_public_standard':
          return { publicStandard: await readWaterproofPublicStandard() };
        case 'compose.stage_specialist': {
          if (operation.config?.agentId !== binding.agentId || operation.config.agentVersion !== binding.agentVersion)
            throw new LiveOperationFailure(workflowIssue('specialist_version_mismatch', operation.nodeId, '专业 Agent 版本不匹配'));
          const origin = await one(tx, sql`select status from app.assistant_runs where enterprise_id=${d.enterpriseId}
            and conversation_id=${d.conversationId} and id=${binding.originRunId}`);
          if (['queued', 'running'].includes(String(origin?.status))) throw new LiveOperationWaiting('specialist_request_pending');
          const analysisRun = await startSpecialistAnalysis(tx, d, conversation, runId);
          if (['queued', 'running'].includes(String(analysisRun.status))) throw new LiveOperationWaiting('specialist_analysis_pending');
          if (analysisRun.status !== 'succeeded' || !analysisRun.output_message_id) {
            throw new LiveOperationFailure(workflowIssue('specialist_analysis_failed', operation.nodeId, String(analysisRun.error_code ?? analysisRun.status)));
          }
          const actor = { ...delegationActor(d), capabilities: ['assistant.chat.self'] };
          const source = await currentSynthesisContext(tx, actor, conversation, String(analysisRun.id));
          const answer = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${d.enterpriseId}
            and conversation_id=${d.conversationId} and id=${String(analysisRun.output_message_id)}`);
          if (!answer) fail('context_changed');
          const usage = await one(tx, sql`select coalesce(sum(input_tokens),0)::int input,coalesce(sum(output_tokens),0)::int output
            from app.assistant_usage_records where enterprise_id=${d.enterpriseId} and run_id=${String(analysisRun.id)} and category='tokens'`);
          const analysis = parseSpecialistOutput({
            analysis: safeText(answer.content as MessageContent), evidence: [...source.knowledge, ...(source.web ?? [])],
            confirmedFacts: [], openQuestions: [], suggestedActions: [], needsHumanReview: true, needsWorkflow: true, receipt: null,
          });
          const ready = (operation.input.publicStandard as { status?: string }).status === 'ready'
            && !!source.web?.some(item => item.web?.document?.reviewedTextHash);
          return { ready, analysis: { agentId: agent.agentId, version: agent.version, runId: String(analysisRun.id),
            messageId: String(analysisRun.output_message_id), usage: usage ?? {}, evidence: analysis.evidence.map(({ ref, hash, web }) =>
              ({ ref, hash, ...(web ? { url: web.url, page: web.document?.page ?? null, role: web.standard?.kind ?? 'public' } : {}) })) } };
        }
        case 'wait.specialist_site_record': {
          const record = await specialistSiteRecord(tx, d);
          return wait(operation, 'specialist_waiting_for_site_record', record ? { record } : null);
        }
        case 'save.specialist_issue': {
          const input = operation.input.record as { id: string; version: number };
          try {
            const issue = await openSpecialistSiteIssue(tx, d, input);
            return { saved: true, saveReceipt: { receiptId: issue.issueId, revision: issue.revision, simulated: false } };
          } catch (error) {
            if (!(error instanceof AssistantError)) throw error;
            throw new LiveOperationFailure(workflowIssue(error.code, operation.nodeId, '无法登记当前现场事项'));
          }
        }
        case 'wait.specialist_review': {
          const { receiptId } = operation.input.issue as { receiptId: string };
          const review = await readSiteResolution(tx, d.enterpriseId, d.projectId, receiptId);
          const receipt = review?.available && ['resolved','closed'].includes(review.state)
            ? await one(tx, sql`select * from app.domain_event_outbox where enterprise_id=${d.enterpriseId}
              and type='construction.site.issue.result.v1' and aggregate_id=${receiptId}
              and payload->>'lifecycleId'=${review.id} and payload->>'conversationId'=${d.conversationId}
              and payload->>'customerId'=${d.ownerId}`) : null;
          const confirmed = receipt && review && await validResult(tx, d.enterpriseId, d.conversationId, receipt)
            ? { review: { eventId: String(receipt.id), id: review.id, issueId: receiptId, revision: review.revision } } : null;
          return wait(operation, 'specialist_waiting_for_review', confirmed);
        }
        case 'deliver.specialist_result': {
          const { eventId } = operation.input.review as { eventId: string };
          await syncSiteResults(tx, delegationActor(d), conversation, eventId);
          const message = await one(tx, sql`select id::text from app.assistant_messages where enterprise_id=${d.enterpriseId}
            and conversation_id=${d.conversationId} and source_event_id=${eventId} and purpose='construction.result'`);
          if (!message) throw new LiveOperationFailure(workflowIssue('specialist_delivery_unavailable', operation.nodeId, '原咨询结果不可投递'));
          return { delivered: true, deliveryReceipt: { receiptId: String(message.id), eventId, simulated: false } };
        }
        default: throw new LiveOperationFailure(workflowIssue('specialist_capability_invalid', operation.nodeId, '节点能力不可用'));
      }
    } },
  });

  const issue = result.operations.findLast(op => op.capabilityRef === 'save.specialist_issue' && op.outcome === 'succeeded');
  const issueId = (issue?.outputs?.saveReceipt as { receiptId?: string } | undefined)?.receiptId;
  const reviewed = result.operations.findLast(op => op.capabilityRef === 'wait.specialist_review' && op.outcome === 'succeeded');
  const receipt = reviewed?.outputs?.review as { id: string; revision: number; eventId: string; issueId: string } | undefined;
  const delivery = result.operations.findLast(op => op.capabilityRef === 'deliver.specialist_result' && op.outcome === 'succeeded');
  const messageId = (delivery?.outputs?.deliveryReceipt as { receiptId?: string } | undefined)?.receiptId;
  if (result.status === 'completed' && receipt && messageId)
    return outcome('completed', '现场资料经项目负责人复核，结果已回传本次咨询', null,
      { type: 'review', id: receipt.id, version: String(receipt.revision), issueId: receipt.issueId, messageId });
  if (result.status === 'failed' || result.status === 'halted') return outcome('failed', '防水核对暂未完成，请在原咨询查看或联系项目团队');
  if (result.status === 'unknown') return outcome('waiting_for_authorization', '核对结果待确认，请在原咨询查看', 'owner');
  const pending = published.definition.nodes.find(node => node.nodeId === result.state.pendingNodeId);
  if (pending?.type === 'agent') return outcome('running', '正在整理防水核对清单');
  if (pending?.type === 'human_review') return outcome('waiting_for_authorization', '事项已登记，等待项目负责人现场复核', 'reviewer',
    issueId ? { type: 'issue', id: issueId, version: String((issue?.outputs?.saveReceipt as {revision: number}).revision), issueId } : null);
  return outcome('waiting_for_worker', '等待施工人员提交该房间的防水现场资料', 'worker');
}

export async function specialistDelegationReadback(tx: PostgresTransaction, d: ReviewDelegation): Promise<DelegationOutcome> {
  if (!d.evidence?.issueId) return d;
  if (d.evidence.type === 'review' && d.evidence.messageId) {
    const event = await one(tx, sql`select e.* from app.domain_event_outbox e join app.assistant_messages m
      on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id
      where e.enterprise_id=${d.enterpriseId} and m.conversation_id=${d.conversationId} and m.id=${d.evidence.messageId}`);
    if (event && await validResult(tx, d.enterpriseId, d.conversationId, event)) return d;
  } else {
    const issue = await readSiteIssueBase(tx, d.enterpriseId, d.projectId, d.evidence.issueId);
    if (issue?.sourceAvailable && !['cancelled', 'dismissed'].includes(issue.status)) return d;
  }
  return outcome('waiting_for_authorization', '原现场资料或复核依据已变化，等待重新核对', 'reviewer');
}

export async function queueSpecialistAnalysisCompletion(tx: PostgresTransaction, eid: string, runId: string, status: string) {
  const task = await one(tx, sql`select r.policy_snapshot->'specialistRun' as binding from app.assistant_runs r
    where r.enterprise_id=${eid} and r.id=${runId}`);
  const id = (task?.binding as { delegationId: string } | null)?.delegationId;
  const target = await one(tx, sql`select id::text,project_id::text from app.native_workflow_delegations where enterprise_id=${eid}
    and current_status in ('pending','running') and ${id ? sql`id::text=${id}` : sql`scope#>>'{workflow,originRunId}'=${runId}`}`);
  if (!target) return;
  const targetId = String(target.id);
  const { appendDelegationEvent } = await import('./delegation-store');
  await appendDelegationEvent(tx, eid, delegationRefresh, targetId + ':assistant:' + runId, 1,
    { delegationId: targetId, projectId: String(target.project_id), assistantRunId: runId, status });
}
