import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { BAILIAN_RAG, LOCAL_PGVECTOR, BailianKnowledgeProvider, bailianKnowledgeConfig } from '@/lib/assistant/knowledge/bailian-provider';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { processManagedKnowledgeCleanup } from '@/lib/assistant/knowledge/managed-cleanup';
import { KnowledgeOperations } from '@/lib/assistant/knowledge/operations';
import { KnowledgeSearchUnavailable, readKnowledgeTarget, retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { KnowledgeService, type KnowledgeActor } from '@/lib/assistant/knowledge/service';
import { resolveEvidence } from '@/lib/assistant/knowledge/sources';
import type { ActorContext, TextModelGateway } from '@/lib/assistant/contracts';
import { mockBailianRag } from './xiaok-r4-bailian-mock';
import { LiveBailianAcceptance } from './xiaok-i7515-bailian-live';
import { prepareLiveLedger, readLiveApproval, readLiveCommand } from './xiaok-i7515-bailian-live-policy';

const command = readLiveCommand(process.argv.slice(2));
if (command.kind === 'prepare') {
  prepareLiveLedger(readLiveApproval(process.env));
  console.log('Prepared the I7.5.15 batch ledger offline');
  process.exit(0);
}
const target = new URL(process.env.XIAOK_I7515_DATABASE_URL ?? 'http://missing');
const owner = new URL(process.env.XIAOK_I7515_OWNER_URL ?? 'http://missing');
for (const url of [target, owner]) assert.ok(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1'
  && !url.search && !url.hash && Number(url.port) >= 49152 && /^\/xiaok_i7515_[a-z0-9_]+$/.test(url.pathname),
  'Use an isolated I7.5.15 loopback database without connection overrides');
assert.equal(owner.port + owner.pathname, target.port + target.pathname);
assert.equal(target.username, 'sfp_app');
assert.equal(owner.username, 'sfp_migrator');
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.ASSISTANT_EMBEDDING_URL ?? ''), 'Use the isolated loopback embedding service');
assert.ok(process.env.ASSISTANT_EMBEDDING_API_KEY);
process.env.DATABASE_URL = target.href;
process.env.ASSISTANT_KNOWLEDGE_PROVIDER = BAILIAN_RAG;
process.env.ASSISTANT_EMBEDDING_PROVIDER = 'local';
process.env.ASSISTANT_REQUESTS_PER_MINUTE = '120';
delete process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID;
delete process.env.ASSISTANT_BAILIAN_RAG_API_KEY;
delete process.env.ASSISTANT_BAILIAN_RAG_CATEGORY_ID;
delete process.env.ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL;

const label = command.label ?? randomUUID();
const out = path.resolve('../tmp/xiaok-i7515', label);
mkdirSync(path.dirname(out), { recursive: true });
mkdirSync(out);
const fixture = JSON.parse(readFileSync('scripts/fixtures/xiaok-ppt-craft-preview.json', 'utf8')) as {
  source: { file: string; sha256: string }; drafts: Array<{ slide: number; title: string; body: string }>
};
const [water, waterproof] = fixture.drafts;
const qWater = '家里现在做水电施工，这一步水路主要做什么？';
const qWaterproof = '卫生间接下来做防水，施工和后续检查由谁安排？';
const cloud = mockBailianRag();
const liveCore = command.kind === 'live' && command.core;
let live: LiveBailianAcceptance | null = null;
const checks: Array<{ name: string; status: string; evidence?: unknown }> = [];
const prefix = 'i7515-' + randomUUID().slice(0, 8);
type Draft = { documentId: string; versionId: string; expectedVersion: number; expectedEditVersion: number };
type Customer = { actor: ActorContext; project: string; conversation: string; chat: ConversationService };

function binding() {
  const names = execFileSync('git', ['ls-files','-c','-o','--exclude-standard','-z','--',
    'src/db','src/lib/assistant','src/lib/construction','src/lib/ai','src/lib/platform-llm-config.ts','src/lib/postgresql.ts',
    'src/lib/xiaok-v1','src/lib/native-workflow','drizzle','package-lock.json','package.json',
    'scripts/xiaok-i7515-bailian-rag-acceptance.ts','scripts/xiaok-i7515-bailian-live.ts','scripts/xiaok-i7515-bailian-live-policy.ts',
    'scripts/__tests__/xiaok-i7515-bailian-live.test.ts',
    'scripts/xiaok-r4-bailian-mock.ts','scripts/fixtures/xiaok-ppt-craft-preview.json',
    'scripts/xiaok-embedding/server.py']).toString().split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const name of names) hash.update(name).update('\0').update(readFileSync(name)).update('\0');
  const config = { provider: process.env.ASSISTANT_KNOWLEDGE_PROVIDER, liveWorkspace: live?.workspace, liveCore,
    liveApproval: live?.budget().authorizationDigest, changePermissions: command.kind === 'live' && command.changePermissions,
    embeddingProvider: process.env.ASSISTANT_EMBEDDING_PROVIDER,
    embeddingUrl: process.env.ASSISTANT_EMBEDDING_URL, database: target.pathname, pgPort: target.port };
  return { files: names.length, sha256: hash.update(JSON.stringify(config)).digest('hex'), config };
}

