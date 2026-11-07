/* eslint-disable @typescript-eslint/no-explicit-any -- Retained isolated real-client acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { workflowSnapshot } from './platform.mjs';
const require = createRequire(import.meta.url); require('@next/env').loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), base = path.join(root, 'tmp/xiaok-fastgpt-unified-20261107', ...(process.argv.includes('--plus') ? ['plus'] : []));
const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'native01'; assert.match(label, /^[a-z0-9-]+$/);
const savedLabel = process.argv.find(x => x.startsWith('--verify-saved='))?.slice(15);
assert.ok(!process.argv.some(x => x.startsWith('--continue=')), 'Unified trial originals must not be replayed');
const verifySaved = !!savedLabel;
const continueLabel = savedLabel || process.argv.find(x => x.startsWith('--continue='))?.slice(11);
if (continueLabel) assert.match(continueLabel, /^[a-z0-9-]+$/);
const prior = continueLabel ? readPrior(continueLabel) : null;
function readPrior(name: string) { return JSON.parse(fs.readFileSync(path.join(base, name, 'assessment.json'), 'utf8')); }
const out = path.join(base, label); assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch'); fs.mkdirSync(out, { recursive: true });
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const setup = readJson(path.join(base, 'preparation.json')); assert.equal(setup.status, 'ready');
const configFile = path.join(base, 'runtime.private.json'), config = readJson(configFile);
const originalDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = readJson(path.join(root, 'tmp/xiaok-vector/connection.private.json')).DATABASE_URL;
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = configFile; process.env.ASSISTANT_TEXT_MODEL = config.rag.model; process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
delete process.env.XIAOK_FASTGPT_RETRIEVAL_FILE;
const { sql } = require('drizzle-orm'), { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { ConversationService, cancelRuns } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { assistantHttp } = require(path.resolve('src/lib/assistant/application/http.ts'));
const { fastGPTWorkflows, closeFastGPTWorkflows } = require(path.resolve('src/lib/assistant/fastgpt/runtime.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');
const tenant = (f: any) => withTenantTransaction('1454', f), platform = (f: any) => withPlatformTransaction(f);
const fixture = readJson(path.join(root, 'tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'));
const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: fixture.adminIds[0] });
const actor = (uid: string) => ({ enterpriseId: '1454', principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
const questions = ['客厅采光一般，地砖我想选浅灰亮面的，日常打理上有什么要注意的？',
  '还是更怕显脏，我改成浅灰哑光吧。纹理想顺着窗户走，你们铺之前怎么排版，谁来核对？',
  '立邦墙面卫士净味全能无添加底漆我也在看，帮我查一下官网，墙面掉粉时能直接刷它吗？',
  '这款底漆你们施工一定会用吗？还有我刚才地砖最后改成哪种了？'];
const report: any = { status: 'preparing', label, fixedTrials: 2, fixedQuestions: questions, model: config.rag.model, embeddingModel: 'text-embedding-v4',
  userDirection: '直接发布 验证后不撤回', runs: [], native: [], checks: [], cleanup: {}, unknownCurrency: true };
const save = () => fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(report, null, 2));
const hash = (bytes: any) => createHash('sha256').update(bytes).digest('hex');
const binding = () => {
  const ts = require('typescript'), c = ts.readConfigFile('tsconfig.json', ts.sys.readFile), options = ts.parseJsonConfigFileContent(c.config, ts.sys, process.cwd()).options;
  const files = new Set<string>();
  const visit = (f: string) => { if (files.has(f) || f.includes('node_modules') || !fs.existsSync(f)) return; files.add(f);
    for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
      const found = ts.resolveModuleName(i.fileName, f, options, ts.sys).resolvedModule?.resolvedFileName; if (found) visit(path.resolve(found));
    } };
  ['scripts/fastgpt/unified-acceptance.mts', 'scripts/fastgpt/acceptance-native.cjs', 'scripts/fastgpt/platform.mjs', 'scripts/wechatide-native-client.ts',
    'src/lib/assistant/application/http.ts', 'src/lib/assistant/application/worker.ts', 'src/lib/assistant/fastgpt/rag-worker.ts',
    'src/lib/assistant/fastgpt/runtime.ts', '../miniprogram/packages/assistant/chat/chat.js', '../miniprogram/app.js'].forEach(p => visit(path.resolve(p)));
  ['package.json', 'package-lock.json', '.env.local', '../miniprogram/project.config.json', '../miniprogram/packages/assistant/chat/chat.wxml',
    '../miniprogram/packages/assistant/chat/chat.less', 'scripts/fixtures/xiaok-ppt-craft-preview.json', 'scripts/fastgpt/unified-workflow.mjs',
    'scripts/assistant-acceptance-safety.mjs'].forEach(p => { if (fs.existsSync(p)) files.add(path.resolve(p)); });
  files.add(configFile); files.add(path.join(base, 'workflow.json'));
  return Object.fromEntries([...files].sort().map(p => [path.relative(root, p).replaceAll('\\', '/'), hash(fs.readFileSync(p))]));
};
const sshArgs = ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const remote = async (code: string) => {
  const script = '$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + Buffer.from(code).toString('base64') + '")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  return new Promise<string>((resolve, reject) => execFile('ssh', [...sshArgs, 'Administrator@192.168.10.54', 'powershell -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 20000, encoding: 'utf8' }, (e, stdout) => e ? reject(Error('Read-only pilot probe failed')) : resolve(stdout)));
};
const workflow = () => workflowSnapshot({ ...config, appId: config.rag.appId, nodeCount: 6 });
const ledger = async (after = 0) => {
  assert.ok(Number.isSafeInteger(after) && after >= 0);
  const query = `begin read only; select json_build_object('lastId',(select coalesce(max(id),0) from logs),'logs',(select coalesce(json_agg(r),'[]') from (select id,model,endpoint,channel_id,code,retry_times,input_tokens,output_tokens,cached_tokens,total_tokens,request_id,created_at,input_amount,output_amount,used_amount from logs where id>${after} order by id) r)); rollback;`;
  const ps = `$ProgressPreference='SilentlyContinue'; if ($env:COMPUTERNAME -ne 'User-2026PKPRRP') { throw 'Unexpected host' }; Set-Location -LiteralPath 'D:/Smart-Floor-Planner-Dev/fastgpt-pilot'; $sql=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(query).toString('base64')}')); & docker --config D:/Smart-Floor-Planner-Dev/docker-cli compose --env-file .env.fastgpt -f compose.yml exec -T proxy-db psql -X -A -t -v ON_ERROR_STOP=1 -U fastgpt -d aiproxy -c $sql; exit $LASTEXITCODE`;
  const raw = await new Promise<string>((resolve, reject) => execFile('ssh', [...sshArgs, 'Administrator@192.168.10.54', 'powershell -NoProfile -EncodedCommand ' + Buffer.from(ps, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 25000, encoding: 'utf8' }, (e, stdout) => e ? reject(Error('Read-only proxy ledger unavailable')) : resolve(stdout)));
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
};
// Token/cost observations are retained by the original PostgreSQL provider
// attempts; a separate read-only AIProxy snapshot accounts native embeddings.
let release: any, settingsBefore: any, platformBefore: any, forward: any, reverse: any, research: any, search: any, sourceRestricted = false;
const users: string[] = [], cids: string[] = [];
let pending: Promise<void> = Promise.resolve(), stopped = false;
const readTrace = (runId: string) => tenant(async (tx: any) => ({
  run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${runId}`),
  steps: await rows(tx, sql`select kind,status,input_summary,private_checkpoint,source_refs,provider_attempt_id::text from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),
  usage: await rows(tx, sql`select category,measurement_kind,input_tokens,output_tokens,quantity,provider_attempt_id::text from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`),
}));
const sourceAudience = async (audience: string) => { const p = setup.published.find((p: any) => p.page === 19);
  const detail = await knowledge.execute('detail', { documentId: p.documentId });
  if (detail.document.audience !== audience) await knowledge.execute('metadata', { documentId: p.documentId, expectedVersion: Number(detail.document.version), audience }, randomUUID());
  sourceRestricted = audience !== 'customer_public';
};
async function consume(question: string, runId: string, cid: string) {
  assert.equal(stopped, false); const item: any = { question, runId, conversationId: cid }; report.runs.push(item); save();
  assert.equal(report.runs.length <= 8, true); assert.equal(question, questions[(report.runs.length - 1) % 4]);
  await release.assertHeld(); assert.deepEqual(binding(), report.bindingBefore);
  let lease: any; for (let i = 0; i < 30 && !lease; i++) { lease = await claimJob(); if (!lease) await new Promise(r => setTimeout(r, 150)); }
  assert.equal(lease?.runId, runId); await processAssistantRun(lease);
  const trace = await readTrace(runId); fs.writeFileSync(path.join(out, 'run-' + runId + '.json'), JSON.stringify(trace, null, 2));
  item.status = trace.run.status; item.error = trace.run.error_code; save(); assert.equal(item.status, 'succeeded', item.error || 'run must succeed');
  const model = trace.steps.filter((s: any) => s.kind === 'fastgpt_unified_model'); assert.ok(model.length >= 1 && model.length <= 4); assert.ok(model[0].provider_attempt_id); assert.ok(model[0].private_checkpoint.output.usage);
  const service = new ConversationService(actor(users[0])), answer = (await service.messages(cid)).items.find((m: any) => m.id === trace.run.output_message_id);
  assert.ok(answer?.available); item.messageId = answer.id; item.answer = answer.content.blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  item.citations = answer.citations; item.raw = model.at(-1).private_checkpoint.output.text; assert.equal(item.answer, item.raw.replace(/\[[^\]]+\]\(CITE\)/g, ''));
  const questionIndex = (report.runs.length - 1) % 4;
  if (questionIndex === 0) { assert.equal(answer.citations.length, 0); assert.equal(model.length, 1); }
  if (questionIndex === 1) assert.ok(answer.citations.some((c: any) => c.title.includes('第19页')));
  if (questionIndex === 2) {
    assert.ok(trace.steps.some((s: any) => s.kind === 'retrieval' && s.private_checkpoint?.candidates?.length));
    assert.ok(answer.citations.some((c: any) => String(c.sourceUrl).includes('nipponpaint.com.cn')));
  }
  for (const c of answer.citations) {
    const opened = await service.citation(c.id, false, cid); assert.ok(opened.available);
    assert.ok(opened.quote.length > 4); if (!c.id.startsWith('w:')) assert.equal(opened.isDraft, false);
    await assert.rejects(() => new ConversationService(actor(users[1])).citation(c.id, false, cid));
    await assert.rejects(() => new ConversationService({ ...actor(users[0]), enterpriseId: '2385' }).citation(c.id, false, cid));
  }
  const trigger = await tenant((tx: any) => one(tx, sql`select m.client_message_id,m.content from app.assistant_runs r join app.assistant_messages m
    on m.enterprise_id=r.enterprise_id and m.id=r.trigger_message_id where r.enterprise_id=1454 and r.id=${runId}`));
  const repeated = await service.send(cid, trigger.client_message_id, trigger.content);
  assert.equal(String(repeated.runId), runId, 'Same client message must not create another run');
  assert.equal(trace.usage.filter((u: any) => u.category === 'tokens' && u.measurement_kind === 'observed').length, model.length);
  item.modelCalls = model.length;
  item.checked = { savedOriginal: true, selectedCitations: true, sourceOpen: true, sameUserReentry: true, otherUserDenied: true, crossTenantDenied: true, perTurnUsage: true, sendIdempotent: true };
  assert.deepEqual(binding(), report.bindingBefore); save(); console.log(JSON.stringify({ reviewRequired: runId, question, answer: item.answer, citations: answer.citations.map((c: any) => c.title) }));
  const file = path.join(out, 'review-' + runId + '.json'), until = Date.now() + 240000;
  while (!fs.existsSync(file) && Date.now() < until) await new Promise(r => setTimeout(r, 300));
  assert.ok(fs.existsSync(file), 'First-draft semantic review is pending'); const review = readJson(file); item.review = review; save();
  assert.equal(review.accepted, true, review.reason);
  if(report.runs.length===5&&sourceRestricted){await sourceAudience('customer_public');report.checks.push({generalUnderSourceWithdrawal:true,noRetrieval:true});save();} // Stop before dispatching the next fixed turn on failure.
}
const preloadBinding = binding();
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  const net = require('node:net'); await new Promise<void>((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(18300, '127.0.0.1', () => s.close(() => resolve())); });
  forward = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '127.0.0.1:18300:127.0.0.1:18300', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await fastGPTWorkflows().ready();
  reverse = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:18310:127.0.0.1:18310', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  process.env.ASSISTANT_WEB_SEARCH_PROVIDER='openserp';process.env.ASSISTANT_WEB_SEARCH_URL='http://127.0.0.1:18098';process.env.ASSISTANT_OPENSERP_ENGINES='baidu';process.env.ASSISTANT_PUBLIC_READER_URL='http://127.0.0.1:18095';
  research=await (await import('../../../tmp/fastgpt-native-qa-20261106/resources.mjs')).openResearchResources(out);
  search=spawn('powershell.exe',['-NoProfile','-File',path.resolve('scripts/assistant-search/openserp.ps1'),'-Executable',path.join(root,'tmp/fastgpt-native-qa-20261107/blocker-repair01/openserp/openserp.exe')],{windowsHide:true,stdio:['ignore',fs.openSync(path.join(out,'search.stdout.log'),'w'),fs.openSync(path.join(out,'search.stderr.log'),'w')]});
  await new Promise(r=>setTimeout(r,1500));assert.equal(search.exitCode,null);

  await remote(`fetch('http://host.docker.internal:18310/unified-input',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(2))`);
  settingsBefore = await tenant((tx: any) => one(tx, sql`select enabled,agent_config from app.assistant_enterprise_settings where enterprise_id=1454`));
  platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
  const primary = new (require('pg').Client)({ connectionString: originalDatabase }); let provider: any;
  try { await primary.connect(); await primary.query('begin read only'); provider = (await primary.query("select llm_config from app.platform_configs where key='default'")).rows[0].llm_config; await primary.query('rollback'); } finally { await primary.end(); }
  if (provider.providerKey !== 'dashscope') { assert.ok(provider.profiles?.dashscope?.apiKeyEncrypted); provider = { ...provider, ...provider.profiles.dashscope, providerKey: 'dashscope' }; }
  await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({ ...provider, model: report.model })}::jsonb where key='default'`));
  await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({ runtime: 'langgraph-v1', providerKey: 'dashscope', model: report.model,
    imageInput: false, tools: true, probeVersion: 'fastgpt-rag-session-20261107', enterpriseKnowledgeEnabled: true })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  if (prior) {
    // Resume only one observed, reviewed saved answer. A CLI interruption is
    // recoverable without paying for that answer again; retain its exact error.
    assert.equal(prior.status, 'failed'); assert.ok(prior.error); assert.equal(prior.runs.length, verifySaved ? 8 : 1);
    assert.ok(prior.native.some((n: any) => n.passed === false));
    assert.ok(prior.cleanup.settingsRestored && prior.cleanup.providerRestored && prior.cleanup.lockReleased && prior.cleanup.bridgeClosed);
    const current = binding(), permitted = new Set(['admin/scripts/fastgpt/unified-acceptance.mts', 'admin/scripts/fastgpt/acceptance-native.cjs']);
    const changed = [...new Set([...Object.keys(prior.bindingBefore), ...Object.keys(current)])].filter(k => prior.bindingBefore[k] !== current[k]);
    const impactFile = process.argv.find(x => x.startsWith('--impact='))?.slice(9);
    const impacts = impactFile ? readJson(path.resolve(impactFile)).changes : [];
    assert.ok(changed.every(k => permitted.has(k) || impacts.some((i: any) => i.file === k && i.before === prior.bindingBefore[k] && i.after === current[k] && i.impact === 'unrelated-dispatch-only')),
      'Every non-driver source change needs an explicit recorded impact check');
    users.push(...prior.users); cids.push(...new Set<string>(prior.runs.map((r: any) => r.conversationId)));
    for (const original of prior.runs) {
      assert.equal(original.status, 'succeeded');
      const review = original.review || readJson(path.join(base, continueLabel!, 'review-' + original.runId + '.json')); assert.equal(review.accepted, true);
      const saved = (await new ConversationService(actor(users[0])).messages(original.conversationId)).items.find((m: any) => m.id === original.messageId);
      assert.ok(saved?.available); assert.equal(saved.content.blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''), original.answer);
      for (const c of saved.citations) {
        const opened = await new ConversationService(actor(users[0])).citation(c.id, false, original.conversationId); assert.ok(opened.available);
        assert.equal(opened.quote, original.citations.find((v: any) => v.id === c.id).quote);
        await assert.rejects(() => new ConversationService(actor(users[1])).citation(c.id, false, original.conversationId));
        await assert.rejects(() => new ConversationService({ ...actor(users[0]), enterpriseId: '2385' }).citation(c.id, false, original.conversationId));
      }
      report.runs.push({ ...original, reusedFrom: continueLabel, review });
    }
    report.continuation = { prior: continueLabel, originalFailure: prior.error, changed, impacts, originalProviderCalls: prior.runs.length, remainingProviderCalls: verifySaved ? 0 : 3 };
  } else await platform(async (tx: any) => { for (let i = 0; i < 2; i++) {
    const prefix = 'synthetic-fastgpt-unified-' + label + '-' + randomUUID(); const u = await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`);
    users.push(String(u.id)); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix})`);
  } }); report.users = users;
  assert.deepEqual(binding(), preloadBinding, 'Source changed while waiting for shared resources; restart before dispatch');
  report.bindingBefore = binding(); report.workflowBefore = await workflow(); report.ledgerBaselineId = (await ledger()).lastId; report.status = 'running'; save();
  if (prior) assert.equal(report.workflowBefore, prior.workflowBefore, 'Resumed originals require the same published workflow/catalog');
  const { SignJWT } = require('jose'), token = await new SignJWT({ id: users[0], mode: 'customer', role: 'user', enterpriseId: '1454', contextVersion: 1, source: 'password' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(users[0]).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h').sign(new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123'));
  for (let trial = 0; trial < 2; trial++) {
    const resume = !!prior && (verifySaved || trial === 0);
    const cid = resume ? cids[trial] : String((await new ConversationService(actor(users[0])).create(randomUUID())).id); if (!resume) cids.push(cid); report.conversations = cids; save();
    if(trial===1&&!prior)await sourceAudience('staff_internal');
    const trialOut = path.join(out, 'trial' + (trial + 1)); fs.mkdirSync(trialOut, { recursive: true });
    const retained = verifySaved ? prior.runs.filter((r: any) => r.conversationId === cid) : [];
    const result = await require(path.resolve('scripts/fastgpt/acceptance-native.cjs'))({ root, output: trialOut, actor: { uid: users[0], token, cid }, questions: verifySaved ? [] : resume ? questions.slice(1) : questions, stage: [], assistantHttp,
      ...(verifySaved ? { savedMessages: retained.map((r: any) => ({ id: r.messageId, text: r.answer })),
        initialCitations: retained.flatMap((r: any) => r.citations.map((c: any) => ({id:c.id,...(c.id.startsWith('w:')?{domain:'nipponpaint.com.cn'}:{page:c.title.match(/第(\d+)页/)?.[1]})}))) }
        : resume ? { initialCitation: { id: prior.runs[0].citations[0].id, page: 19 } } : {}),
      expectedCitationPages: [null,19,null,null], expectedWebDomains: [null,null,'nipponpaint.com.cn',null], onQueued: (q: string, run: string, conversation: string) => { pending = consume(q, run, conversation).catch(error => { stopped = true; throw error; }); return pending; },
      onTurnReviewed: () => pending,
      ...(trial === 1 ? { onSourceRevoked: async () => {
        await sourceAudience('staff_internal'); const service = new ConversationService(actor(users[0])), saved = report.runs.filter((r: any) => r.conversationId === cid);
        for (const run of saved) for (const c of run.citations) assert.equal((await service.citation(c.id, false, cid)).available, c.title.includes('第19页') ? false : true);
        const affected = saved.filter((r: any) => r.question !== questions[0]);
        for (const run of affected) assert.equal((await service.messages(cid)).items.find((m: any) => m.id === run.messageId).available, false);
        assert.equal((await service.messages(cid)).items.find((m: any) => m.id === saved[0].messageId).available, true);
        report.checks.push({withdrawal: true, originalServiceMetadata: true, noModelCalls: true, unrelatedGeneralReadable:true});save();return {messageIds:affected.map((r:any)=>r.messageId)};
      }, onSourceRestored: async () => { await sourceAudience('customer_public'); } } : {}),
    });
    report.native.push(result); save(); await pending; assert.equal(result.passed, true, result.error);
  }
  report.bindingAfter = binding(); assert.deepEqual(report.bindingAfter, report.bindingBefore);
  report.workflowAfter = await workflow(); assert.equal(report.workflowAfter, report.workflowBefore);
  await platform((tx: any) => tx.execute(sql`update app.users set context_version=context_version+1 where id=${users[0]}`));
  await assert.rejects(() => new ConversationService(actor(users[0])).messages(cids[0]));
  const refreshed = new ConversationService({ ...actor(users[0]), contextVersion: 2 });
  assert.equal((await refreshed.messages(cids[0])).items.some((m: any) => m.id === report.runs[0].messageId && m.available), true);
  report.checks.push({ oldSessionPermissionRevoked: true, refreshedIdentityReentry: true });
  report.proxyLedger = await ledger(report.ledgerBaselineId);
  assert.equal(report.proxyLedger.logs.filter((r: any) => r.model === 'qwen3.7-flash').length, 0, 'No secondary native titles');
  assert.equal(report.proxyLedger.logs.filter((r: any) => r.model === config.rag.transportModel).length, verifySaved ? 0 : report.runs.reduce((n:number,r:any)=>n+r.modelCalls,0));
  if (verifySaved) assert.equal(report.proxyLedger.logs.filter((r: any) => r.model === 'text-embedding-v4').length, 0);
  report.status = 'passed'; save(); console.log(JSON.stringify({ passed: true, runs: report.runs.map((r: any) => r.runId), nativeChecks: report.native.map((n: any) => n.checks.length) }));
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save(); console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  await cleanup('undispatchedOwnedRunsCancelled', () => tenant(async (tx: any) => {
    for (const item of report.runs) {
      const pending = await one(tx, sql`select r.status,j.provider_started_at from app.assistant_runs r join app.assistant_jobs j
        on j.enterprise_id=r.enterprise_id and j.run_id=r.id where r.enterprise_id=1454 and r.id=${item.runId} and r.conversation_id=${item.conversationId}`);
      if (pending?.status === 'queued' && !pending.provider_started_at) await cancelRuns(tx, actor(users[0]), item.conversationId, item.runId);
    }
  }));
  if (sourceRestricted) await cleanup('sourceRestored', () => sourceAudience('customer_public'));
  if (settingsBefore) await cleanup('settingsRestored', () => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${settingsBefore.enabled},agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if (platformBefore) await cleanup('providerRestored', () => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  if (report.ledgerBaselineId !== undefined && !report.proxyLedger) await cleanup('ledgerRetained', async () => { report.proxyLedger = await ledger(report.ledgerBaselineId); });
  if(search?.pid)await cleanup('searchClosed',async()=>{await new Promise<void>((resolve,reject)=>execFile('taskkill.exe',['/PID',String(search.pid),'/T','/F'],{windowsHide:true},e=>e?reject(e):resolve()));});
  if(research)await cleanup('researchClosed',research.close);
  await cleanup('bridgeClosed', closeFastGPTWorkflows); reverse?.kill(); forward?.kill(); report.cleanup.ownedTunnelsReleased = true;
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
