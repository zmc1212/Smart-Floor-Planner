/** Bounded knowledge acceptance only; never imported by product runtime. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { focusedSynthesisMessages } from '@/lib/assistant/agent/synthesis';
import { synthesisTextBytes } from '@/lib/assistant/agent/synthesis-projection';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import type { AgentConfig } from '@/lib/assistant/agent/config';
import type { ModelMessage } from '@/lib/assistant/contracts/model';
import { checkOversizeDispatchRejection } from './assistant-knowledge-semantic-rules';

type Source = Record<string, unknown> & { sourceId: string; kind: string; text: string };
type Packet = { synthesisSources?: Source[]; sourceAliases?: Array<{ sourceId: string; canonicalSourceId: string; resultKey?: string }> };
export function modelPackets(messages: Array<{ role: string; content: unknown }>): Packet[] {
  return messages.flatMap(message => {
    if (message.role !== 'tool' || typeof message.content !== 'string') return [];
    try { const packet = JSON.parse(message.content); return Array.isArray(packet?.synthesisSources) ? [packet] : []; } catch { return []; }
  });
}
function authority(source: Source, alias = false) {
  const value: Record<string, unknown> = { ...source }; delete value.citationQuotes; delete value.resultKey;
  if (alias) delete value.sourceId;
  const material = value.material as Record<string, unknown> | undefined;
  if (material?.text === value.text) { value.material = { ...material }; delete (value.material as Record<string, unknown>).text; }
  return value;
}
/** Full source/metadata equality; only documented copy hints and exact project aliases may differ. */
export function auditProjectedSources(original: Array<{ role: string; content: unknown }>, actual: Array<{ role: string; content: unknown }>) {
  const expected = modelPackets(original).flatMap(p => p.synthesisSources || []), packets = modelPackets(actual);
  assert.ok(expected.length > 0, 'FOLLOWUP_NO_SOURCE_BASELINE');
  const included = packets.flatMap(p => p.synthesisSources || []), aliases = packets.flatMap(p => p.sourceAliases || []);
  for (const source of included) assert.ok(expected.some(e => e.sourceId === source.sourceId && isDeepStrictEqual(authority(e), authority(source))), 'FOLLOWUP_UNEXPECTED_SOURCE');
  for (const source of expected) {
    const direct = included.find(s => s.sourceId === source.sourceId);
    if (direct) assert.deepEqual(authority(direct), authority(source), 'FOLLOWUP_SOURCE_CHANGED');
    else {
      const alias = aliases.find(a => a.sourceId === source.sourceId && a.resultKey === source.resultKey);
      assert.ok(alias && source.kind === 'project', 'FOLLOWUP_SOURCE_MISSING');
      const canonical = included.find(s => s.sourceId === alias.canonicalSourceId);
      assert.ok(canonical, 'FOLLOWUP_ALIAS_MISSING');
      assert.deepEqual(authority(canonical, true), authority(source, true), 'FOLLOWUP_ALIAS_CHANGED');
    }
  }
  const unique = [...new Map(expected.map(s => [s.sourceId, s])).values()];
  return { passed: true, knowledge: unique.filter(s => s.kind === 'knowledge').length,
    project: unique.filter(s => s.kind === 'project').length,
    sources: unique.map(s => ({ sourceId: s.sourceId, kind: s.kind, authorityHash: fingerprint(authority(s)) })) };
}

export async function assertSemanticLock() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
  const application = process.env.XIAOK_KNOWLEDGE_SEMANTICS_LOCK_APPLICATION;
  assert.ok(application && process.env.XIAOK_KNOWLEDGE_SEMANTICS_LOCK_OWNER, 'FOLLOWUP_LOCK_REQUIRED');
  await withPlatformTransaction(async tx => {
    const role = await one(tx, sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);
    assert.ok(role && !role.rolsuper && !role.rolbypassrls, 'FOLLOWUP_APPLICATION_ROLE_REQUIRED');
    const owner = await one(tx, sql`select count(*)::int n from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where l.locktype='advisory' and l.granted and a.application_name=${application} and a.datname=current_database() and a.pid<>pg_backend_pid()`);
    assert.equal(Number(owner?.n), 1, 'FOLLOWUP_LOCK_OWNER_MISSING');
  });
}