async function check<T>(name: string, work: () => Promise<T>) {
  try {
    const evidence = await work();
    checks.push({ name, status: 'passed', evidence });
    console.log('PASS', name);
    return evidence;
  } catch (error) {
    checks.push({ name, status: 'failed', evidence: error instanceof Error ? error.stack : String(error) });
    throw error;
  }
}

async function manager(label: string, platform = false): Promise<KnowledgeActor> {
  return withPlatformTransaction(async tx => {
    const name = prefix + '-' + label;
    const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${name},${name},'active') returning id`))!;
    const enterpriseId = String(enterprise.id);
    assert.notEqual(enterpriseId, '1454');
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,1000000,100000000,30,'{"enterpriseKnowledgeEnabled":true}'::jsonb)`);
    const staff = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${platform ? null : enterpriseId},${name},'synthetic-unusable',${platform ? 'admin' : 'enterprise_admin'},'active',
        array['assistant-knowledge','construction-projects'],false) returning id`);
    return { enterpriseId, adminId: String(staff!.id) };
  });
}

async function customer(a: KnowledgeActor, label: string, stage: string): Promise<Customer> {
  const { uid, lead } = await withPlatformTransaction(async tx => {
    const name = prefix + '-' + label;
    const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${name},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${name})`);
    const lead = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${a.enterpriseId},${uid},${name},'13982001115','natural') returning id`);
    return { uid, lead: String(lead!.id) };
  });
  const service = new ConstructionService(a);
  const settings = await service.execute('stages');
  const stages = settings.stages as Row[];
  if (!stages.some(s => s.key === 'waterproof')) await service.execute('saveStages',
    { expectedVersion: settings.version, stages: [...stages, { key:'waterproof', name:'防水', visitReminder:false }] }, randomUUID());
  const created = await service.execute('create',{ leadId: lead, name: prefix + '-' + label, managerId: a.adminId, rooms: ['卫生间'] },randomUUID());
  const project = String(created.id);
  const detail = await service.execute('detail', { projectId: project });
  const updated = await service.execute('update', { projectId: project, expectedVersion: (detail.project as Row).version,
    name: prefix + '-' + label, customerAccess: true, status: 'active' }, randomUUID());
  await service.execute('progress', { projectId: project, expectedVersion: updated.version, stageKey: stage, note: '合成工地阶段', sendReminder: false }, randomUUID());
  const actor: ActorContext = { enterpriseId: a.enterpriseId, principal:{ kind: 'user', userId: uid },
    contextVersion: 1, capabilities:['assistant.chat.self'], entry:{ kind:'lead', id:lead } };
  const chat = new ConversationService(actor);
  return { actor, chat, project, conversation: String((await chat.create(randomUUID())).id) };
}

const indexCount = () => live?.count('addFile') ?? cloud.calls.filter(c => c.path.endsWith('/addFile')).length;
async function drain(store: KnowledgeService, jobId: string) {
  const eid = store.actor.enterpriseId;
  for (let poll = 0; poll < (live ? 30 : 8); poll++) {
    const lease = await claimKnowledgeJob({ enterpriseId: eid, jobId });
    assert.ok(lease);
    await runKnowledgeJob(lease);
    const job = await store.execute('job',{jobId});
    if (job.status === 'succeeded') return job;
    assert.equal(job.status, 'queued', JSON.stringify(job));
    if (live) {
      await delay(4200);
      continue;
    }
    await withTenantTransaction(eid,tx => tx.execute(sql`update app.assistant_jobs set available_at=now()
      where enterprise_id=${eid} and id=${jobId} and status='queued'`));
  }
  throw Error('index never became ready');
}
async function index(store: KnowledgeService, draft: Draft) {
  const queued = await store.execute('index',draft,randomUUID());
  const job = await drain(store,String(queued.jobId));
  const count = indexCount();
  assert.deepEqual(await store.execute('index',draft,randomUUID()), { jobId: queued.jobId, status:'succeeded' });
  assert.equal(indexCount(),count);
  const managed = job.managed as Row;
  for (const name of ['workspace_id','index_id','file_id','index_document_id','indexed_request_id']) assert.ok(managed[name],name);
  assert.ok((job.attempts as Row[]).some(a => a.operation === 'embed' && a.status === 'succeeded' && Number(a.input_tokens)>0));
  return job;
}
async function publishFile(store: KnowledgeService, passage: typeof water, stage: string, projectId?: string) {
  const key = randomUUID();
  const input = { title: passage.title, audience:'customer_public', projectId,
    fileName:'PPT-excerpt-' + passage.slide + '.txt', fileBase64:Buffer.from(passage.body).toString('base64'),
    authorization:'approved PPT excerpt for isolated acceptance',
    professional:{version:1,kind:'construction',topics:[],conditions:[{field:'stage',operator:'in',values:[stage]}],
      prerequisites:[],exceptions:[],origin:{title:'家客来小K装修服务功能方案.pptx',version:'已核验摘录',locator:'第' + passage.slide + '页',
        page:passage.slide,authority:'reference'},review:{note:'按仓库已核验的 PPT 摘录导入。'}} };
  const made = await store.execute('createFile',input,key);
  assert.deepEqual(await store.execute('createFile',input,key),JSON.parse(JSON.stringify(made)));
  const draft = { documentId:String((made.document as Row).id), versionId:String((made.draft as Row).id),
    expectedVersion:1,expectedEditVersion:1 };
  await drain(store,String(made.jobId));
  draft.expectedEditVersion = 2;
  const review = await store.execute('reviewFile',{...draft,acknowledgeWarnings:true,excludedBlockIds:[]},randomUUID());
  draft.expectedEditVersion = Number(review.edit_version);
  const job = await index(store,draft);
  const published = await store.execute('publish',draft,randomUUID());
  draft.expectedVersion = Number(published.version);
  return { draft, job, title: passage.title };
}
const epoch = (eid: string) => withTenantTransaction(eid,async tx =>
  Number((await one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${eid}`))?.knowledge_epoch));
