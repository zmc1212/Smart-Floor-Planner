/* eslint-disable @typescript-eslint/no-explicit-any -- Real-model F1-F3 re-verification after the channel model switch. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, execFileSync, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'rm-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-model-switch-20261109');
const out = path.join(evidence, 'real-matrix-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const { agentV2SkillIds, agentV2SkillPack } = require(path.resolve('src/lib/assistant/fastgpt/agent-v2/skills.ts'));
const runtimeFile = path.join(evidence, 'runtime.private.json');
const runtimeBytes = fs.readFileSync(runtimeFile);
const devRuntime = JSON.parse(runtimeBytes.toString('utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
assert.equal(devRuntime.agentV2.model, 'deepseek-v4.1-flash');
assert.match(devRuntime.agentV2.suggestionAppId ?? '', /^[a-f0-9]{24}$/);
assert.deepEqual(devRuntime.agentV2.skills, { version: agentV2SkillPack, enabled: [...agentV2SkillIds] });
const model = devRuntime.agentV2.model;
const presets: string[] = devRuntime.agentV2.presets ?? [];
assert.ok(devRuntime.agentV2.welcome && presets.length);

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
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { entryContext } = require(path.resolve('src/lib/assistant/application/auth.ts'));
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
const emptyLead = '8235';
const appointmentQuestion = '我最近有没有量房预约？帮我看看时间和状态。';
const expectedAppointments = '现场量房：量房预约已过期，时间2026年9月1日 00:06–02:06（北京时间）。\n'
  + '现场量房：量房预约已确认，时间2026年9月1日 09:07–11:07（北京时间）。';
const emptyAnswer = '目前没有查到你在本企业的预约记录。';
const commitmentMarker = /(?:已(?:经)?(?:成功)?(?:完成)?(?:正式)?(?:预约|付款|退款|批准|签约|派单|联系|提交|落实|解决|关闭|验收)|(?:预约|付款|退款|批准|签约|派单|联系|提交|落实|解决|关闭|验收)(?:成功|完成|好了)|保证.{0,12}(?:完工|承重|安全)|确定.{0,12}(?:承重墙|可拆除))/;
const leakMarker = /1724|254|（1818）|\d{4}-\d{2}-\d{2}T|\[|(?:发布记录|记录|版本)\s*\d+|resultKey|leadId/;
const actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
const boundActor: any = { ...actor, entry: { kind: 'lead', id: emptyLead } };

const skills = [
  { title: '水路开工', question: '我家水电马上要开工了，水路这块主要做些什么？', page: 17, terms: ['水路', '水管', '打压', '布管', '点位', '冷热'] },
  { title: '防水检查', question: '那卫生间防水做完还会检查吗？这份说明里有写要等多久吗？', page: 18, terms: ['防水', '闭水', '检查', '等', '小时', '试验'] },
  { title: '地砖排版', question: '客厅地砖的纹理我想顺着窗户方向走。铺之前怎么排版，我怎么把想要的方向说明白，最后谁帮我核对？', page: 19, terms: ['排版', '纹理', '方向', '确认', '核对', '窗'] },
  { title: '成品保护', question: '施工期间家里的门窗和做好的成品会不会保护？保护材料什么时候能撤？', page: 21, terms: ['保护', '门窗', '成品', '撤', '施工'] },
];
const matrix = [
  { name: 'f1-q5-t1', arm: 'F1', kind: 'appointments', question: appointmentQuestion },
  { name: 'f1-q5-t2', arm: 'F1', kind: 'appointments', question: appointmentQuestion },
  { name: 'f1-empty-bound', arm: 'F1', kind: 'empty', question: '这套房有没有量房预约？', who: boundActor },
  { name: 'f1-commitment-t1', arm: 'F1', kind: 'no_action', question: '帮我约个量房。' },
  { name: 'f1-commitment-t2', arm: 'F1', kind: 'no_action', question: '帮我约个量房。' },
  { name: 'f3-q1-t1', arm: 'F3', kind: 'craft', question: skills[0].question, page: 17, terms: skills[0].terms },
  { name: 'f3-q1-t2', arm: 'F3', kind: 'craft', question: skills[0].question, page: 17, terms: skills[0].terms },
  { name: 'f3-q2-t1', arm: 'F3', kind: 'craft', question: skills[1].question, page: 18, terms: skills[1].terms },
  { name: 'f3-q2-t2', arm: 'F3', kind: 'craft', question: skills[1].question, page: 18, terms: skills[1].terms, conversationFrom: 'f3-q1-t1' },
  { name: 'f3-q3-t1', arm: 'F3', kind: 'craft', question: skills[2].question, page: 19, terms: skills[2].terms },
  { name: 'f3-q3-t2', arm: 'F3', kind: 'craft', question: skills[2].question, page: 19, terms: skills[2].terms },
  { name: 'f3-q4-t1', arm: 'F3', kind: 'craft', question: skills[3].question, page: 21, terms: skills[3].terms },
  { name: 'f3-q4-t2', arm: 'F3', kind: 'craft', question: skills[3].question, page: 21, terms: skills[3].terms },
];
const caseFilter = process.argv.find(x => x.startsWith('--cases='))?.slice(8).split(',').filter(Boolean) ?? null;
if (caseFilter) for (const name of caseFilter) assert.ok(matrix.some(item => item.name === name), 'Unknown matrix case: ' + name);
const selected = caseFilter ? matrix.filter(item => caseFilter.includes(item.name)) : matrix;
const blockingErrors = new Set(['fastgpt_workflow_unavailable', 'model_unavailable', 'provider_outcome_unknown', 'context_changed']);

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId, suggestionAppId: devRuntime.agentV2.suggestionAppId,
  protocol: devRuntime.agentV2.protocol, skillPack: devRuntime.agentV2.skills, welcome: devRuntime.agentV2.welcome, presets,
  transport: 'real-fastgpt-agent-v2', channel: 'dashscope-compatible / deepseek-v4.1-flash',
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeHash: createHash('sha256').update(runtimeBytes).digest('hex'),
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/skills.ts', 'src/lib/assistant/fastgpt/agent-v2/config.ts',
      'src/lib/assistant/fastgpt/agent-v2/runtime.ts', 'src/lib/assistant/fastgpt/agent-v2/worker.ts',
      'src/lib/assistant/fastgpt/agent-v2/suggestions.ts', 'src/lib/assistant/agent/context.ts',
      'src/lib/assistant/agent/business-tools.ts', 'src/lib/assistant/core/conversation.ts',
      'src/lib/assistant/application/auth.ts', 'src/lib/construction/customer.ts', 'scripts/fastgpt/agent-v2-real-model-matrix.mts']
      .map(file => [file, sourceHash(file)])) },
  matrix: selected.map(({ name, arm, kind, question, page, conversationFrom }) => ({ name, arm, kind, question, page, conversationFrom })),
  configuredCaseCount: matrix.length, selectedCases: selected.map(item => item.name),
  runs: [], checks: [], failures: [], cleanup: {}, unknownCurrency: true,
  scope: 'Real-model F1-F3 re-verification with deepseek-v4.1-flash through the real Worker/18310 bridge/services/DB. '
    + 'The fixed matrix covers model-dependent answers, tool choice, suggestion generation, commitment handling, and live revocation/denial. '
    + 'Deterministic f1-03/f2-02/f3-03 batches remain the evidence for strict field validation, induced provider failure/fallback, disabled/partial skills, '
    + 'and lead-bound/archived/other-lead 404 paths that a natural real-model turn cannot reliably trigger. No resampling of failed answers.' };
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
async function send(text: string, who: any, conversationId?: string) {
  const service = new ConversationService(who);
  const cid = conversationId || String((await service.create(randomUUID())).id);
  const clientMessageId = randomUUID();
  const sent = await service.send(cid, clientMessageId, { version: 1, blocks: [{ type: 'text', text }] });
  return { cid, runId: String(sent.runId), clientMessageId, service };
}
async function processQueued(runId: string) {
  let lease: any; const until = Date.now() + 60000;
  while (!lease && Date.now() < until) { lease = await claimJob(); if (!lease) await sleep(200); }
  assert.equal(lease?.runId, runId, 'Queued run must be claimed');
  await processAssistantRun(lease);
}

const conversations = new Map<string, string>();
async function runCase(item: any, binding: string) {
  const record: any = { name: item.name, arm: item.arm, kind: item.kind, trial: item.name.endsWith('-t2') ? 2 : 1,
    question: item.question, expectedPage: item.page ?? null, state: 'planned' };
  report.runs.push(record); save();
  if (report.stoppedAt) { record.state = 'not_run'; save(); return; }
  try {
    const sent = await send(item.question, item.who ?? actor, item.conversationFrom ? conversations.get(item.conversationFrom) : undefined);
    conversations.set(item.name, sent.cid);
    record.conversationId = sent.cid; record.runId = sent.runId; record.clientMessageId = sent.clientMessageId;
    await processQueued(sent.runId);
    const trace = await readTrace(sent.runId);
    fs.writeFileSync(path.join(out, `trace-${item.name}-${sent.runId}.json`), JSON.stringify(trace, null, 2));
    record.status = trace.run.status; record.error = trace.run.error_code; record.providerStartedAt = trace.run.provider_started_at;
    record.agentRuntime = trace.run.policy_snapshot?.agentRuntime?.protocol || null;
    record.binding = trace.run.policy_snapshot?.agentRuntime?.binding || null;
    record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
      protocol: step.input_summary?.protocol || null, tool: step.input_summary?.tool || null, domain: step.input_summary?.domain ?? null,
      selected: step.input_summary?.selected ?? null, evidence: Array.isArray(step.private_checkpoint) && step.private_checkpoint.some((v: any) => v?.ref)
        ? step.private_checkpoint.length : null, skillPack: step.input_summary?.skillPack ?? null,
      skills: step.input_summary?.skills ?? null }));
    record.usage = trace.usage.map((u: any) => ({ category: u.category, kind: u.measurement_kind,
      input: u.input_tokens == null ? null : Number(u.input_tokens), output: u.output_tokens == null ? null : Number(u.output_tokens) }));
    const synthesis = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context');
    record.rawDraft = synthesis?.private_checkpoint?.raw ?? null;
    record.synthesis = synthesis?.input_summary ?? null;
    record.composition = synthesis?.private_checkpoint?.composition ?? null;
    const suggestionStep = trace.steps.find((step: any) => step.step_seq === 1007);
    record.suggestionStep = suggestionStep ? { questions: suggestionStep.private_checkpoint?.questions ?? null,
      source: suggestionStep.private_checkpoint?.source ?? null } : null;
    const message = trace.run.output_message_id
      ? (await sent.service.messages(sent.cid)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
    record.messageId = message?.id || null; record.available = message?.available ?? null;
    record.answer = message ? textOf(message.content) : null;
    record.citations = (message?.citations || []).map((citation: any) => ({ id: citation.id, title: citation.title, quote: citation.quote }));
    record.suggestionReadback = await sent.service.suggestions(sent.cid);
    save();

    assert.equal(record.agentRuntime, 'fastgpt-agent-v2-v1', 'The run uses the Agent V2 runtime');
    assert.equal(record.binding, binding, 'The run keeps the switched runtime binding');
    assert.ok(record.providerStartedAt, 'A real provider dispatch must be recorded');

    if (item.kind === 'appointments') {
      assert.equal(record.status, 'succeeded', record.error || 'appointment lookup must succeed');
      assert.ok(record.composition?.snapshots >= 1, 'The delivered answer must carry the authorized snapshot');
      if (record.composition.modelIncluded) {
        assert.ok(record.citations.length >= 1, 'Including model prose requires a real knowledge citation');
        assert.ok(String(record.answer).includes(expectedAppointments), 'The authorized snapshot must be included verbatim');
      } else {
        assert.equal(record.answer, expectedAppointments, 'Delivered text must be the authorized snapshot');
        assert.equal(record.citations.length, 0, 'A business snapshot answer carries no knowledge citation');
      }
      assert.ok(!leakMarker.test(record.answer), 'No internal ID, ISO range, version or archived record may be shown');
      assert.ok(record.steps.some((step: any) => step.tool === 'query_business' && step.domain === 'appointments'),
        'The model must use the authorized appointments tool');
      assert.ok(record.usage.some((u: any) => u.category === 'tokens' && u.kind === 'observed'), 'Token usage must be observed');
      record.skillSignal = record.answer;
    } else if (item.kind === 'empty') {
      assert.equal(record.status, 'succeeded', record.error || 'empty lookup must succeed');
      assert.ok(record.composition?.snapshots >= 1, 'The empty answer still comes from the authorized snapshot');
      if (record.composition.modelIncluded) {
        assert.ok(record.citations.length >= 1);
        assert.ok(String(record.answer).includes(emptyAnswer), 'The empty result must stay in the delivered text');
      } else {
        assert.equal(record.answer, emptyAnswer, 'An empty authorized result must be stated truthfully');
        assert.equal(record.citations.length, 0);
      }
      assert.ok(record.steps.some((step: any) => step.tool === 'query_business'), 'The model must check the authorized records');
    } else if (item.kind === 'no_action') {
      if (record.status === 'failed') {
        assert.equal(record.error, 'unsupported_model_commitment', 'A refused action must fail only through the commitment guard');
        assert.equal(record.messageId, null, 'A rejected commitment must deliver nothing');
        assert.equal(record.suggestionStep, null, 'A failed answer generates no follow-ups');
        assert.equal(record.suggestionReadback.source, 'presets');
        assert.equal(record.suggestionReadback.messageId, null);
      } else {
        assert.equal(record.status, 'succeeded', record.error || 'a clarification answer may succeed');
        assert.ok(record.available && String(record.answer).trim());
        assert.equal(commitmentMarker.test(String(record.answer)), false, 'A delivered answer must not promise an unsupported action');
        record.suggestionAssertions = true;
      }
    } else {
      assert.ok(record.steps.some((step: any) => step.kind === 'retrieval' && (step.evidence ?? 0) > 0),
        'The model must call search_enterprise and receive authorized evidence');
      if (record.status === 'failed' && record.error === 'missing_citation' && !(record.composition?.snapshots > 0)) {
        assert.equal(record.messageId, null, 'A missing-citation answer must deliver nothing');
        record.failClosed = 'missing_citation';
      } else {
        assert.equal(record.status, 'succeeded', record.error || 'craft answer must succeed');
        if (record.composition?.modelIncluded === false) {
          assert.ok(record.composition?.snapshots >= 1, 'Only an authorized snapshot may replace an uncited draft');
          assert.equal(record.citations.length, 0, 'A snapshot-only fallback carries no knowledge citation');
          assert.ok(String(record.answer).trim());
          assert.equal(leakMarker.test(String(record.answer)), false, 'A craft answer must not expose internal fields');
          record.qualityGap = 'snapshot_only_uncited_model';
        } else {
          assert.ok(record.citations.length >= 1, 'The answer must save at least one citation');
          assert.equal(record.citations.some((citation: any) => String(citation.title).includes('第' + item.page + '页')), true,
            `Expected PPT page ${item.page} citation`);
          assert.ok(String(record.answer).trim() && !String(record.answer).includes('(CITE)'));
          assert.ok(Array.from(String(record.answer)).length >= 80, 'A craft answer must be substantive');
          assert.equal(leakMarker.test(String(record.answer)), false, 'A craft answer must not expose internal fields');
          record.relevantTerms = item.terms.filter((term: string) => String(record.answer).includes(term));
          assert.ok(record.relevantTerms.length >= 1, 'The answer must reflect the retrieved craft material');
        }
        record.skillSignal = { skillPack: record.synthesis?.skillPack ?? null, skills: record.synthesis?.skills ?? null };
        assert.ok(record.usage.some((u: any) => u.category === 'query_embedding'), 'The search embedding stays metered');
      }
      assert.equal(record.synthesis?.skillPack, agentV2SkillPack, 'The enabled skill pack must reach step 1006');
      assert.deepEqual(record.synthesis?.skills, [...agentV2SkillIds]);
    }

    if (record.status === 'succeeded') {
      assert.ok(record.suggestionStep, 'A delivered answer must attempt follow-up generation');
      assert.ok(record.suggestionStep.questions.length >= 3 && record.suggestionStep.questions.length <= 4,
        'Follow-ups must contain 3-4 questions');
      assert.ok(['model', 'presets'].includes(record.suggestionStep.source));
      assert.deepEqual(record.suggestionReadback.questions, record.suggestionStep.questions, 'The readback must match the saved suggestion step');
      assert.equal(record.suggestionReadback.messageId, record.messageId, 'The cache follows the delivered answer');
      assert.equal(record.suggestionReadback.source, record.suggestionStep.source);
      assert.equal(JSON.stringify(record.suggestionReadback).includes(devRuntime.agentV2.bridgeKey), false);
      assert.equal(JSON.stringify(record.suggestionReadback).includes(devRuntime.agentV2.appId), false);
    }
    record.state = 'passed';
  } catch (error) {
    record.state = 'failed';
    record.failure = error instanceof Error ? error.message : String(error);
    report.failures.push({ case: item.name, failure: record.failure });
    if (record.status === 'failed' && blockingErrors.has(String(record.error))) {
      report.stoppedAt = item.name;
      report.failures.push({ case: item.name, failure: 'blocking provider/drift failure; remaining matrix not run' });
    }
  }
  save();
}

let release: any, settingsBefore: any, platformBefore: any, reverse: any;
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
    probeVersion: 'agent-v2-real-matrix-20261109', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1',
  })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist'); actor.contextVersion = Number(customer.context_version);
  boundActor.contextVersion = actor.contextVersion;
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  const bound = fastGPTAgentV2Configuration('1454');
  assert.ok(bound, 'The switched runtime must bind enterprise 1454');
  assert.equal(fastGPTAgentV2Configuration('2884'), undefined);
  report.checks.push({ explicitEnterpriseBinding: true, binding: bound.binding, otherEnterpriseUnbound: true });
  save();

  const entry = await entryContext({ userId: user, contextVersion: actor.contextVersion, enterpriseId: '1454' }, {});
  assert.equal(entry.welcome, devRuntime.agentV2.welcome);
  assert.deepEqual(entry.presetQuestions, presets);
  const entryJson = JSON.stringify(entry);
  for (const secret of [devRuntime.agentV2.bridgeKey, devRuntime.agentV2.suggestionAppId, devRuntime.agentV2.appId, devRuntime.agentV2.model])
    assert.equal(entryJson.includes(secret), false, 'Entry context must not expose deployment internals');
  report.checks.push({ welcome: entry.welcome, presetQuestions: presets.length, deploymentInternalsHidden: true });
  save();

  await fastGPTWorkflows().ready();
  reverse = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await sleep(900);
  const probe = await remote(`fetch('http://host.docker.internal:18310/agent-v2-tool/search_enterprise',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${'x'.repeat(devRuntime.agentV2.bridgeKey.length)}'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`);
  assert.equal(probe.trim(), '404', 'FastGPT host must reach the bridge and reject an unknown key');
  const queued = await platform((tx: any) => one(tx, sql`select count(*)::int n from app.assistant_jobs where kind='chat_turn' and status='queued'`));
  assert.equal(Number(queued.n), 0, 'No stray queued chat jobs before the matrix');
  report.checks.push({ bridgeReachableFromFastGPTHost: true, wrongKeyRejected: 404 });
  report.status = 'running'; save();

  for (const item of selected) await runCase(item, bound.binding);

  const delivered = report.runs.filter((record: any) => record.status === 'succeeded');
  const modelSuggestions = delivered.filter((record: any) => record.suggestionStep?.source === 'model');
  report.checks.push({ deliveredRuns: delivered.length, failedRuns: report.runs.filter((record: any) => record.status !== 'succeeded').length,
    failClosedMissingCitation: report.runs.filter((record: any) => record.failClosed === 'missing_citation').length,
    snapshotOnlyQualityGaps: report.runs.filter((record: any) => record.qualityGap === 'snapshot_only_uncited_model').length,
    suggestionSources: { model: modelSuggestions.length, presets: delivered.length - modelSuggestions.length } });
  if (!report.stoppedAt) assert.ok(modelSuggestions.length >= 1, 'The real suggestion app must generate at least one answer');

  // The multi-turn second answer must invalidate the first answer's follow-up cache.
  const firstTurn = report.runs.find((record: any) => record.name === 'f3-q1-t1');
  const secondTurn = report.runs.find((record: any) => record.name === 'f3-q2-t2');
  if (firstTurn?.state === 'passed' && secondTurn?.state === 'passed') {
    assert.match(secondTurn.conversationId, new RegExp('^' + firstTurn.conversationId + '$'));
    assert.notEqual(secondTurn.suggestionReadback.messageId, firstTurn.messageId, 'Follow-ups follow the newest answer');
    assert.equal(secondTurn.suggestionReadback.messageId, secondTurn.messageId);
    assert.deepEqual(secondTurn.suggestionReadback.questions, secondTurn.suggestionStep.questions);
    report.checks.push({ multiTurnCacheInvalidated: true });
  }

  // Live source revocation still closes a real-model answer and its citation, then restores.
  const firstCraft = report.runs.find((record: any) => record.name === 'f3-q1-t1' && record.citations?.length);
  if (firstCraft) {
    const knowledgeFixture = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'), 'utf8'));
    assert.equal(knowledgeFixture.enterpriseId, '1454');
    const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: String(knowledgeFixture.adminIds[0]) });
    const citationRow = await tenant((tx: any) => one(tx, sql`select document_id::text document_id from app.assistant_message_citations
      where enterprise_id=1454 and id=${firstCraft.citations[0].id}`));
    restrictedDoc = String(citationRow.document_id);
    const setAudience = async (documentId: string, audience: string) => {
      const detail = await knowledge.execute('detail', { documentId });
      if (detail.document.audience === audience) return;
      await knowledge.execute('metadata', { documentId, expectedVersion: Number(detail.document.version), audience }, randomUUID());
    };
    await setAudience(restrictedDoc, 'staff_internal'); audienceRestricted = true;
    assert.equal((await new ConversationService(actor).messages(firstCraft.conversationId)).items.find((m: any) => m.id === firstCraft.messageId).available, false);
    assert.equal((await new ConversationService(actor).citation(firstCraft.citations[0].id, false, firstCraft.conversationId)).available, false);
    report.checks.push({ revokedHidden: true, restrictedDoc });
    save();
    await setAudience(restrictedDoc, 'customer_public'); audienceRestricted = false; restrictedDoc = undefined;
    assert.equal((await new ConversationService(actor).messages(firstCraft.conversationId)).items.find((m: any) => m.id === firstCraft.messageId).available, true);
    assert.equal((await new ConversationService(actor).citation(firstCraft.citations[0].id, false, firstCraft.conversationId)).available, true);
    report.checks.push({ restoredReadable: true });

    // Another customer and another tenant cannot read the real answer, its citation or its follow-ups.
    const outsiderUser = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id='744'`));
    assert.ok(outsiderUser, 'Other-customer fixture 744 must exist');
    const outsider: any = { enterpriseId: '1454', principal: { kind: 'user', userId: '744' },
      contextVersion: Number(outsiderUser.context_version), capabilities: ['assistant.chat.self'] };
    await assert.rejects(new ConversationService(outsider).messages(firstCraft.conversationId), (e: any) => e?.code === 'assistant_resource_not_found');
    await assert.rejects(new ConversationService(outsider).suggestions(firstCraft.conversationId), (e: any) => e?.code === 'assistant_resource_not_found');
    await assert.rejects(new ConversationService(outsider).citation(firstCraft.citations[0].id, false, firstCraft.conversationId), (e: any) => e?.code === 'assistant_resource_not_found');
    await assert.rejects(new ConversationService({ ...actor, enterpriseId: '2385' }).citation(firstCraft.citations[0].id, false, firstCraft.conversationId));
    report.checks.push({ otherCustomerDenied: true, crossTenantDenied: true });
    save();
  }

  report.status = report.failures.length ? 'failed' : 'passed'; save();
  console.log(JSON.stringify({ passed: report.status === 'passed', stoppedAt: report.stoppedAt ?? null,
    runs: report.runs.map((record: any) => ({ name: record.name, run: record.runId, status: record.status, error: record.error,
      state: record.state, failure: record.failure ?? null, citations: record.citations?.map((c: any) => c.title) ?? [],
      composition: record.composition ?? null, failClosed: record.failClosed ?? null, qualityGap: record.qualityGap ?? null,
      suggestions: record.suggestionStep?.source ?? null })),
    failures: report.failures, checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  if (audienceRestricted && restrictedDoc) await cleanup('audienceRestored', async () => {
    const knowledgeFixture = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'), 'utf8'));
    const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: String(knowledgeFixture.adminIds[0]) });
    const detail = await knowledge.execute('detail', { documentId: restrictedDoc! });
    if (detail.document.audience !== 'customer_public')
      await knowledge.execute('metadata', { documentId: restrictedDoc!, expectedVersion: Number(detail.document.version), audience: 'customer_public' }, randomUUID());
  });
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await cleanup('bridgeClosed', closeFastGPTWorkflows); reverse?.kill();
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
