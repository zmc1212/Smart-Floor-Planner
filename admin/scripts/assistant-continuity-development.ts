/** PPT15/23/37/38: synthetic facts, actual HTTP/Worker/model; no customer data. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { SynthesisContext, SynthesisAnswer } from '@/lib/assistant/agent/synthesis';
import { readMemory, applyNeedDelta, parseNeedDelta, type NeedFact } from '@/lib/assistant/agent/memory';
import { defaultConstructionStages } from '@/lib/construction/stages';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { hasExplicitUseFormalComparison } from './assistant-continuity-checks';

const root = path.resolve('..'), output = path.resolve(process.env.XIAOK_ACCEPTANCE_OUTPUT || path.join(root, 'tmp/xiaok-corrections-continuity')), native = process.argv.includes('--native');
const isolated = process.argv.includes('--isolated'), origin = process.env.XIAOK_ACCEPTANCE_ORIGIN || 'http://localhost:3006';
assert.ok(['http://localhost:3006','http://localhost:3008'].includes(origin), 'Approved business loopback acceptance origin required;3007 belongs to the knowledge task');
const sourceFiles = [...['answer-continuity','memory-sources','business-tools','memory','materials','context','worker','bound-context','synthesis','synthesis-sources','synthesis-projection','synthesis-attribution']
  .map(f => 'src/lib/assistant/agent/' + f + '.ts'), 'src/lib/construction/need-issues.ts',
  'src/lib/ai/postgres-workflow-chat.ts', 'src/lib/ai/providers/agent-chat.ts', 'scripts/assistant-continuity-development.ts', 'scripts/assistant-continuity-native.mjs', 'scripts/construction-chat-native.mjs', 'scripts/assistant-continuity-isolated.mjs', 'scripts/assistant-continuity-checks.ts', 'scripts/assistant-acceptance-safety.mjs'];
const sourceHash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const prefix = (isolated ? 'synthetic-fact-boundaries-' : 'synthetic-continuity-live-') + randomUUID();
export const initialNeeds = '请记录：书房书桌靠窗；书房偶尔双人办公；书房使用电脑和台灯；厨房为封闭式。';
export const question = '结合我书房现在的需求、团队核对和当前正式方案，按企业专业做法解释底盒为什么仍需核对；办公需求补充和底盒核对这两件事分别在等谁？';
export const correction = '更正一下，书房办公人数改为单人办公，电脑和台灯不变。按企业专业做法，底盒现在还要核对什么；办公需求补充和底盒核对这两件事分别在等谁？';
export const continuation = '那为什么还要核对，那两件事现在分别在等谁？';
export const withdrawnQuestion = '结合当前可用资料和企业专业做法，现在书房办公人数还能确定吗，哪些需求仍可沿用？';
type Expected = { phase: string; versionId: string; single: boolean };
let expected: Expected = { phase: 'baseline', versionId: '', single: false };
const report: Row = { started: new Date().toISOString(), prefix, passed: false, requests: [], runs: [], checks: [],
  selection: native && process.argv.includes('--focus-continuation') ? 'fresh native correction, continuation and withdrawn-source answer; baseline not rerun' : 'full existing scenario sequence',
  preregistered: [native && process.argv.includes('--focus-continuation') ? 'baseline not rerun; prior actual4239/v59 is historical evidence only' : 'baseline: expressed window preference is known; site dimensions remain unverified; no phone dependency',
    'mixed-correction: save use before retrieval, retain desk/devices/other room; preserve shared original and exact approved version',
    'continuation: current need and same unresolved issue/owner survive reentry; enterprise rule and actual stage explain the remaining gap',
    'withdrawal: dependent historical answers unavailable; no formal action or disclosure caused by private correction'],
  reality: { factsAndMedia: 'clearly labelled synthetic; no real customer or engineering data', http: origin,
    database: isolated ? 'approved isolated55432/xiaok_embedding_eval' : 'approved development5432', worker: isolated ? 'isolated worktree HTTP Worker under shared acceptance lock' : 'existing real Worker', model: 'configured DeepSeek/deepseek-flash', imagePixels: false, costMicros: null } };
const save = () => { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, native ? 'native-driver.json' : 'live.json'), JSON.stringify(report, null, 2)); };
const check = (name: string) => { (report.checks as Row[]).push({ name, passed: true }); save(); console.log('PASS ' + name); };
async function wait<T>(read: () => Promise<T | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 360; i++) { const result = await read(); if (result) return result; await new Promise(r => setTimeout(r, 500)); }
  throw Error('Timed out: ' + label);
}
let eid = '', uid = '', pid = '', cid = '', leadId = '', did = '', vid = '', customerToken = '', issueId = '';
const staff: { enterpriseId: string; adminId: string; userId: string; role: 'enterprise_admin' | 'designer' | 'construction_staff'; token: string }[] = [];
const actor = (): ActorContext => ({ enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } });
async function http(url: string, token: string, method = 'GET', body?: unknown, status = 200, key = randomUUID()) {
  const r = await fetch(origin + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const j = await r.json(); (report.requests as Row[]).push({ url, method, status: r.status, noStore: r.headers.get('cache-control') }); save();
  assert.equal(r.status, status, JSON.stringify(j)); assert.match(r.headers.get('cache-control') || '', /no-store/); return j.data;
}
const mini = (suffix: string, method = 'GET', text?: string) => {
  const key = randomUUID(); return http('/api/miniprogram/assistant/conversations/' + cid + suffix, customerToken, method,
    text ? { clientMessageId: key, content: { version: 1, blocks: [{ type: 'text', text }] } } : undefined, method === 'POST' ? 202 : 200, key);
};
const materials = async () => {
  const { queryMaterials } = await import('@/lib/assistant/agent/materials');
  return withTenantTransaction(eid, tx => queryMaterials(tx, actor(), cid, { leadId: '', room: '书房' }));
};
const followups = async () => {
  const { queryNeedIssues } = await import('@/lib/construction/need-issues');
  return withTenantTransaction(eid, tx => queryNeedIssues(tx, actor(), cid));
};
const memory = () => withTenantTransaction(eid, async tx => readMemory((await one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`))?.entry_snapshot));
let baselineFacts: NeedFact[] = [], needIssueId = '';
async function auditPreparation(runId: string) {
  const run = await wait(async () => { const r = await http('/api/miniprogram/assistant/runs/' + runId, customerToken); return !['queued','running'].includes(r.status) ? r : false; }, 'initial memory write');
  const current = (await memory()).facts.filter(f => f.status === 'current'); baselineFacts = current;
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select step_seq,status,private_checkpoint,input_summary from app.assistant_run_steps
    where enterprise_id=${eid} and run_id=${runId} and kind='agent_model' order by step_seq`));
  report.preparation = { runId, run, facts: current, steps }; save();
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.ok(current.some(f => f.room === '书房' && /靠窗/.test(f.value)));
  assert.ok(current.some(f => f.room === '书房' && f.field === 'use' && /双人/.test(f.value)));
  assert.ok(current.some(f => f.room === '书房' && f.field === 'devices' && /电脑/.test(f.value) && /台灯/.test(f.value)));
  assert.ok(current.some(f => f.room === '厨房' && /封闭/.test(f.value)));
  const needs = (await followups()).data.filter(i => !i.kind && i.field === 'use'); assert.equal(needs.length, 1); needIssueId = needs[0].issueId;
  report.preparation = { runId, run, facts: current, steps, needIssueId }; save();
}
/** Explicit synthetic setup for pre-field-normalization data; not an AI write
 * or customer action. Keep the original fact in its immutable correction chain. */
