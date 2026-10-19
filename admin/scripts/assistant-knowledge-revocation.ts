/** Permission acceptance only: real PostgreSQL/HTTP handlers, injected deterministic providers. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { EMBEDDING_PROFILE } from '@/lib/assistant/infrastructure/embedding-gateway';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { GET, POST } from '@/app/api/miniprogram/assistant/[...path]/route';
import type { ActorContext, Evidence, TextModelGateway } from '@/lib/assistant/contracts';
import { assertSemanticLock } from './assistant-knowledge-semantics-followup';

export function assertOriginalReceiptRecovery(before: Row, after: Row) {
  for (const name of ['createKey','sendKey','conversationId','messageId','runId','requestHash']) {
    assert.ok(typeof before[name] === 'string' && before[name], 'RECOVERY_ORIGINAL_EVIDENCE_MISSING');
    assert.equal(after[name], before[name], 'RECOVERY_ORIGINAL_IDENTITY_CHANGED');
  }
  for (const name of ['runs','jobs','reservations','providerAttempts']) assert.ok(Number.isSafeInteger((before.counts as Row)?.[name]), 'RECOVERY_COUNTER_MISSING');
  for (const name of ['chunk','embedding','retrieval','model']) assert.ok(Number.isSafeInteger((before.calls as Row)?.[name]), 'RECOVERY_CALL_COUNTER_MISSING');
  assert.deepEqual(after.counts, before.counts, 'RECOVERY_ADDED_SIDE_EFFECT');
  assert.deepEqual(after.calls, before.calls, 'RECOVERY_INVOKED_PROVIDER');
  assert.ok(Array.isArray(before.reservations) && before.reservations.length > 0, 'RECOVERY_QUOTA_EVIDENCE_MISSING');
  assert.deepEqual(after.reservations, before.reservations, 'RECOVERY_RECONCILIATION_CHANGED');
  assert.equal(after.costMicros, null, 'RECOVERY_UNKNOWN_COST_ZERO_FILLED');
}

/** Review preparation, never a dispatch/retry authority. Missing current rows cannot authorize new keys. */
export function archivedRecoveryPlan(input: { runId: string; currentRowExists: boolean; runStatus: string; reservationStatus: string;
  attemptStatus: string; accepted: boolean; originalCreateKey?: string | null; originalSendKey: string | null; requestHash: string | null }) {
  assert.ok(/^[1-9][0-9]*$/.test(input.runId) && (input.requestHash === null || /^[a-f0-9]{64}$/.test(input.requestHash)));
  return { runId: input.runId, originalCreateKey: input.originalCreateKey ?? null, originalSendKey: input.originalSendKey, requestHash: input.requestHash,
    dispatchApproved: false as const, maximumFutureExecutions: 1, costMicros: null,
    state: !input.currentRowExists ? 'archive_only_wait_shared_review' : 'original_receipt_lookup_only',
    missingEvidence: [!input.originalCreateKey ? 'originalCreateKey' : '', !input.originalSendKey ? 'originalSendKey' : '', !input.requestHash ? 'requestHash' : ''].filter(Boolean),
    checks: ['verified stable shared conclusion', 'original receipt and current state before any action',
      'no unresolved indeterminate or reconciling state', 'existing authorized recovery mechanism; no replacement key',
      'one explicit execution at most; compare original identity and attempt/HTTP deltas', 'on new uncertainty stop and preserve original evidence'],
    original: { runStatus: input.runStatus, reservationStatus: input.reservationStatus, attemptStatus: input.attemptStatus, accepted: input.accepted } };
}

