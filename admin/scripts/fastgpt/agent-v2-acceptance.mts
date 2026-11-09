/* eslint-disable @typescript-eslint/no-explicit-any -- Retained F0 service-level acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'f0-01';
assert.match(label, /^[a-z0-9-]+$/);
const scope = process.argv.find(x => x.startsWith('--scope='))?.slice(8) || 'full';
assert.ok(scope === 'full' || scope === 'fallback', 'Unknown scope');
const out = path.resolve('../tmp/xiaok-fastgpt-agentv2-f0-20261109/acceptance-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const runtimeFile = path.resolve('../tmp/xiaok-fastgpt-agentv2-f0-20261109/runtime.private.json');
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
// The Agent V2 app's free DashScope tier can be exhausted independently of this
// project's own channel; the built-in fallback check uses an available configured model.
const model = scope === 'fallback' ? 'qwen3.7-plus' : devRuntime.agentV2.model;
// The fallback item proves the built-in runtime path (dispatch, write, persistence)
// still works; craft-question answer quality belongs to the Agent V2 arm and the
// existing V1 evidence, and depends on a model whose free tier is currently exhausted.
const fallbackQuestion = '你好，你可以帮我做什么？';
const originalDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile;
process.env.ASSISTANT_TEXT_MODEL = model;
process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
delete process.env.XIAOK_FASTGPT_RETRIEVAL_FILE;

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { ConversationService, cancelRuns } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const questions = [
  { text: '我家水电马上要开工了，水路这块主要做些什么？', page: 17, documentId: '2511' },
  { text: '那卫生间防水做完还会检查吗？这份说明里有写要等多久吗？', page: 18, documentId: '2512' },
  { text: '客厅地砖的纹理我想顺着窗户方向走。铺之前怎么排版，我怎么把想要的方向说明白，最后谁帮我核对？', page: 19, documentId: '2513' },
  { text: '施工期间家里的门窗和做好的成品会不会保护？保护材料什么时候能撤？', page: 21, documentId: '2514' },
];
const unknownQuestion = '你们公司的员工年假有几天？';

const user = '645';
const knowledgeFixture = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'), 'utf8'));
assert.equal(knowledgeFixture.enterpriseId, '1454');
const knowledgeAdminId = String(knowledgeFixture.adminIds[0]);
let actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
const report: any = { status: 'preparing', label, scope, model, appId: devRuntime.agentV2.appId, knowledgeAdminId,
  questions, unknownQuestion, runs: [], checks: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));
const readTrace = (runId: string) => tenant(async (tx: any) => ({
  run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,trigger_message_id::text,policy_snapshot,
    (select provider_started_at::text from app.assistant_jobs j where j.enterprise_id=app.assistant_runs.enterprise_id and j.run_id=app.assistant_runs.id) provider_started_at
    from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
  steps: await rows(tx, sql`select kind,status,input_summary,private_checkpoint,source_refs,provider_attempt_id::text from app.assistant_run_steps
    where enterprise_id=1454 and run_id=${runId} order by step_seq`),
  usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity from app.assistant_usage_records
    where enterprise_id=1454 and run_id=${runId}`),
}));
const sshArgs = ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const remote = async (code: string) => {
  const script = '$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + Buffer.from(code).toString('base64') + '")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  return new Promise<string>((resolve, reject) => execFile('ssh', [...sshArgs, 'Administrator@192.168.10.54', 'powershell -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (e, stdout, stderr) => e ? reject(Error('remote probe failed: ' + String(stderr).slice(0, 200))) : resolve(stdout)));
};
const writeRuntime = (mutate: (config: any) => void) => {
  const config = JSON.parse(runtimeBytes.toString('utf8'));
  mutate(config);
  fs.writeFileSync(runtimeFile, JSON.stringify(config, null, 2));
};
const restoreRuntime = () => fs.writeFileSync(runtimeFile, runtimeBytes);
async function send(question: string, conversationId?: string, clientMessageId = randomUUID()) {
  const service = new ConversationService(actor);
  const cid = conversationId || String((await service.create(randomUUID())).id);
  const sent = await service.send(cid, clientMessageId, { version: 1, blocks: [{ type: 'text', text: question }] });
  return { cid, runId: String(sent.runId), clientMessageId, service };
}
async function processQueued(runId: string) {
  let lease: any; const until = Date.now() + 60000;
  while (!lease && Date.now() < until) { lease = await claimJob(); if (!lease) await sleep(200); }
  assert.equal(lease?.runId, runId, 'Queued run must be claimed');
  await processAssistantRun(lease);
}
async function run(question: string, conversationId?: string, clientMessageId = randomUUID()) {
  const sent = await send(question, conversationId, clientMessageId);
  await processQueued(sent.runId);
  const trace = await readTrace(sent.runId);
  const message = (await new ConversationService(actor).messages(sent.cid)).items.find((m: any) => m.id === trace.run.output_message_id);
  return { ...sent, trace, message };
}

let release: any, settingsBefore: any, platformBefore: any, reverse: any, secondUser: string | undefined;
let audienceRestricted = false, restrictedDoc: string | undefined;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  settingsBefore = await tenant((tx: any) => one(tx, sql`select enabled,agent_config from app.assistant_enterprise_settings where enterprise_id=1454`));
  platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
  const primary = new (require('pg').Client)({ connectionString: originalDatabase }); let provider: any;
  try { await primary.connect(); await primary.query('begin read only');
    provider = (await primary.query("select llm_config from app.platform_configs where key='default'")).rows[0].llm_config; await primary.query('rollback');
  } finally { await primary.end(); }
  if (provider.providerKey !== 'dashscope') { assert.ok(provider.profiles?.dashscope?.apiKeyEncrypted); provider = { ...provider, ...provider.profiles.dashscope, providerKey: 'dashscope' }; }
  await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({ ...provider, model })}::jsonb where key='default'`));
  await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({
    runtime: 'langgraph-v1', providerKey: 'dashscope', model, imageInput: false, tools: true,
    probeVersion: 'agent-v2-f0-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,nickname,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor = { ...actor, contextVersion: Number(customer.context_version) };
  secondUser = String((await platform((tx: any) => one(tx, sql`insert into app.users(nickname,context_version)
    values(${'synthetic-agent-v2-denial-' + randomUUID()},1) returning id`))).id);
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };

  await fastGPTWorkflows().ready();
  reverse = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await sleep(900);
  const probe = await remote(`fetch('http://host.docker.internal:18310/agent-v2-tool/search_enterprise',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${'x'.repeat(devRuntime.agentV2.bridgeKey.length)}'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`);
  assert.equal(probe.trim(), '404', 'FastGPT host must reach the bridge and reject an unknown key');
  report.checks.push({ bridgeReachableFromFastGPTHost: true, wrongKeyRejected: 404 });
  report.status = 'running'; save();

  // `--scope=fallback` reuses retained full-batch evidence and only rechecks the built-in runtime.
  if (scope === 'full') {
  for (const [index, item] of questions.entries()) {
    const record: any = { index: index + 1, question: item.text, expectedPage: item.page };
    report.runs.push(record); save();
    const result = await run(item.text);
    record.conversationId = result.cid; record.runId = result.runId; record.messageId = result.message?.id;
    fs.writeFileSync(path.join(out, `trace-q${index + 1}-${result.runId}.json`), JSON.stringify(result.trace, null, 2));
    record.status = result.trace.run.status; record.error = result.trace.run.error_code;
    save();
    assert.equal(record.status, 'succeeded', record.error || 'run must succeed');
    assert.equal(result.trace.run.policy_snapshot.agentRuntime?.protocol, 'fastgpt-agent-v2-v1');
    const retrieval = result.trace.steps.filter((step: any) => step.kind === 'retrieval' && step.input_summary?.protocol === 'fastgpt-agent-v2-v1');
    assert.ok(retrieval.length >= 1, 'The model must call the authorized search tool');
    assert.ok(retrieval.some((step: any) => (step.private_checkpoint || []).length > 0), 'Search must return authorized evidence');
    const synthesis = result.trace.steps.find((step: any) => step.kind === 'agent_synthesis_context');
    assert.equal(synthesis?.input_summary?.protocol, 'fastgpt-agent-v2-v1');
    assert.ok(result.message?.available, 'Saved answer must be readable');
    const answer = result.message.content.blocks.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('');
    record.answer = answer; assert.ok(answer.trim()); assert.ok(!answer.includes('(CITE)'));
    record.citations = result.message.citations.map((citation: any) => ({ id: citation.id, title: citation.title, quote: citation.quote }));
    record.expectedPageCited = record.citations.some((citation: any) => String(citation.title).includes('第' + item.page + '页'));
    assert.equal(record.expectedPageCited, true, `Expected PPT page ${item.page} citation`);
    for (const citation of result.message.citations) {
      const opened = await result.service.citation(citation.id, false, result.cid);
      assert.ok(opened.available && String(opened.quote).length > 4);
      await assert.rejects(() => new ConversationService({ ...actor, principal: { kind: 'user', userId: secondUser } }).citation(citation.id, false, result.cid));
      await assert.rejects(() => new ConversationService({ ...actor, enterpriseId: '2385' }).citation(citation.id, false, result.cid));
    }
    const again = await result.service.send(result.cid, result.clientMessageId, { version: 1, blocks: [{ type: 'text', text: item.text }] });
    assert.equal(String(again.runId), result.runId, 'Same client message must not create another run');
    record.tokens = result.trace.usage.filter((u: any) => u.category === 'tokens').map((u: any) => ({ kind: u.measurement_kind, input: u.input_tokens, output: u.output_tokens }));
    record.queryEmbedding = result.trace.usage.filter((u: any) => u.category === 'query_embedding').map((u: any) => ({ kind: u.measurement_kind, input: u.input_tokens }));
    assert.ok(record.tokens.length === 1);
    record.checked = { savedAnswer: true, expectedPage: true, citationOpen: true, otherUserDenied: true, crossTenantDenied: true, idempotentSend: true };
    save();
  }

  // No-evidence turn: the tool reports empty and the answer must carry no citation.
  const unknown: any = { question: unknownQuestion }; report.unknown = unknown; save();
  const unknownResult = await run(unknownQuestion);
  unknown.conversationId = unknownResult.cid; unknown.runId = unknownResult.runId;
  fs.writeFileSync(path.join(out, `trace-unknown-${unknownResult.runId}.json`), JSON.stringify(unknownResult.trace, null, 2));
  unknown.status = unknownResult.trace.run.status; unknown.error = unknownResult.trace.run.error_code;
  assert.equal(unknown.status, 'succeeded', unknown.error || 'unknown turn must still answer');
  const unknownRetrieval = unknownResult.trace.steps.filter((step: any) => step.kind === 'retrieval' && step.input_summary?.protocol === 'fastgpt-agent-v2-v1');
  unknown.toolCalls = unknownRetrieval.map((step: any) => ({ query: step.input_summary?.query, selected: step.input_summary?.selected }));
  unknown.answer = unknownResult.message?.content?.blocks?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('') || '';
  unknown.citations = unknownResult.message?.citations?.length || 0;
  assert.ok(unknown.answer.trim());
  assert.equal(unknown.citations, 0, 'An unsupported question must not gain citations');
  if (unknownRetrieval.length) assert.ok(unknownRetrieval.every((step: any) => step.private_checkpoint.length === 0));
  save();

  // Source revocation: a saved answer and its citation must become unavailable, then readable again.
  const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: knowledgeAdminId });
  const first = report.runs[0], affected = report.runs.filter((r: any) => r.citations.length);
  const citationDocs = new Map<string, string>();
  for (const item of affected) for (const citation of item.citations) {
    const row = await tenant((tx: any) => one(tx, sql`select document_id::text document_id from app.assistant_message_citations
      where enterprise_id=1454 and id=${citation.id}`));
    citationDocs.set(String(citation.id), String(row.document_id));
  }
  restrictedDoc = String(citationDocs.get(String(first.citations[0].id)));
  report.checks.push({ revocationPrepared: true, affectedAnswers: affected.map((r: any) => r.runId), restrictedDoc });
  const setAudience = async (documentId: string, audience: string) => {
    const detail = await knowledge.execute('detail', { documentId });
    if (detail.document.audience === audience) return;
    await knowledge.execute('metadata', { documentId, expectedVersion: Number(detail.document.version), audience }, randomUUID());
  };
  await setAudience(restrictedDoc, 'staff_internal'); audienceRestricted = true;
  for (const item of report.runs.filter((r: any) => r.question === questions[0].text)) {
    assert.equal((await new ConversationService(actor).messages(item.conversationId)).items.find((m: any) => m.id === item.messageId).available, false);
    for (const citation of item.citations) {
      const opened = await new ConversationService(actor).citation(citation.id, false, item.conversationId);
      assert.equal(opened.available, citationDocs.get(String(citation.id)) !== restrictedDoc, 'Only the restricted source citation closes');
    }
  }
  report.checks.push({ revokedHidden: true, firstRun: first.runId });
  await setAudience(restrictedDoc, 'customer_public'); audienceRestricted = false;
  for (const item of report.runs.filter((r: any) => r.question === questions[0].text)) {
    assert.equal((await new ConversationService(actor).messages(item.conversationId)).items.find((m: any) => m.id === item.messageId).available, true);
    for (const citation of item.citations) assert.equal((await new ConversationService(actor).citation(citation.id, false, item.conversationId)).available, true);
  }
  report.checks.push({ restoredReadable: true });
  save();

  // A known pre-dispatch failure must not lock the conversation; a retry succeeds.
  const retryQuestion = '门窗保护材料一般什么时候撤？';
  const retrySent = await send(retryQuestion);
  writeRuntime(config => { config.agentV2.model = config.agentV2.model + '-binding-mismatch'; });
  await processQueued(retrySent.runId);
  restoreRuntime();
  const failed = { ...retrySent, trace: await readTrace(retrySent.runId) };
  report.retry = { question: retryQuestion, conversationId: failed.cid, runId: failed.runId,
    status: failed.trace.run.status, error: failed.trace.run.error_code, providerStartedAt: failed.trace.run.provider_started_at };
  assert.equal(failed.trace.run.status, 'failed');
  assert.equal(failed.trace.run.error_code, 'context_changed');
  assert.equal(failed.trace.run.provider_started_at, null);
  const retried = await run(retryQuestion, failed.cid);
  report.retry.retryRunId = retried.runId; report.retry.retryStatus = retried.trace.run.status;
  assert.equal(retried.trace.run.status, 'succeeded', retried.trace.run.error_code || 'retry must succeed');
  report.checks.push({ knownFailureRecoverable: true, retriedRun: retried.runId });
  save();
  }

  // Fallback: with the FastGPT deployment switch absent the built-in runtime must answer.
  // Editing the never-changing runtime file mid-process trips fastGPTWorkflows()'s
  // configuration-drift guard (a generic error the worker maps to model_unavailable),
  // so the switch is removed through the environment instead.
  delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  let fallback: any;
  try { fallback = await run(fallbackQuestion); }
  finally { process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile; }
  report.fallback = { question: fallbackQuestion, runId: fallback.runId, status: fallback.trace.run.status, error: fallback.trace.run.error_code,
    agentRuntime: fallback.trace.run.policy_snapshot.agentRuntime || null,
    answer: fallback.message?.content?.blocks?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('') || '',
    citations: fallback.message?.citations?.length || 0 };
  assert.equal(report.fallback.agentRuntime, null);
  assert.equal(report.fallback.status, 'succeeded', report.fallback.error || 'built-in fallback must answer');
  assert.ok(report.fallback.answer.trim());
  report.checks.push({ builtInFallback: true });
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, runs: report.runs.map((r: any) => r.runId), unknown: report.unknown?.runId ?? null,
    retry: report.retry?.retryRunId ?? null, fallback: report.fallback.runId }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  restoreRuntime();
  if (audienceRestricted && restrictedDoc) await cleanup('audienceRestored', async () => {
    const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: knowledgeAdminId });
    const detail = await knowledge.execute('detail', { documentId: restrictedDoc! });
    if (detail.document.audience !== 'customer_public') await knowledge.execute('metadata', { documentId: restrictedDoc!, expectedVersion: Number(detail.document.version), audience: 'customer_public' }, randomUUID());
  });
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await cleanup('bridgeClosed', closeFastGPTWorkflows); reverse?.kill();
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
