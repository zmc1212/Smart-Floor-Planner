/** PPT23/38: synthetic business facts, real development HTTP/Worker/configured model. */
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

const root = path.resolve('..'), output = path.join(root, 'tmp/xiaok-team-sources'), native = process.argv.includes('--native');
const prefix = 'synthetic-team-live-' + randomUUID();
export const question = '结合我共享的书房需求、点位图、团队核对和当前正式方案，按企业专业做法解释底盒现在能直接固定吗？请区分图纸关联、这一版的差异和我的真实决定，有不一致的地方也指出来。';
type Expected = { phase: string; review: boolean; versionId: string | null; number?: number; decision?: string; conflict?: boolean };
let expected: Expected = { phase: 'unreviewed', review: false, versionId: null };
const report: Row = { started: new Date().toISOString(), prefix, passed: false, requests: [], runs: [], checks: [],
  preregistered: ['unreviewed: no invented team check or formal version','reviewed: exact returned association changes explanation',
    'pending-v1: exact formal source and pending decision','approved-v1: exact consent, still no execution proof',
    'changed-v2: no inherited consent; conflicting single-person/no-lamp proposal versus two-person/lamp intent',
    'withdrawn: no old version fallback; dependent history and media invalidated'],
  reality: { factsAndMedia: 'clearly labelled synthetic; no real customer or engineering data', http: 'localhost:3006',
    database: 'approved development5432', worker: 'existing real Worker', model: 'configured DeepSeek/deepseek-flash', imagePixels: false, costMicros: null } };
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
  const r = await fetch('http://localhost:3006' + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
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
const base = () => '/api/miniprogram/construction/projects/' + pid + '/chat';
const staffSend = async (index: number, text: string, mediaIds: string[] = []) => {
  const current = await http(base(), staff[index].token);
  return http(base() + '/messages', staff[index].token, 'POST', { text, mediaIds, versions: current.versions });
};
async function audit(runId: string, label: string, started: number) {
  const run = await wait(async () => { const r = await withTenantTransaction(eid, tx => one(tx, sql`select id::text,status,error_code,output_message_id::text
    from app.assistant_runs where enterprise_id=${eid} and id=${runId}`)); return r && !['queued','running'].includes(String(r.status)) ? r : false; }, 'configured-model answer');
  const history = await mini('/messages'), snapshot = await materials(), message = history.items.find((m: Row) => String(m.id) === run.output_message_id);
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,status,source_refs,private_checkpoint,input_summary
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  const citations = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,document_id::text,document_version_id::text,quote_snapshot
    from app.assistant_message_citations where enterprise_id=${eid} and run_id=${runId}`));
  const usage = await withTenantTransaction(eid, tx => rows(tx, sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text
    from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`));
  const result = { runId, label, ...run, elapsedMs: Date.now() - started, expected: { ...expected }, message, text: message ? safeText(message.content) : '',
    steps, citations, usage, currentMaterialSnapshot: snapshot, outputMessageId: String(run.output_message_id), costMicros: null };
  (report.runs as Row[]).push(result); save(); assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(message?.available, true);
  assert.ok(citations.some(c => c.document_id === did && c.document_version_id === vid), 'actual answer cites effective enterprise rule');
  const context = steps.find(s => s.kind === 'agent_synthesis_context')?.source_refs as SynthesisContext;
  const answer = steps.find(s => s.kind === 'agent_synthesis_context')?.private_checkpoint as SynthesisAnswer; assert.ok(context && answer);
  const cited = answer.segments.flatMap(s => s.citations).map(c => context.sources.find(s => s.sourceId === c.sourceId)!);
  assert.ok(cited.some(s => s.material?.ref.type === 'shared_need'), 'actual explanation cites the customer intent');
  assert.ok(context.snapshots.some(s => s.query.domain === 'construction'), 'current real project stage enters the same answer');
  assert.equal(snapshot.data.sources.some(s => s.ref.type === 'team_review'), expected.review);
  if (expected.review) assert.ok(cited.some(s => s.material?.ref.type === 'team_review'), 'actual explanation must use the explicitly returned review');
  const plan = snapshot.data.sources.find(s => s.ref.type === 'formal_plan');
  assert.equal(plan?.ref.id || null, expected.versionId);
  if (plan) {
    assert.equal(plan.formal?.number, expected.number); assert.equal(plan.formal?.decision, expected.decision);
    assert.ok(cited.some(s => s.material?.ref.id === expected.versionId && s.material.ref.type === 'formal_plan'), 'actual explanation cites the exact formal version');
    assert.match(result.text, new RegExp('V' + expected.number));
    assert.match(result.text, expected.decision === 'approved' ? /同意|决定/ : /待.{0,5}(?:决定|确认)|尚未.{0,5}(?:同意|决定)/);
  }
  for (const segment of answer.segments) for (const citation of segment.citations) assert.ok(context.sources.find(s => s.sourceId === citation.sourceId)?.text.includes(citation.quote));
  assert.match(result.text, /核对|复核|核实/); assert.match(result.text, /待核实|待(?:现场)?(?:核对|复核)|需要.{0,20}(?:核对|核实)|仍需.{0,20}(?:核对|核实)/);
  assert.doesNotMatch(result.text, /PRIVATE_|现在可以直接固定|可直接施工|保证.{0,10}完工/);
  if (expected.conflict) { assert.match(result.text, /双人/); assert.match(result.text, /单人/); assert.match(result.text, /台灯/); assert.match(result.text, /不一致|冲突|不符|差异/); }
  return result;
}
async function main() {
  loadEnvConfig(process.cwd(), true); const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const [{ signMiniProgramToken }, { ConstructionService }, { ConversationService }, { KnowledgeService }] = await Promise.all([
    import('@/lib/miniprogram-jwt'), import('@/lib/construction/service'), import('@/lib/assistant/core/conversation'), import('@/lib/assistant/knowledge/service')]);
  save();
  try {
    await withPlatformTransaction(async tx => {
      const template = await one(tx, sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`);
      assert.ok(template && String(template.code).startsWith('p4b-development-')); const config = template.agent_config as Row;
      assert.equal(config.providerKey, 'deepseek'); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.runtime, 'langgraph-v1');
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 团队核对与正式来源问答',${prefix},'active') returning id`))!.id);
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
    pid = String((await service.execute('create', { leadId, name: '合成核对问答工地', managerId: staff[0].adminId, rooms: ['书房'] }, randomUUID())).id);
    const pv = async () => Number(((await service.execute('detail', { projectId: pid })).project as Row).version);
    for (const s of staff.slice(1)) await service.execute('member', { projectId: pid, expectedVersion: await pv(), adminId: s.adminId, role: s.role === 'designer' ? 'designer' : 'worker', active: true, workLabel: '' }, randomUUID());
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
      const response = await fetch('http://localhost:3006' + base() + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + staff[1].token, 'Idempotency-Key': randomUUID() }, body: form });
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
      const { run } = await import('./assistant-team-materials-native.mjs');
      await run({ root, output, projectId: pid, identities: staff, customer: { conversationId: cid, token: customerToken, enterpriseId: eid }, question,
        diagramBase64, audit, materials, setExpected, planText, setIssue: (id: string) => { issueId = id; },
        verify: async () => { const data = await http(base(), staff[0].token); return { data, issues: data.issues, events: [] }; },
        revoke: async () => service.execute('member', { projectId: pid, expectedVersion: await pv(), adminId: staff[1].adminId, role: 'designer', active: false, workLabel: '' }, randomUUID()),
      });
    } else {
      await mini('/messages', 'POST', '共享书房需求：靠窗双人办公，电脑和台灯，具体尺寸待核对。');
      await http('/api/miniprogram/assistant/conversations/' + cid + '/media', customerToken, 'POST', { data: diagramBase64, kind: 'image', roomName: '' });
      await mini('/messages', 'POST', '共享书房点位图：客户参考图，图内尺寸尚未核实。');
      const record = await staffSend(2, '书房底盒还没固定，PRIVATE_INTERNAL_ORIGINAL 等设计师核对位置。');
      await wait(async () => { const r = await http(base(), staff[0].token); return r.items.some((i: Row) => (i.record as Row | null)?.id === record.recordId && (i.record as Row).status === 'draft') ? true : false; }, 'real site draft');
      issueId = String((await staffSend(0, '跟进记录' + record.recordId)).issueId); await staffSend(1, '接手事项' + issueId);
      await staffSend(1, '回复事项' + issueId + '：PRIVATE_UNRETURNED_REPLY 具体安装尺寸仍待现场核对。');
      const drawing = (await materials()).data.sources.find(s => s.ref.type === 'shared_drawing')!;
      let first = '', second = '';
      for (const phase of ['unreviewed','reviewed','pending-v1','approved-v1','changed-v2','withdrawn']) {
        if (phase === 'reviewed') { await staffSend(1, `核对事项${issueId}图纸${drawing.ref.id}`); await staffSend(0, `回传事项${issueId}：图纸已按本项目书房核对关联，现场尺寸仍待复核。`);
          await wait(async () => (await materials()).data.sources.some(s => s.ref.type === 'team_review'), 'explicit returned drawing check'); setExpected({ phase, review: true, versionId: null }); }
        if (phase === 'pending-v1') { first = await publish(); setExpected({ phase, review: true, versionId: first, number: 1, decision: 'pending_customer' }); }
        if (phase === 'approved-v1') { await decide(first, 'preview'); await decide(first, 'approve'); setExpected({ phase, review: true, versionId: first, number: 1, decision: 'approved' }); }
        if (phase === 'changed-v2') { second = await publish(true); setExpected({ phase, review: true, versionId: second, number: 2, decision: 'pending_customer', conflict: true }); }
        if (phase === 'withdrawn') { await staffSend(1, `撤回方案${second}：单人及取消台灯与客户需求不一致，重新核对`); setExpected({ phase, review: true, versionId: null }); }
        for (let n = 1; n <= 2; n++) {
          for (let attempt = 0; attempt < 2; attempt++) {
            const started = Date.now(), sent = await mini('/messages', 'POST', question);
            try { await audit(String(sent.runId), phase + '-' + n, started); break; }
            catch (error) {
              const failed = (report.runs as Row[]).find(r => r.runId === String(sent.runId));
              if (attempt || failed?.status !== 'indeterminate' || failed.error_code !== 'provider_outcome_unknown') throw error;
              // A new synthetic read-only question, never a retry of the old run,
              // provider attempt, idempotency key, decision or business write.
              const retries = (report.acceptanceRetries ||= []) as Row[];
              retries.push({ oldRunId: String(sent.runId), phase, case: n, reason: 'provider_outcome_unknown',
                action: 'new synthetic read-only question; original unknown run untouched', time: new Date().toISOString() }); save();
            }
          }
        }
        check(phase + ': two actual configured-model explanations checked against current sources');
      }
      await mini('/messages', 'POST', '撤回共享资料' + drawing.ref.id);
      const allMessages: Row[] = []; let before = '';
      for (let page = 0; page < 10; page++) {
        const history = await mini('/messages?limit=100' + (before ? '&beforeSeq=' + before : ''));
        allMessages.push(...history.items); if (!history.nextCursor) break;
        assert.notEqual(history.nextCursor, before); before = history.nextCursor;
      }
      for (const r of report.runs as Row[]) assert.equal(allMessages.find((m: Row) => m.id === r.outputMessageId)?.available, false);
      check('reference withdrawal invalidates all persisted dependent explanations; no old formal source revives');
    }
    report.formalAudit = await withTenantTransaction(eid, tx => rows(tx, sql`select type,count(*)::int as count from app.domain_event_outbox where enterprise_id=${eid}
      and (type like 'construction.plan.%' or type='construction.site.issue.lifecycle.v1') group by type order by type`));
    assert.ok(!(report.formalAudit as Row[]).some(r => r.type === 'construction.site.issue.lifecycle.v1'), 'ordinary explanations do not implement, resolve or close the issue');
    report.passed = true;
  } finally {
    if (eid) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);
      for (const userId of [uid,...staff.map(s => s.userId)].filter(Boolean)) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
      report.finalState = await one(tx, sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,
        (select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs,
        (select count(*) from app.assistant_jobs where enterprise_id=${eid} and status in ('queued','running')) active_jobs`);
    });
    report.finished = new Date().toISOString(); save(); await closePostgresPool();
  }
}
main().catch(e => { report.error = (e as Error).message; save(); console.error((e as Error).message); process.exitCode = 1; });
