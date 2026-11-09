/* eslint-disable @typescript-eslint/no-explicit-any -- Narrow real-model smoke after the FastGPT channel model switch. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, execFileSync, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'switch-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-model-switch-20261109');
const out = path.join(evidence, 'smoke-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const { agentV2SkillIds, agentV2SkillPack } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/skills.ts'));
const runtimeFile = path.join(evidence, 'runtime.private.json');
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
assert.equal(devRuntime.agentV2.model, 'deepseek-v4.1-flash', 'The smoke runs the switched model');
assert.ok(/^[a-f0-9]{24}$/.test(devRuntime.agentV2.suggestionAppId ?? ''), 'The combined runtime keeps the suggestion app');
assert.deepEqual(devRuntime.agentV2.skills, { version: agentV2SkillPack, enabled: [...agentV2SkillIds] });
const model = devRuntime.agentV2.model;

const originalDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile;
process.env.ASSISTANT_TEXT_MODEL = model;
process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
delete process.env.XIAOK_FASTGPT_RETRIEVAL_FILE;

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { ConversationService } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { fastGPTAgentV2Configuration } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/config.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textOf = (content: any) => (content?.blocks || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
const sourceHash = (file: string) => createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');

const user = '645';
const question = { text: '我家水电马上要开工了，水路这块主要做些什么？', page: 17, documentId: '2511' };
const actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId, suggestionAppId: devRuntime.agentV2.suggestionAppId,
  protocol: devRuntime.agentV2.protocol, skillPack: devRuntime.agentV2.skills, question,
  transport: 'real-fastgpt-agent-v2', channel: 'dashscope-compatible / deepseek-v4.1-flash',
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeHash: createHash('sha256').update(runtimeBytes).digest('hex'),
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/config.ts', 'src/lib/assistant/fastgpt/agent-v2/runtime.ts',
      'src/lib/assistant/fastgpt/agent-v2/worker.ts', 'src/lib/assistant/ai/provider.ts',
      'src/lib/assistant/agent/context.ts', 'scripts/fastgpt/agent-v2-model-switch-smoke.mts'].filter(file => fs.existsSync(path.resolve(file)))
      .map(file => [file, sourceHash(file)])) },
  checks: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));
const readTrace = (runId: string) => tenant(async (tx: any) => ({
  run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,trigger_message_id::text,policy_snapshot,
    (select provider_started_at::text from app.assistant_jobs j where j.enterprise_id=app.assistant_runs.enterprise_id and j.run_id=app.assistant_runs.id) provider_started_at
    from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
  steps: await rows(tx, sql`select step_seq,kind,status,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),
  usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity
    from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`),
}));
const sshArgs = ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const remote = async (code: string) => {
  const script = '$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + Buffer.from(code).toString('base64') + '")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  return new Promise<string>((resolve, reject) => execFile('ssh', [...sshArgs, 'Administrator@192.168.10.54', 'powershell -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (e, stdout, stderr) => e ? reject(Error('remote probe failed: ' + String(stderr).slice(0, 200))) : resolve(stdout)));
};
async function send(text: string, clientMessageId = randomUUID()) {
  const service = new ConversationService(actor);
  const cid = String((await service.create(randomUUID())).id);
  const sent = await service.send(cid, clientMessageId, { version: 1, blocks: [{ type: 'text', text }] });
  return { cid, runId: String(sent.runId), clientMessageId, service };
}
async function processQueued(runId: string) {
  let lease: any; const until = Date.now() + 60000;
  while (!lease && Date.now() < until) { lease = await claimJob(); if (!lease) await sleep(200); }
  assert.equal(lease?.runId, runId, 'Queued run must be claimed');
  await processAssistantRun(lease);
}

let release: any, settingsBefore: any, platformBefore: any, reverse: any;
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
    probeVersion: 'agent-v2-model-switch-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor.contextVersion = Number(customer.context_version);
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  const bound = fastGPTAgentV2Configuration('1454');
  assert.ok(bound, 'The switched runtime must bind enterprise 1454');
  assert.equal(fastGPTAgentV2Configuration('2884'), undefined, 'The binding stays scoped to the explicitly enabled enterprise');
  report.checks.push({ explicitEnterpriseBinding: true, binding: bound.binding, otherEnterpriseUnbound: true });
  save();

  await fastGPTWorkflows().ready();
  reverse = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await sleep(900);
  const probe = await remote(`fetch('http://host.docker.internal:18310/agent-v2-tool/search_enterprise',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${'x'.repeat(devRuntime.agentV2.bridgeKey.length)}'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`);
  assert.equal(probe.trim(), '404', 'FastGPT host must reach the bridge and reject an unknown key');
  report.checks.push({ bridgeReachableFromFastGPTHost: true, wrongKeyRejected: 404 });
  report.status = 'running'; save();

  const queued = await platform((tx: any) => one(tx, sql`select count(*)::int n from app.assistant_jobs where kind='chat_turn' and status='queued'`));
  assert.equal(Number(queued.n), 0, 'No stray queued chat jobs before the smoke');

  const sent = await send(question.text);
  const record: any = { conversationId: sent.cid, runId: sent.runId, clientMessageId: sent.clientMessageId, question: question.text, expectedPage: question.page };
  report.run = record; save();
  await processQueued(sent.runId);
  const trace = await readTrace(sent.runId);
  fs.writeFileSync(path.join(out, `trace-${sent.runId}.json`), JSON.stringify(trace, null, 2));
  record.status = trace.run.status; record.error = trace.run.error_code; record.providerStartedAt = trace.run.provider_started_at;
  record.agentRuntime = trace.run.policy_snapshot?.agentRuntime?.protocol || null;
  record.binding = trace.run.policy_snapshot?.agentRuntime?.binding || null;
  record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
    protocol: step.input_summary?.protocol || null, tool: step.input_summary?.tool || null, query: step.input_summary?.query || null,
    selected: step.input_summary?.selected ?? null, evidence: Array.isArray(step.private_checkpoint) ? step.private_checkpoint.length : null }));
  record.usage = trace.usage.map((u: any) => ({ category: u.category, kind: u.measurement_kind,
    input: u.input_tokens == null ? null : Number(u.input_tokens), output: u.output_tokens == null ? null : Number(u.output_tokens) }));
  const message = trace.run.output_message_id
    ? (await sent.service.messages(sent.cid)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
  record.messageId = message?.id || null; record.available = message?.available ?? null;
  record.answer = message ? textOf(message.content) : null;
  record.citations = (message?.citations || []).map((citation: any) => ({ id: citation.id, title: citation.title, quote: citation.quote }));
  const synthesis = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context');
  record.rawDraft = synthesis?.private_checkpoint?.raw ?? null;
  record.synthesis = synthesis?.input_summary ?? null;
  save();
  assert.equal(record.status, 'succeeded', record.error || 'real-model smoke run must succeed');
  assert.equal(record.agentRuntime, 'fastgpt-agent-v2-v1');
  assert.equal(record.binding, bound.binding, 'The smoke run keeps the switched runtime binding');
  assert.ok(record.providerStartedAt, 'The job must record a real provider dispatch');
  const retrieval = trace.steps.filter((step: any) => step.kind === 'retrieval' && step.input_summary?.protocol === 'fastgpt-agent-v2-v1');
  assert.ok(retrieval.length >= 1, 'The model must call the authorized search tool');
  assert.ok(retrieval.some((step: any) => (step.private_checkpoint || []).length > 0), 'Search must return authorized evidence');
  assert.equal(synthesis?.input_summary?.protocol, 'fastgpt-agent-v2-v1');
  assert.ok(message?.available, 'Saved answer must be readable');
  assert.ok(String(record.answer).trim()); assert.ok(!String(record.answer).includes('(CITE)'));
  assert.ok(record.citations.length >= 1, 'The answer must save at least one citation');
  assert.equal(record.citations.some((citation: any) => String(citation.title).includes('第' + question.page + '页')), true,
    `Expected PPT page ${question.page} citation`);
  for (const citation of message.citations) {
    const opened = await sent.service.citation(citation.id, false, sent.cid);
    assert.ok(opened.available && String(opened.quote).length > 4, 'Each saved citation must open with its original quote');
  }
  assert.ok(record.usage.some((u: any) => u.category === 'tokens' && u.kind === 'observed'), 'Token usage must be observed');
  assert.ok(record.usage.some((u: any) => u.category === 'query_embedding'), 'The search embedding stays metered');
  record.checked = { realProvider: true, savedAnswer: true, searchToolCalled: true, expectedPage: true, citationOpen: true, usageObserved: true };
  report.checks.push({ realModelRun: sent.runId, answerLength: Array.from(String(record.answer)).length, citations: record.citations.length });
  report.scope = 'One narrow real-model smoke after the DashScope channel/model switch (deepseek-v4.1-flash-1017 -> deepseek-v4.1-flash). '
    + 'It reuses the F0/F3 bridge, Worker, DB, retrieval, citation and usage paths; it does not repeat the F1-F3 matrix and does not change default/production.';
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, run: sent.runId, status: record.status, citations: record.citations.map((c: any) => c.title),
    answer: record.answer, checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await cleanup('bridgeClosed', closeFastGPTWorkflows); reverse?.kill();
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
