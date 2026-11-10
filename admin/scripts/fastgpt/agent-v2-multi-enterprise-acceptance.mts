/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated multi-enterprise queue acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const pilotRuntimeFile = path.resolve('../tmp/xiaok-fastgpt-agentv2-model-switch-20261109/runtime.private.json');
const pilot = JSON.parse(fs.readFileSync(pilotRuntimeFile, 'utf8'));
const evidence = path.resolve('../tmp/xiaok-agentv2-d2-20261110');
fs.mkdirSync(evidence, { recursive: true });
const runtimeFile = path.join(evidence, 'runtime.multi.json');
const switchedFile = path.join(evidence, 'runtime.switched.json');
const auditFile = path.join(evidence, 'audit.jsonl');
const report: any = { status: 'preparing', database: null, enterprises: [], runs: [], checks: [], cleanup: {} };
const save = () => fs.writeFileSync(path.join(evidence, 'acceptance.json'), JSON.stringify(report, null, 2));

process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile;
process.env.ASSISTANT_WORKER_CONCURRENCY = '2';
process.env.ASSISTANT_ENTERPRISE_CONCURRENCY = '1';
delete process.env.XIAOK_OPENINGS_FILE;

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { deleteAssistantData } = require(path.resolve('src/db/repositories/assistant-cleanup.ts'));
const { ConversationService } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { claimJob, processAssistantJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { fastGPTAgentV2Configuration } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/config.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { claimKnowledgeJob, runKnowledgeJob } = require(path.resolve('src/lib/assistant/knowledge/index-worker.ts'));
const { closePostgresPool } = require(path.resolve('src/lib/postgresql.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const platform = (f: any) => withPlatformTransaction(f);
const tenantFor = (enterpriseId: string, f: any) => withTenantTransaction(enterpriseId, f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textOf = (content: any) => (content?.blocks || []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('');
const sshArgs = ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const remote = async (code: string) => {
  const script = '$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("'
    + Buffer.from(code).toString('base64') + '")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  return new Promise<string>((resolve, reject) => execFile('ssh', [...sshArgs, 'Administrator@192.168.10.54',
    'powershell -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')],
  { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (error, stdout, stderr) =>
    error ? reject(Error('remote probe failed: ' + String(stderr).slice(0, 200))) : resolve(stdout)));
};

const prefix = 'd2-agentv2-' + randomUUID().slice(0, 8);
const fixtures: any[] = [];
const admins: string[] = [];
const users: string[] = [];
const docs: any[] = [];
let release: any, reverse: any;

async function seedKnowledge(index: number, title: string, body: string) {
  const fixture = fixtures[index];
  const service = new KnowledgeService({ enterpriseId: fixture.id, adminId: admins[index] });
  const created: any = await service.execute('create', { title, sourceType: 'manual_text', audience: 'customer_public', body }, randomUUID());
  const target = { documentId: String(created.document.id), versionId: String(created.draft.id), expectedVersion: 1, expectedEditVersion: 1 };
  const queued: any = await service.execute('index', target, randomUUID());
  const lease = await claimKnowledgeJob();
  assert.ok(lease, 'Index job must be claimable');
  assert.equal(lease.jobId, queued.jobId);
  await runKnowledgeJob(lease);
  assert.equal((await service.execute('job', { jobId: queued.jobId }, randomUUID())).status, 'succeeded');
  await service.execute('publish', target, randomUUID());
  docs.push({ enterpriseId: fixture.id, documentId: target.documentId, title, fact: body });
}

async function trace(runId: string) {
  return {
    run: await platform((tx: any) => one(tx, sql`select id::text,status,error_code,started_at,completed_at,output_message_id::text,
      policy_snapshot->'agentRuntime' agent_runtime from app.assistant_runs where id=${runId}`)),
    job: await platform((tx: any) => one(tx, sql`select provider_started_at,status,attempts from app.assistant_jobs where run_id=${runId} and kind='chat_turn'`)),
    steps: await platform((tx: any) => rows(tx, sql`select kind,status,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where run_id=${runId} order by step_seq`)),
  };
}

try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  report.database = new URL(process.env.DATABASE_URL).pathname;

  await platform(async (tx: any) => {
    for (let index = 0; index < 2; index += 1) {
      const name = prefix + '-' + index;
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${name},${name},'active') returning id`))!;
      const id = String(enterprise.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${id},true,100,1200000,100000000,90)`);
      const admin = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${id},${name},'test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!;
      const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${name},1) returning id`))!;
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(user.id)},${name})`);
      admins.push(String(admin.id));
      users.push(String(user.id));
      fixtures.push({ id, adminId: String(admin.id), userId: String(user.id), actor: {
        enterpriseId: id, principal: { kind: 'user', userId: String(user.id) }, contextVersion: 1, capabilities: ['assistant.chat.self'] } });
    }
  });
  report.enterprises = fixtures.map(fixture => ({ id: fixture.id, userId: fixture.userId }));
  const [first, second] = fixtures;
  const model = pilot.agentV2.model;
  const agentConfig = { runtime: 'langgraph-v1', providerKey: 'dashscope', model, imageInput: false, tools: true,
    probeVersion: 'agent-v2-d2-20261110', enterpriseKnowledgeEnabled: true, knowledgeExplanation: 'natural-knowledge-answer-v1' };
  for (const fixture of fixtures) await tenantFor(fixture.id, (tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set agent_config=${JSON.stringify(agentConfig)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${fixture.id}`));

  const runtime = { baseUrl: pilot.baseUrl, apiKey: pilot.apiKey, auditFile, agentV2: fixtures.map(fixture => ({
    protocol: 'fastgpt-agent-v2-v1', enterpriseId: fixture.id, appId: pilot.agentV2.appId, model, bridgeKey: pilot.agentV2.bridgeKey })) };
  fs.writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2));
  report.bindings = Object.fromEntries(fixtures.map(fixture => [fixture.id, fastGPTAgentV2Configuration(fixture.id)?.binding]));
  assert.ok(fixtures.every(fixture => fastGPTAgentV2Configuration(fixture.id)), 'Both enterprises must bind the V2 runtime');

  await seedKnowledge(0, '甲企业防水标准', '甲企业施工标准：卫生间防水闭水试验必须持续 48 小时。');
  await seedKnowledge(1, '乙企业防水标准', '乙企业施工标准：卫生间防水闭水试验必须持续 72 小时。');
  report.documents = docs;
  save();

  const conversations: any = [];
  for (const fixture of fixtures) conversations.push(String((await new ConversationService(fixture.actor).create(randomUUID())).id));
  const secondConversation = String((await new ConversationService(first.actor).create(randomUUID())).id);
  const question = '请根据企业知识库回答：卫生间防水闭水试验必须持续多长时间？';
  const content = (text: string) => ({ version: 1, blocks: [{ type: 'text', text }] });
  const firstSent = await new ConversationService(first.actor).send(conversations[0], randomUUID(), content(question));
  const secondSent = await new ConversationService(second.actor).send(conversations[1], randomUUID(), content(question));
  // Same enterprise, different conversation: it must wait for the enterprise slot.
  const queuedSameEnterprise = await new ConversationService(first.actor).send(secondConversation, randomUUID(), content(question));
  const runIds = [String(firstSent.runId), String(secondSent.runId), String(queuedSameEnterprise.runId)];
  report.runs = runIds.map(runId => ({ runId }));
  save();

  await fastGPTWorkflows().ready();
  reverse = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310',
    'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await sleep(900);
  const probe = await remote(`fetch('http://host.docker.internal:18310/agent-v2-tool/search_enterprise',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${'x'.repeat(pilot.agentV2.bridgeKey.length)}'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`);
  assert.equal(probe.trim(), '404', 'FastGPT host must reach the multi-enterprise bridge');
  report.checks.push({ bridgeReachableFromFastGPTHost: true });

  const tick = processAssistantJob(processAssistantRun, 2);
  let started = false;
  for (let attempt = 0; attempt < 240 && !started; attempt += 1) {
    const jobs = await platform((tx: any) => rows(tx, sql`select run_id::text,status,provider_started_at from app.assistant_jobs
      where run_id in (${runIds[0]},${runIds[1]}) and kind='chat_turn'`));
    started = jobs.length === 2 && jobs.every((job: any) => job.provider_started_at);
    if (!started) await sleep(500);
  }
  assert.ok(started, 'Both enterprise runs must reach the provider concurrently');
  const whileRunning = await platform((tx: any) => one(tx, sql`select status from app.assistant_jobs where run_id=${runIds[2]} and kind='chat_turn'`));
  assert.equal(whileRunning!.status, 'queued', 'The same enterprise second conversation must wait');
  const claimedWhileFull = await claimJob();
  assert.equal(claimedWhileFull, null, 'A full enterprise must not lend its slot to another conversation');
  report.checks.push({ sameEnterpriseQueuedWhileRunning: true, claimDuringFullSlot: null });
  await tick;

  const traces = [await trace(runIds[0]), await trace(runIds[1])];
  for (let index = 0; index < 2; index += 1) {
    const record: any = report.runs[index];
    const item = traces[index], run = item.run;
    record.status = run.status; record.error = run.error_code; record.agentRuntime = run.agent_runtime;
    record.providerStartedAt = item.job.provider_started_at; record.startedAt = run.started_at; record.completedAt = run.completed_at;
    const message = (await new ConversationService(fixtures[index].actor).messages(conversations[index])).items
      .find((entry: any) => entry.id === run.output_message_id);
    assert.ok(message, 'Each run must save a reader-visible answer');
    record.answer = textOf(message.content);
    record.citations = (message?.citations || []).map((citation: any) => ({ id: citation.id, title: citation.title, quote: citation.quote }));
    assert.equal(record.status, 'succeeded', record.error || 'Both enterprises must answer');
    assert.equal(record.agentRuntime?.protocol, 'fastgpt-agent-v2-v1');
    assert.ok(record.answer.includes(index === 0 ? '48' : '72'), 'Each answer must use its own enterprise standard');
    assert.ok(record.citations.some((citation: any) => citation.title === docs[index].title), 'Each answer must cite its own enterprise document');
    assert.ok(record.citations.every((citation: any) => citation.title === docs[index].title), 'No citation may cross enterprises');
    assert.ok(!JSON.stringify(item.steps).includes(docs[1 - index].title), 'Retrieved evidence must not contain the other enterprise document');
    for (const citation of message.citations || []) {
      const opened = await new ConversationService(fixtures[index].actor).citation(citation.id, false, conversations[index]);
      assert.ok(opened.available && String(opened.quote).length > 4);
    }
  }
  const [left, right] = traces.map(item => item.job.provider_started_at);
  const overlaps = new Date(left) < new Date(traces[1].run.completed_at) && new Date(right) < new Date(traces[0].run.completed_at);
  assert.ok(overlaps, 'The two enterprises must run in overlapping windows');
  report.checks.push({ twoEnterprisesOverlap: true, providerStart: [left, right] });

  const resumed = await processAssistantJob(processAssistantRun, 1);
  assert.equal(resumed.claimed, true, 'The queued same-enterprise conversation resumes after the slot frees');
  const resumedTrace = await trace(runIds[2]);
  assert.equal(resumedTrace.run.status, 'succeeded', resumedTrace.run.error_code || 'Queued same-enterprise run must succeed');
  report.runs[2] = { runId: runIds[2], status: resumedTrace.run.status, agentRuntime: resumedTrace.run.agent_runtime,
    queuedWhileOtherRunActive: true };

  const settingsBefore = await platform((tx: any) => rows(tx, sql`select enterprise_id::text,agent_config,policy_version,knowledge_epoch
    from app.assistant_enterprise_settings where enterprise_id in (${first.id},${second.id}) order by enterprise_id`));
  const firstBinding = fastGPTAgentV2Configuration(first.id)!.binding;
  fs.writeFileSync(switchedFile, JSON.stringify({ ...runtime, agentV2: [
    { ...runtime.agentV2[0] }, { ...runtime.agentV2[1], runtime: 'langgraph-v1' }] }, null, 2));
  process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = switchedFile;
  try {
    assert.equal(fastGPTAgentV2Configuration(second.id), undefined, 'Stopping V2 is scoped to the disabled enterprise');
    assert.equal(fastGPTAgentV2Configuration(first.id)?.binding, firstBinding, 'The other enterprise keeps its binding');
  } finally { process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile; }
  const settingsAfter = await platform((tx: any) => rows(tx, sql`select enterprise_id::text,agent_config,policy_version,knowledge_epoch
    from app.assistant_enterprise_settings where enterprise_id in (${first.id},${second.id}) order by enterprise_id`));
  assert.deepEqual(settingsAfter, settingsBefore, 'Stopping V2 must not change knowledge policy');
  report.checks.push({ runtimeSwitchScoped: true, knowledgePolicyUnchanged: true });
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, database: report.database, enterprises: report.enterprises,
    runs: report.runs.map((run: any) => ({ runId: run.runId, status: run.status, citations: run.citations?.map((citation: any) => citation.title) })),
    checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  save();
  console.error(report.error);
  process.exitCode = 1;
} finally {
  const cleanup = async (key: string, run: () => Promise<any>) => {
    try { await run(); report.cleanup[key] = true; } catch (error) { report.cleanup[key] = String(error); process.exitCode = 1; }
  };
  for (const fixture of fixtures) await cleanup('assistantData:' + fixture.id, () => platform((tx: any) => deleteAssistantData(tx, BigInt(fixture.id))));
  await cleanup('fixtures', () => platform(async (tx: any) => {
    for (const fixture of fixtures) {
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${fixture.id}`);
      await tx.execute(sql`delete from app.enterprises where id=${fixture.id}`);
    }
    for (const userId of users) await tx.execute(sql`delete from app.users where id=${userId}`);
  }));
  await cleanup('bridgeClosed', closeFastGPTWorkflows);
  reverse?.kill();
  if (release) await cleanup('lockReleased', release);
  await cleanup('poolClosed', closePostgresPool);
  for (const file of [runtimeFile, switchedFile]) try { fs.rmSync(file); } catch {}
  save();
}
