import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { getCapability } from '../registry';
import type { WorkflowDefinition } from '../types';
import type { LiveRunRecord } from './types';

type RunIdentity = {
  id: string;
  status: string;
  scope: { workflow: { templateId: string; revision: number; digest: string; agentId: string; agentVersion: number } };
  evidence?: { issueId?: string; type: string; version: string } | null;
  createdAt: string;
  updatedAt: string;
};

function statusFor(record: LiveRunRecord | null, delegation: RunIdentity, agentStatus: unknown) {
  if (delegation.status === 'cancelled' || agentStatus === 'cancelled') return 'cancelled';
  if (record?.status === 'unknown' || agentStatus === 'indeterminate') return 'indeterminate';
  if (agentStatus === 'failed' || delegation.status === 'failed'
    || record?.status === 'failed' || record?.status === 'halted') return 'failed';
  if (delegation.status === 'completed' && record?.status === 'completed') return 'succeeded';
  if (delegation.status === 'paused' || delegation.status.startsWith('waiting_')) return 'waiting';
  if (agentStatus === 'queued' || !record && delegation.status === 'pending') return 'queued';
  if (agentStatus === 'running' || record?.status === 'running') return 'running';
  return record?.status === 'waiting' ? 'waiting' : 'queued';
}

export async function specialistStatus(tx: PostgresTransaction, enterpriseId: string, delegation: RunIdentity, record: LiveRunRecord | null,
  definition: WorkflowDefinition) {
  const workflow = delegation.scope.workflow;
  const runId = 'specialist:' + delegation.id;
  const job = await one(tx, sql`select r.id::text,r.status,r.error_code,r.policy_snapshot#>>'{agent,providerKey}' as provider from app.assistant_runs r
    join app.native_workflow_delegations d on d.enterprise_id=r.enterprise_id and d.conversation_id=r.conversation_id
      and d.origin_message_id=r.trigger_message_id
    where r.enterprise_id=${enterpriseId} and d.id=${delegation.id} and r.purpose='specialist.workflow'
      and r.policy_snapshot#>>'{specialistRun,workflowRunId}'=${runId} order by r.id desc limit 1`);
  const attempts = job ? await rows(tx, sql`select provider_key as adapter,remote_model as model,
    metadata#>>'{assistantResponse,providerModel}' as reported_model,
    metadata#>>'{assistantResponse,providerRequestId}' as request_id,metadata#>'{assistantResponse,usage}' as usage,
    coalesce(metadata->>'assistantWire',metadata#>>'{assistantResponse,observation,protocol}',metadata#>>'{assistantRequest,protocol}') as protocol,
    status,error_code,duration_ms from app.ai_provider_attempts where enterprise_id=${enterpriseId} and assistant_run_id=${String(job.id)}
    order by id limit 50`) : [];
  const usage = job ? await one(tx, sql`select sum(input_tokens)::int as input,sum(output_tokens)::int as output
    from app.assistant_usage_records where enterprise_id=${enterpriseId} and run_id=${String(job.id)} and category='tokens'`) : null;
  const status = statusFor(record, delegation, job?.status);
  const trace = record?.trace ?? [];
  const completedNodeIds = [...new Set(trace.flatMap(entry => entry.kind === 'node_succeeded' && entry.nodeId ? [entry.nodeId] : []))];
  const waitingNodeId = status === 'waiting' ? record?.state.pendingNodeId ?? null : null;
  const records = record?.operations ?? [];
  const publishedNodes = new Map(definition.nodes.map(node => [node.nodeId, node]));
  const analysis = records.findLast(operation => operation.capabilityRef === 'read.specialist_evidence'
    || operation.nodeVersion.startsWith('agent@'))?.outputs?.analysis as Row | undefined;
  const review = records.findLast(operation => operation.capabilityRef === 'wait.specialist_review')?.outputs?.review as Row | undefined;
  const issue = records.findLast(operation => operation.nodeVersion.startsWith('create_issue@'))?.outputs?.saveReceipt as Row | undefined;
  const sources = (analysis?.evidenceRefs ?? analysis?.evidence ?? []) as Array<Row>;
  const evidence = sources.map(source => {
    const ref = source.ref as Row | undefined;
    return { type: source.kind ?? ref?.type ?? null, id: ref?.id ?? null, version: ref?.version ?? null,
      hash: source.hash ?? null, standardId: source.standardId ?? null, page: source.page ?? null,
      originalHash: source.originalHash ?? null, url: source.url ?? null };
  });
  const nodeSummaries = definition.nodes.flatMap<{ nodeId: string; branch?: unknown; itemCount?: number }>(node => {
    const outputs = record?.state.outputs[node.nodeId];
    if (!completedNodeIds.includes(node.nodeId) || !outputs) return [];
    if (node.type === 'condition') return [{ nodeId: node.nodeId, branch: outputs.branch ?? outputs.result }];
    if (node.type === 'checklist' || node.type === 'request_material') {
      const items = outputs.checklist ?? outputs.missing;
      return [{ nodeId: node.nodeId, itemCount: Array.isArray(items) ? items.length : 0 }];
    }
    return [];
  });
  return {
    binding: { runId, definitionId: workflow.templateId, revision: workflow.revision, digest: workflow.digest,
      agentId: workflow.agentId, agentVersion: workflow.agentVersion },
    status, currentNodeId: record?.state.pendingNodeId ?? (record?.status === 'completed' ? null : record?.state.currentNodeId ?? null),
    completedNodeIds, waitingNodeId, recoveryCount: trace.filter(entry => entry.kind === 'run_resumed').length,
    createdAt: record?.createdAt ?? delegation.createdAt, updatedAt: record?.updatedAt ?? delegation.updatedAt,
    error: record?.state.error ? { code: record.state.error.code, path: record.state.error.path }
      : job?.error_code ? { code: String(job.error_code), path: null } : null,
    model: { runId: job?.id ?? null, status: job?.status ?? null, provider: job?.provider ?? null, attempts, usage },
    humanReview: { status: status === 'waiting' && record?.status === 'completed' ? 'recheck_required'
      : review ? review.state ?? 'reviewed' : issue ? 'waiting' : 'not_started',
      issueId: delegation.evidence?.issueId ?? issue?.receiptId ?? null,
      reviewId: review?.id ?? null, reviewVersion: review?.revision ?? null },
    evidence, nodeSummaries,
    operations: records.map(operation => ({
      nodeId: operation.nodeId, capability: operation.capabilityRef, version: operation.nodeVersion, status: operation.outcome,
      durationMs: Date.parse(operation.finishedAt) - Date.parse(operation.startedAt),
      inputPorts: Object.keys(getCapability(operation.capabilityRef)?.inputs ?? {}),
      inputs: publishedNodes.get(operation.nodeId)?.inputs ?? {},
      config: publishedNodes.get(operation.nodeId)?.config ?? {},
      outputPorts: Object.keys(operation.outputs ?? {}),
      ...(operation.error ? { error: operation.error.code } : {}),
      ...(operation.nodeVersion.startsWith('agent@') || operation.capabilityRef === 'read.specialist_evidence' ? { summary: { messageId: analysis?.messageId ?? null,
        checks: Array.isArray(analysis?.requestedChecks) ? analysis.requestedChecks.length : null } } : {}),
      ...(operation.capabilityRef === 'read.specialist_project'
        ? { summary: { revision: (operation.outputs?.project as Row | undefined)?.revision,
          records: ((operation.outputs?.project as Row | undefined)?.recordIds as unknown[] | undefined)?.length } } : {}),
      ...(operation.capabilityRef === 'read.specialist_knowledge'
        ? { summary: { status: (operation.outputs?.enterprise as Row | undefined)?.status,
          epoch: (operation.outputs?.enterprise as Row | undefined)?.epoch } } : {}),
      ...(operation.capabilityRef === 'read.specialist_public_standard'
        ? { summary: { status: (operation.outputs?.publicStandard as Row | undefined)?.status,
          standardId: (operation.outputs?.publicStandard as Row | undefined)?.standardId } } : {}),
    })),
    trace: trace.map(entry => ({ seq: entry.seq, at: entry.at, kind: entry.kind, nodeId: entry.nodeId,
      ...(['node_waiting', 'branch_selected'].includes(entry.kind) ? { detail: entry.detail } : {}) })),
  };
}

export type SpecialistStatus = Awaited<ReturnType<typeof specialistStatus>>;