async function search(c: Customer, query: string, documentId?: string) {
  return retrieveKnowledge(c.conversation,c.actor,query,await epoch(c.actor.enterpriseId),undefined,undefined,'ranked',
    documentId ? {documentId} : undefined);
}
async function submit(c: Pick<Customer,'chat'|'actor'|'conversation'>, question: string, model: TextModelGateway) {
  const sent = await c.chat.send(c.conversation,randomUUID(),{ version:1, blocks:[{type:'text',text:question}] });
  const job = await claimJob({ enterpriseId: c.actor.enterpriseId, runId:String(sent.runId) });
  assert.ok(job);
  await processAnswer(job,{model});
  return c.chat.run(String(sent.runId));
}
let mockModelCalls = 0;
const select = (source?: string, text?: string): TextModelGateway => ({
  capabilities:{streaming:false,toolCalling:false,usage:false},
  async generate(input) {
    mockModelCalls++;
    const choices = (JSON.parse(input.messages[1].content).evidence as Row[]);
    const match = choices.find(c => c.source === source && (!text || c.text === text));
    assert.ok(match);
    return { text:JSON.stringify({selections:[match.selectionId]}),attemptId:'',finishReason:'stop',
      usage:null,providerRequestId:null };
  },
});

// The account-level import rejection only blocks adding to an existing library.
// Exercise both stages through separate synthetic enterprise mappings.
async function checkLiveCore(bailian: LiveBailianAcceptance) {
  const a = await manager('A'), b = await manager('B');
  const waterCustomer = await customer(a,'water','utilities'), bathCustomer = await customer(b,'bath','waterproof');
  const otherBath = await customer(b,'other-bath','waterproof');
  const as = new KnowledgeService(a), bs = new KnowledgeService(b);
  const wet = await check('02_water_upload_and_index', () => publishFile(as,water,'utilities'));
  const bath = await check('03_waterproof_project_upload_and_index', () => publishFile(bs,waterproof,'waterproof',bathCustomer.project));
  const scenarios = [
    { customer:waterCustomer, query:qWater, draft:wet.draft, page:17, quote:water.body },
    { customer:bathCustomer, query:qWaterproof, draft:bath.draft, page:18, quote:waterproof.body.split('\n\n').at(-1)! },
  ];
  await check('04_distinct_enterprise_mappings_and_denials', async () => {
    const indices = [wet.job.managed as Row, bath.job.managed as Row];
    assert.notEqual(indices[0].index_id,indices[1].index_id);
    assert.ok(indices.every(index => index.workspace_id===bailian.workspace));
    const requests = bailian.count('retrieve');
    await assert.rejects(retrieveKnowledge(bathCustomer.conversation,waterCustomer.actor,qWater,await epoch(a.enterpriseId)),/assistant_resource_not_found/);
    await assert.rejects(retrieveKnowledge(waterCustomer.conversation,bathCustomer.actor,qWaterproof,await epoch(b.enterpriseId)),/assistant_resource_not_found/);
    assert.deepEqual((await search(otherBath,qWaterproof,bath.draft.documentId)).evidence,[]);
    assert.deepEqual((await search(bathCustomer,qWater,wet.draft.documentId)).evidence,[]);
    assert.deepEqual((await search(waterCustomer,qWaterproof,bath.draft.documentId)).evidence,[]);
    assert.equal(bailian.count('retrieve'),requests);
    return { enterprises:[a.enterpriseId,b.enterpriseId], projects:[waterCustomer.project,bathCustomer.project,otherBath.project], indices };
  });
  let answerProvider: typeof BAILIAN_RAG | typeof LOCAL_PGVECTOR = BAILIAN_RAG;
  try {
    await check('05_hosted_retrieval_both_stages', async () => {
      const results = [];
      for (const scenario of scenarios) {
        const result = await search(scenario.customer,scenario.query);
        assert.equal(result.diagnostic.provider,BAILIAN_RAG);
        const requests = result.diagnostic.managedIndex?.requests;
        assert.ok(requests?.length && requests.every(request => request.requestId));
        assert.ok(result.evidence.some(value => value.ref.version===scenario.draft.versionId && value.text.trim()===scenario.quote));
        assert.ok(result.evidence.every(value => value.ref.version===scenario.draft.versionId));
        results.push(result);
      }
      return results;
    });
  } catch {
    process.exitCode = 1;
    answerProvider = LOCAL_PGVECTOR;
  }
  await check('06_real_local_fallback_for_hosted_index', async () => {
    bailian.fault('transport');
    const result = await search(waterCustomer,qWater);
    assert.equal(result.diagnostic.provider,LOCAL_PGVECTOR);
    assert.equal(result.diagnostic.fallback?.reason,'transport_error');
    assert.equal(result.evidence[0]?.ref.version,wet.draft.versionId);
    return result;
  });
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = answerProvider;
  let bathCitation: string | null = null;
  try {
    for (const scenario of scenarios) {
      await check('07_deepseek_citation_page_' + scenario.page, async () => {
        const run = await submit(scenario.customer,scenario.query,bailian.model);
        assert.equal(run.answerKind,'grounded',JSON.stringify(run));
        const message = (await scenario.customer.chat.messages(scenario.customer.conversation)).items.find(m => m.answerKind==='grounded')!;
        const citations = await Promise.all(message.citations.map(item => scenario.customer.chat.citation(item.id)));
        const citation = citations.find(value => value.available && 'quote' in value && value.quote===scenario.quote);
        assert.ok(citation?.available && 'page' in citation);
        assert.equal(citation.page,scenario.page);
        assert.equal(citation.version,scenario.draft.versionId);
        assert.equal(citation.versionNumber,1);
        const projectScoped = scenario.customer === bathCustomer;
        assert.equal(citation.knowledge.scope,projectScoped ? 'project' : 'enterprise');
        assert.equal(citation.knowledge.projectId,projectScoped ? scenario.customer.project : null);
        if (projectScoped) bathCitation = citation.id;
        return { query:scenario.query, retrievalProvider:answerProvider, runId:run.id, citation };
      });
    }
  } finally {
    process.env.ASSISTANT_KNOWLEDGE_PROVIDER = BAILIAN_RAG;
  }
  await check('08_real_withdrawal_and_cleanup', async () => {
    assert.ok(bathCitation);
    const key = randomUUID(), input = { documentId:bath.draft.documentId, expectedVersion:bath.draft.expectedVersion };
    const retired = await bs.execute('retire',input,key);
    assert.deepEqual(await bs.execute('retire',input,key),JSON.parse(JSON.stringify(retired)));
    assert.equal((await bathCustomer.chat.citation(bathCitation)).available,false);
    assert.deepEqual((await search(bathCustomer,qWaterproof,bath.draft.documentId)).evidence,[]);
    assert.equal(await processManagedKnowledgeCleanup(undefined,{enterpriseId:b.enterpriseId}),true);
    const job = await bs.execute('job',{jobId:String(bath.job.id)});
    assert.ok((job.managed as Row).removed_at,JSON.stringify(job.managed));
    assert.equal(await processManagedKnowledgeCleanup(undefined,{enterpriseId:b.enterpriseId}),false);
    return { withdrawnCitation:bathCitation, managed:job.managed };
  });
}