export async function historicalReceiptAudit(archive: string) {
  const bytes = fs.readFileSync(archive), old = JSON.parse(bytes.toString('utf8'));
  const original = old.runs.find((r: { runId: string }) => String(r.runId) === '4242');
  assert.ok(original && original.key === 'study-prerequisites' && original.unknownProviderOutcome === true);
  assert.equal(original.run.status, 'indeterminate');
  const current = await withPlatformTransaction(tx => one(tx, sql`select id::text,status,error_code from app.assistant_runs where id=4242`));
  return { runId: '4242', action: 'read_only_no_retry_or_replacement', archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    originalStatus: original.run.status, originalAttempts: original.attempts.map((a: { id: string; status: string }) => ({ id: a.id, status: a.status })),
    current: current || null, interpretation: current ? 'Existing receipt retained; no mutation performed' : 'Prior fixture was cleaned; archive absence is not known billing',
    costMicros: null, nextCase: 'registered-conflict', nextCasePreviouslyExecuted: old.runs.some((r: { key: string }) => r.key === 'registered-conflict') };
}

export async function verifyBudgetFence(config: AgentConfig, register: (enterpriseId: string, userId: string) => void) {
  await assertSemanticLock();
  const prefix = 'synthetic-kb-budget-' + randomUUID();
  const { enterpriseId, userId } = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    register(enterpriseId, userId);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,12000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
    return { enterpriseId, userId };
  });
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor), conversationId = String((await chat.create(randomUUID())).id);
  const sent = await chat.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '请记录：书房单人办公。' }] });
  const runId = String(sent.runId), lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, runId); assert.equal(lease.enterpriseId, enterpriseId);
  const snapshot = () => withTenantTransaction(enterpriseId, async tx => ({
    run: await one(tx, sql`select status,error_code,trigger_message_id::text from app.assistant_runs where id=${runId}`),
    steps: await rows(tx, sql`select kind,status,step_seq,private_checkpoint from app.assistant_run_steps where run_id=${runId} order by step_seq`),
    attempts: await rows(tx, sql`select id::text,status,accepted,actual_cost from app.ai_provider_attempts where assistant_run_id=${runId} order by id`),
    quota: await one(tx, sql`select status,settled_cost_micros from app.assistant_quota_reservations where run_id=${runId}`),
    job: await one(tx, sql`select provider_started_at from app.assistant_jobs where run_id=${runId}`),
  }));
  let mockHttp = 0, before: Awaited<ReturnType<typeof snapshot>> | undefined;
  const priorFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      assert.equal(new URL(String(input)).pathname.endsWith('/chat/completions'), true); mockHttp++;
      assert.equal(mockHttp, 1, 'FOLLOWUP_UNEXPECTED_SECOND_MOCK_HTTP'); before = await snapshot();
      return Response.json({ id: 'synthetic-budget-response', choices: [{ message: {
        content: '用于无网络预算测试的供应商响应。'.repeat(500), tool_calls: [{ id: 'need', type: 'function',
          function: { name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'use', value: '单人办公', quote: '书房单人办公。' }) } }],
      }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
    };
    await processAgentAnswer(lease);
  } finally { globalThis.fetch = priorFetch; }
  const after = await snapshot(); assert.ok(before); assert.equal(mockHttp, 1);
  const checkpoint = after.steps.find(s => s.kind === 'agent_checkpoint')!.private_checkpoint as { messages: ModelMessage[] };
  const textBytes = synthesisTextBytes(focusedSynthesisMessages(checkpoint.messages, String(after.run!.trigger_message_id)));
  assert.ok(textBytes > 48000); assert.equal(after.attempts.length, 1); assert.equal(after.attempts[0].status, 'succeeded');
  assert.deepEqual(after.attempts[0].actual_cost, { measurementKind: 'unavailable' });
  assert.equal(after.job?.provider_started_at?.toString(), before.job?.provider_started_at?.toString());
  const oracle = checkOversizeDispatchRejection(textBytes, 48000, { events: [{ kind: 'preparation_rejected', code: String(after.run?.error_code) }],
    httpCalls: mockHttp - 1, providerAttempts: [], terminalStatus: String(after.run?.status), reservationStatus: String(after.quota?.status), priorBillableUnsettled: true });
  assert.ok(oracle.passed); assert.equal(after.quota?.settled_cost_micros, null);
  return { runId, passed: true, realHttp: 0, mockHttp, targetTurnHttp: 0, targetTurnAttempts: 0, textBytes, limit: 48000,
    terminalStatus: after.run?.status, errorCode: after.run?.error_code, earlierAttempt: after.attempts[0],
    reservationStatus: after.quota?.status, settledCostMicros: after.quota?.settled_cost_micros, oracle };
}
