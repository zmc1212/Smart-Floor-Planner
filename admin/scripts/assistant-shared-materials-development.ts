/** PPT23/38 synthetic originals, real development HTTP/Worker/configured model. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { SynthesisContext, SynthesisAnswer } from '@/lib/assistant/agent/synthesis';

const root = path.resolve('..'), output = path.join(root, 'tmp/xiaok-material-projection'), native = process.argv.includes('--native');
const prefix = 'synthetic-shared-live-' + randomUUID();
export const materialQuestion = '结合我这次共享的书房需求、点位图和当前施工情况，按企业专业做法解释底盒现在能直接固定吗？图纸与现场还有哪些内容待核实？';
const report: Row = { started: new Date().toISOString(), prefix, passed: false, checks: [], requests: [], runs: [],
  reality: { factsAndMedia: 'clearly labelled synthetic fixtures; no actual customer/engineering data', database: 'approved development5432',
    http: 'localhost:3006', worker: 'existing real Worker', model: 'configured DeepSeek/deepseek-flash', imagePixels: false, costMicros: null } };
const save = () => { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, native ? 'native-driver.json' : 'live.json'), JSON.stringify(report, null, 2)); };
const check = (name: string) => { (report.checks as Row[]).push({ name, passed: true }); save(); console.log('PASS ' + name); };
async function wait<T>(read: () => Promise<T | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 500)); }
  throw Error('Timed out: ' + label);
}
let eid = '', uid = '', pid = '', cid = '', leadId = '', did = '', vid = '', customerToken = '';
const staff: { adminId: string; userId: string; role: 'enterprise_admin' | 'designer' | 'construction_staff'; token: string; enterpriseId: string }[] = [];
let expectedNeed = '', expectsDrawing = false;
async function http(url: string, token: string, method = 'GET', body?: unknown, expected = 200, key = randomUUID()) {
  const r = await fetch('http://localhost:3006' + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const j = await r.json(); (report.requests as Row[]).push({ url, method, status: r.status, noStore: r.headers.get('cache-control') }); save();
  assert.equal(r.status, expected, JSON.stringify(j)); assert.match(r.headers.get('cache-control') || '', /no-store/); return j.data;
}
const mini = (suffix: string, method = 'GET', text?: string) => {
  const key = randomUUID(); return http('/api/miniprogram/assistant/conversations/' + cid + suffix, customerToken, method,
    text ? { clientMessageId: key, content: { version: 1, blocks: [{ type: 'text', text }] } } : undefined, method === 'POST' ? 202 : 200, key);
};
const actor = (): ActorContext => ({ enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } });
const materials = async () => {
  const { queryMaterials } = await import('@/lib/assistant/agent/materials');
  return withTenantTransaction(eid, tx => queryMaterials(tx, actor(), cid, { leadId: '', room: '书房' }));
};
async function runState(runId: string) {
  return wait(async () => { const r = await withTenantTransaction(eid, tx => one(tx, sql`select r.id::text,r.status,r.error_code,r.output_message_id::text,m.content
    from app.assistant_runs r left join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id
    where r.enterprise_id=${eid} and r.id=${runId}`)); return r && !['queued','running'].includes(String(r.status)) ? r : false; }, 'real configured Worker run');
}
async function audit(runId: string, label: string, started: number) {
  const run = await runState(runId), history = await mini('/messages'), snapshot = await materials();
  const message = history.items.find((m: Row) => String(m.id) === String(run.output_message_id));
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,status,source_refs,private_checkpoint,input_summary
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  const citations = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,document_id::text,document_version_id::text,quote_snapshot
    from app.assistant_message_citations where enterprise_id=${eid} and run_id=${runId}`));
  const usage = await withTenantTransaction(eid, tx => rows(tx, sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text
    from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`));
  const result = { runId, label, elapsedMs: Date.now() - started, ...run, message, text: message ? safeText(message.content) : '', steps, citations, usage,
    expectedNeed, expectsDrawing, currentMaterialSnapshot: snapshot, outputMessageId: String(run.output_message_id), costMicros: null };
  (report.runs as Row[]).push(result); save(); assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(message?.available, true);
  assert.ok(citations.some(c => c.document_id === did && c.document_version_id === vid), 'effective enterprise knowledge must enter the actual answer');
  const synthesis = steps.find(s => s.kind === 'agent_synthesis_context'); assert.ok(synthesis);
  const context = synthesis.source_refs as SynthesisContext, answer = synthesis.private_checkpoint as SynthesisAnswer;
  const currentNeed = snapshot.data.sources.find(s => s.ref.type === 'shared_need')!, drawing = snapshot.data.sources.find(s => s.ref.type === 'shared_drawing');
  assert.equal(currentNeed.text, expectedNeed); assert.equal(!!drawing, expectsDrawing);
  assert.ok(context.sources.some(s => s.material?.ref.id === currentNeed.ref.id && s.material?.hash === currentNeed.hash));
  const cited = answer.segments.flatMap(s => s.citations).map(c => context.sources.find(s => s.sourceId === c.sourceId)!);
  assert.ok(cited.some(s => s.material?.ref.type === 'shared_need'), 'must use the need original, not only receive a source packet');
  if (drawing) assert.ok(cited.some(s => s.material?.ref.id === drawing.ref.id), 'must use the current drawing caption original');
  assert.ok(context.snapshots.some(s => s.query.domain === 'construction'), 'actual current stage must enter the same answer');
  for (const segment of answer.segments) for (const c of segment.citations) assert.ok(context.sources.find(s => s.sourceId === c.sourceId)?.text.includes(c.quote), 'every quote is exact');
  assert.match(result.text, /核对|复核|核实/); assert.match(result.text, /一般建议|待核实/);
  assert.doesNotMatch(result.text, /PRIVATE_|可以直接固定|保证.{0,12}完工/);
  assert.doesNotMatch(result.text, /从双人长桌|之前双人长桌|原来.{0,3}双人长桌/, 'this fixture never specified the former table type; people and furniture are separate facts');
  if (expectsDrawing) assert.doesNotMatch(result.text, /缺少(?:有效)?点位图|没有(?:有效)?点位图|尚未.{0,6}关联.{0,6}房间/);
  return result;
}
async function main() {
  loadEnvConfig(process.cwd(), true); const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const [{ signMiniProgramToken }, { ConstructionService }, { KnowledgeService }, { ConversationService }, { projectSiteIssues }] = await Promise.all([
    import('@/lib/miniprogram-jwt'), import('@/lib/construction/service'), import('@/lib/assistant/knowledge/service'), import('@/lib/assistant/core/conversation'), import('@/lib/construction/site-issues')]);
  save();
  try {
    await withPlatformTransaction(async tx => {
      const template = await one(tx, sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`);
      assert.ok(template && String(template.code).startsWith('p4b-development-')); const config = template.agent_config as Row;
      assert.equal(config.providerKey, 'deepseek'); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.runtime, 'langgraph-v1');
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 原件投影问答',${prefix},'active') returning id`))!.id);
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
      values(${eid},${uid},'合成原件业主','13800000000','natural') returning id`)))!.id);
    const service = new ConstructionService({ enterpriseId: eid, adminId: staff[0].adminId });
    pid = String((await service.execute('create', { leadId, name: '合成原件问答工地', managerId: staff[0].adminId, rooms: ['书房'] }, randomUUID())).id);
    const pv = async () => Number(((await service.execute('detail', { projectId: pid })).project as Row).version);
    for (const s of staff.slice(1)) await service.execute('member', { projectId: pid, expectedVersion: await pv(), adminId: s.adminId, role: s.role === 'designer' ? 'designer' : 'worker', active: true, workLabel: '' }, randomUUID());
    await service.execute('progress', { projectId: pid, expectedVersion: await pv(), stageKey: 'utilities', note: '合成水电施工阶段，底盒待核对，不代表验收', sendReminder: false }, randomUUID());
    cid = String((await new ConversationService(actor()).create(randomUUID())).id); report.fixture = { ...(report.fixture as Row), leadId, projectId: pid, conversationId: cid }; save();
    await mini('/messages'); for (const s of staff) await http('/api/miniprogram/construction/projects/' + pid + '/chat', s.token);
    const bytes = await sharp({ create: { width: 240, height: 180, channels: 3, background: '#e3e9e2' } }).png().toBuffer();
    fs.writeFileSync(path.join(output, 'synthetic-point-original.png'), bytes); const diagramBase64 = bytes.toString('base64');
    const k = new KnowledgeService({ enterpriseId: eid, adminId: staff[0].adminId });
    const source = await k.execute('create', { title: '合成企业办公点位核对规则', sourceType: 'manual_text', audience: 'customer_public', body:
      '合成企业专业做法：书房办公先核对电脑和台灯的使用位置，再按实际家具尺寸核对通道及插座。双人长桌与独立办公桌应分别核对设备需求，需求更正后不能沿用旧布置。水电阶段底盒固定前，设计师须结合客户有效点位图、现场尺寸和实际家具核对；客户共享图纸只作参考，不等于正式核对或批准。缺图或图内细节未识读时说明待核实，不能据文字说明推断图内精确位置，不能承诺费用和工期。' }, randomUUID());
    did = String((source.document as Row).id); vid = String((source.draft as Row).id); report.knowledge = { documentId: did, versionId: vid }; save();
    const job = await k.execute('index', { documentId: did, versionId: vid, expectedEditVersion: 1 }, randomUUID());
    await wait(async () => { const j = await k.execute('job', { jobId: job.jobId }); if (['failed','cancelled','indeterminate'].includes(String(j.status))) throw Error(JSON.stringify(j)); return j.status === 'succeeded' ? j : false; }, 'real knowledge indexing');
    await k.execute('publish', { documentId: did, versionId: vid, expectedVersion: 1, expectedEditVersion: 1 }, randomUUID());
    const setExpected = (need: string, drawing: boolean) => { expectedNeed = need; expectsDrawing = drawing; };
    const original = async (grantId: string, mediaId: string, status = 200) => {
      const url = '/api/miniprogram/construction/projects/' + pid + '/chat/materials/' + grantId + '/media/' + mediaId;
      const r = await fetch('http://localhost:3006'+url, { headers: { Authorization: 'Bearer '+staff[1].token }, signal: AbortSignal.timeout(30000) });
      assert.equal(r.status, status); assert.match(r.headers.get('cache-control') || '', /no-store/);
      if (status === 200) { const own = await fetch('http://localhost:3006/api/miniprogram/assistant/conversations/'+cid+'/media/'+mediaId, { headers: { Authorization: 'Bearer '+customerToken } }); assert.equal(own.status,200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from(await own.arrayBuffer())); }
    };
    if (native) {
      const driver = await import('./assistant-shared-materials-native.mjs');
      await driver.run({ root, output, projectId: pid, identities: staff, customer: { conversationId: cid, token: customerToken, enterpriseId: eid },
        question: materialQuestion, diagramBase64, audit, materials, setExpected, verifyOriginal: original,
        verify: () => withTenantTransaction(eid, async tx => ({ issues: await projectSiteIssues(tx,eid,pid), events: await rows(tx,sql`select id::text,type from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.site.issue.%' order by id`) })),
        revoke: async () => service.execute('member', { projectId: pid, expectedVersion: await pv(), adminId: staff[1].adminId, role: 'designer', active: false, workLabel: '' }, randomUUID()),
      });
    } else {
      expectedNeed = '靠窗双人办公，电脑和台灯，底盒位置待现场核对。'; await mini('/messages','POST','共享书房需求：'+expectedNeed);
      const media = await http('/api/miniprogram/assistant/conversations/'+cid+'/media',customerToken,'POST',{data:diagramBase64,kind:'image',roomName:''});
      await mini('/messages','POST','共享书房点位图：书桌插座参考图，须结合现场尺寸核对。'); expectsDrawing = true;
      const drawing = (await materials()).data.sources.find(s=>s.ref.type==='shared_drawing')!; await original(drawing.ref.id,String(media.id));
      check('real customer sharing and protected original downloads match exact stored media; synthetic image is not claimed as visually understood');
      for (const scenario of ['effective-original','replaced-need','withdrawn-drawing']) {
        if (scenario === 'replaced-need') { expectedNeed = '改为独立办公桌，仅供本人办公，保留电脑和台灯。'; await mini('/messages','POST','共享书房需求：'+expectedNeed); }
        if (scenario === 'withdrawn-drawing') { await mini('/messages','POST','撤回共享资料'+drawing.ref.id); expectsDrawing = false; await original(drawing.ref.id,String(media.id),404); }
        for (let n=1;n<=2;n++) {const start=Date.now(),sent=await mini('/messages','POST',materialQuestion);await audit(String(sent.runId),scenario+'-'+n,start);}
        check(scenario+': two configured-model answers use current original IDs, exact quotes, effective knowledge and actual stage');
      }
      const before = report.runs as Row[]; const currentNeed = (await materials()).data.sources.find(s=>s.ref.type==='shared_need')!;
      await mini('/messages','POST','撤回共享资料'+currentNeed.ref.id); const history = await mini('/messages');
      for(const r of before) assert.equal(history.items.find((m:Row)=>m.id===r.outputMessageId).available,false);
      check('all six persisted explanations become unavailable after dependent grant replacement/withdrawal; old originals never revive');
    }
    const formal = await withTenantTransaction(eid,tx=>one(tx,sql`select count(*) n from app.domain_event_outbox where enterprise_id=${eid} and (type like 'construction.site.plan.%' or type='construction.site.issue.lifecycle.v1')`));
    assert.equal(Number(formal!.n),0); check('professional explanation creates no formal approval, execution, closure or new permission'); report.passed = true;
  } finally {
    if(eid)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);
      for(const userId of [uid,...staff.map(s=>s.userId)].filter(Boolean))await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
      report.finalState=await one(tx,sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,(select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs`);});
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(e=>{report.error=(e as Error).message;save();console.error((e as Error).message);process.exitCode=1;});
