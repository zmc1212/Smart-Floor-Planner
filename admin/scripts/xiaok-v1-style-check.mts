/* eslint-disable @typescript-eslint/no-explicit-any -- Bounded isolated acceptance reads dynamic service and SQL snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(process.cwd() + '/package.json');
require('@next/env').loadEnvConfig(process.cwd(), true);
const providerSourceDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8')).DATABASE_URL;
const { sql } = require('drizzle-orm');
const root = path.resolve('..'), imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const { withTenantTransaction, withPlatformTransaction } = await imp('src/db/transaction.ts');
const { one, rows } = await imp('src/db/repositories/assistant-repository.ts');
const { closePostgresPool } = await imp('src/lib/postgresql.ts');
const { PortfolioService } = await imp('src/lib/portfolio/service.ts');
const { PortfolioCatalog } = await imp('src/lib/portfolio/catalog.ts');
const { portfolioCandidates } = await imp('src/lib/portfolio/public-query.ts');
const { ConversationService, appendMessage } = await imp('src/lib/assistant/core/conversation.ts');
const { recommendDesigners } = await imp('src/lib/portfolio/designer-recommendation.ts');
const { processAgentAnswer } = await imp('src/lib/assistant/agent/worker.ts');
const { processAssistantRun } = await imp('src/lib/assistant/application/worker.ts');
const { claimJob } = await imp('src/lib/assistant/infrastructure/job-queue.ts');
const { lockAssistantAcceptance } = await imp('scripts/assistant-acceptance-safety.mjs');
assert.ok(process.argv.includes('--live'), 'Configured-model trial requires --live; no implicit calls or retries');
const native = process.argv.includes('--native');
const resume = process.argv.find(a => a.startsWith('--resume='))?.slice(9);
const original = resume ? JSON.parse(fs.readFileSync(path.resolve(resume, 'report.json'), 'utf8')) : null;
const out = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) || '../tmp/v1-style-recommendations-20261106/service01');
fs.mkdirSync(out, { recursive: true });
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Never overwrite an original attempt');
const eid = '1454', prefix = 'synthetic-v1-style-' + randomUUID();
const read = (fn: any) => withTenantTransaction(eid, fn), platform = (fn: any) => withPlatformTransaction(fn);
const fixed = [
  ['我家在杭州，喜欢原木风，想看看这种风格的设计师和作品。'],
  ['想找个设计师，我比较喜欢奶油风。', '房子在成都，是两居。', '再帮我看看成都的奶油风设计师。'],
];
const report: any = { passed: false, model: 'qwen3.8-flash', enterpriseId: eid, fixturePrefix: prefix,
  fixedTrials: fixed, protocol: 'Existing dedicated designers final; no generic synthesis or public-web repair',
  scope: 'Two fixed natural journeys; the last turn follows withdrawal of all matching sources. Stop on first blocker. No resampling.',
  maxModelCalls: 16, repairIterations: 0, trials: [], checks: [], fixtures: [], providerHttpErrors: [] };
if (original) { assert.deepEqual(original.fixedTrials, fixed); assert.deepEqual(original.drift, []); report.reusedSuccessfulPrefix = path.relative(root, path.resolve(resume!)); report.repairIterations = 1; }
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const ts = require('typescript'), cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options, files = new Set<string>();
function visit(f: string) {
  if (files.has(f) || f.includes('node_modules') || !fs.existsSync(f)) return;
  files.add(f);
  for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
    const resolved = ts.resolveModuleName(i.fileName, f, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved) visit(path.resolve(resolved));
  }
}
for (const f of ['src/lib/assistant/core/conversation.ts', 'src/lib/assistant/application/worker.ts',
  'src/lib/assistant/application/http.ts', 'src/lib/portfolio/service.ts', 'src/lib/portfolio/catalog.ts']) visit(path.resolve(f));
for (const f of [fileURLToPath(import.meta.url), '.env.local', 'package.json', 'package-lock.json', 'tsconfig.json',
  '../tmp/xiaok-vector/connection.private.json', '../tmp/xiaok-vector/renovation-photos/window.jpg',
  'src/lib/portfolio/__tests__/designer-recommendation.test.ts', 'src/lib/assistant/__tests__/agent-designer.test.ts']) files.add(path.resolve(f));
if (native) {
  files.add(path.resolve('scripts/xiaok-v1-style-native.cjs'));
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'miniprogram_npm'].includes(e.name)) continue;
    const file = path.join(dir, e.name); if (e.isDirectory()) walk(file); else files.add(file);
  } };
  walk(path.join(root, 'miniprogram'));
}
const binding = () => Object.fromEntries([...files].sort().map(f => [path.relative(root, f).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const counts = () => platform(async (tx: any) => ({
  provider: Number((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts`)).n),
  queue: Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n),
}));
const runtime = () => read(async (tx: any) => ({
  assistant: await one(tx, sql`select agent_config,policy_version from app.assistant_enterprise_settings where enterprise_id=1454`),
  platformHash: (await one(tx, sql`select md5(llm_config::text) hash from app.platform_configs where key='default'`)).hash,
}));
const users: string[] = [], staff: string[] = [], chats: any[] = [], works: any[] = [];
let release: any, assistantBefore: any, platformBefore: any, opted: any, manager: any;
const originalFetch = globalThis.fetch;
async function withdraw(work: any) {
  const d = await manager.execute('detail', { workId: work.workId });
  if (d.work.published_version_id && !d.work.withdrawn) await manager.execute('withdraw', {
    workId: work.workId, expectedVersion: Number(d.work.version), note: '合成测试结束/公开源撤回验证',
  }, randomUUID());
}
async function runTurn(chat: any, text: string, expected: 'context' | 'positive' | 'empty', style: string, city: string) {
  const key = randomUUID(), content = { version: 1, blocks: [{ type: 'text', text }] };
  const queued = await chat.service.send(chat.cid, key, content);
  assert.equal((await chat.service.send(chat.cid, key, content)).runId, queued.runId);
  const entry: any = { question: text, runId: queued.runId, expected }; chat.journey.turns.push(entry); save();
  const lease = await claimJob(); assert.equal(lease?.runId, queued.runId);
  const prior = original?.trials.flatMap((t: any) => t.turns).find((r: any) => r.question === text && r.expected === expected && r.status === 'succeeded'
    && (expected === 'context' || expected === 'positive' && r.cards?.length === 2));
  if (prior) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(resume!, 'run-' + prior.runId + '.json'), 'utf8'));
    const outputs = saved.steps.filter((s: any) => s.kind === 'agent_model').map((s: any) => s.private_checkpoint); let index = 0;
    entry.replayedSuccessfulPrefix = { runId: prior.runId, engineeringModelFixture: true, newProviderCalls: 0 };
    await processAgentAnswer(lease, { model: async () => {
      const value = outputs[index++]; assert.ok(value, 'Replay cannot invent another model turn');
      const remap = (s: string) => s.replaceAll(prior.runId + ':', String(queued.runId) + ':');
      return { text: remap(value.text || ''), toolCalls: (value.toolCalls || []).map((c: any) => ({ ...c, arguments: remap(c.arguments) })),
        finishReason: value.finishReason, usage: { inputTokens: 0, outputTokens: 0 } };
    } });
  } else await processAssistantRun(lease);
  const trace = await read(async (tx: any) => ({
    run: await one(tx, sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${queued.runId}`),
    steps: await rows(tx, sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint,provider_attempt_id::text from app.assistant_run_steps where enterprise_id=1454 and run_id=${queued.runId} order by step_seq`),
    usage: await rows(tx, sql`select category,input_tokens,output_tokens,measurement_kind from app.assistant_usage_records where enterprise_id=1454 and run_id=${queued.runId}`),
    attempts: await rows(tx, sql`select id::text,status,accepted,error_code,actual_cost,metadata from app.ai_provider_attempts where enterprise_id=1454 and assistant_run_id=${queued.runId} order by id`),
  }));
  fs.writeFileSync(path.join(out, 'run-' + queued.runId + '.json'), JSON.stringify(trace, null, 2));
  Object.assign(entry, { status: trace.run.status, error: trace.run.error_code, attempts: trace.attempts.map((a: any) => ({ id: a.id, status: a.status, accepted: a.accepted, error: a.error_code })) }); save();
  assert.equal(trace.run.status, 'succeeded', trace.run.error_code);
  assert.ok(!trace.steps.some((s: any) => s.capability_name === 'knowledge.search.v1'));
  assert.ok(!trace.usage.some((u: any) => u.category === 'query_embedding'));
  const messages = await chat.service.messages(chat.cid), again = await new ConversationService(chat.actor).messages(chat.cid);
  assert.deepEqual(messages.items, again.items);
  const message = messages.items.find((m: any) => m.id === trace.run.output_message_id); assert.ok(message);
  entry.answer = message.content; entry.cards = message.designerRecommendation?.items || []; entry.reentrySame = true; save();
  const search = trace.steps.filter((s: any) => s.capability_name === 'designers.search.v1'); assert.ok(search.length, 'Actual designer service must be read');
  const snapshot = search.at(-1).private_checkpoint;
  if (expected === 'context') {
    assert.equal(snapshot.needContext, true); assert.equal(entry.cards.length, 0);
    const contextChecks: any[] = []; report.checks.push({ clarificationSourceBoundary: contextChecks });
    await read(async (tx: any) => {
      for (const mode of ['adjacent', 'noDesignerLookup', 'interveningUser']) {
        await tx.execute(sql`savepoint designer_context_check`);
        try {
          if (mode === 'noDesignerLookup') await tx.execute(sql`delete from app.assistant_run_steps where enterprise_id=1454
            and run_id=${queued.runId} and capability_name='designers.search.v1'`);
          if (mode === 'interveningUser') await appendMessage(tx, chat.actor, chat.cid, { author: 'user',
            content: { version: 1, blocks: [{ type: 'text', text: '这是隔离的权限检查原话，不是一次模型旅程。' }] } });
          const current = await appendMessage(tx, chat.actor, chat.cid, { author: 'user', content: { version: 1, blocks: [{ type: 'text', text: fixed[1][1] }] } });
          const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=1454 and id=${chat.cid}`);
          const value = await recommendDesigners(tx, chat.actor, conversation, { query: '成都 两居 奶油风', triggerText: fixed[1][1] }, { triggerMessageId: String(current.id) });
          assert.equal(value.items.length, mode === 'adjacent' ? 2 : 0); assert.equal(value.needContext === true, mode !== 'adjacent');
          assert.equal(value.requestMessageIds.length, mode === 'adjacent' ? 2 : 1);
          assert.deepEqual((await one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=1454 and id=${chat.cid}`)).entry_snapshot, conversation.entry_snapshot);
          contextChecks.push({ mode, count: value.items.length, originalMessageIds: value.requestMessageIds, noNeedWrite: true, rolledBackEngineeringCheck: true, passed: true }); save();
        } finally { await tx.execute(sql`rollback to savepoint designer_context_check`); await tx.execute(sql`release savepoint designer_context_check`); }
      }
    });
  }
  else {
    assert.equal(snapshot.needContext, false); assert.equal(snapshot.style, style); assert.equal(snapshot.cityCode, city);
    if (expected === 'empty') { assert.equal(snapshot.count, 0); assert.equal(entry.cards.length, 0); }
    else {
      assert.equal(entry.cards.length, 2); assert.equal(new Set(entry.cards.map((c: any) => c.authorId)).size, 2);
      for (const card of entry.cards) {
        assert.ok(card.work.primaryStyle === style || card.work.secondaryStyles.includes(style)); assert.ok(card.reason.includes(style));
        const catalog = new PortfolioCatalog(chat.actor, chat.cid), work = await catalog.work(card.work.id, card.work.versionId);
        const author = await catalog.designer(card.authorId); assert.ok(author.works.some((w: any) => w.id === work.id));
        const image = await catalog.image(work.id, work.versionId, work.coverAssetId); assert.ok(image.length > 1000);
        card.originalImageHash = createHash('sha256').update(image).digest('hex');
      }
      chat.positiveMessageId = message.id; chat.cards = entry.cards;
    }
  }
  assert.equal(messages.conversation?.mode || 'ai', 'ai');
  const current = await counts(); assert.ok(current.provider - report.before.provider <= report.maxModelCalls, 'Bounded trial exceeded model-call scope');
  save(); return entry;
}
try {
  const u = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(u.hostname) && u.port === '55432' && u.pathname === '/xiaok_embedding_eval');
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  report.before = await counts(); assert.equal(report.before.queue, 0);
  assistantBefore = await read((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`)); assert.equal(assistantBefore.enabled, false);
  await read((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({ ...assistantBefore.agent_config, model: 'qwen3.8-flash', enterpriseKnowledgeEnabled: false })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  const uSource = new URL(providerSourceDatabase!);
  assert.ok(['localhost', '127.0.0.1'].includes(uSource.hostname) && uSource.port === '5432' && uSource.pathname === '/smart_floor_planner');
  const client = new (require('pg').Client)({ connectionString: providerSourceDatabase }); let source: any;
  try { await client.connect(); await client.query('begin read only'); source = (await client.query("select llm_config from app.platform_configs where key='default'")).rows[0]?.llm_config; await client.query('rollback'); } finally { await client.end(); }
  assert.equal(source?.providerKey, 'dashscope'); opted = { ...source, model: 'qwen3.8-flash' };
  platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default' for update`));
  await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(opted)}::jsonb where key='default'`));
  globalThis.fetch = async (...args: Parameters<typeof originalFetch>) => { const response = await originalFetch(...args); if (response.status === 429) { report.providerHttpErrors.push({ status: 429, body: await response.clone().text() }); save(); } return response; };
  report.bindingBefore = binding(); report.runtimeBefore = await runtime(); save();
  const managerId = String((await platform((tx: any) => one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(1454,${prefix + ':manager'},'unusable-local-fixture','enterprise_admin','active',false,'合成测试·作品审核') returning id`))).id);
  staff.push(managerId); manager = new PortfolioService({ enterpriseId: eid, adminId: managerId });
  const specs = [
    { style: '原木风', city: '330100', cityName: '杭州市' },
    { style: '现代简约', secondary: ['原木风'], city: '330100', cityName: '杭州市' },
    { style: '现代简约', city: '330100', cityName: '杭州市' },
    { style: '奶油风', city: '510100', cityName: '成都市' },
    { style: '奶油风', city: '510100', cityName: '成都市' },
    { style: '原木风', city: '330100', cityName: '杭州市', private: true },
  ];
  const image = fs.readFileSync('../tmp/xiaok-vector/renovation-photos/window.jpg').toString('base64');
  for (const [i, spec] of specs.entries()) {
    const aid = String((await platform((tx: any) => one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(1454,${prefix + ':designer:' + i},'unusable-local-fixture','designer','active',false,${'合成测试·设计师' + (i + 1)}) returning id`))).id);
    staff.push(aid); const service = new PortfolioService({ enterpriseId: eid, adminId: aid });
    const workId = String((await service.execute('create', {}, randomUUID())).id);
    const fixture = { workId, authorId: aid, ...spec }; works.push(fixture); report.fixtures.push(fixture); save();
    const upload = await service.execute('upload', { workId, expectedVersion: 1, imageBase64: image }, randomUUID());
    const content = { title: '合成测试·' + spec.cityName + spec.style + '作品' + (i + 1), description: '隔离开发合成夹具，图片为CC0测试素材，非真实客户案例。',
      primaryStyle: spec.style, secondaryStyles: spec.secondary || [], cityCode: spec.city, cityName: spec.cityName,
      district: spec.city === '330100' ? '西湖区' : '武侯区', communityId: null, area: 90, rooms: '2室2厅', layoutTypes: ['两居'], authorRole: '主创设计',
      source: 'CC0 window.jpg，合成测试用途', authorization: '仅限隔离开发公开读取测试', rightsUntil: null, highlights: [], materials: [], palette: [], tours: [],
      images: [{ assetId: String(upload.assetId), kind: 'photo', aiGenerated: false, showroom: false, caption: 'CC0测试图片，非真实客户案例', space: '客厅' }],
      coverAssetId: String(upload.assetId), showOnProfile: true, recommendable: true };
    await service.execute('save', { workId, expectedVersion: 1, content }, randomUUID());
    if (!spec.private) {
      let d = await service.execute('detail', { workId }); await service.execute('submit', { workId, expectedVersion: Number(d.work.version) }, randomUUID());
      d = await service.execute('detail', { workId }); await manager.execute('publish', { workId, expectedVersion: Number(d.work.version) }, randomUUID());
    }
    await service.execute('saveProfile', { authorId: aid, expectedVersion: 0, content: { bio: '合成测试公开设计师', cities: [{ code: spec.city, name: spec.cityName, districts: [] }],
      styles: [spec.style, ...(spec.secondary || [])], layoutSpecialties: ['两居'], featuredWorkIds: spec.private ? [] : [workId] } }, randomUUID());
  }
  for (let i = 0; i < 2; i++) {
    const uid = String((await platform((tx: any) => one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + ':customer:' + i},1) returning id`))).id); users.push(uid);
    await platform((tx: any) => tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + ':' + i})`));
    const actor = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
    const service = new ConversationService(actor), cid = String((await service.create(randomUUID())).id), journey = { trial: i + 1, conversationId: cid, turns: [] };
    chats.push({ uid, actor, service, cid, journey }); report.trials.push(journey);
  }
  const catalog = new PortfolioCatalog(chats[0].actor, chats[0].cid);
  const initial = await catalog.recommend({ cityCode: '330100', style: '原木风' }); assert.equal(initial.items.length, 2);
  assert.ok(initial.items.some((c: any) => c.work.secondaryStyles.includes('原木风')));
  assert.equal((await catalog.recommend({ cityCode: '330100', style: '法式' })).items.length, 0);
  await assert.rejects(catalog.work(works.find(w => w.private).workId), /portfolio_not_found/);
  await assert.rejects(new PortfolioCatalog(chats[1].actor, chats[0].cid).recommend({ cityCode: '330100', style: '原木风' }));
  const crossTenant = await withTenantTransaction('999999999', (tx: any) => portfolioCandidates(tx, eid, { workId: works[0].workId, recommend: true })); assert.equal(crossTenant.length, 0);
  report.checks.push({ actualPublicPrimaryAndSecondaryMatch: true, noMatch: true, draftExcluded: true, otherCustomerDenied: true, crossTenantDenied: true }); save();
  await runTurn(chats[0], fixed[0][0], 'positive', '原木风', '330100');
  await runTurn(chats[1], fixed[1][0], 'context', '', '');
  await runTurn(chats[1], fixed[1][1], 'positive', '奶油风', '510100');
  const withdrawChengdu = async (workId?: string) => {
    for (const work of works.filter(w => w.city === '510100' && (!workId || w.workId === workId))) await withdraw(work);
  };
  const noMatchTurn = () => runTurn(chats[1], fixed[1][2], 'empty', '奶油风', '510100');
  if (native) {
    const { SignJWT } = require('jose'), { assistantHttp } = await imp('src/lib/assistant/application/http.ts');
    const chat = chats[1], token = await new SignJWT({ id: chat.uid, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: 1, source: 'password' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(chat.uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    report.native = await require(path.resolve('scripts/xiaok-v1-style-native.cjs'))({ root, output: out, actor: { uid: chat.uid, token, cid: chat.cid, cards: chat.cards }, assistantHttp,
      withdraw: withdrawChengdu, noMatchTurn }); save(); assert.equal(report.native.passed, true);
  } else { await withdrawChengdu(); await noMatchTurn(); }
  const b = chats[1], afterWithdrawal = await b.service.messages(b.cid);
  assert.equal(afterWithdrawal.items.find((m: any) => m.id === b.positiveMessageId)?.designerRecommendation ?? null, null);
  for (const card of b.cards) {
    const c = new PortfolioCatalog(b.actor, b.cid);
    await assert.rejects(c.work(card.work.id, card.work.versionId), /portfolio_not_found/);
    await assert.rejects(c.image(card.work.id, card.work.versionId, card.work.coverAssetId), /portfolio_not_found/);
  }
  // A new publication may be browsed, but it cannot silently replace the saved version.
  const a = chats[0], revised = works[0], author = new PortfolioService({ enterpriseId: eid, adminId: revised.authorId });
  let d = await author.execute('detail', { workId: revised.workId });
  await author.execute('newDraft', { workId: revised.workId, expectedVersion: Number(d.work.version) }, randomUUID());
  d = await author.execute('detail', { workId: revised.workId }); await author.execute('submit', { workId: revised.workId, expectedVersion: Number(d.work.version) }, randomUUID());
  d = await author.execute('detail', { workId: revised.workId }); await manager.execute('publish', { workId: revised.workId, expectedVersion: Number(d.work.version) }, randomUUID());
  let projection = (await a.service.messages(a.cid)).items.find((m: any) => m.id === a.positiveMessageId)?.designerRecommendation;
  assert.ok(!projection?.items.some((c: any) => c.work.id === revised.workId));
  await assert.rejects(catalog.work(revised.workId, a.cards.find((c: any) => c.work.id === revised.workId).work.versionId), /portfolio_not_found/);
  await platform((tx: any) => tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=1454 and id=${works[1].authorId}`));
  projection = (await a.service.messages(a.cid)).items.find((m: any) => m.id === a.positiveMessageId)?.designerRecommendation;
  assert.equal(projection ?? null, null);
  report.checks.push({ withdrawnOriginalsDenied: true, persistedCardsRevalidated: true, replacementVersionNotSubstituted: true, disabledAuthorExcluded: true });
  report.runtimeAfter = await runtime(); assert.deepEqual(report.runtimeAfter, report.runtimeBefore); report.passed = true;
} catch (e) { report.error = (e as Error).stack || String(e); process.exitCode = 1; }
finally {
  try {
    for (const work of works) await withdraw(work);
    for (const chat of chats) { const c = await read((tx: any) => one(tx, sql`select status,version from app.assistant_conversations where enterprise_id=1454 and id=${chat.cid}`));
      if (c?.status === 'open') await chat.service.archive(chat.cid, Number(c.version), randomUUID()); }
    for (const uid of users) await platform((tx: any) => tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`));
    for (const aid of staff) await platform((tx: any) => tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=1454 and id=${aid}`));
    if (platformBefore) assert.ok(await platform((tx: any) => one(tx, sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default' and llm_config=${JSON.stringify(opted)}::jsonb returning key`)), 'Do not overwrite platform drift');
    if (assistantBefore) await read((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantBefore.enabled},agent_config=${JSON.stringify(assistantBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
    report.cleanup = { worksWithdrawn: works.filter(w => !w.private).length, archivedChats: chats.length, revokedUsers: users.length, disabledSyntheticStaff: staff.length, configurationRestored: true };
    report.after = await counts(); assert.equal(report.after.queue, 0);
  } catch (e) { report.cleanupError = String(e); report.passed = false; process.exitCode = 1; }
  globalThis.fetch = originalFetch; if (release) await release();
  if (report.bindingBefore) { report.bindingAfter = binding(); report.drift = Object.keys(report.bindingBefore).filter(f => report.bindingBefore[f] !== report.bindingAfter[f]); if (report.drift.length) { report.passed = false; process.exitCode = 1; } }
  save(); await closePostgresPool();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, trials: report.trials.map((t: any) => ({ trial: t.trial, turns: t.turns.map((r: any) => ({ runId: r.runId, status: r.status, error: r.error })) })),
    error: report.error, cleanup: report.cleanup, cleanupError: report.cleanupError, drift: report.drift }));
}
