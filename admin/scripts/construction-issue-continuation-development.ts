/** Synthetic development-only PPT17/20/23/24/36/38 continuation, real HTTP/Worker/model. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';

const root = path.resolve('..'), output = path.join(root, 'tmp/xiaok-issue-continuation');
const native = process.argv.includes('--native'), prefix = 'synthetic-issue-live-' + randomUUID();
export const continuationQuestion = '书房底盒核对这件事现在在等谁？结合双人办公的企业做法，下一步该核对什么，是否可以直接固定底盒？';
const report: Row = { started: new Date().toISOString(), prefix, checks: [], requests: [], runs: [], passed: false,
  scope: 'P4A explicit same-issue cancellation/recovery and authorized return plus knowledge/site synthesis; synthetic facts, no actual engineering approval',
  reality: { database: 'approved development5432', model: 'existing configured DeepSeek/deepseek-flash', worker: 'existing real Worker', semanticReview: 'separate evidence review, not human acceptance' } };
const save = () => { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, native ? 'native-driver.json' : 'live.json'), JSON.stringify(report, null, 2)); };
const check = (name: string) => { (report.checks as Row[]).push({ name, passed: true }); save(); console.log('PASS ' + name); };
async function wait<T>(read: () => Promise<T | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 300; i++) { const v = await read(); if (v) return v; await new Promise(r => setTimeout(r, 500)); }
  throw Error('Timed out: ' + label);
}
let eid = '', uid = '', pid = '', cid = '', did = '', vid = '', customerToken = '';
let issueId = '', state = 'cancelled';
const staff: { adminId: string; userId: string; role: 'enterprise_admin' | 'designer' | 'construction_staff'; token: string; enterpriseId: string }[] = [];
async function http(url: string, token: string, method = 'GET', body?: unknown, expected = 200, key = randomUUID()) {
  const r = await fetch('http://localhost:3006' + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const j = await r.json(); (report.requests as Row[]).push({ url, method, status: r.status, noStore: r.headers.get('cache-control') }); save();
  assert.equal(r.status, expected, JSON.stringify(j)); assert.match(r.headers.get('cache-control') || '', /no-store/); return j.data;
}
const mini = (suffix: string, method = 'GET', text?: string) => {
  const key = randomUUID();
  return http('/api/miniprogram/assistant/conversations/' + cid + suffix, customerToken, method,
    text ? { clientMessageId: key, content: { version: 1, blocks: [{ type: 'text', text }] } } : undefined, method === 'POST' ? 202 : 200, key);
};
async function command(text: string, index = 0, key = randomUUID(), versions?: Row) {
  const base = '/api/miniprogram/construction/projects/' + pid + '/chat';
  return http(base + '/messages', staff[index].token, 'POST', { text, mediaIds: [], versions: versions || (await http(base, staff[index].token)).versions }, 200, key);
}
async function runState(runId: string) {
  return wait(async () => { const run = await withTenantTransaction(eid, tx => one(tx, sql`select r.id::text,r.status,r.error_code,r.output_message_id::text,m.content
    from app.assistant_runs r left join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id
    where r.enterprise_id=${eid} and r.id=${runId}`)); return run && !['queued','running'].includes(String(run.status)) ? run : false; }, 'real Worker run');
}
async function audit(runId: string, label: string, started: number) {
  const run = await runState(runId), history = await mini('/messages');
  const message = history.items.find((m: Row) => String(m.id) === String(run.output_message_id));
  const citations = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,document_id::text,document_version_id::text,quote_snapshot
    from app.assistant_message_citations where enterprise_id=${eid} and run_id=${runId}`));
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,status,input_summary,source_refs,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  const usage = await withTenantTransaction(eid, tx => rows(tx, sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text
    from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`));
  const result = { runId, label, expectedState: state, issueId, elapsedMs: Date.now()-started, ...run, message, citations, steps, usage, costMicros: null,
    outputMessageId: String(run.output_message_id), text: message ? safeText(message.content) : '' };
  (report.runs as Row[]).push(result); save(); assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(message?.available, true);
  assert.ok(citations.some(c => c.document_id === did && c.document_version_id === vid), 'must cite current enterprise knowledge');
  assert.ok(steps.some(s => s.kind === 'agent_synthesis_context'), 'must synthesize professional evidence, not just return a status');
  const { queryNeedIssues } = await import('@/lib/construction/need-issues');
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  const current = (await withTenantTransaction(eid, tx => queryNeedIssues(tx, actor, cid))).data.find(i => i.issueId === issueId)!;
  assert.equal(current.status, state); assert.equal(current.waitingFor, state === 'cancelled' ? 'none' : 'team');
  const dependencies = steps.filter(s => s.kind === 'agent_construction_context').flatMap(s => s.source_refs as string[] || []);
  assert.ok(dependencies.includes(current.sourceMessageId!), 'same returned issue must join revocable construction provenance');
  assert.match(result.text, /底盒|点位/); assert.match(result.text, /核对|复核/); assert.match(result.text, /双人|电脑|通道/);
  assert.match(result.text, state === 'cancelled' ? /取消|暂缓/ : /设计师|等待团队|待.*核对/);
  assert.doesNotMatch(result.text, /PRIVATE_INTERNAL_REPLY|PRIVATE_ISSUE_KNOWLEDGE|可以直接固定|已(?:经)?批准固定|保证.{0,12}完工/);
  return result;
}
async function main() {
  loadEnvConfig(process.cwd(), true);
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const [{ signMiniProgramToken }, { ConstructionService }, { KnowledgeService }, { ConversationService }, { deliverSiteResults }, { projectSiteIssues }] = await Promise.all([
    import('@/lib/miniprogram-jwt'), import('@/lib/construction/service'), import('@/lib/assistant/knowledge/service'),
    import('@/lib/assistant/core/conversation'), import('@/lib/construction/site-results'), import('@/lib/construction/site-issues')]);
  save();
  try {
    await withPlatformTransaction(async tx => {
      const template = await one(tx, sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`);
      assert.ok(template && String(template.code).startsWith('p4b-development-')); const config = template.agent_config as Row;
      assert.equal(config.providerKey, 'deepseek'); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.runtime, 'langgraph-v1');
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 同事项取消恢复',${prefix},'active') returning id`))!.id);
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
    report.fixture = { enterpriseId: eid, userId: uid, staff: staff.map(({ adminId,userId,role }) => ({ adminId,userId,role })) }; save();
    for (const s of staff) s.token = await signMiniProgramToken({ sub: s.userId, id: s.userId, mode: 'staff', role: s.role, staffRole: s.role,
      staffId: s.adminId, enterpriseId: eid, contextVersion: 1, source: 'phone' });
    customerToken = await signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
    const leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${uid},'合成持续服务业主','13800000000','natural') returning id`)))!.id);
    const service = new ConstructionService({ enterpriseId: eid, adminId: staff[0].adminId });
    pid = String((await service.execute('create', { leadId, name: '合成同事项连续工地', managerId: staff[0].adminId, rooms: ['书房'] }, randomUUID())).id);
    const version = async () => Number(((await service.execute('detail', { projectId: pid })).project as Row).version);
    for (const s of staff.slice(1)) await service.execute('member', { projectId: pid, expectedVersion: await version(), adminId: s.adminId, role: s.role === 'designer' ? 'designer' : 'worker', active: true, workLabel: '' }, randomUUID());
    await service.execute('progress', { projectId: pid, expectedVersion: await version(), stageKey: 'utilities', note: '合成水电施工阶段，不代表验收', sendReminder: false }, randomUUID());
    const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
    cid = String((await new ConversationService(actor).create(randomUUID())).id); report.fixture = { ...(report.fixture as Row), projectId: pid, leadId, conversationId: cid }; save();
    await mini('/messages'); await mini('/messages', 'POST', '共享书房需求：靠窗双人办公，电脑和台灯；底盒位置仍需现场尺寸核对。');
    for (const s of staff) await http('/api/miniprogram/construction/projects/' + pid + '/chat', s.token);
    check('real customer and three staff HTTP identities, explicit shared excerpt and actual project stage');
    const k = new KnowledgeService({ enterpriseId: eid, adminId: staff[0].adminId });
    const source = await k.execute('create', { title: '合成企业双人办公核对做法', sourceType: 'manual_text', audience: 'customer_public',
      body: '合成企业专业做法：书房双人办公先核对电脑和台灯的使用位置，再结合实际家具尺寸核对通道与点位图。底盒固定前须由设计师结合现场尺寸核对；资料缺失时先补齐，不凭房间名称或一句恢复跟进认定点位已获批准。取消跟进只是本次处理安排暂停；恢复后仍需重新核对，旧回复、图纸核对和正式决定不自动恢复。' }, randomUUID());
    did = String((source.document as Row).id); vid = String((source.draft as Row).id); report.knowledge = { documentId: did, versionId: vid }; save();
    const job = await k.execute('index', { documentId: did, versionId: vid, expectedEditVersion: 1 }, randomUUID());
    await wait(async () => { const j = await k.execute('job', { jobId: job.jobId }); if (['failed','cancelled','indeterminate'].includes(String(j.status))) throw Error(JSON.stringify(j)); return j.status === 'succeeded' ? j : false; }, 'real knowledge indexing');
    await k.execute('publish', { documentId: did, versionId: vid, expectedVersion: 1, expectedEditVersion: 1 }, randomUUID());
    const verify = () => withTenantTransaction(eid, async tx => ({ issues: await projectSiteIssues(tx, eid, pid),
      events: await rows(tx, sql`select id::text,type,aggregate_id,aggregate_version,payload from app.domain_event_outbox where enterprise_id=${eid}
        and type in ('construction.site.issue.opened.v1','construction.site.issue.progress.v1') order by id`) }));
    if (native) {
      const driver = await import('./construction-issue-continuation-native.mjs');
      await driver.run({ root, output, projectId: pid, identities: staff, customer: { conversationId: cid, token: customerToken, enterpriseId: eid },
        question: continuationQuestion, audit, setIssue: (id: string, next: string) => { issueId = id; state = next; }, deliver: deliverSiteResults,
        verify, retire: () => k.execute('retire', { documentId: did, expectedVersion: 2 }, randomUUID()),
        revoke: async () => service.execute('member', { projectId: pid, expectedVersion: await version(), adminId: staff[1].adminId, role: 'designer', active: false, workLabel: '' }, randomUUID()),
      });
    } else {
      const original = await command('书房线管已铺好，底盒尚未固定，等设计师核对位置。', 2); const originalRun = await runState(String(original.runId));
      assert.equal(originalRun.status, 'succeeded');
      issueId = String((await command('跟进记录' + original.recordId + '：底盒待核对', 2)).issueId);
      await command('转交事项' + issueId + '给合成设计师'); await command('回复事项' + issueId + '：PRIVATE_INTERNAL_REPLY 现场尺寸未确认，不得直接固定。', 1);
      await command('取消事项' + issueId + '：暂缓本次核对，未安排施工。');
      await command('回传事项' + issueId + '：已取消本次底盒核对跟进，当前没有待执行安排；可由有权人员沿原事项恢复。'); await deliverSiteResults();
      for (let n = 1; n <= 2; n++) { const start = Date.now(), sent = await mini('/messages', 'POST', continuationQuestion); await audit(String(sent.runId), 'cancelled-' + n, start); }
      check('two configured-model answers combine effective knowledge with the cancelled issue and no executing assignment');
      const prior = await verify(); const versions = (await http('/api/miniprogram/construction/projects/' + pid + '/chat', staff[0].token)).versions;
      const raw = '恢复事项' + issueId + '：继续按当前资料重新核对', key = randomUUID();
      const restored = await command(raw, 0, key, versions); assert.deepEqual(await command(raw, 0, key, versions), restored); state = 'awaiting_owner';
      await command('回传事项' + issueId + '：已沿原事项恢复，当前由合成设计师重新核对，尚无正式点位批准。'); await deliverSiteResults();
      for (let n = 1; n <= 2; n++) { const start = Date.now(), sent = await mini('/messages', 'POST', continuationQuestion); await audit(String(sent.runId), 'restored-' + n, start); }
      const after = await verify(); assert.equal(after.issues.length, prior.issues.length); assert.equal(after.issues[0].issueId, issueId); assert.equal(after.issues[0].progressMessageId, null);
      check('same original issue restores once; two real answers use current waiting party without resurrecting private replies or approval');
      await k.execute('retire', { documentId: did, expectedVersion: 2 }, randomUUID());
      const history = await mini('/messages'); for (const r of report.runs as Row[]) assert.equal(history.items.find((m: Row) => String(m.id) === String(r.outputMessageId)).available, false);
      check('withdrawal revokes all four derived customer answers on real HTTP reentry');
    }
    report.issueId = issueId; report.finalEvents = (await verify()).events;
    report.passed = true;
  } finally {
    if (eid) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);
      for (const id of [uid, ...staff.map(s => s.userId)].filter(Boolean)) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${id}`);
      report.finalState = await one(tx, sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,
        (select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs`);
    });
    report.finished = new Date().toISOString(); save(); await closePostgresPool();
  }
}
main().catch(e => { report.error = (e as Error).message; save(); console.error((e as Error).message); process.exitCode = 1; });