async function seedLegacyMemory() {
  const seeded = await withTenantTransaction(eid, async tx => {
    const c = await one(tx, sql`select c.*,e.code from app.assistant_conversations c join app.enterprises e on e.id=c.enterprise_id
      where c.enterprise_id=${eid} and c.id=${cid} for update of c`); assert.equal(c?.code, prefix);
    const before = readMemory(c.entry_snapshot), desk = before.facts.find(f => f.status === 'current' && f.room === '书房' && f.field === 'desk')!; assert.ok(desk);
    const origin = await one(tx, sql`select id,content from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid}
      and id=${desk.sourceMessageId} and user_id=${uid} and author_kind='user'`); assert.ok(origin);
    const text = safeText(origin.content as Parameters<typeof safeText>[0]), operationId = 'synthetic:legacy-mixed:' + uid;
    const after = applyNeedDelta(before, parseNeedDelta({ room: '书房', field: 'desk', value: '书房书桌靠窗；书房偶尔双人办公', quote: text,
      sourceMessageId: desk.sourceMessageId, expectedVersion: before.version }), { id: desk.sourceMessageId, text }, operationId, new Date().toISOString());
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify(after)}::jsonb),version=version+1
      where enterprise_id=${eid} and id=${cid}`);
    return { reason: 'labelled synthetic legacy mixed-desk fixture using the production source validator; not a model response or formal business mutation', before, after, operationId };
  });
  baselineFacts = seeded.after.facts.filter(f => f.status === 'current'); report.syntheticLegacyFixture = seeded; save();
}
const base = () => '/api/miniprogram/construction/projects/' + pid + '/chat';
const staffSend = async (index: number, text: string, mediaIds: string[] = []) => {
  const current = await http(base(), staff[index].token);
  return http(base() + '/messages', staff[index].token, 'POST', { text, mediaIds, versions: current.versions });
};
async function audit(runId: string, label: string, started: number, withdrawn = false) {
  const run = await wait(async () => { const r = await withTenantTransaction(eid, tx => one(tx, sql`select id::text,status,error_code,output_message_id::text
    from app.assistant_runs where enterprise_id=${eid} and id=${runId}`)); return r && !['queued','running'].includes(String(r.status)) ? r : false; }, 'configured-model answer');
  const history = await mini('/messages'), snapshot = await materials(), message = history.items.find((m: Row) => String(m.id) === run.output_message_id);
  const currentMemory = await memory(), currentFollowups = await followups();
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,status,source_refs,private_checkpoint,input_summary
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  const citations = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,document_id::text,document_version_id::text,quote_snapshot
    from app.assistant_message_citations where enterprise_id=${eid} and run_id=${runId}`));
  const usage = await withTenantTransaction(eid, tx => rows(tx, sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text
    from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`));
  const result = { runId, label, ...run, elapsedMs: Date.now() - started, expected: { ...expected }, message, text: message ? safeText(message.content) : '',
    steps, citations, usage, currentMaterialSnapshot: snapshot, currentMemory, currentFollowups, outputMessageId: String(run.output_message_id), costMicros: null };
  (report.runs as Row[]).push(result); save(); assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(message?.available, true);
  const checkpoints = steps.filter(s => ['agent_checkpoint','agent_synthesis_context'].includes(String(s.kind)));
  assert.ok(checkpoints.length >= 2);
  for (const checkpoint of checkpoints) assert.equal((checkpoint.input_summary as Row)?.promptVersion, report.promptVersion, 'actual Worker uses this frozen prompt version');
  assert.ok(citations.some(c => c.document_id === did && c.document_version_id === vid), 'actual answer cites effective enterprise rule');
  const context = steps.find(s => s.kind === 'agent_synthesis_context')?.source_refs as SynthesisContext;
  const answer = steps.find(s => s.kind === 'agent_synthesis_context')?.private_checkpoint as SynthesisAnswer; assert.ok(context && answer);
  const cited = answer.segments.flatMap(s => s.citations).map(c => context.sources.find(s => s.sourceId === c.sourceId)!);
  assert.ok(context.snapshots.some(s => s.query.domain === 'construction'), 'current real project stage enters the same answer');
  assert.ok(context.snapshots.some(s => s.query.domain === 'followups'), 'same-run original followups are revalidated');
  if (withdrawn) {
    const legacy = snapshot.data.sources.find(s => s.need?.field === 'desk')!; assert.ok(legacy);
    assert.equal(legacy.need!.interpretation?.currentFactId, null); assert.equal(snapshot.data.sources.some(s => s.need?.field === 'use'), false);
    assert.ok(!context.sources.some(s => s.material && ['shared_drawing','team_review','formal_plan'].includes(s.material.ref.type)));
    assert.ok(!JSON.stringify(context.sources).includes('单人办公'), 'unavailable use cannot return via a different source adapter');
    assert.doesNotMatch(result.text, /单人办公/); assert.match(result.text, /人数/); assert.match(result.text, /未知|不足|不能|不确定|待核实|无法|未取得/);
    for (const clause of result.text.split(/[。；;\n]/)) if (!/不能|不应|无法|不足|未知|不确定|不再|不能据/.test(clause))
      assert.doesNotMatch(clause, /(?:当前|现在|目前|仍是|仍然).{0,12}(?:双人|两人)/);
    Object.assign(result, { semanticReviewRequired: true, length: result.text.length }); save(); return result;
  }
  const use = currentMemory.facts.find(f => f.status === 'current' && f.room === '书房' && f.field === 'use')!; assert.ok(use);
  assert.match(use.value, expected.single ? /单人/ : /双人/);
  for (const fact of baselineFacts.filter(f => !(f.room === '书房' && f.field === 'use'))) assert.ok(currentMemory.facts.some(f => f.id === fact.id && f.status === 'current'), 'independent fact retained: ' + fact.value);
  const need = currentFollowups.data.find(i => i.issueId === needIssueId && !i.kind)!;
  assert.equal(need.sourceFactId, use.id); assert.equal(need.waitingFor, 'unassigned');
  assert.ok(cited.some(s => s.followup?.issueId === needIssueId), 'actual explanation uses the same unresolved customer-need issue');
  assert.ok(cited.some(s => s.followup?.issueId === issueId && s.followup.kind === 'team_result'), 'actual explanation uses the explicitly returned site issue and live owner');
  const plan = snapshot.data.sources.find(s => s.ref.type === 'formal_plan');
  assert.ok(plan); assert.equal(plan.ref.id, expected.versionId); assert.equal(plan.formal?.decision, 'approved');
  if (expected.single) {
    assert.ok(use.supersedes); assert.ok(cited.some(s => s.material?.need?.field === 'use' && /单人/.test(s.material.need.value)));
    assert.ok(cited.some(s => s.material?.ref.id === expected.versionId && s.material.ref.type === 'formal_plan'), 'private correction is compared to the exact unchanged formal version');
    assert.match(result.text, /单人/); assert.match(result.text, /双人/); assert.match(result.text, /不一致|差异|不同|冲突/);
    assert.ok(hasExplicitUseFormalComparison(answer, context.sources, {
      useId: use.id, formalId: expected.versionId, currentTerm: '单人', formalTerm: '双人',
    }), 'one evidence paragraph must compare current use to the exact quoted formal version; the answer must also cite the current use original');
    assert.ok(snapshot.data.sources.some(s => s.need?.field === 'desk' && s.need.qualifiedBy?.some(q => q.factId === use.id)), 'legacy compound statement is qualified by this exact current use correction');
  }
  for (const segment of answer.segments) for (const citation of segment.citations) assert.ok(context.sources.find(s => s.sourceId === citation.sourceId)?.text.includes(citation.quote));
  assert.match(result.text, /核对|复核|核实/); assert.match(result.text, /待核实|待(?:现场)?(?:核对|复核)|需要.{0,20}(?:核对|核实)|仍需.{0,20}(?:核对|核实)/);
  assert.doesNotMatch(result.text, /PRIVATE_|现在可以直接固定|可直接施工|保证.{0,10}完工/);
  assert.doesNotMatch(result.text, /书桌.{0,6}(?:靠哪|放哪)|(?:还需要|还有)(?:哪些|什么)设备/);
  assert.doesNotMatch(result.text, /直接(?:找|联系|私聊|拨打).{0,12}合成设计师/, 'an internal issue owner is not an authorized customer contact channel');
  for (const sentence of result.text.split(/[。\n]/)) if (!/不用|无需|不必|不需要/.test(sentence))
    assert.doesNotMatch(sentence, /等.{0,30}(?:电话|联系方式).{0,20}(?:再|后|才能).{0,15}(?:联系|沟通|核对)|(?:电话|联系方式).{0,20}(?:后|才能).{0,15}(?:联系|沟通|核对)/);
  Object.assign(result, { semanticReviewRequired: true, length: result.text.length }); save();
  return result;
}
async function main() {
  loadEnvConfig(process.env.XIAOK_ACCEPTANCE_ENV_ROOT || process.cwd(), true); const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname)
    && (isolated ? target.port === '55432' && target.pathname === '/xiaok_embedding_eval' && process.env.XIAOK_ACCEPTANCE_LOCK_OWNER === String(process.ppid)
      : process.argv.includes('--development') && target.port === '5432' && target.pathname === '/smart_floor_planner'));
  report.promptVersion = (await import('@/lib/assistant/agent/context')).agentPromptVersion;
  report.sourceManifest = sourceFiles.map(file => ({ file, sha256: sourceHash(file) }));
  const [{ signMiniProgramToken }, { ConstructionService }, { ConversationService }, { KnowledgeService }] = await Promise.all([
    import('@/lib/miniprogram-jwt'), import('@/lib/construction/service'), import('@/lib/assistant/core/conversation'), import('@/lib/assistant/knowledge/service')]);
  save();
  let restoreProvider: (() => Promise<unknown>) | undefined;
  try {
    let template: Row | undefined;
    if (isolated) {
      const primary = new URL(process.env.XIAOK_ACCEPTANCE_PRIMARY_DATABASE_URL || '');
      assert.ok(['localhost','127.0.0.1'].includes(primary.hostname) && primary.port === '5432' && primary.pathname === '/smart_floor_planner');
      const evaluation = process.env.DATABASE_URL;
      await closePostgresPool();
      let provider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
      try {
        process.env.DATABASE_URL = primary.toString();
        provider = await getPlatformLlmRuntimeConfig();
        template = await withPlatformTransaction(tx => one(tx, sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`));
      } finally { await closePostgresPool(); process.env.DATABASE_URL = evaluation; }
      assert.equal(provider.providerKey, 'deepseek'); assert.equal(new URL(provider.baseUrl).origin, 'https://api.deepseek.com');
      const prior = await getPlatformLlmRuntimeConfig();
      if (prior.apiKey !== provider.apiKey || prior.providerKey !== provider.providerKey || prior.baseUrl !== provider.baseUrl || prior.model !== provider.model || !prior.enabled) {
        restoreProvider = () => savePlatformLlmConfig(prior);
        await savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: provider.baseUrl, model: 'deepseek-flash', apiKey: provider.apiKey });
      }
      report.provider = { reusedExistingAuthorizedProvider: true, changedIsolatedOverride: Boolean(restoreProvider), credentialsPersistedInEvidence: false };
    } else template = await withPlatformTransaction(tx => one(tx, sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`));
    assert.ok(template && String(template.code).startsWith('p4b-development-')); const config = template.agent_config as Row;
    assert.equal(config.providerKey, 'deepseek'); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.runtime, 'langgraph-v1');
    await withPlatformTransaction(async tx => {
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 更正记忆与事项接续',${prefix},'active') returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,200,12000000,1000000000,30,${JSON.stringify({ ...config, imageInput: false })}::jsonb)`);
      for (const [i, role] of (['enterprise_admin','designer','construction_staff'] as const).entries()) {
        const userId = String((await one(tx, sql`insert into app.users(nickname,phone,context_version) values(${prefix+role},${'139'+String(Date.now()).slice(-6)+String(i).padStart(2,'0')},1) returning id`))!.id);
        const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,display_name,menu_permissions)
          values(${eid},${userId},${prefix+role},${'unusable:'+randomUUID()},${role},'active',false,${['合成负责人','合成设计师','合成师傅'][i]},ARRAY['assistant-knowledge']) returning id`))!.id);
        staff.push({ enterpriseId: eid, adminId, userId, role, token: '' });
      }
      uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+'customer'},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
    });
    report.fixture = { enterpriseId: eid, userId: uid, staff: staff.map(({adminId,userId,role}) => ({adminId,userId,role})) }; save();
    for (const s of staff) s.token = await signMiniProgramToken({ sub: s.userId, id: s.userId, mode: 'staff', role: s.role, staffRole: s.role, staffId: s.adminId, enterpriseId: eid, contextVersion: 1, source: 'phone' });
    customerToken = await signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
    leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${uid},'合成核对业主','13800000000','natural') returning id`)))!.id);
    const service = new ConstructionService({ enterpriseId: eid, adminId: staff[0].adminId });
    pid = String((await service.execute('create', { leadId, name: '合成核对问答工地', managerId: staff[0].adminId, rooms: ['书房','厨房'] }, randomUUID())).id);
    const pv = async () => Number(((await service.execute('detail', { projectId: pid })).project as Row).version);
    for (const s of staff.slice(1)) await service.execute('member', { projectId: pid, expectedVersion: await pv(), adminId: s.adminId, role: s.role === 'designer' ? 'designer' : 'worker', active: true, workLabel: '' }, randomUUID());
    const stageConfig = await service.execute('stages');
    await service.execute('saveStages', { expectedVersion: stageConfig.version, stages: defaultConstructionStages.map(s => s.key === 'utilities'
      ? { ...s, followUps: [{ field: 'use', room: '书房', question: '书房的办公使用方式还有需要补充的吗？' }] } : s) }, randomUUID());
    await service.execute('progress', { projectId: pid, expectedVersion: await pv(), stageKey: 'utilities', note: '合成水电阶段，底盒等待现场点位核对', sendReminder: false }, randomUUID());
    cid = String((await new ConversationService(actor()).create(randomUUID())).id); report.fixture = { ...(report.fixture as Row), leadId, projectId: pid, conversationId: cid }; save();
    const bytes = await sharp({ create: { width: 240, height: 180, channels: 3, background: '#e3e9e2' } }).png().toBuffer();
    fs.writeFileSync(path.join(output, 'synthetic-point-original.png'), bytes); const diagramBase64 = bytes.toString('base64');
    const k = new KnowledgeService({ enterpriseId: eid, adminId: staff[0].adminId });
    const source = await k.execute('create', { title: '合成企业书房点位与版本核对做法', sourceType: 'manual_text', audience: 'customer_public', body:
      '合成企业专业做法：书房办公先按客户原话核对人数、电脑和台灯，再结合实际家具尺寸核对通道及插座。水电阶段底盒固定前须核对具体点位。客户参考图、团队图纸关联、精确正式版本决定分别保留依据：关联核对不证明具体位置与尺寸正确；方案待决定时不能直接用于施工，同意该版也仍需现场落实依据。新版不继承旧版同意。若正式方案差异与客户原话不一致，保留双方来源并请团队核实，不替客户改需求。方案费用及工期变化仅按精确版本说明，不承诺总价或实际完成日期。' }, randomUUID());
    did = String((source.document as Row).id); vid = String((source.draft as Row).id); report.knowledge = { documentId: did, versionId: vid }; save();
    const job = await k.execute('index', { documentId: did, versionId: vid, expectedEditVersion: 1 }, randomUUID());
    await wait(async () => { const j = await k.execute('job', { jobId: job.jobId }); if (['failed','cancelled','indeterminate'].includes(String(j.status))) throw Error(JSON.stringify(j)); return j.status === 'succeeded' ? j : false; }, 'real knowledge indexing');
    await k.execute('publish', { documentId: did, versionId: vid, expectedVersion: 1, expectedEditVersion: 1 }, randomUUID());
    const setExpected = (e: Expected) => { expected = e; };
    const planText = (conflict = false) => `发布方案事项${issueId}\n标题：合成书房点位调整\n差异：${conflict ? '改为单人办公，取消台灯设备位，需客户核对这一差异。' : '按双人办公补充电脑和台灯设备位，具体安装尺寸仍待现场核对。'}\n费用变化：+${conflict ? '800' : '500'}.00元\n工期变化：+${conflict ? '3' : '2'}天`;
    const publish = async (conflict = false) => {
      const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'synthetic-formal.png');
      const response = await fetch(origin + base() + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + staff[1].token, 'Idempotency-Key': randomUUID() }, body: form });
      const payload = await response.json(); assert.equal(response.status, 200, JSON.stringify(payload));
      (report.requests as Row[]).push({ url: base() + '/media', method: 'POST', status: response.status, kind: 'real multipart upload' }); save();
      const result = await staffSend(1, planText(conflict), [String(payload.data.id)]);
      await wait(async () => { const history = await mini('/messages'); return history.items.some((m: Row) => (m.planDecision as Row | undefined)?.id === result.planId) ? true : false; }, 'formal version delivery');
      return String(result.planId);
    };
    const decide = async (id: string, action: string) => {
      const suffix = '/plans/' + id, p = await mini(suffix);
      return http('/api/miniprogram/assistant/conversations/' + cid + suffix + '/' + action, customerToken, 'POST', { expectedRevision: p.revision });
    };
    if (native) {
      const { run } = await import('./assistant-continuity-native.mjs');
      await run({ root: process.env.XIAOK_NATIVE_PROJECT_ROOT || root, origin, output, projectId: pid, identities: staff, customer: { conversationId: cid, token: customerToken, enterpriseId: eid }, question,
        focusContinuation: process.argv.includes('--focus-continuation'),
        diagramBase64, audit, auditPreparation, seedLegacyMemory, materials, followups, initialNeeds, correction, continuation, withdrawnQuestion, setExpected, planText, setIssue: (id: string) => { issueId = id; },
        disclosure: () => withTenantTransaction(eid, tx => rows(tx, sql`select id::text,type from app.domain_event_outbox where enterprise_id=${eid}
          and (type like 'construction.plan.%' or type='construction.material.shared.v1') order by id`)),
        verify: async () => { const data = await http(base(), staff[0].token); return { data, issues: data.issues, events: [] }; },
        revoke: async () => service.execute('member', { projectId: pid, expectedVersion: await pv(), adminId: staff[1].adminId, role: 'designer', active: false, workLabel: '' }, randomUUID()),
      });
    } else {
      await mini('/messages');
      const preparation = await mini('/messages', 'POST', initialNeeds); await auditPreparation(String(preparation.runId)); await seedLegacyMemory();
      await mini('/messages', 'POST', '共享书房需求：靠窗双人办公，电脑和台灯，具体尺寸待核对。');
      await http('/api/miniprogram/assistant/conversations/' + cid + '/media', customerToken, 'POST', { data: diagramBase64, kind: 'image', roomName: '' });
      await mini('/messages', 'POST', '共享书房点位图：客户参考图，图内尺寸尚未核实。');
      const record = await staffSend(2, '书房底盒还没固定，PRIVATE_INTERNAL_ORIGINAL 等设计师核对位置。');
      await wait(async () => { const r = await http(base(), staff[0].token); return r.items.some((i: Row) => (i.record as Row | null)?.id === record.recordId && (i.record as Row).status === 'draft') ? true : false; }, 'real site draft');
      issueId = String((await staffSend(0, '跟进记录' + record.recordId)).issueId); await staffSend(1, '接手事项' + issueId);
      await staffSend(1, '回复事项' + issueId + '：PRIVATE_UNRETURNED_REPLY 具体安装尺寸仍待现场核对。');
      const drawing = (await materials()).data.sources.find(s => s.ref.type === 'shared_drawing')!;
      await staffSend(1, `核对事项${issueId}图纸${drawing.ref.id}`); await staffSend(0, `回传事项${issueId}：图纸已按本项目书房核对关联，现场尺寸仍待复核。`);
      await wait(async () => (await materials()).data.sources.some(s => s.ref.type === 'team_review'), 'explicit returned drawing check');
      const first = await publish(); await decide(first, 'preview'); await decide(first, 'approve');
      const disclosureBefore = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,type from app.domain_event_outbox where enterprise_id=${eid}
        and (type like 'construction.plan.%' or type='construction.material.shared.v1') order by id`));
      for (const phase of ['baseline','mixed-correction','continuation']) {
        setExpected({ phase, versionId: first, single: phase !== 'baseline' });
        for (let n = 1; n <= 2; n++) {
          const started = Date.now(), text = phase === 'mixed-correction' ? correction : phase === 'continuation' ? continuation : question;
          const sent = await mini('/messages', 'POST', text); await audit(String(sent.runId), phase + '-' + n, started);
        }
        check(phase + ': two actual configured-model answers; current need, original issues, actual stage and enterprise rule checked');
      }
      const disclosureAfter = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,type from app.domain_event_outbox where enterprise_id=${eid}
        and (type like 'construction.plan.%' or type='construction.material.shared.v1') order by id`));
      assert.deepEqual(disclosureAfter, disclosureBefore); report.disclosureAudit = { before: disclosureBefore, after: disclosureAfter };
      check('private corrections and ordinary explanations produce no new share or formal decision');
      await mini('/messages', 'POST', '撤回共享资料' + drawing.ref.id);
      const allMessages: Row[] = []; let before = '';
      for (let page = 0; page < 10; page++) {
        const history = await mini('/messages?limit=100' + (before ? '&beforeSeq=' + before : ''));
        allMessages.push(...history.items); if (!history.nextCursor) break;
        assert.notEqual(history.nextCursor, before); before = history.nextCursor;
      }
      for (const r of report.runs as Row[]) assert.equal(allMessages.find((m: Row) => m.id === r.outputMessageId)?.available, false);
      check('reference withdrawal invalidates all persisted dependent explanations; no old formal source revives');
      for (let n = 1; n <= 2; n++) {
        const started = Date.now(), sent = await mini('/messages', 'POST', withdrawnQuestion);
        await audit(String(sent.runId), 'withdrawn-no-fallback-' + n, started, true);
      }
      check('two real answers after withdrawal keep the unavailable correction private and never revive old occupancy');
    }
    report.formalAudit = await withTenantTransaction(eid, tx => rows(tx, sql`select type,count(*)::int as count from app.domain_event_outbox where enterprise_id=${eid}
      and (type like 'construction.plan.%' or type='construction.site.issue.lifecycle.v1') group by type order by type`));
    assert.ok(!(report.formalAudit as Row[]).some(r => r.type === 'construction.site.issue.lifecycle.v1'), 'ordinary explanations do not implement, resolve or close the issue');
    report.passed = true;
  } finally {
    try {
    if (eid) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);
      for (const userId of [uid,...staff.map(s => s.userId)].filter(Boolean)) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
      report.finalState = await one(tx, sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,
        (select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs,
        (select count(*) from app.assistant_jobs where enterprise_id=${eid} and status in ('queued','running')) active_jobs`);
    });
    } finally {
      try { if (restoreProvider) { await restoreProvider(); report.providerRestored = true; } }
      finally {
        report.changedDuringRun = ((report.sourceManifest || []) as Array<{ file: string; sha256: string }>).filter(s => s.sha256 !== sourceHash(s.file)).map(s => s.file);
        report.finished = new Date().toISOString(); save(); await closePostgresPool();
      }
    }
  }
  assert.deepEqual(report.changedDuringRun, [], 'final evidence must use unchanged source files');
  for (const value of Object.values(report.finalState as Row)) assert.equal(String(value), '0', 'no synthetic staff/run/job remains active');
}
main().catch(e => { report.passed = false; report.error = (e as Error).message; save(); console.error((e as Error).message); process.exitCode = 1; });
