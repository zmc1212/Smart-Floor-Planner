/* eslint-disable @typescript-eslint/no-explicit-any -- One fixed natural conversation over three known gaps. */
/** Verifies the three unresolved Agent V2 gaps in one real conversation:
 *  real web search with checkable sources, nearby public sites, designer works.
 *  The customer speaks naturally; tools and expectations stay in code.
 *  Optional --conversation=<id> reuses an already located customer chat; the
 *  script never creates a synthetic location or refreshes an expired one. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'probe-01';
assert.match(label, /^[a-z0-9-]+$/);
const cliValue = (name: string) => {
  const prefix = `--${name}=`;
  const inline = process.argv.find(x => x.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const reuseConversationId = cliValue('conversation');
if (reuseConversationId) assert.match(reuseConversationId, /^[1-9]\d*$/, '--conversation must be a positive conversation id');
const out = path.resolve('../tmp/xiaok-agentv2-web-recommend-20261110/' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const runtimeFile = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
assert.ok(runtimeFile, 'XIAOK_FASTGPT_WORKFLOWS_FILE must point at the bound Agent V2 runtime');
const devRuntime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
assert.equal(devRuntime.agentV2.enterpriseId, '1454');
assert.equal(devRuntime.baseUrl, 'http://127.0.0.1:18300');
assert.equal(devRuntime.agentV2.runtime, 'fastgpt-agent-v2');
const model = devRuntime.agentV2.model;

// The reader URL is a fixed private loopback contract, not user input. A
// standalone probe process has no dev.mjs environment, so default it here and
// fail at startup instead of producing a whole invalid turn with
// web_reader_unconfigured.
const publicReaderUrl = 'http://127.0.0.1:18095';
if (!process.env.ASSISTANT_PUBLIC_READER_URL) process.env.ASSISTANT_PUBLIC_READER_URL = publicReaderUrl;
assert.equal(process.env.ASSISTANT_PUBLIC_READER_URL, publicReaderUrl,
  'ASSISTANT_PUBLIC_READER_URL must be the fixed private reader http://127.0.0.1:18095');

const originalDatabase = process.env.DATABASE_URL;
assert.ok(originalDatabase, 'DATABASE_URL must be configured for the development database');
const vectorDatabase = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
// Acceptance is fixed to the isolated database by lockAssistantAcceptance. A
// reused conversation must therefore live there; the main development chat is
// never silently substituted or copied.
process.env.DATABASE_URL = vectorDatabase;
const databaseName = (url: string | undefined) => { try { return url ? new URL(url).pathname.replace(/^\//, '') : null; } catch { return null; } };
process.env.ASSISTANT_TEXT_MODEL = model;
process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { ConversationService } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { nearbyRegion } = require(path.resolve('src/lib/assistant/location/region.ts'));
const { designerMessageProjection } = require(path.resolve('src/lib/portfolio/designer-recommendation.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textOf = (content: any) => (content?.blocks || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
const sourceHash = (file: string) => createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
const sshBin = process.env.XIAOK_SSH_BIN || 'D:/Git/usr/bin/ssh.exe';
const user = '645';
const commitmentMarker = /(?:已(?:经)?(?:成功)?(?:完成)?(?:正式)?(?:预约|付款|退款|批准|签约|派单|联系|提交|落实|解决|关闭|验收)|保证.{0,12}(?:完工|承重|安全)|确定.{0,12}(?:承重墙|可拆除))/;

const turns = [
  { name: 'turn1-web', kind: 'web', question: '我想确认下，现在国家标准对室内装修的甲醛释放限量是怎么规定的？帮我上网查一下公开的要求。' },
  { name: 'turn2-nearby', kind: 'sites', question: '我挺想看看附近有没有可以围观的工地，有的话我想打开看看。' },
  { name: 'turn3-style', kind: 'designer', question: '我比较喜欢原木风，你们有没有合适的公开设计师作品？' },
];

const report: any = { status: 'preparing', label, model, appId: devRuntime.agentV2.appId,
  protocol: devRuntime.agentV2.protocol, transport: 'real-fastgpt-agent-v2',
  database: databaseName(process.env.DATABASE_URL),
  databaseScope: 'isolated-evaluation (required by acceptance lock)',
  scope: 'Three fixed natural questions in one customer chat over the known gaps: real web search with checkable sources, '
    + 'nearby authorized public sites, and designer works by stated style. No resampling, no matrix expansion.',
  source: { commit: (() => { try { return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    runtimeFile,
    files: Object.fromEntries(['src/lib/assistant/fastgpt/agent-v2/worker.ts', 'src/lib/assistant/fastgpt/agent-v2/runtime.ts',
      'src/lib/assistant/agent/public-research.ts', 'src/lib/assistant/agent/web-evidence.ts',
      'src/lib/portfolio/designer-recommendation.ts', 'src/lib/construction/public-read.ts',
      'scripts/fastgpt/agent-v2-web-recommend-probe.mts'].map(file => [file, sourceHash(file)])) },
  turns: [], checks: [], failures: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));

const sshArgs = ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const remote = async (code: string) => {
  const script = '$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + Buffer.from(code).toString('base64') + '")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  return new Promise<string>((resolve, reject) => execFile(sshBin, [...sshArgs, 'Administrator@192.168.10.54', 'powershell -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (e, stdout, stderr) => e ? reject(Error('remote probe failed: ' + String(stderr).slice(0, 200))) : resolve(stdout)));
};

const readTrace = (runId: string) => tenant(async (tx: any) => ({
  run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,trigger_message_id::text,policy_snapshot,
    (select provider_started_at::text from app.assistant_jobs j where j.enterprise_id=app.assistant_runs.enterprise_id and j.run_id=app.assistant_runs.id) provider_started_at
    from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
  steps: await rows(tx, sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint,source_refs
    from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),
  usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity
    from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`),
}));

async function assertPublicReader() {
  let response: Response;
  try {
    response = await fetch(publicReaderUrl + '/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch (error) {
    throw Error(`Public reader health check failed at ${publicReaderUrl}: ${(error as Error).message}`);
  }
  assert.equal(response.status, 200, `Public reader /health must return 200 at ${publicReaderUrl}`);
  const health: any = await response.json().catch(() => null);
  assert.ok(health && typeof health.parser === 'string' && health.parser.length > 0,
    'Public reader /health must report its parser');
  report.checks.push({ publicReader: { url: publicReaderUrl, status: response.status, parser: health.parser } });
}

async function processQueued(runId: string) {
  // The standing Worker may claim the run first; either path is a real dispatch.
  const status = async () => (await tenant((tx: any) => one(tx, sql`select status from app.assistant_runs where enterprise_id=1454 and id=${runId}`)))?.status;
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    const now = await status();
    if (['succeeded', 'failed', 'cancelled'].includes(String(now))) return;
    if (now === 'queued') { const lease = await claimJob(); if (lease?.runId === runId) { await processAssistantRun(lease); return; } }
    await sleep(1000);
  }
  throw Error('Run ' + runId + ' did not reach a terminal status');
}

let release: any, settingsBefore: any, platformBefore: any, reverse: any;
try {
  await assertPublicReader();
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
    probeVersion: 'agent-v2-web-recommend-20261110', enterpriseKnowledgeEnabled: true,
    knowledgeExplanation: 'natural-knowledge-answer-v1' })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id=${user}`));
  assert.ok(customer, 'Eval user 645 must exist');
  const actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: user }, contextVersion: Number(customer.context_version), capabilities: ['assistant.chat.self'] };

  await fastGPTWorkflows().ready();
  reverse = spawn(sshBin, [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310',
    'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await sleep(1500);
  const probe = await remote(`fetch('http://host.docker.internal:18310/agent-v2-tool/search_enterprise',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${'x'.repeat(devRuntime.agentV2.bridgeKey.length)}'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`);
  assert.equal(probe.trim(), '404', 'FastGPT host must reach the bridge and reject an unknown key');
  report.checks.push({ bridgeReachableFromFastGPTHost: true, wrongKeyRejected: 404 });
  report.status = 'running'; save();

  const service = new ConversationService(actor);
  let conversationId: string;
  if (reuseConversationId) {
    const existing: any = await tenant((tx: any) => one(tx, sql`
      select id::text,status,purpose,entry_snapshot,version,context_revision
      from app.assistant_conversations where enterprise_id=1454 and id=${reuseConversationId}`));
    assert.ok(existing, `Conversation ${reuseConversationId} must exist in enterprise 1454`);
    assert.equal(existing.status, 'open', 'The reused conversation must be open');
    assert.equal(existing.purpose, 'customer_consultation', 'The reused conversation must be a customer consultation');
    assert.equal(existing.entry_snapshot?.kind, 'lead', 'The reused conversation must be bound to the customer lead');
    assert.equal(String(existing.entry_snapshot?.id), '3132', 'The reused conversation must belong to lead 3132');
    const active = await tenant((tx: any) => rows(tx, sql`
      select id::text,status from app.assistant_runs where enterprise_id=1454
        and conversation_id=${reuseConversationId} and status in ('queued','running')`));
    assert.equal(active.length, 0, 'The reused conversation must have no active run before the probe');
    const location = nearbyRegion(existing.entry_snapshot);
    assert.ok(location, 'The reused conversation must have a fresh authorized location (<30 minutes); refresh it before rerunning');
    report.reusedConversation = { id: String(existing.id), version: existing.version,
      contextRevision: existing.context_revision, entry: existing.entry_snapshot, location };
    conversationId = String(existing.id);
  } else {
    conversationId = String((await service.create(randomUUID())).id);
  }
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
    record.steps = trace.steps.map((step: any) => ({ seq: step.step_seq, kind: step.kind, status: step.status,
      capability: step.capability_name || null, tool: step.input_summary?.tool || null,
      count: step.input_summary?.count ?? null, sources: Array.isArray(step.source_refs) ? step.source_refs.length : 0 }));
    const synthesis = trace.steps.find((step: any) => step.kind === 'agent_synthesis_context');
    record.rawDraft = synthesis?.private_checkpoint?.raw ?? null;
    record.catalogIds = (synthesis?.private_checkpoint?.citations || []).map((citation: any) => citation.nativeId);
    record.composition = synthesis?.private_checkpoint?.composition ?? null;
    record.webSteps = record.steps.filter((step: any) => step.capability && step.capability.startsWith('web.')).length;
    record.webSources = trace.steps.filter((step: any) => step.capability_name?.startsWith('web.')).reduce((sum: number, step: any) => sum + (Array.isArray(step.source_refs) ? step.source_refs.length : 0), 0);
    record.usage = trace.usage;
    const message = trace.run.output_message_id
      ? (await service.messages(conversationId)).items.find((m: any) => m.id === trace.run.output_message_id) : null;
    record.messageId = message?.id || null; record.available = message?.available ?? null;
    record.answer = message ? textOf(message.content) : null;
    record.citations = (message?.citations || []).map((citation: any) => ({ id: citation.id, title: citation.title, quote: String(citation.quote || '').slice(0, 80) }));
    save();

    assert.equal(record.agentRuntime, 'fastgpt-agent-v2-v1', 'Every turn uses the Agent V2 runtime');
    assert.ok(record.providerStartedAt, 'Every turn records a real provider dispatch');
    assert.equal(record.status, 'succeeded', record.error || `${turn.name} must succeed`);
    assert.ok(record.available && String(record.answer).trim(), 'A succeeded turn must deliver readable text');
    assert.equal(String(record.answer).includes('(CITE)'), false, 'Delivered text never exposes CITE markers');
    assert.equal(commitmentMarker.test(String(record.answer)), false, 'A delivered answer must not promise an action');

    if (turn.kind === 'web') {
      assert.ok(record.webSteps >= 1, 'The web turn must actually search or read the public web');
      assert.ok(record.webSources >= 1, 'A web turn must retain at least one read page as evidence');
      assert.ok(record.citations.length >= 1, 'A web-based answer must save a checkable citation');
    }
    if (turn.kind === 'sites') {
      assert.ok(record.steps.some((step: any) => step.kind === 'agent_public_sites'), 'The nearby turn must resolve authorized public sites');
    }
    if (turn.kind === 'designer') {
      const designerStep = record.steps.find((step: any) => step.kind === 'agent_designer_result' && step.seq === 2000);
      assert.ok(designerStep, 'The style turn must persist agent_designer_result at step_seq 2000; a follow-up question is not a pass');
      const projection = await tenant((tx: any) => designerMessageProjection(tx, {
        enterpriseId: '1454', principal: { kind: 'user', userId: '645' }, contextVersion: 1, capabilities: [],
      }, conversationId, record.messageId));
      record.designerProjection = projection ? { count: projection.items.length,
        items: projection.items.map((item: any) => ({ workId: item.work?.id, versionId: item.work?.versionId, authorId: item.authorId,
          authorName: item.authorName, title: item.work?.title })) } : null;
      save();
      assert.ok(projection?.items.length, 'The style turn must project at least one live designer card from the saved step');
    }
    record.state = 'passed'; save();
  }

  const reentry = (await service.messages(conversationId)).items;
  for (const turn of report.turns) {
    assert.ok(reentry.some((m: any) => m.id === turn.messageId && m.available),
      `${turn.name} must stay readable on reentry`);
  }
  report.checks.push({ reentry: reentry.length, totals: report.turns.map((turn: any) => ({ name: turn.name,
    web: turn.webSteps, citations: turn.citations.length, steps: turn.steps.map((step: any) => step.kind) })) });
  report.status = 'passed'; save();
  console.log(JSON.stringify({ passed: true, turns: report.turns.map((turn: any) => ({ name: turn.name, run: turn.runId,
    status: turn.status, error: turn.error, webSteps: turn.webSteps, answers: turn.citations.map((c: any) => c.title),
    steps: turn.steps, answer: String(turn.answer).slice(0, 160) })), checks: report.checks }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failures.push({ message: (error as Error).message, stack: String((error as Error).stack).slice(0, 2000) });
  save(); console.error('FAILED: ' + (error as Error).message); process.exitCode = 1;
} finally {
  try { reverse?.kill(); } catch { /* already gone */ }
  try { if (settingsBefore) await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)); } catch (e) { report.cleanup.settings = String((e as Error).message); }
  try { if (platformBefore) await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)); } catch (e) { report.cleanup.platform = String((e as Error).message); }
  try { await closeFastGPTWorkflows(); } catch { /* idempotent */ }
  try { release?.(); } catch { /* released with connection */ }
  save();
}
