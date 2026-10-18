import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key, principalKey, type ActorContext, type MessageContent } from '../contracts';
import { evaluationBatchManifest, type EvaluationBatchPreparation } from '../knowledge/evaluation-batch';
import { executionPrepareOperation, executionCancelOperation, type KnowledgeBatchSharedPort, type BatchExecutionContext,
  type BatchExecutionReceipt, type BatchCancellationFence, type BatchRunReceipt } from '../knowledge/batch-execution-adapter';
import { retrievalConfiguration } from '../knowledge/retrieval';
import { operationReceipt } from './operation-receipts';
import { ConversationService } from './conversation';
import { readPreviewExecution, resolvePreviewExecution } from './execution-config';

type DispatchInput = Parameters<KnowledgeBatchSharedPort<PostgresTransaction>['dispatch']>[2];
/** Private run binding for the knowledge-owned five-method protocol. Contains no question or credentials. */
export type PreparedExecutionPin = Omit<DispatchInput, 'conversationId' | 'content'> & { version: 1; contentHash: string };

async function authorize(tx: PostgresTransaction, actor: ActorContext, write = false) {
  if (actor.principal.kind !== 'admin' || !actor.capabilities.includes('assistant.preview.self')) fail('assistant_capability_forbidden', 403);
  return (await new AssistantRepository(tx, actor).settings(write))!;
}
async function resolveContext(tx: PostgresTransaction, actor: ActorContext, context: BatchExecutionContext) {
  const execution = await resolvePreviewExecution(tx, actor);
  if (context.mode !== 'knowledge_preview' || context.profile.id !== execution.index.profileId || context.profile.hash !== execution.index.profileHash
    || fingerprint(context.retrievalConfiguration) !== fingerprint(retrievalConfiguration)) fail('execution_changed');
  return execution;
}
function cancellationBinding(actor: ActorContext, pin: PreparedExecutionPin) {
  const fence: BatchCancellationFence = { operation: executionCancelOperation, key: pin.batch.batchId,
    principalKey: principalKey(actor), manifestHash: pin.batch.manifestHash };
  if (fingerprint(pin.batch.cancellation) !== fingerprint(fence)) fail('invalid_batch_manifest');
}

/** Reuse the knowledge-owned preparation/cancel records. No parallel binding or cancellation authority. */
async function validateBinding(tx: PostgresTransaction, actor: ActorContext, pin: PreparedExecutionPin) {
  const settings = await authorize(tx, actor, true);
  if (pin.version !== 1) fail('invalid_batch_manifest');
  key(pin.createKey); key(pin.sendKey); key(pin.batch.batchId); id(pin.batch.evaluationId);
  const preparedRow = await operationReceipt(tx, actor, 'knowledge-batch-prepare', pin.batch.batchId);
  const executionRow = await operationReceipt(tx, actor, executionPrepareOperation, pin.batch.batchId);
  if (!preparedRow || !executionRow) fail('assistant_resource_not_found', 404);
  const prepared = preparedRow.result as EvaluationBatchPreparation, receipt = executionRow.result as BatchExecutionReceipt;
  if (actor.principal.kind !== 'admin' || prepared.enterpriseId !== actor.enterpriseId || prepared.adminId !== actor.principal.adminId
    || prepared.batchId !== pin.batch.batchId) fail('assistant_resource_not_found', 404);
  cancellationBinding(actor, pin);
  const manifest = evaluationBatchManifest(prepared, pin.expectedExecutionRevision);
  if (receipt.version !== 1 || !Number.isInteger(receipt.concurrency) || receipt.concurrency < 1 || receipt.concurrency > 4
    || fingerprint(receipt.manifest) !== fingerprint(manifest) || manifest.hash !== pin.batch.manifestHash) fail('invalid_batch_manifest');
  const item = manifest.items.find(candidate => candidate.evaluationId === pin.batch.evaluationId);
  if (!item) fail('invalid_batch_manifest');
  const cancelled = await operationReceipt(tx, actor, executionCancelOperation, pin.batch.batchId);
  if (cancelled) {
    const intent = cancelled.result as Row;
    if (intent.batchId !== pin.batch.batchId || intent.manifestHash !== manifest.hash || intent.cancelled !== true) fail('invalid_batch_manifest');
    fail('batch_cancelled');
  }
  if (Number(settings.knowledge_epoch) !== manifest.knowledgeEpoch || Number(settings.policy_version) !== manifest.policyVersion) fail('context_changed');
  const evaluations = await rows(tx, sql`select e.*,c.revision current_revision from app.assistant_knowledge_evaluations e
    left join app.assistant_knowledge_cases c on c.enterprise_id=e.enterprise_id and c.id=e.case_id
    where e.enterprise_id=${actor.enterpriseId} and e.created_by=${actor.principal.adminId}
    and e.id in (${sql.join(manifest.items.map(selected => sql`${selected.evaluationId}`), sql`,`)}) for update of e`);
  const byId = new Map(evaluations.map(evaluation => [String(evaluation.id), evaluation]));
  for (const selected of manifest.items) {
    const evaluation = byId.get(selected.evaluationId);
    if (!evaluation || String(evaluation.case_id) !== selected.caseId || Number(evaluation.case_revision) !== selected.caseRevision
      || Number(evaluation.current_revision) !== selected.caseRevision || Number(evaluation.knowledge_epoch) !== manifest.knowledgeEpoch
      || fingerprint(evaluation.snapshot) !== selected.snapshotHash) fail('context_changed');
  }
  const evaluation = byId.get(item.evaluationId)!;
  const content: MessageContent = { version: 1, blocks: [{ type: 'text', text: String((evaluation.snapshot as Row).question) }] };
  if (key(evaluation.create_key) !== pin.createKey || key(evaluation.send_key) !== pin.sendKey || fingerprint(content) !== pin.contentHash) fail('invalid_batch_manifest');
  const execution = await resolveContext(tx, actor, pin.context);
  if (execution.revision !== pin.expectedExecutionRevision) fail('execution_changed');
  return { pin, execution, evaluation };
}

