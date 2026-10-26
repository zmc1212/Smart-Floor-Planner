import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmConfig } from '@/lib/platform-llm-config';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { AiProviderError } from '@/lib/ai/provider-types';
import { ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

// Established isolated-service bootstrap; no provider runtime/key is exposed.
// Every HTTP call during the invocation is replaced before product dispatch.
const root = path.resolve(process.cwd(), '..');
createRequire(path.join(root, 'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(), true);
const connection = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const target = new URL(connection);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = connection;
const output = path.join(root, 'tmp/d1-contract-recovery-20261026', `service-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const files = ['admin/scripts/provider-http-diagnostics-acceptance.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/src/lib/ai/provider-types.ts', 'admin/src/lib/ai/providers/http-diagnostics.ts', 'admin/src/lib/ai/providers/http.ts',
  'admin/src/lib/ai/providers/agent-chat.ts', 'admin/src/lib/ai/postgres-workflow-chat.ts', 'admin/src/lib/platform-llm-config.ts',
  'admin/src/lib/ai/provider-registry.ts', 'admin/src/db/repositories/ai-creation-repository.ts', 'admin/src/db/transaction.ts',
  'admin/package-lock.json', 'admin/tsconfig.json'];
const binding = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const historical = () => withPlatformTransaction(async tx => ({
  runs: await rows(tx, sql`select id,status,error_code,output_message_id from app.assistant_runs where id in (1174,1175) order by id`),
  attempts: await rows(tx, sql`select id,status,accepted,actual_cost,error_code from app.ai_provider_attempts where id in (1382,1383) order by id`),
  reservations: await rows(tx, sql`select id,status,reserved_tokens,reserved_cost_micros,settled_tokens,settled_cost_micros
    from app.assistant_quota_reservations where run_id in (1174,1175) order by id`),
}));

async function main() {
  const report: Record<string, unknown> = { scope: 'Synthetic HTTP400 persistence only; no model/native/business acceptance',
    started: new Date().toISOString(), realProviderCalls: 0, localFakeResponses: 0, passed: false, before: binding() };
  let release: (() => Promise<void>) | undefined;
  let fixture: { enterpriseId: string; userId: string } | undefined, chat: ConversationService | undefined, runId: string | undefined;
  const oldFetch = globalThis.fetch, oldModel = process.env.ASSISTANT_TEXT_MODEL;
  try {
    release = await lockAssistantAcceptance(connection);
    report.historicalBefore = await historical();
    const config = await getPlatformLlmConfig();
    assert.ok(config.enabled && config.available, 'Existing configuration required; never add credentials or fallback');
    const agent = { runtime: 'langgraph-v1' as const, model: config.model, providerKey: config.providerKey, tools: true, imageInput: false, probeVersion: 'synthetic-http-diagnostic-not-a-capability-probe' };
    fixture = await withPlatformTransaction(async tx => {
      const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
        values('测试专用 · HTTP诊断',${'synthetic-http-diagnostic-' + randomUUID()},'active') returning id`))!.id);
      const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values('测试专用 · HTTP诊断业主',1) returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${enterpriseId},true,100,1000000,10000000,30,${JSON.stringify(agent)}::jsonb)`);
      return { enterpriseId, userId };
    });
    const actor: ActorContext = { enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userId },
      contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
    chat = new ConversationService(actor);
    const conversationId = String((await chat.create(randomUUID())).id);
    const sent = await chat.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '预算没想好，量房前需要准备什么？' }] });
    runId = String(sent.runId); assert.ok(sent.runId);
    report.fixture = { ...fixture, conversationId, runId, synthetic: true };
    process.env.ASSISTANT_TEXT_MODEL = config.model;
    const privateMarker = 'FIXTURE_ONLY_PRIVATE_TEXT';
    const responseBody = JSON.stringify({ error: { code: 'invalid_type', type: 'invalid_request_error', param: 'messages.0.content',
      message: `Expected string, received ${privateMarker} sk-synthetic-never-log` } });
    globalThis.fetch = async () => {
      report.localFakeResponses = Number(report.localFakeResponses) + 1;
      return new Response(responseBody, { status: 400, headers: { 'x-request-id': 'synthetic-http400-audit' } });
    };
    await assert.rejects(executePostgresText({ enterpriseId: BigInt(fixture.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(runId) },
      logicalModelKey: 'chat.general', messages: [], maxTokens: 128, metadata: { synthetic: true, scope: 'http-diagnostic-local-fake' },
      agent: { config: agent, input: { maxTokens: 128, tools: [{ name: 'final_response', description: 'synthetic', parameters: { type: 'object' } }],
        messages: [{ role: 'system', content: [{ type: 'text', text: privateMarker }] }, { role: 'user', content: [{ type: 'text', text: privateMarker }] }] } },
    }), error => error instanceof AiProviderError && error.code === 'HTTP_400' && !error.message.includes(privateMarker));
    globalThis.fetch = oldFetch;
    assert.equal(report.localFakeResponses, 1, 'One controlled response; no retry or provider fallback');
    const attempts = await withTenantTransaction(fixture.enterpriseId, tx => rows(tx, sql`select id,status,accepted,error_code,error_message,metadata,actual_cost
      from app.ai_provider_attempts where enterprise_id=${fixture!.enterpriseId} and assistant_run_id=${runId!} order by id`));
    assert.equal(attempts.length, 1);
    const attempt = attempts[0], metadata = attempt.metadata as Record<string, unknown>;
    assert.equal(attempt.status, 'failed'); assert.equal(attempt.accepted, false); assert.equal(attempt.error_code, 'HTTP_400');
    assert.equal(attempt.error_message, 'Assistant provider invocation failed');
    assert.equal((metadata.providerFailure as Record<string, unknown>).parameter, 'messages.0.content');
    assert.equal((metadata.providerFailure as Record<string, unknown>).providerCode, 'invalid_type');
    assert.match(String((metadata.assistantRequest as Record<string, unknown>).payloadHash), /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(attempt).includes(privateMarker)); assert.ok(!JSON.stringify(attempt).includes('sk-synthetic'));
    assert.deepEqual(attempt.actual_cost, {}, 'No inferred zero bill or observed usage from HTTP400');
    report.audit = attempt;
    report.historicalAfter = await historical();
    assert.deepEqual(report.historicalAfter, report.historicalBefore, 'Historical unknowns/holds are immutable');
    const afterConfig = await getPlatformLlmConfig();
    assert.equal(afterConfig.model, config.model); assert.equal(afterConfig.providerKey, config.providerKey);
    report.configuration = { model: config.model, providerKey: config.providerKey, unchanged: true };
    report.passed = true;
  } catch (error) {
    // Do not log a raw upstream error; unit failures use synthetic fixtures only.
    report.error = error instanceof AiProviderError ? { code: error.code, diagnostic: error.diagnostic } : String(error);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = oldFetch;
    if (oldModel === undefined) delete process.env.ASSISTANT_TEXT_MODEL; else process.env.ASSISTANT_TEXT_MODEL = oldModel;
    try {
      if (chat && runId) await chat.run(runId, 'cancel', randomUUID());
      if (fixture) await withPlatformTransaction(async tx => {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${fixture!.enterpriseId}`);
        await tx.execute(sql`update app.users set context_version=context_version+1 where id=${fixture!.userId}`);
      });
      report.fixtureDisabled = true;
    } catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
    if (release) await release();
    report.after = binding(); report.drift = files.filter(f => (report.before as Record<string, string>)[f] !== (report.after as Record<string, string>)[f]);
    if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
    await closePostgresPool();
    console.log(JSON.stringify({ output: path.relative(root, output), passed: report.passed, drift: report.drift,
      realProviderCalls: report.realProviderCalls, localFakeResponses: report.localFakeResponses, error: report.error || null, cleanupError: report.cleanupError || null }));
  }
}
void main();