export async function verifyKnowledgeRevocation(register: (enterpriseId: string, adminId: string, userId: string) => void) {
  await assertSemanticLock();
  const prefix = 'synthetic-kb-revocation-' + randomUUID(), calls = { chunk: 0, embedding: 0, retrieval: 0, model: 0 };
  const identity = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    register(enterpriseId, adminId, userId);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${enterpriseId},true,100,12000000,1000000000,30)`);
    return { enterpriseId, adminId, userId };
  });
  const { enterpriseId, adminId, userId } = identity, knowledge = new KnowledgeService({ enterpriseId, adminId });
  const sourceText = 'SYNTHETIC_REVOCATION_ONLY：书房办公的屏幕眩光与通道须核对，点位需团队核对有效图纸，不代表现场批准。';
  const created = await knowledge.execute('create', { title: '测试专用撤回权限', body: sourceText, sourceType: 'manual_text', audience: 'customer_public' }, randomUUID());
  const target = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  const queued = await knowledge.execute('index', target, randomUUID()), indexLease = await claimKnowledgeJob();
  assert.ok(indexLease); assert.equal(indexLease.jobId, queued.jobId);
  await runKnowledgeJob(indexLease, {
    chunk: async text => { calls.chunk++; return [{ text, start: 0, end: Array.from(text).length, tokens: 32 }]; },
    embedding: { profile: EMBEDDING_PROFILE, embed: async texts => { calls.embedding++; return { vectors: texts.map(() => [1, ...Array(1023).fill(0)]), usage: null }; } },
  });
  assert.equal((await knowledge.execute('job', { jobId: indexLease.jobId })).status, 'succeeded');
  await knowledge.execute('publish', target, randomUUID());
  const chunk = (await withTenantTransaction(enterpriseId, tx => one(tx, sql`select id::text,text,text_hash from app.assistant_knowledge_chunks
    where enterprise_id=${enterpriseId} and document_version_id=${target.versionId}`)))!;
  const evidence: Evidence = { ref: { type: 'knowledge_chunk', id: String(chunk.id), version: target.versionId }, hash: String(chunk.text_hash), text: String(chunk.text) };
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor), createKey = randomUUID(), sendKey = randomUUID(), conversationId = String((await chat.create(createKey)).id);
  const token = await signMiniProgramToken({ sub: userId, id: userId, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
  const http = async (route: string[], body?: Row) => {
    const request = new Request('http://localhost:3007/api/miniprogram/assistant/' + route.join('/'), { method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': sendKey }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await (body ? POST : GET)(request, { params: Promise.resolve({ path: route }) });
    assert.equal(response.status, body ? 202 : 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).data as Row;
  };
  const sent = await http(['conversations', conversationId, 'messages'], { clientMessageId: sendKey, content: { version: 1, blocks: [{ type: 'text', text: '书房办公的眩光和通道应核对什么？' }] } });
  const runId = String(sent.runId), lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, runId); assert.equal(lease.enterpriseId, enterpriseId);
  const model: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false }, generate: async input => {
    calls.model++; const selected = JSON.parse(input.messages[1].content).evidence as Row[];
    return { text: JSON.stringify({ selections: selected.map(e => e.selectionId) }), attemptId: '', usage: null, finishReason: null, providerRequestId: null };
  } };
  await processAnswer(lease, { model, retriever: { retrieve: async () => { calls.retrieval++; return [evidence]; } } });
  const run = await http(['runs', runId]); assert.equal(run.status, 'succeeded');
  const history = await http(['conversations', conversationId, 'messages']), answer = (history.items as Row[]).find(m => String(m.id) === String(run.outputMessageId));
  assert.equal(answer?.available, true); assert.ok(JSON.stringify(answer).includes('SYNTHETIC_REVOCATION_ONLY'));
  const citation = (await withTenantTransaction(enterpriseId, tx => one(tx, sql`select id::text from app.assistant_message_citations where enterprise_id=${enterpriseId} and run_id=${runId}`)))!;
  const citationBefore = await http(['citations', String(citation.id)]); assert.equal(citationBefore.available, true);
  const snapshot = async () => withTenantTransaction(enterpriseId, async tx => {
    const receipt = (await one(tx, sql`select request_hash from app.assistant_idempotency_records where enterprise_id=${enterpriseId}
      and principal_key=${'user:' + userId} and operation=${'send:' + conversationId} and key=${sendKey}`))!;
    const counts: Row = {};
    for (const [name, table] of [['runs','assistant_runs'],['jobs','assistant_jobs'],['reservations','assistant_quota_reservations'],['providerAttempts','ai_provider_attempts']])
      counts[name] = Number((await one(tx, sql`select count(*)::int n from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`))!.n);
    const reservations = await rows(tx, sql`select status,settled_tokens::text,settled_cost_micros::text from app.assistant_quota_reservations
      where enterprise_id=${enterpriseId} and run_id=${runId}`);
    return { createKey, sendKey, conversationId, messageId: String(sent.messageId), runId, requestHash: receipt.request_hash,
      counts, calls: { ...calls }, reservations, costMicros: null };
  });
  const original = await chat.originalSubmission({ createKey, sendKey }); assert.equal(original.runId, runId);
  await knowledge.execute('retire', { documentId: target.documentId, expectedVersion: 2 }, randomUUID());
  const before = await snapshot(), afterHistory = await http(['conversations', conversationId, 'messages']);
  const hidden = (afterHistory.items as Row[]).find(m => String(m.id) === String(run.outputMessageId));
  assert.equal(hidden?.available, false); assert.ok(!JSON.stringify(hidden).includes('SYNTHETIC_REVOCATION_ONLY'));
  const citationAfter = await http(['citations', String(citation.id)]); assert.equal(citationAfter.available, false);
  assert.ok(!JSON.stringify(citationAfter).includes('SYNTHETIC_REVOCATION_ONLY'));
  const reads = await Promise.all([chat.originalSubmission({ createKey, sendKey }), chat.originalSubmission({ createKey, sendKey })]);
  for (const value of reads) { assert.equal(value.runId, original.runId); assert.equal(value.messageId, original.messageId); assert.equal(value.conversationId, original.conversationId); }
  const after = await snapshot(); assertOriginalReceiptRecovery(before, after);
  const reservations = await withTenantTransaction(enterpriseId, tx => rows(tx, sql`select status,settled_cost_micros::text from app.assistant_quota_reservations where enterprise_id=${enterpriseId} and run_id=${runId}`));
  return { passed: true, mode: 'Real isolated PostgreSQL/C01 Request handlers; simulated vector/retrieval/selection, no Agent semantic acceptance', ...identity,
    documentId: target.documentId, versionId: target.versionId, runId, citationId: String(citation.id),
    visibleBeforeWithdrawal: true, hiddenOnReentry: true, citationUnavailable: true, originalReceiptReadOnly: true,
    before, after, reservations, realExternalCalls: 0, simulatedCalls: calls };
}