export async function assertBatchDispatchAllowed(tx: PostgresTransaction, actor: ActorContext, pin: PreparedExecutionPin) {
  return validateBinding(tx, actor, pin);
}

export async function assertPinnedRunDispatch(tx: PostgresTransaction, actor: ActorContext, run: Row) {
  const policy = run.policy_snapshot as Row;
  if (policy.batchExecution === undefined && policy.execution === undefined) return;
  if (!policy.batchExecution || !policy.execution) fail('context_changed');
  const state = await validateBinding(tx, actor, policy.batchExecution as PreparedExecutionPin);
  if (readPreviewExecution(policy.execution).revision !== state.execution.revision
    || (state.evaluation.run_id && String(state.evaluation.run_id) !== String(run.id))
    || (state.evaluation.conversation_id && String(state.evaluation.conversation_id) !== String(run.conversation_id))) fail('invalid_batch_receipt');
  const sent = await operationReceipt(tx, actor, 'send:' + String(run.conversation_id), state.pin.sendKey);
  const receipt = sent?.result as Row | undefined;
  if (!receipt || receipt.runId !== String(run.id) || receipt.messageId !== String(run.trigger_message_id)
    || sent!.request_hash !== state.pin.contentHash) fail('invalid_batch_receipt');
}

async function observeRun(tx: PostgresTransaction, actor: ActorContext, receipt: BatchRunReceipt) {
  await authorize(tx, actor);
  await new AssistantRepository(tx, actor).conversation(id(receipt.conversationId));
  const run = await one(tx, sql`select r.*,exists(select 1 from app.assistant_quota_reservations q
    where q.enterprise_id=r.enterprise_id and q.run_id=r.id and q.status='reconciling') awaiting_reconciliation
    from app.assistant_runs r where r.enterprise_id=${actor.enterpriseId} and r.id=${id(receipt.runId)} and r.conversation_id=${receipt.conversationId}`);
  if (!run || !['queued','running','succeeded','failed','cancelled','indeterminate'].includes(String(run.status))) fail('assistant_resource_not_found', 404);
  const usage = await rows(tx, sql`select measurement_kind,input_tokens,output_tokens from app.assistant_usage_records
    where enterprise_id=${actor.enterpriseId} and run_id=${receipt.runId} and category='tokens'`);
  const unknown = await one(tx, sql`select id from app.ai_provider_attempts where enterprise_id=${actor.enterpriseId}
    and assistant_run_id=${receipt.runId} and status not in ('succeeded','failed') limit 1`);
  return { status: run.status as 'queued'|'running'|'succeeded'|'failed'|'cancelled'|'indeterminate',
    awaitingReconciliation: Boolean(run.awaiting_reconciliation), usageKnown: !unknown && usage.length > 0
      && usage.every(record => record.measurement_kind === 'observed' && record.input_tokens !== null && record.output_tokens !== null) };
}

/** Lazy construction; only these five operations implement the exact knowledge-owned adapter interface. */
export function createKnowledgeBatchSharedPort(): KnowledgeBatchSharedPort<PostgresTransaction> {
  const port: KnowledgeBatchSharedPort<PostgresTransaction> = {
    async executionRevision(tx, actor, context) {
      const execution = await resolveContext(tx, actor, context);
      return { mode: 'knowledge_preview', revision: execution.revision };
    },
    async lookupReceipt(tx, actor, input) {
      await authorize(tx, actor);
      const chat = ConversationService.inTransaction(tx, actor), original = await chat.originalSubmission(input);
      if (input.conversationId && input.conversationId !== original.conversationId) fail('invalid_batch_receipt');
      if (original.submission !== 'sent') {
        const possible = original.conversationId ? await one(tx, sql`select id from app.assistant_messages where enterprise_id=${actor.enterpriseId}
          and conversation_id=${original.conversationId} and client_message_id=${input.sendKey} limit 1`) : null;
        if (possible) fail('invalid_batch_receipt');
        return null;
      }
      if (!original.runId || !original.conversationId) fail('invalid_batch_receipt');
      const receipt = await operationReceipt(tx, actor, 'send:' + original.conversationId, input.sendKey);
      if (receipt?.request_hash !== fingerprint(input.content)) fail('invalid_batch_receipt');
      return { conversationId: original.conversationId, runId: original.runId };
    },
    async dispatch(tx, actor, input) {
      const pin: PreparedExecutionPin = { version: 1, createKey: input.createKey, sendKey: input.sendKey,
        expectedExecutionRevision: input.expectedExecutionRevision, context: input.context, batch: input.batch,
        contentHash: fingerprint(input.content) };
      await validateBinding(tx, actor, pin);
      const original = await port.lookupReceipt(tx, actor, input);
      if (original) return original;
      const chat = ConversationService.inTransaction(tx, actor);
      const conversationId = input.conversationId ?? String((await chat.create(input.createKey, { audience: 'customer_public', draftVersionIds: [] })).id);
      const sent = await chat.send(conversationId, input.sendKey, input.content, undefined, pin);
      if (!sent.runId) fail('invalid_batch_receipt');
      return { conversationId, runId: String(sent.runId) };
    },
    observeRun,
    async cancelRun(tx, actor, input) {
      await observeRun(tx, actor, input);
      await ConversationService.inTransaction(tx, actor).run(input.runId, 'cancel', key(input.requestKey));
    },
  };
  return port;
}
