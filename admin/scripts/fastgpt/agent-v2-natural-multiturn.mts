/* eslint-disable @typescript-eslint/no-explicit-any -- One fixed natural multi-turn conversation, not a matrix. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, execFileSync, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'natural-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-model-switch-20261109');
const out = path.join(evidence, 'natural-multiturn-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const runtimeFile = path.join(evidence, 'runtime.private.json');
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
assert.equal(devRuntime.agentV2.model, 'deepseek-v4.1-flash');
assert.equal(devRuntime.agentV2.runtime, 'fastgpt-agent-v2');
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
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textOf = (content: any) => (content?.blocks || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
const sourceHash = (file: string) => createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');

const user = '645';
const expectedAppointments = '现场量房：量房预约已过期，时间2026年9月1日 00:06–02:06（北京时间）。\n'
  + '现场量房：量房预约已确认，时间2026年9月1日 09:07–11:07（北京时间）。';
const commitmentMarker = /(?:已(?:经)?(?:成功)?(?:完成)?(?:正式)?(?:预约|付款|退款|批准|签约|派单|联系|提交|落实|解决|关闭|验收)|(?:预约|付款|退款|批准|签约|派单|联系|提交|落实|解决|关闭|验收)(?:成功|完成|好了)|保证.{0,12}(?:完工|承重|安全)|确定.{0,12}(?:承重墙|可拆除))/;
const leakMarker = /1724|254|（1818）|\d{4}-\d{2}-\d{2}T|\[|(?:发布记录|记录|版本)\s*\d+|resultKey|leadId/;
const actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };

const turns = [
  { name: 'turn1-water', question: '我家水电马上要开工了，水路这块主要做些什么？', kind: 'craft' },
  { name: 'turn2-pressure', question: '那打压测试这一步，我要在现场盯哪些细节？', kind: 'craft' },
  { name: 'turn3-appointment', question: '顺便帮我看下我最近有没有量房预约。', kind: 'appointments' },
  { name: 'turn4-old-house', question: '刚才说的水路，如果是老房子，有什么要特别注意的？', kind: 'craft' },
  { name: 'turn5-waterproof', question: '防水做完还要做闭水试验吗？一般要等多久？', kind: 'craft' },
];

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId,
  protocol: devRuntime.agentV2.protocol, channel: 'dashscope-compatible / deepseek-v4.1-flash',
  transport: 'real-fastgpt-agent-v2', scope: 'One fixed natural five-turn conversation in one customer chat. '
    + 'It verifies multi-turn context, prior-citation reuse, a business snapshot turn, and two new craft questions. '
    + 'No resampling of failed answers and no matrix expansion.',
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeHash: createHash('sha256').update(runtimeBytes).digest('hex'),
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/worker.ts', 'src/lib/assistant/fastgpt/rag-session.ts',
      'src/lib/assistant/fastgpt/agent-v2/runtime.ts', 'src/lib/assistant/fastgpt/agent-v2/skills.ts',
      'src/lib/assistant/agent/context.ts', 'src/lib/assistant/agent/business-tools.ts',
      'src/lib/construction/customer.ts', 'scripts/fastgpt/agent-v2-natural-multiturn.mts']
      .map(file => [file, sourceHash(file)])) },
  turns: [], checks: [], failures: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));

const sshArgs = ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const remote = async (code: string) => {
  const script = '$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + Buffer.from(code).toString('base64') + '")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  return new Promise<string>((resolve, reject) => execFile('ssh', [...sshArgs, 'Administrator@192.168.10.54', 'powershell -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (e, stdout, stderr) => e ? reject(Error('remote probe failed: ' + String(stderr).slice(0, 200))) : resolve(stdout)));
};

const readTrace = (runId: string) => tenant(async (tx: any) => ({
  run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,trigger_message_id::text,policy_snapshot,
    (select provider_started_at::text from app.assistant_jobs j where j.enterprise_id=app.assistant_runs.enterprise_id and j.run_id=app.assistant_runs.id) provider_started_at
    from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
  steps: await rows(tx, sql`select step_seq,kind,status,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),
  usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity
    from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`),
}));
async function processQueued(runId: string) {
  let lease: any; const until = Date.now() + 90000;
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
    probeVersion: 'agent-v2-natural-multiturn-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor.contextVersion = Number(customer.context_version);
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  await fastGPTWorkflows().ready();
  reverse = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await sleep(900);
  const probe = await remote(`fetch('http://host.docker.internal:18310/agent-v2-tool/search_enterprise',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${'x'.repeat(devRuntime.agentV2.bridgeKey.length)}'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`);
  assert.equal(probe.trim(), '404', 'FastGPT host must reach the bridge and reject an unknown key');
  report.checks.push({ bridgeReachableFromFastGPTHost: true, wrongKeyRejected: 404 });
  report.status = 'running'; save();

  const service = new ConversationService(actor);
  const conversationId = String((await service.create(randomUUID())).id);
  report.conversationId = conversationId;

  for (const turn of turns) {
    const record: any = { name: turn.name, question: turn.question, kind: turn.kind, conversationId };
    report.turns.push(record); save();
    const clientMessageId = randomUUID();
    const sent = await service.send(conversationId, clientMessageId, { version: 1, blocks: [{ type: 'text', text: turn.question }] });
    record.runId = String(sent.runId); record.clientMessageId = clientMessageId;
    await processQueued(sent.runId);
    const trace = await readTrace(sent.runId);
    fs.writeFileSync(path.join(out, `trace-${turn.name}-${sent.runId}.json`), JSON.stringify(trace, null, 2));
    record.status = trace.run.status; record.error = trace.run.error_code; record.providerStartedAt = trace.run.provider_started_at;
    record.agentRuntime = trace.run.policy_snapshot?.agentRuntime?.protocol || null;
    record.binding = trace.run.policy_snapshot?.agentRuntime?.binding || null;
    record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
      tool: step.input_summary?.tool || null, domain: step.input_summary?.domain ?? null, selected: step.input_summary?.selected ?? null,
      evidence: Array.isArray(step.private_checkpoint) && step.private_checkpoint.some((v: any) => v?.ref)
        ? step.private_checkpoint.length : null }));
    const synthesis = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context');
    record.rawDraft = synthesis?.private_checkpoint?.raw ?? null;
    record.catalogIds = (synthesis?.private_checkpoint?.citations || []).map((citation: any) => citation.nativeId);
    record.composition = synthesis?.private_checkpoint?.composition ?? null;
    const suggestionStep = trace.steps.find((step: any) => step.step_seq === 1007);
    record.suggestionStep = suggestionStep ? { questions: suggestionStep.private_checkpoint?.questions ?? null,
      source: suggestionStep.private_checkpoint?.source ?? null } : null;
    const message = trace.run.output_message_id
      ? (await service.messages(conversationId)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
    record.messageId = message?.id || null; record.available = message?.available ?? null;
    record.answer = message ? textOf(message.content) : null;
    record.citations = (message?.citations || []).map((citation: any) => ({ id: citation.id, title: citation.title, quote: citation.quote }));
    save();

    assert.equal(record.agentRuntime, 'fastgpt-agent-v2-v1', 'Every turn uses the Agent V2 runtime');
    assert.ok(record.providerStartedAt, 'Every turn records a real provider dispatch');
    assert.equal(record.status, 'succeeded', record.error || `${turn.name} must succeed`);
    assert.ok(record.available && String(record.answer).trim(), 'A succeeded turn must deliver readable text');
    assert.equal(String(record.answer).includes('(CITE)'), false, 'Delivered text never exposes CITE markers');
    assert.equal(leakMarker.test(String(record.answer)), false, 'Delivered text must not expose internal fields');
    assert.equal(commitmentMarker.test(String(record.answer)), false, 'A delivered answer must not promise an action');
    assert.equal(devRuntime.agentV2.runtime, 'fastgpt-agent-v2', 'The bound agent runtime is Agent V2');

    if (turn.kind === 'appointments') {
      assert.ok(record.composition?.snapshots >= 1, 'The appointment turn must deliver the authorized snapshot');
      if (record.composition.modelIncluded) assert.ok(record.citations.length >= 1, 'Included model prose needs a citation');
      else assert.equal(record.answer, expectedAppointments, 'The snapshot must be delivered verbatim');
      assert.ok(String(record.answer).includes('量房预约'));
      assert.ok(record.steps.some((step: any) => step.tool === 'query_business' && step.domain === 'appointments'),
        'The appointment turn must use the authorized business tool');
    } else {
      assert.ok(record.steps.some((step: any) => step.kind === 'retrieval'), 'Craft turns must go through authorized retrieval');
      assert.ok(record.citations.length >= 1, 'A craft answer must save at least one real citation');
      assert.ok(Array.from(String(record.answer)).length >= 60, 'A craft answer must be substantive');
    }
    if (record.suggestionStep) {
      assert.ok(record.suggestionStep.questions.length >= 3 && record.suggestionStep.questions.length <= 4);
      assert.ok(['model', 'presets'].includes(record.suggestionStep.source));
    }
    record.state = 'passed'; save();
  }

  const first = report.turns[0];
  const second = report.turns[1];
  report.checks.push({ fiveTurnsDelivered: report.turns.filter((turn: any) => turn.state === 'passed').length,
    priorCitationCarriedIntoFollowup: first.catalogIds.some((id: string) => second.catalogIds.includes(id)),
    firstCatalog: first.catalogIds.length, secondCatalog: second.catalogIds.length,
    appointmentSnapshot: report.turns[2].composition?.snapshots ?? 0,
    totalCitations: report.turns.reduce((sum: number, turn: any) => sum + turn.citations.length, 0) });

  const reentry = (await service.messages(conversationId)).items;
  assert.ok(reentry.filter((m: any) => m.authorKind === 'assistant' && m.available).length >= turns.length,
    'Every delivered answer stays readable on reentry');
  report.checks.persistedReentry = reentry.length;
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true,
    turns: report.turns.map((turn: any) => ({ name: turn.name, run: turn.runId, status: turn.status, error: turn.error,
      citations: turn.citations.map((citation: any) => citation.title), composition: turn.composition,
      catalogIds: turn.catalogIds, suggestions: turn.suggestionStep?.source ?? null })),
    checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
  report.failures.push(report.error); save();
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
