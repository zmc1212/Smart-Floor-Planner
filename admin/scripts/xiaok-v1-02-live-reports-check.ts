/** Fixed configured-model report batch. Existing local Worker processes real
 * persisted jobs; this script never injects model answers or retries a failure. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AdminUserRepository } from '@/db/repositories/admin-user-repository';
import { MiniProgramIdentityRepository } from '@/db/repositories/miniprogram-identity-repository';
import { UserRepository } from '@/db/repositories/user-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, cancelRuns } from '@/lib/assistant/core/conversation';
import { assistantDailyLimitsEnabled } from '@/lib/assistant/core/daily-limits';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { enqueueReport, enqueueReportCorrection } from '@/lib/construction/report-store';
import { latestReportPeriod, nextReportAt } from '@/lib/construction/report-calendar';
import type { ReportFacts } from '@/lib/construction/report-scope';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development') && process.argv.includes('--configured-model'));
const root = path.resolve('..'), eid = '1454';
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
assert.equal(assistantDailyLimitsEnabled(), false, 'Bind the user-confirmed unlimited daily admission setting');
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-live-reports/configured-01');
const native = process.argv.includes('--stable');
const weeklyStages = process.argv.includes('--weekly-stages');
const stageReminders = process.argv.includes('--stage-reminders');
assert.ok(!stageReminders || !weeklyStages);
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain every original attempt');
fs.mkdirSync(output, { recursive: true });
const prefix = 'synthetic-v1-02-live-' + randomUUID();
const users: string[] = [], admins: string[] = [], leads: string[] = [], projects: string[] = [], records: string[] = [], bindings: Row[] = [];
const staffUsers: string[] = [];
let unrelatedBindingIds: string[] = [];
const log: Row = { startedAt: new Date().toISOString(), prefix, owner: process.env.CODEX_THREAD_ID,
  scope: stageReminders ? 'Current stage reminder bodies and private readback; lifecycle scheduling is checked separately' : 'Configured-model daily/weekly report bodies only; scheduled discovery/native/follow-up evidence is not upgraded by this batch',
  fixedScope: { audiences: ['customer','customer','worker','designer','boss'], projects: 2, kinds: stageReminders ? ['stage'] : weeklyStages ? ['weekly'] : ['daily','weekly'],
    ...(stageReminders ? { stages: 'A: installation following masonry; B: utilities' } : {}),
    ...(weeklyStages ? { stages: 'A: masonry waterproofing then installation; B: utilities' } : {}),
    firstDraftsPerCase: stageReminders ? 1 : 2, maxBodyRuns: stageReminders ? 8 : weeklyStages ? 10 : 20,
    ...(stageReminders ? {} : { secondDraft: 'preplanned independent correction revision with unchanged original facts, never retry after failure' }),
    stop: 'first failed/indeterminate body, source/configuration drift or unavailable original source',
    reused: 'Existing scheduler, fact-worker, private destination, native components, permissions and revocation evidence at their unchanged scopes' },
  checks: [], attempts: [], fixture: { users, admins, leads, projects, records, bindings: [] }, ingestionCalls: 0, injectedModelCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(log, null, 2));
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const files = execFileSync('rg', ['--files','admin/src/lib/assistant','admin/src/lib/construction','admin/src/lib/ai','admin/src/db','admin/drizzle','miniprogram'],
  { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\','/'));
files.push('admin/src/lib/platform-llm-config.ts','admin/src/lib/platform-llm-profile.ts','admin/src/app/api/internal/assistant/jobs/run/route.ts',
  'admin/scripts/assistant-worker.mjs','admin/scripts/xiaok-v1-02-live-reports-check.ts','admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/.env.local','tmp/xiaok-vector/connection.private.json');
if (native) files.push('admin/scripts/xiaok-v1-02-live-reports-native.cjs','admin/scripts/wechatide-native-client.ts',
  'tmp/wechat-devtools-version-test/window.ps1','tmp/v1-02-conversation-list-visual/inspect-window.ps1',
  'D:/微信开发工具/微信web开发者工具/resources/app.asar','D:/微信开发工具/微信web开发者工具/微信开发者工具.exe');
const binding = () => Object.fromEntries([...new Set(files)].filter(p => fs.existsSync(path.resolve(root,p))).sort()
  .map(p => [p, createHash('sha256').update(fs.readFileSync(path.resolve(root,p))).digest('hex')]));
let before: ReturnType<typeof binding>, release: (() => Promise<void>) | undefined, policy: Row | undefined;
let owner: ConstructionService, plan: ConstructionReportService;
const actor = (b: Row): ActorContext => ({ enterpriseId: eid, principal: b.user_id
  ? { kind: 'user', userId: String(b.user_id) } : { kind: 'admin', adminId: String(b.admin_id) },
  contextVersion: b.user_id ? 1 : 0, capabilities: ['assistant.followup.self'] });
const config = () => read(async tx => ({
  settings: await one(tx, sql`select enabled,agent_config,knowledge_epoch,active_index_profile_id::text from app.assistant_enterprise_settings where enterprise_id=${eid}`),
  provider: await one(tx, sql`select md5(llm_config::text) hash from app.platform_configs where key='default'`),
  published: await rows(tx, sql`select id::text,status,published_version_id::text from app.assistant_knowledge_documents where enterprise_id=${eid} and id in (404,405) order by id`),
}));
const originalLedger = () => read(async tx => ({
  unknown: await one(tx, sql`select id::text,status,input_tokens::text,error_code from app.assistant_knowledge_attempts where enterprise_id=${eid} and id=3753`),
  reservations: await rows(tx, sql`select id::text,run_id::text,version,status,reserved_tokens::text,settled_tokens::text,settled_cost_micros::text
    from app.assistant_quota_reservations where enterprise_id=${eid} and id<=1591 and status='reconciling' order by id`),
}));
const unrelatedDestinations = () => read(tx=>rows(tx,sql`select b.id::text,md5(row_to_json(b)::text) binding_hash,
  (select md5(coalesce(string_agg(md5(row_to_json(m)::text),',' order by m.id),'')) from app.assistant_messages m
    where m.enterprise_id=b.enterprise_id and m.conversation_id=b.conversation_id) message_hash
  from app.construction_followup_bindings b where b.enterprise_id=${eid}
    and ${JSON.stringify(unrelatedBindingIds)}::jsonb ? b.id::text order by b.id`));
function checkBinding() {
  const after = binding(), drift = [...new Set([...Object.keys(before),...Object.keys(after)])].filter(p => before[p] !== after[p]);
  fs.writeFileSync(path.join(output,'binding.json'),JSON.stringify({ before,after,drift },null,2));
  assert.deepEqual(drift, []); log.drift = drift;
}
async function step(name: string, work: () => Promise<unknown>) {
  try { const data = await work(); (log.checks as Row[]).push({ name,passed:true,data }); }
  catch(e) { (log.checks as Row[]).push({ name,passed:false,error:(e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + ((log.checks as Row[]).at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
async function original(pid: string, data: Row, audience: 'customer' | 'internal') {
  const staff = new SiteChatService({ enterpriseId:eid,adminId:admins[1] });
  const r = await staff.withWriteScope(pid,async(tx,c)=>{
    const m = await appendMessage(tx,staff.actor,String(c.id),{author:'admin',clientMessageId:randomUUID(),purpose:'site.source',
      content:{version:1,blocks:[{type:'text',text:[data.completed,data.pending,data.coordination].filter(Boolean).join('。')}]}});
    const row = (await one(tx,sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
      values(${eid},${pid},${String(c.id)},${String(m.id)},${admins[1]},'draft',${JSON.stringify({title:'合成实模验收·水电原记录',roomId:null,note:'标记合成现场输入，不是模型完成记录',...data})}::jsonb) returning *`))!;
    await recordVersion(tx,eid,row,admins[1],'organized'); return row;
  });
  records.push(String(r.id)); save();
  await new SiteChatService(owner.actor).mutate(pid,String(r.id),'publish',{expectedVersion:Number(r.version),audience},randomUUID());
}
async function waitReport(id: string, revision: number, b: Row) {
  const started = Date.now();
  while (Date.now()-started<300000) {
    const state = await read(tx=>one(tx,sql`select v.*,r.kind,body.status body_status,body.error_code body_error
      from app.construction_report_versions v join app.construction_reports r on r.enterprise_id=v.enterprise_id and r.id=v.report_id
      left join app.assistant_runs body on body.enterprise_id=v.enterprise_id and body.id=v.body_run_id
      where v.enterprise_id=${eid} and v.report_id=${id} and v.revision=${revision}`));
    assert.ok(state);
    if (['failed','indeterminate','cancelled'].includes(String(state.status)) || state.knowledge_status==='failed' || ['failed','indeterminate','cancelled'].includes(String(state.body_status))) {
      log.failedBody = { reportId:id,revision,state }; save(); throw Error('Original report body failed: '+String(state.body_error || state.body_error_code || state.status));
    }
    if (state.knowledge_status==='ready' && state.body_status==='succeeded') {
      const service = new FollowupService(actor(b));
      const detail = await service.detail(String(b.id),id,revision) as unknown as Row;
      if (detail.available && detail.deliveryState==='delivered') return { state,detail };
      // Public service saves delivery independently; allow existing Worker to finish it.
      if (!stageReminders && detail.available && (await read(tx=>one(tx,sql`select id from app.construction_report_deliveries where enterprise_id=${eid} and report_id=${id} and revision=${revision}`)))) return {state,detail};
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('Owned report did not finish within fixed 300s; retain its original result and usage');
}
async function main() {
  const control = JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL;
  release = await lockAssistantAcceptance(control,{waitForLock:true});
  before = binding();
  assert.equal((await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n,0);
  log.configurationBefore = await config(); log.originalLedgerBefore = await originalLedger();
  assert.equal(((log.configurationBefore as Row).settings as Row).enabled,true);
  assert.deepEqual(((log.configurationBefore as Row).published as Row[]).map(p=>[p.id,p.status,p.published_version_id]),[['404','active','410'],['405','active','411']]);
  await step('fresh labelled four-end fixtures, real stage writes and publication',async()=>{
    const others = await read(tx=>rows(tx,sql`select a.id,b.id::text binding_id,b.status from app.admin_users a left join app.construction_followup_bindings b
      on b.enterprise_id=a.enterprise_id and b.principal_key='admin:'||a.id::text and b.audience='boss'
      where a.enterprise_id=${eid} and a.status='active' and a.role='enterprise_admin'`));
    assert.ok(others.every(a=>a.binding_id), 'Do not create a new unrelated owner destination');
    unrelatedBindingIds=others.map(a=>String(a.binding_id));
    log.unrelatedDestinationsBefore=await unrelatedDestinations(); save();
    await withPlatformTransaction(async tx=>{
      for(let i=0;i<2;i++) {
        users.push(String((await one(tx,sql`insert into app.users(nickname,phone,context_version) values(${prefix+':customer:'+i},${'139'+String(Date.now()).slice(-7)+i},1) returning id`))!.id));
        await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+':openid:'+i})`);
      }
      for(const role of ['enterprise_admin','construction_staff','designer']) admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
        values(${eid},${prefix+':'+role},${'合成实模验收·'+role},'unusable-local-fixture',${role},'active',false) returning id`))!.id));
    }); save();
    owner = new ConstructionService({enterpriseId:eid,adminId:admins[0]}); plan = new ConstructionReportService(owner.actor);
    policy = await plan.settings(); log.reportPolicyBefore=policy; save(); assert.equal(policy.enabled,false);
    for(let i=0;i<2;i++) {
      leads.push(String((await read(tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${eid},${users[i]},${prefix+':lead:'+i},${'138'+String(Date.now()).slice(-7)+i},'natural') returning id`)))!.id));
      const pid = String((await owner.execute('create',{leadId:leads[i],name:'合成实模验收·'+(stageReminders ? '阶段提醒' : weeklyStages ? '跨阶段' : '水电')+(i?'乙户':'甲户'),managerId:admins[1],rooms:['厨房']},randomUUID())).id);
      projects.push(pid); save();
      let p = (await owner.execute('detail',{projectId:pid})).project as Row;
      await owner.execute('member',{projectId:pid,expectedVersion:p.version,adminId:admins[2],role:'designer',active:true,workLabel:'合成实模验收'},randomUUID());
      p = (await owner.execute('detail',{projectId:pid})).project as Row;
      const waterproof = (weeklyStages || stageReminders) && i === 0;
      await owner.execute('progress',{projectId:pid,expectedVersion:p.version,stageKey:waterproof ? 'masonry_carpentry' : 'utilities',note:'合成实模验收：团队记录当前阶段',sendReminder:false},randomUUID());
      await original(pid,waterproof ? {title:'合成实模验收·卫生间防水原记录',completed:'卫生间基层已查看',pending:'防水前请先核对管根处理和闭水条件',coordination:''}
        : i ? {completed:'卧室照明回路已核对',pending:'客厅双控开关位置待业主确认',coordination:''}
        : {completed:'厨房线路走向已核对',pending:'厨房台面插座位置待业主确认',coordination:'镜前灯电源位置待设计师核对'},'customer');
      if(waterproof) {
        p = (await owner.execute('detail',{projectId:pid})).project as Row;
        await owner.execute('progress',{projectId:pid,expectedVersion:p.version,stageKey:'installation',note:'合成实模验收：已进入安装节点',sendReminder:false},randomUUID());
        await original(pid,{title:'合成实模验收·安装原记录',completed:'安装位置已与现场对照',pending:'台盆安装位置请业主再核对',coordination:''},'customer');
      }
    }
    await original(projects[0],{completed:'',pending:'内部交接标记：蓝色工具箱未交接',coordination:''},'internal');
    await plan.configure({expectedVersion:Number(policy.version),enabled:true,stageEnabled:stageReminders,dailyTime:'23:59',weeklyTime:'23:59',
      projectIds:projects,stageKeys:stageReminders ? ['utilities','installation'] : weeklyStages ? ['utilities','installation','masonry_carpentry'] : ['utilities'],audiences:['customer','worker','designer','boss']},randomUUID());
    bindings.push(...await read(tx=>rows(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid}
      and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]})) order by id`)));
    assert.deepEqual(bindings.map(b=>b.audience).sort(),['boss','customer','customer','designer','worker']);
    (log.fixture as Row).bindings=bindings.map(b=>({id:String(b.id),conversationId:String(b.conversation_id),audience:b.audience,userId:b.user_id,adminId:b.admin_id})); save();
    return {projects,records,bindings:bindings.length,dailyLimitsEnforced:false};
  });
  // Isolate body semantics from the already-covered scheduling matrix. The
  // original automatic enqueue path is reused with fixed controlled periods.
  const dailyAt = new Date(Date.now()+86400000), weeklyAt = nextReportAt('weekly',dailyAt,'08:00');
  const weekly = latestReportPeriod('weekly',weeklyAt,'08:00');
  const periods = stageReminders ? await read(async tx => {
    const result = [];
    for (const projectId of projects) {
      const event = (await one(tx, sql`select id,created_at from app.domain_event_outbox where enterprise_id=${eid}
        and aggregate_id=${projectId} and type='construction.stage.updated.v1' order by aggregate_version desc limit 1`))!;
      const at = new Date(String(event.created_at));
      result.push({kind:'stage' as const, start:at, end:at, cutoff:new Date(+at+1), scheduledAt:at, stageEventId:String(event.id), projectId});
    }
    return result;
  }) : weeklyStages ? [weekly] : [latestReportPeriod('daily',new Date(new Date().toISOString().slice(0,10)+'T15:59:00Z'),'23:59'),weekly];
  for(const period of periods) for(const b of bindings) {
    if ('projectId' in period && b.audience==='customer' && String(b.project_id)!==period.projectId) continue;
    let current: Row | undefined;
    for(let trial=1;trial<=(stageReminders ? 1 : 2);trial++) await step(`${period.kind}/${b.audience}/${b.id} first draft ${trial}`,async()=>{
      checkBinding(); assert.deepEqual(await config(),log.configurationBefore);
      const queued = await read(async tx=>{
        const settings = (await one(tx,sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`))!;
        return trial===1 ? enqueueReport(tx,eid,b,settings,period) : enqueueReportCorrection(tx,eid,current!,settings,period.end);
      }); assert.ok(queued);
      const id = String(queued.reportId), revision = Number(queued.revision);
      const attempt: Row = {trial,kind:period.kind,audience:b.audience,bindingId:String(b.id),...queued,startedAt:new Date().toISOString()};
      (log.attempts as Row[]).push(attempt); save();
      const result = await waitReport(id,revision,b); attempt.result=result; attempt.finishedAt=new Date().toISOString(); save();
      current = await read(tx=>one(tx,sql`select * from app.construction_reports where enterprise_id=${eid} and id=${id}`));
      assert.equal(result.state.body_status,'succeeded');
      assert.equal(result.detail.contentStatus,'composed');
      const composed = result.detail.body as Array<{ projectId: string; guidance: Array<{ basis: string; text: string }>;
        standards: Array<{ basis: string; text: string; citations: Array<{ sourceId: string; quote: string }> }>;
        knowledgeSources: Array<{ sourceId: string }> }>;
      if ('projectId' in period) {
        const expectedKey = period.projectId===projects[0] ? 'installation' : 'utilities';
        const [project] = composed;
        assert.deepEqual(composed.map(p=>p.projectId),[period.projectId]);
        const [fact] = (result.detail.facts as ReportFacts).projects;
        assert.equal(fact.stageKey,expectedKey);
        assert.deepEqual(fact.stageEvents.map(e=>e.id),[period.stageEventId]);
        assert.equal(result.detail.deliveryState,'delivered');
        if (expectedKey==='installation') {
          assert.deepEqual(project.standards,[]);
          assert.deepEqual(project.knowledgeSources,[]);
        } else {
          assert.ok(project.knowledgeSources.length);
          assert.ok(project.standards.every(line=>line.basis==='evidence' && line.citations.length===1 && line.citations[0].quote.startsWith('水电工艺标准')));
          const source = project.knowledgeSources[0].sourceId;
          const followup = new FollowupService(actor(b));
          await followup.knowledgeSource(String(b.id),id,revision,period.projectId,source,true);
          const other = bindings.find(c=>c.audience==='customer' && c.project_id!==b.project_id)!;
          await assert.rejects(new FollowupService(actor(other)).knowledgeSource(String(b.id),id,revision,period.projectId,source,true), /not_found/);
        }
        checkBinding(); assert.deepEqual(await config(),log.configurationBefore);
        return {reportId:id,revision,runId:result.state.body_run_id,stageKey:expectedKey,body:composed};
      }
      assert.equal(composed.length, b.audience === 'customer' ? 1 : projects.length);
      for (const project of composed) {
        assert.equal(project.guidance.length, 1);
        assert.equal(project.guidance[0].basis, 'advice');
        assert.match(project.guidance[0].text, /请优先核对原记录中的这一项/);
        assert.ok(project.standards.some(item => item.basis === 'evidence'), 'The selected fixture requires an authorized workmanship excerpt');
        const sources = new Set(project.knowledgeSources.map(s => s.sourceId));
        for (const item of project.standards) {
          if (weeklyStages && item.basis === 'uncertainty') { assert.deepEqual(item.citations, []); continue; }
          assert.equal(item.citations.length, 1);
          const { sourceId, quote } = item.citations[0];
          assert.ok(sources.has(sourceId) && (weeklyStages ? item.text.includes(quote + '\n') : item.text.startsWith(quote + '\n')), 'The report must display the exact cited excerpt');
        }
        if (weeklyStages && project.projectId === projects[0]) {
          const facts = (result.detail.facts as ReportFacts).projects.find(f => f.id === project.projectId)!;
          assert.equal(facts.stageKey, 'installation');
          assert.ok(facts.stageEvents.some(e => e.stageKey === 'masonry_carpentry'));
          assert.ok(facts.records.some(r => r.publishedStageKey === 'masonry_carpentry' && String(r.data.pending).includes('防水')));
          assert.ok(project.standards.some(item => item.text.startsWith('泥木 · 防水工艺标准') && item.basis === 'evidence'));
          assert.ok(project.standards.some(item => item.text === '安装 · 本次没有可引用的企业工艺依据。' && item.basis === 'uncertainty'));
        } else if (weeklyStages) {
          assert.ok(project.standards.some(item => item.text.startsWith('水电 · 水电工艺标准') && item.basis === 'evidence'));
          assert.ok(project.standards.every(item => !item.text.includes('防水工艺标准')));
        }
      }
      const visible = JSON.stringify(result.detail);
      if(b.audience==='customer') {
        assert.ok(!visible.includes('蓝色工具箱'),'Internal publication must not leak to customer');
        assert.deepEqual((result.detail.facts as ReportFacts).projects.map(p=>p.id),[String(b.project_id)]);
      } else assert.deepEqual((result.detail.facts as ReportFacts).projects.map(p=>p.id).sort(),[...projects].sort());
      checkBinding(); assert.deepEqual(await config(),log.configurationBefore);
      return {reportId:id,revision,runId:result.state.body_run_id,body:result.detail.body};
    });
  }
  log.configuredPassed = true; save();
  if (native) await step('Stable native report readback across four roles', async () => {
    checkBinding(); assert.deepEqual(await config(),log.configurationBefore);
    assert.ok(process.env.JWT_SECRET);
    const actors = [];
    for (const b of bindings) {
      const aid = b.admin_id ? String(b.admin_id) : undefined;
      let uid = String(b.user_id), contextVersion = 1;
      const role = b.audience === 'customer' ? 'user' : b.audience === 'boss' ? 'enterprise_admin' : b.audience === 'worker' ? 'construction_staff' : 'designer';
      if (aid) {
        const user = await withPlatformTransaction(async tx => {
          const account = await new AdminUserRepository(tx).findById(BigInt(aid));
          assert.ok(account && admins.includes(aid) && !account.userId);
          const mini = new MiniProgramIdentityRepository(tx), u = await mini.ensureStaffUser(account);
          staffUsers.push(String(u.id));
          await new UserRepository(tx).update(u.id, { phone: '199' + String(u.id).padStart(8, '0') });
          assert.ok(await mini.selectContext(u.id, { mode: 'staff', staffId: BigInt(aid), enterpriseId: BigInt(eid) }));
          return u;
        });
        uid = String(user.id); contextVersion = Number(user.contextVersion);
      }
      const mode = aid ? 'staff' : 'customer';
      const token = await new SignJWT({ sub: uid, id: uid, mode, role, ...(aid ? { staffId: aid } : {}),
        enterpriseId: eid, contextVersion, source: 'password' }).setProtectedHeader({ alg: 'HS256' })
        .setSubject(uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
      const reports = (log.attempts as Array<{ bindingId?: string; kind: string; reportId: string; revision: number; trial: number; result: { detail: Row } }>)
        .filter(a => a.trial === (stageReminders ? 1 : 2) && String(a.bindingId) === String(b.id));
      assert.equal(reports.length, stageReminders && b.audience==='customer' ? 1 : periods.length);
      actors.push({ name: String(b.audience), leadId: aid ? undefined : leads[users.indexOf(uid)], uid, aid, role, token,
        bid: String(b.id), cid: String(b.conversation_id), reports: reports.map(r => ({ id: r.reportId, revision: r.revision, kind: r.kind, body: r.result.detail.body })) });
    }
    const runNative = (await import(pathToFileURL(path.join(root,'admin/scripts/xiaok-v1-02-live-reports-native.cjs')).href)).default;
    return runNative({ root, output, actors });
  });
  log.passed=true;
}
async function cleanup() {
  if(policy && plan) {
    const current=await plan.settings();
    const {enabled,stageEnabled,dailyTime,weeklyTime,weeklyDay,projectIds,stageKeys,audiences,inactivePolicy}=reportPlanDto(policy,eid);
    await plan.configure({enabled,stageEnabled,dailyTime,weeklyTime,weeklyDay,projectIds,stageKeys,audiences,inactivePolicy,expectedVersion:Number(current.version)},randomUUID());
  }
  for(const b of bindings) await read(tx=>cancelRuns(tx,actor(b),String(b.conversation_id)));
  if(owner) for(const pid of projects) {
    for(const rid of records) {
      const r=await read(tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${eid} and project_id=${pid} and id=${rid} and status='published'`));
      if(r)await new SiteChatService(owner.actor).mutate(pid,rid,'withdraw',{expectedVersion:Number(r.version),reason:'合成实模验收结束，撤回测试原记录'},randomUUID());
    }
    const p=(await owner.execute('detail',{projectId:pid})).project as Row;
    await owner.execute('update',{projectId:pid,expectedVersion:p.version,name:p.name,status:'archived',customerAccess:false},randomUUID());
  }
  await read(async tx=>{
    for(const b of bindings)await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${String(b.id)}`);
    for(const aid of admins)await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and id=${aid} and username like ${prefix+':%'}`);
    for(const lid of leads)await tx.execute(sql`update app.leads set archived_at=now() where enterprise_id=${eid} and id=${lid} and name like ${prefix+':%'}`);
  });
  if(users.length)await withPlatformTransaction(async tx=>{for(const uid of users)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid} and nickname like ${prefix+':%'}`);});
  if(staffUsers.length)await withPlatformTransaction(async tx=>{for(const uid of staffUsers)await tx.execute(sql`update app.users set phone=null,context_version=context_version+1 where id=${uid}`);});
      log.originalLedgerAfter=await originalLedger();if(log.originalLedgerBefore)assert.deepEqual(log.originalLedgerAfter,log.originalLedgerBefore);
  if(log.unrelatedDestinationsBefore){log.unrelatedDestinationsAfter=await unrelatedDestinations();assert.deepEqual(log.unrelatedDestinationsAfter,log.unrelatedDestinationsBefore);}
  log.accounting = await read(async tx=>({
    attempts:bindings.length?await rows(tx,sql`select a.id::text,a.assistant_run_id::text,a.status,a.actual_cost,a.metadata#>'{assistantResponse,usage}' usage
      from app.ai_provider_attempts a join app.assistant_runs r on r.enterprise_id=a.enterprise_id and r.id=a.assistant_run_id
      where a.enterprise_id=${eid} and ${JSON.stringify(bindings.map(b=>String(b.conversation_id)))}::jsonb ? r.conversation_id::text order by a.id`):[],
    policy:await one(tx,sql`select enabled,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`),
    queue:await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`),
  }));
  if(before)checkBinding();log.cleanup=true;
}
main().catch(e=>{log.passed=false;log.error=(e as Error).stack;process.exitCode=1;})
  .finally(async()=>{
    try { await cleanup(); } catch(e){log.cleanupError=(e as Error).stack;process.exitCode=1;}
    finally {try{await closePostgresPool();}finally{await release?.();log.finishedAt=new Date().toISOString();log.ownedResources=[];save();}}
    console.log(JSON.stringify({passed:log.passed,error:log.error,cleanup:log.cleanup,cleanupError:log.cleanupError,attempts:(log.attempts as Row[]).length}));
  });