async function main() {
  const safety = await withPlatformTransaction(tx => one(tx, sql`select current_database() as database,current_user as role,
    current_setting('server_version_num')::int as version,
    (select extversion from pg_extension where extname='vector') as pgvector,
    (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass,
    (select shobj_description(oid,'pg_database') from pg_database where datname=current_database()) as marker,
    (select count(*)::int from app.assistant_platform_knowledge_library) as configured,
    (select count(*)::int from app.assistant_managed_knowledge_libraries) as libraries`));
  assert.ok(safety && safety.role === 'sfp_app' && safety.bypass === false && Number(safety.version)>=170000
    && Number(safety.version)<180000 && safety.pgvector==='0.8.2' && /^xiaok-i7515-/.test(String(safety.marker))
    && safety.configured===0 && safety.libraries===0, 'Use an empty marked PostgreSQL 17 application database');
  await check('01_workspace_config', async () => {
    if (live) {
      const row = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int as existing from app.enterprises`));
      assert.equal(row?.existing, 0, 'Live acceptance requires a business-data-free database');
      const { requestId, missingModels } = await live.start();
      if (missingModels.length) await live.enableMissingInference();
      return { safety, workspace: live.workspace, requestId };
    }
    assert.throws(bailianKnowledgeConfig,/bailian_knowledge_not_configured/);
    cloud.install();
    const listing = await new BailianKnowledgeProvider().listIndices();
    assert.deepEqual(listing.value,[]);
    assert.ok(listing.requestId);
    return { safety, workspace: bailianKnowledgeConfig().workspaceId, requestId: listing.requestId };
  });
  if (live && liveCore) return checkLiveCore(live);
  const a = await manager('A'), b = await manager('B'), platform = await manager('platform',true);
  await assert.rejects(withTenantTransaction(a.enterpriseId,tx => tx.execute(sql`insert into app.assistant_platform_knowledge_library
    (enterprise_id) values(${a.enterpriseId})`)), (error: Error) => (error.cause as {code?: string})?.code === '42501');
  const provision = new pg.Client({connectionString: owner.href});
  await provision.connect();
  try {
    await provision.query('insert into app.assistant_platform_knowledge_library(enterprise_id) values($1)',[platform.enterpriseId]);
  } finally { await provision.end(); }
  const waterCustomer = await customer(a,'water','utilities'), bathCustomer = await customer(a,'bath','waterproof');
  const outside = await customer(b,'outside','utilities');
  const as = new KnowledgeService(a), bs = new KnowledgeService(b), ps = new KnowledgeService(platform);

  const wet = await check('02_water_upload_and_index', () => publishFile(as,water,'utilities'));
  const bath = await check('03_waterproof_project_upload_and_index', () => publishFile(as,waterproof,'waterproof',bathCustomer.project));
  const foreign = await publishFile(bs,water,'utilities');
  const shared = await publishFile(ps,water,'utilities');
  await check('04_workspace_mapping_and_admin_operations', async () => {
    const get = (x: typeof wet) => x.job.managed as Row;
    assert.equal(get(wet).index_id,get(bath).index_id);
    assert.equal(new Set([get(wet).index_id,get(foreign).index_id,get(shared).index_id]).size,3);
    assert.equal(new Set([get(wet).workspace_id,get(foreign).workspace_id,get(shared).workspace_id]).size,1);
    const cases = new KnowledgeOperations(a), input = {title:'水路工艺',question:qWater,
      expectation:{kind:'grounded',requiredDocumentIds:[wet.draft.documentId],forbiddenDocumentIds:[]}};
    const saved = await cases.save(input,randomUUID());
    await assert.rejects(new KnowledgeOperations(b).detail(String(saved.id)),/assistant_resource_not_found/);
    return {a:a.enterpriseId,b:b.enterpriseId,publicCorpus:platform.enterpriseId,caseId:String(saved.id),
      managed:[get(wet),get(bath),get(foreign),get(shared)]};
  });
  const primary = await check('05_water_retrieval_and_public_priority', async () => {
    const result = await search(waterCustomer,qWater);
    assert.equal(result.diagnostic.provider,BAILIAN_RAG);
    assert.equal(result.diagnostic.context.stage,'utilities');
    assert.equal(result.evidence[0]?.ref.version,wet.draft.versionId);
    assert.equal(result.evidence[0]?.text.trim(),water.body.trim());
    assert.equal(result.evidence.find(e => e.ref.version===shared.draft.versionId)?.knowledge?.scope,'platform');
    assert.ok(!result.evidence.some(e => e.ref.version===bath.draft.versionId));
    const requests = result.diagnostic.managedIndex?.requests ?? [];
    assert.equal(requests.length,2);
    assert.ok(requests.every(r=>r.requestId));
    return { evidence:result.evidence, diagnostic:result.diagnostic };
  });
  const bathResult = await check('06_waterproof_and_stage_filter', async () => {
    const result = await search(bathCustomer,qWaterproof);
    assert.equal(result.diagnostic.context.stage,'waterproof');
    assert.ok(result.evidence.length && result.evidence.every(e => e.ref.version===bath.draft.versionId));
    const wrongStage = await search(bathCustomer,qWater,wet.draft.documentId);
    assert.deepEqual(wrongStage.evidence,[]);
    return result;
  });
  await check('07_ab_and_project_permission', async () => {
    const looked = await search(outside,qWater);
    if (!live) {
      const privateSlice = cloud.getSlices(String((foreign.job.managed as Row).index_id),String((foreign.job.managed as Row).index_document_id))[0];
      assert.ok(privateSlice);
      cloud.intercept.extraSlices = [{...privateSlice,score:1}];
    }
    try {
      assert.ok((await search(waterCustomer,qWater)).evidence.every(e=>e.ref.version!==foreign.draft.versionId));
    } finally { cloud.intercept.extraSlices = []; }
    assert.equal(looked.evidence[0]?.ref.version,foreign.draft.versionId);
    assert.ok(looked.evidence.every(e => e.ref.version!==wet.draft.versionId));
    await assert.rejects(retrieveKnowledge(outside.conversation,waterCustomer.actor,qWater,await epoch(a.enterpriseId)),/assistant_resource_not_found/);
    await assert.rejects(retrieveKnowledge(waterCustomer.conversation,outside.actor,qWater,await epoch(b.enterpriseId)),/assistant_resource_not_found/);
    assert.deepEqual((await search(waterCustomer,qWaterproof,bath.draft.documentId)).evidence,[]);
    assert.deepEqual((await search(outside,qWater,wet.draft.documentId)).evidence,[]);
    assert.deepEqual((await search(waterCustomer,qWater,foreign.draft.documentId)).evidence,[]);
    return { projects:[waterCustomer.project,bathCustomer.project,outside.project], ab: 'both_denied' };
  });
  const citations = await check('08_grounded_citation_readback', async () => {
    const quote = waterproof.body.split('\n\n').at(-1)!;
    const grounded = await submit(bathCustomer,qWaterproof,live?.model ?? select(undefined,quote));
    assert.equal(grounded.answerKind,'grounded',JSON.stringify(grounded));
    const message = (await bathCustomer.chat.messages(bathCustomer.conversation)).items.find(m => m.answerKind==='grounded')!;
    const citation = await bathCustomer.chat.citation(message.citations[0].id);
    assert.ok(citation.available && 'page' in citation);
    assert.equal(citation.page,18);
    assert.equal(citation.version,bath.draft.versionId);
    assert.equal(citation.versionNumber,1);
    assert.equal(citation.quote,quote);
    assert.equal(citation.professional?.origin?.title,'家客来小K装修服务功能方案.pptx');
    await assert.rejects(waterCustomer.chat.citation(citation.id),/assistant_resource_not_found/);
    const publicRun = await submit(waterCustomer,'家里的用水管路主要做什么？',live?.model ?? select('平台公共知识'));
    assert.equal(publicRun.answerKind,'grounded',JSON.stringify(publicRun));
    const publicMessage = (await waterCustomer.chat.messages(waterCustomer.conversation)).items.find(m => m.answerKind==='grounded')!;
    const publicCitation = await waterCustomer.chat.citation(publicMessage.citations[0].id);
    assert.ok(publicCitation.available && 'page' in publicCitation);
    assert.equal(publicCitation.page,17);
    if (live) {
      const scope = publicCitation.version === wet.draft.versionId ? 'enterprise' : 'platform';
      assert.ok([wet.draft.versionId, shared.draft.versionId].includes(publicCitation.version));
      assert.equal(publicCitation.knowledge.scope,scope);
      assert.equal(publicCitation.quote,water.body);
      if (scope === 'platform') assert.match(publicCitation.sourceLocation ?? '',/^平台公共知识 · /);
    } else {
      assert.equal(publicCitation.knowledge.scope,'platform');
      assert.match(publicCitation.sourceLocation ?? '',/^平台公共知识 · /);
      assert.equal(publicCitation.version,shared.draft.versionId);
    }
    await assert.rejects(outside.chat.citation(publicCitation.id),/assistant_resource_not_found/);
    return { citation, publicCitation };
  });
  await check('09_no_evidence_and_exact_lookup', async () => {
    const actor = new KnowledgeOperations(a).actor, chat = new ConversationService(actor);
    const conversation = String((await chat.create(randomUUID(),{audience:'staff_internal'})).id);
    const before = mockModelCalls;
    const notice = await submit({actor,chat,conversation},'这间厨房的橱柜用的什么型号？',select());
    assert.equal(notice.answerKind,'insufficient_evidence');
    assert.equal(mockModelCalls,before);
    const current = primary.evidence[0], other = bathResult.evidence[0];
    const found = await withTenantTransaction(a.enterpriseId,async tx => readKnowledgeTarget(tx,waterCustomer.actor,waterCustomer.conversation,
      await epoch(a.enterpriseId),{versionId:current.ref.version!,chunkId:current.ref.id}));
    assert.equal(found[0]?.hash,current.hash);
    const denied = await withTenantTransaction(a.enterpriseId,async tx => readKnowledgeTarget(tx,waterCustomer.actor,waterCustomer.conversation,
      await epoch(a.enterpriseId),{versionId:other.ref.version!,chunkId:other.ref.id}));
    assert.deepEqual(denied,[]);
    return { notice:notice.answerKind, current:current.ref };
  });
  await check('10_real_local_fallback_and_recovery', async () => {
    if (live) live.fault('transport');
    else cloud.intercept.unavailableNext='transport';
    const pinned = await search(waterCustomer,qWater);
    assert.equal(pinned.diagnostic.provider,LOCAL_PGVECTOR);
    assert.equal(pinned.diagnostic.fallback?.reason,'transport_error');
    assert.ok(pinned.diagnostic.embeddingUsage?.inputTokens);
    assert.deepEqual(pinned.evidence[0]?.ref,primary.evidence[0].ref);
    if (live) live.fault('gateway');
    else cloud.intercept.unavailableNext='gateway';
    const waterproofLocal = await search(bathCustomer,qWaterproof);
    assert.equal(waterproofLocal.diagnostic.provider,LOCAL_PGVECTOR);
    assert.equal(waterproofLocal.evidence[0]?.ref.version,bath.draft.versionId);
    if (!live) assert.ok(waterproofLocal.diagnostic.managedIndex?.requestId);
    assert.equal((await search(waterCustomer,qWater)).diagnostic.provider,BAILIAN_RAG);
    const cloudCalls = live?.receipts.length ?? cloud.calls.length;
    process.env.ASSISTANT_KNOWLEDGE_PROVIDER=LOCAL_PGVECTOR;
    try {
      const localOnly = await search(waterCustomer,qWater);
      assert.equal(localOnly.diagnostic.provider,LOCAL_PGVECTOR);
      assert.deepEqual(localOnly.evidence[0]?.ref,primary.evidence[0].ref);
      assert.equal(live?.receipts.length ?? cloud.calls.length,cloudCalls);
    } finally { process.env.ASSISTANT_KNOWLEDGE_PROVIDER=BAILIAN_RAG; }
    return { water:{evidence:pinned.evidence,diagnostic:pinned.diagnostic},
      waterproof:{evidence:waterproofLocal.evidence,diagnostic:waterproofLocal.diagnostic} };
  });
  await check('11_dual_outage_wrong_profile_and_auth_denial', async () => {
    if (live) live.fault('denied');
    else cloud.intercept.failNext='retrieve';
    await assert.rejects(search(waterCustomer,qWater), error => error instanceof KnowledgeSearchUnavailable
      && error.httpStatus===403 && !error.fallbackError);
    const original = process.env.ASSISTANT_EMBEDDING_URL!;
    const modelBefore = mockModelCalls;
    try {
      if (live) {
        live.stopEmbedding = true;
        live.fault('transport');
      } else {
        process.env.ASSISTANT_EMBEDDING_URL='http://127.0.0.1:18116';
        cloud.intercept.unavailableNext='transport';
      }
      const fresh = String((await bathCustomer.chat.create(randomUUID())).id);
      const failed = await submit({...bathCustomer,conversation:fresh},qWaterproof,select());
      assert.equal(failed.status,'failed');
      assert.equal(failed.errorCode,'retrieval_unavailable');
      assert.equal(mockModelCalls,modelBefore);
    } finally {
      if (live) live.stopEmbedding = false;
      process.env.ASSISTANT_EMBEDDING_URL=original;
    }
    const eid = a.enterpriseId, vid = wet.draft.versionId;
    const originalChunks = await withTenantTransaction(eid,tx => tx.execute(sql`select id,locator from app.assistant_knowledge_chunks
      where enterprise_id=${eid} and document_version_id=${vid}`));
    try {
      await withTenantTransaction(eid,tx => tx.execute(sql`update app.assistant_knowledge_chunks set locator=locator-'localEmbeddingProfile'
        where enterprise_id=${eid} and document_version_id=${vid}`));
      if (live) live.fault('gateway');
      else cloud.intercept.unavailableNext='gateway';
      await assert.rejects(search(waterCustomer,qWater), error => error instanceof KnowledgeSearchUnavailable
        && error.fallbackError==='local_index_incompatible');
    } finally {
      for (const row of originalChunks.rows) await withTenantTransaction(eid,tx => tx.execute(sql`update app.assistant_knowledge_chunks
        set locator=${JSON.stringify(row.locator)}::jsonb where enterprise_id=${eid} and id=${String(row.id)}`));
    }
    const key = process.env.ASSISTANT_BAILIAN_RAG_API_KEY;
    const cloudCalls = live?.receipts.length ?? cloud.calls.length;
    try {
      delete process.env.ASSISTANT_BAILIAN_RAG_API_KEY;
      const missingKey = await search(waterCustomer,qWater);
      assert.equal(missingKey.diagnostic.provider,LOCAL_PGVECTOR);
      assert.equal(missingKey.diagnostic.fallback?.reason,'bailian_knowledge_not_configured');
      assert.equal(live?.receipts.length ?? cloud.calls.length,cloudCalls);
    } finally { process.env.ASSISTANT_BAILIAN_RAG_API_KEY=key; }
    return { doubleOutage:'retrieval_unavailable', permissionStatus:403, incompatible:'local_index_incompatible', missingKeyRequests:0 };
  });
  await check('12_replace_withdraw_delete_idempotently', async () => {
    const old = bath.draft;
    const version = await as.execute('newVersion',{documentId:old.documentId,fromVersionId:old.versionId,expectedVersion:old.expectedVersion},randomUUID());
    const draft = {...old,versionId:String(version.id),expectedVersion:old.expectedVersion+1,expectedEditVersion:1};
    const excerpt = waterproof.body.split('\n\n').at(-1)!;
    const edit = await as.execute('replaceFile',{...draft,fileName:'PPT-excerpt-18-checked.txt',
      fileBase64:Buffer.from(excerpt).toString('base64'),authorization:'approved PPT excerpt for isolated acceptance'},randomUUID());
    await drain(as,String(edit.jobId));
    const review = await as.execute('reviewFile',{...draft,expectedEditVersion:3,acknowledgeWarnings:true,excludedBlockIds:[]},randomUUID());
    draft.expectedEditVersion=Number(review.edit_version);
    const updatedJob = await index(as,draft);
    const published = await as.execute('publish',draft,randomUUID());
    assert.equal(String(published.published_version_id),draft.versionId);
    assert.equal((await bathCustomer.chat.citation(citations.citation.id)).available,false);
    const current = (await search(bathCustomer,qWaterproof)).evidence;
    assert.ok(current.length && current.every(e => e.ref.version===draft.versionId && e.text.trim()===excerpt));
    assert.equal(await processManagedKnowledgeCleanup(undefined,{enterpriseId:a.enterpriseId}),true);
    const oldJob = await as.execute('job',{jobId:String(bath.job.id)});
    const oldRemote = oldJob.managed as Row;
    assert.ok(oldRemote.removed_at && oldRemote.cleanup_request_id);
    const calls = live?.receipts.length ?? cloud.calls.length;
    assert.equal(await processManagedKnowledgeCleanup(undefined,{enterpriseId:a.enterpriseId}),false);
    assert.equal(live?.receipts.length ?? cloud.calls.length,calls);
    const key = randomUUID(), input = {documentId:shared.draft.documentId,expectedVersion:shared.draft.expectedVersion};
    const retired = await ps.execute('retire',input,key);
    assert.deepEqual(await ps.execute('retire',input,key),JSON.parse(JSON.stringify(retired)));
    if (citations.publicCitation.knowledge.scope === 'platform')
      assert.equal((await waterCustomer.chat.citation(citations.publicCitation.id)).available,false);
    assert.equal(await processManagedKnowledgeCleanup(undefined,{enterpriseId:platform.enterpriseId}),true);
    assert.equal(await processManagedKnowledgeCleanup(undefined,{enterpriseId:platform.enterpriseId}),false);
    const stale = await withTenantTransaction(a.enterpriseId,async tx => {
      const c = (await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${a.enterpriseId} and id=${bathCustomer.conversation}`))!;
      return resolveEvidence(tx,bathCustomer.actor,c,bathResult.evidence[0]);
    });
    assert.equal(stale,undefined);
    return { prior:oldRemote, current:updatedJob.managed, withdrawnPlatform:citations.publicCitation.id };
  });
  if (!live) await check('13_revalidate_project_stage_after_provider_dispatch', async () => {
    const service = new ConstructionService(a), projectId = waterCustomer.project;
    async function setStage(stageKey: string) {
      const current = await service.execute('detail',{projectId});
      return service.execute('progress',{projectId,expectedVersion:(current.project as Row).version,
        stageKey,note:'合成阶段变更',sendReminder:false},randomUUID());
    }
    const n = cloud.calls.length;
    cloud.intercept.beforeRetrieve=async () => {
      cloud.intercept.beforeRetrieve=null;
      await setStage('waterproof');
    };
    try {
      await assert.rejects(search(waterCustomer,qWater),/context_changed/);
      assert.ok(cloud.calls.length>n);
    } finally {
      cloud.intercept.beforeRetrieve=null;
      await setStage('utilities');
    }
    return { staleResult:'context_changed', restoredStage:'utilities' };
  });
}

