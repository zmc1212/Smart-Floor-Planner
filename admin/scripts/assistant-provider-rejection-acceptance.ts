import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmConfig } from '@/lib/platform-llm-config';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import type { ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

type Row = Record<string, unknown>;
const root = path.resolve(process.cwd(), '..');
loadEnvConfig(process.cwd(), true);
const connection = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const target = new URL(connection);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = connection;
const output = path.join(root, 'tmp/xiaok-d1-resume-20261027', `rejection-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const files = [...new Set(['admin/scripts/assistant-provider-rejection-acceptance.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package-lock.json', 'admin/tsconfig.json', 'admin/src/lib/platform-llm-config.ts', 'admin/src/lib/ai/postgres-workflow-chat.ts',
  ...cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'admin/src/lib/assistant',
    'admin/src/lib/ai/providers', 'admin/src/db', 'miniprogram/packages/assistant/lib'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean)])];
const binding = () => Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const report: Row = { scope: 'D1 execution rejection and recovery; real isolated Worker/database, controlled HTTP only; no semantic/model/native acceptance',
  before: binding(), realProviderCalls: 0, cases: [] as Row[], passed: false };
const save = () => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
const fixtures: { enterpriseId: string; userId: string; conversationId: string }[] = [];
const originalFetch = globalThis.fetch;
const originalModel = process.env.ASSISTANT_TEXT_MODEL;
const originalAllowlist = process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
let release: (() => Promise<void>) | undefined;

async function main() {
  save();
  try {
    release = await lockAssistantAcceptance(connection);
    const config = await getPlatformLlmConfig();
    assert.ok(config.enabled && config.available, 'Use existing configured runtime; no fallback or settings change');
    report.configuration = { model: config.model, providerKey: config.providerKey, baseUrl: config.baseUrl };
    process.env.ASSISTANT_TEXT_MODEL = config.model;
    const oldTrial = path.join(root, 'tmp/agent-contract/trial-composable-d1-2026-10-26T17-01-30-833Z.json');
    const originalTrialHash = createHash('sha256').update(fs.readFileSync(oldTrial)).digest('hex');
    // These IDs belong to a different restored instance. Snapshot only; never
    // identify/reconcile old trials by numeric IDs from another database.
    const detachedIds = () => withPlatformTransaction(tx => rows(tx, sql`select id,enterprise_id,assistant_run_id,status,accepted,actual_cost
      from app.ai_provider_attempts where id in (1382,1383) order by id`));
    report.detachedIdsBefore = await detachedIds();
    for (const scenario of ['rejected400', 'timeout', 'http408', 'http503'] as const) {
      const code = 'synthetic-provider-rejection-' + randomUUID();
      const fixture = await withPlatformTransaction(async tx => {
        const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
          values('测试专用 · 模型拒绝与恢复',${code},'active') returning id`))!.id);
        const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values('测试专用 · 装修咨询',1) returning id`))!.id);
        await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
          values(${enterpriseId},true,100,1000000,10000000,30,${JSON.stringify({ runtime: 'langgraph-v1', providerKey: config.providerKey,
            model: config.model, tools: true, imageInput: false, probeVersion: 'synthetic-provider-rejection-no-capability-claim' })}::jsonb)`);
        return { enterpriseId, userId };
      });
      const actor: ActorContext = { enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userId },
        contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
      process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = fixture.enterpriseId;
      const chat = new ConversationService(actor), conversationId = String((await chat.create(randomUUID())).id);
      fixtures.push({ ...fixture, conversationId });
      const key = randomUUID(), content = { version: 1 as const, blocks: [{ type: 'text' as const, text: '预算还没定，老房量房前要准备些什么？' }] };
      const sent = await chat.send(conversationId, key, content);
      const result: Row = { scenario, ...fixture, conversationId, runId: sent.runId, localResponses: 0, passed: false };
      (report.cases as Row[]).push(result); save();
      globalThis.fetch = async () => {
        result.localResponses = Number(result.localResponses) + 1;
        if (scenario === 'timeout') throw new DOMException('synthetic timeout', 'TimeoutError');
        return new Response(JSON.stringify({ error: { code: 'invalid_request', type: 'invalid_request_error', param: 'messages.0.content',
          message: 'Synthetic rejected request' } }), { status: scenario === 'rejected400' ? 400 : scenario === 'http408' ? 408 : 503 });
      };
      const lease = await claimJob(); assert.equal(lease?.runId, sent.runId); assert.ok(lease);
      await processAgentAnswer(lease);
      globalThis.fetch = originalFetch;
      const run = await chat.run(String(sent.runId));
      const known = scenario === 'rejected400';
      result.run = run;
      assert.equal(run.status, known ? 'failed' : 'indeterminate');
      assert.equal(run.errorCode, known ? 'model_unavailable' : 'provider_outcome_unknown');
      assert.equal(result.localResponses, 1, 'No automatic retry or provider fallback');
      result.audit = await withTenantTransaction(fixture.enterpriseId, async tx => ({
        attempts: await rows(tx, sql`select id,status,accepted,error_code,actual_cost from app.ai_provider_attempts
          where enterprise_id=${fixture.enterpriseId} and assistant_run_id=${String(sent.runId)} order by id`),
        reservations: await rows(tx, sql`select status,reserved_tokens,reserved_cost_micros,settled_tokens,settled_cost_micros
          from app.assistant_quota_reservations where enterprise_id=${fixture.enterpriseId} and run_id=${String(sent.runId)}`),
        outputs: await rows(tx, sql`select id from app.assistant_messages where enterprise_id=${fixture.enterpriseId}
          and run_id=${String(sent.runId)} and author_kind='assistant'`),
      }));
      const audit = result.audit as { attempts: Row[]; reservations: Row[]; outputs: Row[] };
      assert.equal(audit.attempts.length, 1); assert.deepEqual(audit.attempts[0].actual_cost, {});
      assert.equal(audit.reservations[0].status, 'reconciling');
      assert.equal(audit.reservations[0].settled_tokens, null); assert.equal(audit.reservations[0].settled_cost_micros, null);
      assert.equal(audit.outputs.length, 0, 'No fabricated answer after provider failure');
      assert.equal(run.retryable, false, 'Original call cannot be retried before billing reconciliation');
      await assert.rejects(() => chat.run(String(sent.runId), 'retry', randomUUID()));
      assert.equal((await chat.send(conversationId, key, content)).runId, sent.runId, 'Same-key recovery never creates another run');
      assert.equal((await new ConversationService(actor).detail(conversationId)).id, conversationId);
      const other: ActorContext = { ...actor, principal: { kind: 'user', userId: '1' } };
      await assert.rejects(() => new ConversationService(other).run(String(sent.runId)));
      if (known) {
        const next = await chat.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '那先聊聊量房需要带哪些资料。' }] });
        assert.ok(next.runId && next.runId !== sent.runId);
        globalThis.fetch = async () => {
          result.recoveryResponses = Number(result.recoveryResponses || 0) + 1;
          return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'synthetic-final', type: 'function',
            function: { name: 'final_response', arguments: JSON.stringify({ kind: 'general', text: '量房前可以准备现有户型图和物业装修规定，并整理保留家具、设备的尺寸。' }) } }] },
            finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 30 } }), { status: 200 });
        };
        const nextLease = await claimJob(); assert.equal(nextLease?.runId, next.runId); assert.ok(nextLease);
        await processAgentAnswer(nextLease); globalThis.fetch = originalFetch;
        result.recoveryRun = await chat.run(String(next.runId));
        assert.equal((result.recoveryRun as Row).status, 'succeeded');
        assert.equal(result.recoveryResponses, 1);
        assert.equal((await new ConversationService(actor).run(String(sent.runId))).status, 'failed');
      } else {
        await assert.rejects(() => chat.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '那先聊聊量房需要带哪些资料。' }] }));
      }
      result.passed = true; save();
    }
    report.detachedIdsAfter = await detachedIds(); assert.deepEqual(report.detachedIdsAfter, report.detachedIdsBefore);
    assert.equal(createHash('sha256').update(fs.readFileSync(oldTrial)).digest('hex'), originalTrialHash);
    report.originalTrialUnchanged = true;
    const current = await getPlatformLlmConfig();
    assert.deepEqual({ model: current.model, providerKey: current.providerKey, baseUrl: current.baseUrl }, report.configuration);
    report.configurationUnchanged = true; report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalModel === undefined) delete process.env.ASSISTANT_TEXT_MODEL; else process.env.ASSISTANT_TEXT_MODEL = originalModel;
    if (originalAllowlist === undefined) delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS; else process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = originalAllowlist;
    try {
      for (const fixture of fixtures) {
        const actor: ActorContext = { enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userId },
          contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
        const active = await withPlatformTransaction(tx => rows(tx, sql`select id from app.assistant_runs
          where enterprise_id=${fixture.enterpriseId} and status in ('queued','running')`));
        for (const run of active) await new ConversationService(actor).run(String(run.id), 'cancel', randomUUID());
        await withPlatformTransaction(async tx => {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${fixture.enterpriseId}`);
        await tx.execute(sql`update app.users set context_version=context_version+1 where id=${fixture.userId}`);
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
          where enterprise_id=${fixture.enterpriseId} and status in ('queued','running')`);
        });
      }
      report.cleaned = true;
    } catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
    if (release) await release();
    report.after = binding(); report.drift = files.filter(f => (report.before as Row)[f] !== (report.after as Row)[f]);
    if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
    await closePostgresPool(); save();
    console.log(JSON.stringify({ output: path.relative(root, output), passed: report.passed, cases: (report.cases as Row[]).map(c => ({ scenario: c.scenario, passed: c.passed })),
      cleaned: report.cleaned, drift: report.drift, error: report.error || null, cleanupError: report.cleanupError || null }));
  }
}
void main();
