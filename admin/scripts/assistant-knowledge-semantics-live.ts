/** Knowledge-only acceptance: unchanged C01 handlers/Agent, real configured providers, synthetic isolated fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { agentConfig, type AgentConfig } from '@/lib/assistant/agent/config';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import type { SynthesisContext, SynthesisAnswer } from '@/lib/assistant/agent/synthesis';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import { ConstructionService } from '@/lib/construction/service';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { GET, POST } from '@/app/api/miniprogram/assistant/[...path]/route';
import { professionalEntry, professionalCases, professionalMaterialPolicy } from './assistant-professional-cases';
import { synthesisCases, synthesisPolicies } from './assistant-synthesis-cases';
import { coverageCases } from './assistant-knowledge-coverage-cases';

const output = process.env.XIAOK_KNOWLEDGE_SEMANTICS_OUTPUT;
if (!output) throw Error('Run through the locked assistant-knowledge-semantics-acceptance.mjs wrapper.');
const directory: string = output;
const knowledgeOnly = process.env.XIAOK_KNOWLEDGE_SEMANTICS_ONLY === '1';
const prefix = 'synthetic-kb-semantics-' + randomUUID(), tenants: string[] = [], admins: string[] = [], users: string[] = [];
const report: Row = { prefix, started: new Date().toISOString(), promptVersion: agentPromptVersion, overall: 'Limited',
  scope: 'Actual C01 Request handlers and user Agent; real configured text model, chunking, Embedding and isolated PostgreSQL/RLS; no listening server/native UI',
  mode: knowledgeOnly ? 'KB-1 existing material/registered-conflict cases without a bound construction project' : 'KB-3 four-source pressure with a bound construction project',
  rounds: 2, semanticReview: 'requires_independent_source_bound_review', fixtures: [], runs: [], guards: [], network: [], errors: [] };
const save = () => fs.writeFileSync(path.join(directory, 'live.json'), JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2));
type DocumentInput = { title: string; body: string; claim?: { key: string; value: string }; professional?: Row };
type Scenario = { key: string; question: string; documents: readonly DocumentInput[]; ppt: readonly number[]; qa: readonly string[]; semanticCriteria: readonly string[] };
const spec: Scenario[] = knowledgeOnly ? [
  { key: 'material-conditions', question: professionalCases.material.question, ppt: professionalCases.material.ppt, qa: professionalCases.material.qa,
    semanticCriteria: [...professionalCases.material.points, ...professionalCases.material.forbidden.map(x => '禁止：' + x)],
    documents: [{ title: '合成地暖型粘结材料适用说明', body: professionalMaterialPolicy, professional: { kind: 'material', conditions: [{ field: 'material', operator: 'in', values: ['地暖型粘结材料'] }] } },
      { title: '合成材料核对前提', body: '铺地砖的材料解释须保留实际地暖、产品型号、基层条件和厂家说明的核对前提。企业通用说明不表示本项目已满足条件或已经形成施工安排，缺项交项目团队核实。',
        professional: { kind: 'material', conditions: [{ field: 'material', operator: 'in', values: ['地暖型粘结材料'] }] } }] },
  { key: 'registered-conflict-knowledge-only', question: synthesisCases.conflict.question, ppt: synthesisCases.conflict.ppt, qa: synthesisCases.conflict.qa,
    semanticCriteria: [...synthesisCases.conflict.points, ...synthesisCases.conflict.forbidden.map(x => '禁止：' + x)],
    documents: [{ title: '合成书房办公口径甲', body: synthesisPolicies.office, claim: { key: '书房屏幕朝向', value: '侧向' },
      professional: { conditions: [{ field: 'room', operator: 'in', values: ['书房'] }] } },
    { title: '合成书房办公口径乙', body: synthesisPolicies.conflict, claim: { key: '书房屏幕朝向', value: '正对窗' },
      professional: { conditions: [{ field: 'room', operator: 'in', values: ['书房'] }] } }] },
] : coverageCases.map((c, i) => ({ ...c, ppt: i ? [6, 23, 38] : [6, 14, 15, 23], qa: i ? ['QA06', 'QA07'] : ['QA02', 'QA04', 'QA06'],
  semanticCriteria: i ? ['先指出登记口径冲突，保留双方及原文依据', '不据上传先后/分数选唯一权威', '客户自述材料不等于服务端已核实条件', '解释可回答的共同部分和最小待核实项，不自动安排施工'] :
    ['说明采光/屏幕眩光、通道与电气点位的相互约束', '户型存在不等于有效电气点位图，不凭户型定位置', '区分企业解释、一般建议与本项目实际阶段/资料缺项', '不把解释写成企业批准、施工指令或已通知/落实的回执'] }));
report.criteria = spec.map(({ key, question, ppt, qa, semanticCriteria }) => ({ key, question, ppt, qa, semanticCriteria }));
type Document = { documentId: string; versionId: string; expectedVersion: number; expectedEditVersion: number };
type Customer = { userId: string; leadId: string; projectId: string; planId: string; conversationId: string; token: string };
type Fixture = { enterpriseId: string; adminId: string; knowledge: KnowledgeService; documents: Document[]; internal: Document; customers: Customer[] };
const fixtures: Fixture[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const kind = url.pathname.endsWith('/chat/completions') ? 'text_model' : url.pathname.endsWith('/embeddings') ? 'embedding' : url.pathname.endsWith('/chunks') ? 'chunk' : null;
  const call: Row = { kind, host: url.hostname, path: url.pathname, started: new Date().toISOString(), status: 'dispatched' };
  if (kind) {
    if (typeof init?.body === 'string') {
      call.requestHash = createHash('sha256').update(init.body).digest('hex');
      const body = JSON.parse(init.body); call.model = body.model ?? null;
    }
    (report.network as Row[]).push(call); save();
  }
  try {
    const response = await originalFetch(input, init);
    if (kind) { call.status = response.status; call.finished = new Date().toISOString(); save(); }
    return response;
  } catch (error) { if (kind) { call.status = 'transport_unknown'; call.errorName = (error as Error).name; save(); } throw error; }
};

async function http(customer: Customer, route: string[], method = 'GET', body?: Row, expected = 200, key = randomUUID()) {
  const request = new Request('http://localhost:3007/api/miniprogram/assistant/' + route.join('/'), { method,
    headers: { Authorization: 'Bearer ' + customer.token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await (method === 'POST' ? POST : GET)(request, { params: Promise.resolve({ path: route }) });
  const result = await response.json();
  assert.equal(response.status, expected, 'C01 ' + method + ' ' + route.join('/') + ' returned ' + response.status + ' ' + String(result.code || ''));
  assert.equal(response.headers.get('cache-control'), 'no-store'); return result.data as Row;
}
async function globalSnapshot() {
  return withPlatformTransaction(async tx => ({
    llm: await one(tx, sql`select llm_config->>'enabled' enabled,llm_config->>'providerKey' provider,llm_config->>'model' model,
      md5(llm_config::text) hash from app.platform_configs where key='default'`),
    providers: await one(tx, sql`select md5(coalesce(jsonb_agg(to_jsonb(p) order by key)::text,'[]')) hash from app.ai_provider_configs p`),
  }));
}
async function publish(f: Pick<Fixture, 'enterpriseId' | 'adminId' | 'knowledge'>, entry: DocumentInput, audience = 'customer_public') {
  const created = await f.knowledge.execute('create', { title: entry.title, body: entry.body, sourceType: 'manual_text', audience,
    professional: professionalEntry({ kind: 'explanation', topics: ['合成书房办公'], prerequisites: ['现场尺寸、完整点位资料和团队核对均待确认'],
      conditions: entry.claim ? [{ field: 'material', operator: 'in', values: ['合成板材'] }] : [], ...entry.professional, claim: entry.claim ?? null }) }, randomUUID());
  const d = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  const queued = await f.knowledge.execute('index', d, randomUUID()), lease = await claimKnowledgeJob();
  assert.ok(lease); assert.equal(lease.jobId, queued.jobId); await runKnowledgeJob(lease);
  assert.equal((await f.knowledge.execute('job', { jobId: lease.jobId })).status, 'succeeded');
  await f.knowledge.execute('publish', d, randomUUID()); return d;
}
async function fixture(i: number, config: AgentConfig) {
  const identity = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!.id); tenants.push(enterpriseId);
    const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${prefix + i},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id); admins.push(adminId);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,200,12000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
    return { enterpriseId, adminId };
  });
  const f = { ...identity, knowledge: new KnowledgeService(identity), documents: [] as Document[], customers: [] as Customer[] };
  const record: Row = { key: spec[i].key, ...identity, documents: f.documents, customers: [] }; (report.fixtures as Row[]).push(record); save();
  for (const d of spec[i].documents) { f.documents.push(await publish(f, d)); save(); }
  const internal = await publish(f, { title: '合成内部禁止外发', body: 'PRIVATE_KB_SEMANTICS_DO_NOT_SEND 书房办公的内部密码与人员信息，不得外发。' }, 'staff_internal');
  record.internal = internal; save(); const completed: Fixture = { ...f, internal }; fixtures.push(completed);
  return completed;
}
async function customer(f: Fixture, round: number) {
  const userId = await withPlatformTransaction(async tx => {
    const id = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + round},1) returning id`))!.id); users.push(id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${prefix + id})`); return id;
  });
  if (knowledgeOnly) {
    const leadId = String((await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${f.enterpriseId},${userId},'合成KB1语义业主','13800000000','natural') returning id`)))!.id);
    const actor: ActorContext = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
    const conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
    const token = await signMiniProgramToken({ sub: userId, id: userId, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
    const c = { userId, leadId, projectId: '', planId: '', conversationId, token }; f.customers.push(c);
    ((report.fixtures as Row[]).find(r => r.enterpriseId === f.enterpriseId)!.customers as Row[]).push({ userId, leadId, projectId: null, planId: null, conversationId, round }); save(); return c;
  }
  const graph = { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{ id: 'f', name: '一层', ceilingHeightMm: 2800,
    nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
    walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b' }, { id: 'bc', startNodeId: 'b', endNodeId: 'c' }, { id: 'cd', startNodeId: 'c', endNodeId: 'd' }, { id: 'da', startNodeId: 'd', endNodeId: 'a' }],
    openings: [], spaces: [{ id: 'study', name: '书房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }] }] } };
  const ids = await withTenantTransaction(f.enterpriseId, async tx => {
    const leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${f.enterpriseId},${userId},'合成知识语义业主','13800000000','natural') returning id`))!.id);
    const planId = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
      values(${f.enterpriseId},${userId},'合成书房正式主户型','manual','completed',${JSON.stringify(graph)}::jsonb) returning id`))!.id);
    await tx.execute(sql`update app.leads set primary_floor_plan_id=${planId} where enterprise_id=${f.enterpriseId} and id=${leadId}`); return { leadId, planId };
  });
  const construction = new ConstructionService({ enterpriseId: f.enterpriseId, adminId: f.adminId }), stages = await construction.execute('stages');
  if (round === 1) await construction.execute('saveStages', { expectedVersion: stages.version, stages: [{ key: 'utilities', name: '水电', visitReminder: false, visitReason: '', watchPoints: '' }] }, randomUUID());
  const projectId = String((await construction.execute('create', { leadId: ids.leadId, name: '合成知识语义工地', managerId: f.adminId, rooms: ['书房'] }, randomUUID())).id);
  const detail = await construction.execute('detail', { projectId });
  await construction.execute('progress', { projectId, expectedVersion: (detail.project as Row).version, stageKey: 'utilities', note: '合成当前阶段，未登记点位批准或检查结果', sendReminder: false }, randomUUID());
  const actor: ActorContext = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: ids.leadId } };
  const conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  const token = await signMiniProgramToken({ sub: userId, id: userId, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
  const c = { userId, ...ids, projectId, conversationId, token }; f.customers.push(c);
  ((report.fixtures as Row[]).find(r => r.enterpriseId === f.enterpriseId)!.customers as Row[]).push({ userId, ...ids, projectId, conversationId, round }); save(); return c;
}

async function execute(f: Fixture, i: number, round: number) {
  const c = await customer(f, round), started = Date.now(), key = randomUUID();
  const result: Row = { key: spec[i].key, round, enterpriseId: f.enterpriseId, conversationId: c.conversationId, question: spec[i].question,
    expectedDocuments: f.documents, automatic: {}, semanticReview: 'requires_independent_source_bound_review' };
  (report.runs as Row[]).push(result); save();
  const sent = await http(c, ['conversations', c.conversationId, 'messages'], 'POST', { clientMessageId: key,
    content: { version: 1, blocks: [{ type: 'text', text: spec[i].question }] } }, 202, key);
  result.runId = sent.runId; save(); console.log(JSON.stringify({ event: 'core-dispatched', key: spec[i].key, round, runId: sent.runId }));
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId); assert.equal(lease.enterpriseId, f.enterpriseId);
  await processAnswer(lease);
  const run = await http(c, ['runs', String(sent.runId)]), messages = await http(c, ['conversations', c.conversationId, 'messages']);
  const message = (messages.items as Row[]).find(m => m.id === run.outputMessageId);
  const data = await withTenantTransaction(f.enterpriseId, async tx => ({
    steps: await rows(tx, sql`select step_seq,kind,status,capability_name,input_summary,source_refs,private_checkpoint from app.assistant_run_steps
      where enterprise_id=${f.enterpriseId} and run_id=${String(sent.runId)} order by step_seq`),
    attempts: await rows(tx, sql`select id::text,status,accepted,provider_key,remote_model,error_code,duration_ms,metadata from app.ai_provider_attempts
      where enterprise_id=${f.enterpriseId} and assistant_run_id=${String(sent.runId)} order by id`),
    usage: await rows(tx, sql`select category,measurement_kind,quantity,input_tokens,output_tokens,cost_micros from app.assistant_usage_records
      where enterprise_id=${f.enterpriseId} and run_id=${String(sent.runId)} order by id`),
    citations: await rows(tx, sql`select x.id::text,x.document_id::text,x.document_version_id::text,x.source_hash,x.quote_snapshot,c.text original_text,c.text_hash
      from app.assistant_message_citations x join app.assistant_knowledge_chunks c on c.enterprise_id=x.enterprise_id and c.id=x.chunk_id
      where x.enterprise_id=${f.enterpriseId} and x.run_id=${String(sent.runId)} order by x.id`),
  }));
  const synthesis = data.steps.find(s => s.kind === 'agent_synthesis_context'), context = synthesis?.source_refs as SynthesisContext | undefined;
  const answer = synthesis?.private_checkpoint as SynthesisAnswer | undefined, text = message?.available ? safeText(message.content as Parameters<typeof safeText>[0]) : '';
  const consulted = new Set(context?.knowledge.map(e => e.ref.version) || []);
  result.run = run; result.message = message ?? null; result.text = text; result.elapsedMs = Date.now() - started; Object.assign(result, data);
  const automatic: Record<string, boolean> = { terminalSuccess: run.status === 'succeeded', available: message?.available === true,
    actualAgentProvider: data.attempts.length > 0 && data.steps.some(s => s.kind === 'agent_model'),
    synthesis: !!synthesis, requiredSourcesConsulted: f.documents.every(d => consulted.has(d.versionId)),
    noPrivateSource: !!context && context.knowledge.every(e => e.ref.version !== f.internal.versionId) && !JSON.stringify(message ?? null).includes('PRIVATE_KB_SEMANTICS_DO_NOT_SEND'),
    actualKnowledgeCitations: data.citations.length > 0,
    originalQuotes: data.citations.every(r => String(r.original_text).includes(String(r.quote_snapshot)) && r.source_hash === r.text_hash),
  };
  if (!knowledgeOnly) automatic.currentBoundProject = !!context?.snapshots.some(s => JSON.stringify(s.data).includes('"projectId":"' + c.projectId + '"'));
  if (knowledgeOnly && i === 0) automatic.materialConditionsStillUnknown = (context?.knowledge.filter(e => e.professional?.entry.kind === 'material') || []).length >= 1
    && context!.knowledge.filter(e => e.professional?.entry.kind === 'material').every(e => e.professional?.applicability.status === 'unknown');
  if (i === 1) {
    automatic.conflictFirst = answer?.segments[0]?.basis === 'uncertainty';
    automatic.conflictingClaimsStillUnknown = (context?.knowledge.filter(e => e.professional?.entry.claim) || []).length >= 2
      && context!.knowledge.filter(e => e.professional?.entry.claim).every(e => e.professional?.applicability.status === 'unknown');
  }
  if (message?.available) {
    const fresh = await http(c, ['conversations', c.conversationId, 'messages']);
    automatic.persistedReentry = JSON.stringify((fresh.items as Row[]).find(m => m.id === message.id)?.content) === JSON.stringify(message.content);
    const sourceReads: Row[] = [];
    for (const citation of data.citations) sourceReads.push(await http(c, ['citations', String(citation.id)]));
    result.citationReads = sourceReads;
  } else automatic.persistedReentry = false;
  result.automatic = automatic; result.automaticPassed = Object.values(automatic).every(Boolean);
  result.unknownProviderOutcome = data.attempts.some(a => a.status === 'unknown') || run.status === 'indeterminate';
  result.signals = { glare: /眩光|反光|强光/.test(text), passage: /通道|走动|通行/.test(text), pointPlan: /点位图|电气/.test(text),
    conditions: /核对|核实|待|缺|未知/.test(text), conflict: /冲突|矛盾|不一致|不同/.test(text) };
  save(); console.log(JSON.stringify({ event: 'core-recorded', key: spec[i].key, round, runId: sent.runId, status: run.status,
    automatic, providerAttempts: data.attempts.length, unknownProviderOutcome: result.unknownProviderOutcome }));
  return result;
}
async function guards() {
  const a = fixtures[0]?.customers[0], b = fixtures[1]?.customers[0];
  if (a && b) { await http(b, ['conversations', a.conversationId, 'messages'], 'GET', undefined, 404);
    (report.guards as Row[]).push({ name: 'cross-tenant customer HTTP history denied', passed: true }); }
  for (const f of fixtures) {
    const succeeded = (report.runs as Row[]).filter(r => r.enterpriseId === f.enterpriseId && (r.run as Row)?.status === 'succeeded');
    if (!succeeded.length) { (report.guards as Row[]).push({ name: f.enterpriseId + ' source withdrawal', executed: false, reason: 'No successful answer to withdraw' }); continue; }
    await f.knowledge.execute('retire', { documentId: f.documents.at(-1)!.documentId, expectedVersion: 2 }, randomUUID());
    for (const r of succeeded) {
      const c = f.customers.find(c => c.conversationId === r.conversationId)!;
      const current = await http(c, ['conversations', c.conversationId, 'messages']);
      const withdrawn = (current.items as Row[]).find(m => m.id === (r.message as Row).id);
      (report.guards as Row[]).push({ name: 'source withdrawal invalidates derived answer', runId: r.runId, passed: withdrawn?.available === false, projection: withdrawn });
    }
  }
  if (b) {
    await withTenantTransaction(fixtures[1].enterpriseId, tx => tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now(),version=version+1
      where enterprise_id=${fixtures[1].enterpriseId} and conversation_id=${b.conversationId} and user_id=${b.userId}`));
    await http(b, ['conversations', b.conversationId, 'messages'], 'GET', undefined, 404);
    const key = randomUUID(); await http(b, ['conversations', b.conversationId, 'messages'], 'POST', { clientMessageId: key,
      content: { version: 1, blocks: [{ type: 'text', text: '合成撤权后拒绝发送' }] } }, 404, key);
    (report.guards as Row[]).push({ name: 'removed participant cannot read/send through C01', passed: true });
  }
  save();
}
async function auditAndCleanup() {
  try {
    report.accounting = await withPlatformTransaction(async tx => {
      const result = [];
      for (const enterpriseId of tenants) result.push({ enterpriseId,
        indexAttempts: await rows(tx, sql`select operation,status,count(*)::int calls,sum(input_tokens)::text known_input_tokens,count(*) filter(where input_tokens is null)::int unknown_input_calls
          from app.assistant_knowledge_attempts where enterprise_id=${enterpriseId} group by operation,status order by operation,status`),
        usage: await rows(tx, sql`select category,measurement_kind,count(*)::int calls,sum(input_tokens)::text known_input_tokens,sum(output_tokens)::text known_output_tokens,
          count(*) filter(where input_tokens is null)::int unknown_input_calls from app.assistant_usage_records where enterprise_id=${enterpriseId} group by category,measurement_kind order by category,measurement_kind`),
        providerAttempts: await rows(tx, sql`select id::text,assistant_run_id::text,status,accepted,provider_key,remote_model,error_code,duration_ms from app.ai_provider_attempts where enterprise_id=${enterpriseId} order by id`),
        reservations: await rows(tx, sql`select status,count(*)::int count from app.assistant_quota_reservations where enterprise_id=${enterpriseId} group by status order by status`),
        issueEvents: await rows(tx, sql`select type,count(*)::int count from app.domain_event_outbox where enterprise_id=${enterpriseId} and type like 'construction.%issue.%' group by type`),
      });
      return { tenantIds: tenants, adminIds: admins, userIds: users, items: result, costMicros: null };
    }); save();
  } finally {
    await withPlatformTransaction(async tx => {
      for (const enterpriseId of tenants) {
        await deleteConstructionData(tx, BigInt(enterpriseId)); await deleteAssistantData(tx, BigInt(enterpriseId));
        await tx.execute(sql`delete from app.leads where enterprise_id=${enterpriseId}`); await tx.execute(sql`delete from app.floor_plans where enterprise_id=${enterpriseId}`);
        await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterpriseId}`); await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
      }
      for (const user of users) await tx.execute(sql`delete from app.users where id=${user}`);
    });
  }
  report.cleanup = await withPlatformTransaction(async tx => {
    const tables = await rows(tx, sql`select table_name from information_schema.columns where table_schema='app' and column_name='enterprise_id' order by table_name`), remaining: Row[] = [];
    for (const t of tenants.length ? tables : []) {
      const r = await one(tx, sql`select count(*)::int n from app.${sql.identifier(String(t.table_name))} where enterprise_id in (${sql.join(tenants.map(id => sql`${id}::bigint`), sql`,`)})`);
      if (Number(r!.n)) remaining.push({ table: t.table_name, rows: r!.n });
    }
    const identities = [];
    for (const [table, ids] of [['enterprises', tenants], ['admin_users', admins], ['users', users]] as const) if (ids.length) identities.push({ table,
      rows: Number((await one(tx, sql`select count(*)::int n from app.${sql.identifier(table)} where id in (${sql.join(ids.map(id => sql`${id}::bigint`), sql`,`)})`))!.n) });
    return { tablesChecked: tables.length, remaining, identities };
  }); save();
  const cleanup = report.cleanup as { remaining: Row[]; identities: Array<{ rows: number }> };
  assert.deepEqual(cleanup.remaining, []); assert.ok(cleanup.identities.every(i => i.rows === 0));
}
async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
  save(); const before = await globalSnapshot(); report.configurationBefore = before;
  try {
    const raw = await withPlatformTransaction(tx => one(tx, sql`select s.agent_config from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id
      where (e.code like 'synthetic-%' or e.code like 'p4b-development-%') and s.agent_config->>'providerKey'=${String(before.llm?.provider)}
      and s.agent_config->>'model'=${process.env.ASSISTANT_TEXT_MODEL || String(before.llm?.model)} order by s.enterprise_id limit 1`));
    const config = agentConfig(raw?.agent_config); assert.ok(config, 'Existing verified synthetic Agent template required; no fabricated capability probe');
    assert.equal(before.llm?.enabled, 'true'); report.agentConfiguration = config; save();
    for (let i = 0; i < spec.length; i++) await fixture(i, config);
    console.log(JSON.stringify({ event: 'fixtures-published', tenants, plannedCoreRuns: 4 }));
    let stop = false;
    for (let i = 0; i < spec.length && !stop; i++) for (const round of [1, 2]) {
      const result = await execute(fixtures[i], i, round); if (result.unknownProviderOutcome) { stop = true; report.stoppedForUnknownProviderOutcome = true; break; }
    }
    await guards();
  } catch (error) {
    (report.errors as Row[]).push({ name: (error as Error).name, code: (error as { code?: string }).code || 'acceptance_error',
      assertion: error instanceof assert.AssertionError ? error.message.slice(0, 500) : null }); save(); process.exitCode = 1;
  } finally {
    try { report.configurationAfter = await globalSnapshot(); report.configurationStable = JSON.stringify(before) === JSON.stringify(report.configurationAfter); await auditAndCleanup(); }
    finally { globalThis.fetch = originalFetch; report.finished = new Date().toISOString(); save(); await closePostgresPool(); }
  }
  const runs = report.runs as Row[], guardsResult = report.guards as Row[];
  report.automaticSummary = { planned: 4, recorded: runs.length, passed: runs.filter(r => r.automaticPassed).length,
    failed: runs.filter(r => r.run && !r.automaticPassed).length, unexecuted: 4 - runs.filter(r => r.run).length,
    guardsExecuted: guardsResult.filter(g => g.passed !== undefined).length, guardsFailed: guardsResult.filter(g => g.passed === false).length,
    semanticPassed: null, semanticReview: 'requires_independent_source_bound_review' };
  save(); console.log(JSON.stringify({ event: 'acceptance-finished', automaticSummary: report.automaticSummary, configurationStable: report.configurationStable, overall: 'Limited' }));
  if (runs.length !== 4 || runs.some(r => !r.automaticPassed) || guardsResult.some(g => g.passed === false) || !report.configurationStable) process.exitCode = 1;
}
main().catch(async error => { (report.errors as Row[]).push({ name: (error as Error).name, code: 'acceptance_cleanup_or_setup_error' }); save(); process.exitCode = 1; await closePostgresPool(); });