async function runAcceptance() {
  const before = binding();
  try {
    await main();
    assert.ok(!live?.budgetRefusals.length, 'Live acceptance had authorization or budget refusals; see the receipts');
  } catch (error) {
    if (checks.at(-1)?.status !== 'failed') checks.push({ name:'fixture_setup', status:'failed',
      evidence:error instanceof Error ? error.stack : String(error) });
    throw error;
  } finally {
    const liveRun = live;
    if (liveRun) {
      try { await check('live_resource_cleanup', () => liveRun.cleanup()); }
      catch { process.exitCode=1; }
    }
    await closePostgresPool();
    const after = binding();
    writeFileSync(path.join(out,'result.json'),JSON.stringify({ before,after,source:fixture.source,checks,
      mock: { cloudRequests:cloud.calls.length, textSelections:mockModelCalls },
      real:live ? { workspace: live.workspace, bailianRag:live.count('retrieve') ? 'executed' : 'incomplete',
        deepseek:live.modelResults.length ? 'executed' : 'not_run', receiptsFile:'live-receipts.json',
        requests:live.receipts.length, budgetRefusals:live.budgetRefusals.length,
        batchBudget:live.budget() } : {bailianRag:'not_run',deepseek:'not_run',cloudCalls:0,costCny:0},
    },(_key,value)=>typeof value==='bigint' ? String(value) : value,2));
    assert.equal(after.sha256,before.sha256,'Source or config changed during acceptance');
  }
}
async function run() {
  // Acquire the authorized batch and its lock before the first PostgreSQL or HTTP call.
  if (command.kind === 'live') live = LiveBailianAcceptance.open(path.join(out, 'live-receipts.json'), command.changePermissions);
  try { await runAcceptance(); } finally { live?.close(); }
}
run().catch(error => { console.error(error); process.exitCode=1; });
