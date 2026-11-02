/** Deterministic protocol/service checks with an injected model/retriever.
 * Never configured-model semantic acceptance or a paid provider invocation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { ensureFollowupBinding, enqueueReport, enqueueReportCorrection } from '@/lib/construction/report-store';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { advanceConstructionReports, processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { processReportComposition } from '@/lib/construction/report-body-worker';
import { reportSectionKinds } from '@/lib/construction/report-composition';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), isolated = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
const developmentUrl = process.env.DATABASE_URL!;
assert.ok(process.argv.includes('--evaluation'));
const target = new URL(isolated.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = isolated.DATABASE_URL;
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-natural-reports/service-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain all original batches'); fs.mkdirSync(output, { recursive: true });
const recoveryPath = process.argv.find(v => v.startsWith('--resume-fixture='))?.slice(17);
const savedRecovery = recoveryPath ? JSON.parse(fs.readFileSync(path.resolve(recoveryPath), 'utf8')) : null;
const recovery = savedRecovery?.fixture ? { ...savedRecovery.fixture, prefix: savedRecovery.prefix, settingsOwned: savedRecovery.cleanup === true } : savedRecovery;
const concurrencyRepair = process.argv.includes('--resume-after-concurrency');
const remaining = process.argv.includes('--remaining-source-and-unknown');
const savedWithdrawalRead = process.argv.includes('--saved-withdrawal-read');
const queryUnknownOnly = process.argv.includes('--query-usage-unknown-only');
assert.ok(!savedWithdrawalRead || remaining);
assert.ok(!concurrencyRepair || savedRecovery?.checks?.some((c:Row)=>c.name==='automatic daily/weekly fact and body runs, four private audiences, independent of ordinary chat' && c.passed===false));
const eid = '1454', prefix = recovery?.prefix || 'synthetic-report-composition-' + randomUUID();
assert.ok(prefix.startsWith('synthetic-report-composition-'));
const log: Row = { at: new Date().toISOString(), scope: 'isolated deterministic service protocol; model/retriever substituted; semantic/native acceptance not asserted',
  enterpriseId: eid, prefix, checks: [], actualModelCalls: 0, actualEmbeddingCalls: 0, newIngestionCalls: 0, injectedModelCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(log, null, 2));
const step = async (name: string, work: () => Promise<unknown>) => {
  try { const result = await work(); (log.checks as Row[]).push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { (log.checks as Row[]).push({ name, passed: false, error: (error as Error).message }); throw error; } finally { save(); }
};
const files = execFileSync('rg', ['--files','admin/src/lib/assistant','admin/src/lib/construction','admin/src/lib/ai','admin/src/db','admin/drizzle'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\','/'));
files.push('admin/scripts/xiaok-v1-02-report-composition-check.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/package.json','admin/package-lock.json','admin/.env.local');
const hashes = () => Object.fromEntries(files.filter(p => fs.existsSync(path.join(root,p))).sort().map(p => [p, createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
const before = hashes();
const scoped = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const users: string[] = [], admins: string[] = [], projects: string[] = [], records: string[] = [], bindings: Row[] = [];
if(recovery){users.push(...recovery.users);admins.push(...recovery.admins);projects.push(...recovery.projects);records.push(...recovery.records||[]);}
log.fixture={users,admins,projects,records,bindingIds:[]};
let release: (() => Promise<void>) | undefined, owner: ConstructionService, settingsCreated = false;
const actor = (kind: 'user' | 'admin', id: string): ActorContext => ({ enterpriseId: eid, principal: kind === 'user' ? { kind, userId: id } : { kind, adminId: id },
  contextVersion: kind === 'user' ? 1 : 0, capabilities: ['assistant.followup.self'] });
const model = async (messages: ModelMessage[]): Promise<ModelTurnOutput> => {
  log.injectedModelCalls = Number(log.injectedModelCalls) + 1;
  const serialized = JSON.stringify(messages); assert.ok(!serialized.includes('今天先聊书房的台灯'));
  const packet = JSON.parse((messages.find(m => m.role === 'user') as { content: Array<{ text: string }> }).content[0].text);
  assert.equal(packet.scope.timezone, 'Asia/Shanghai');
  const result = { projects: packet.projects.map((p: { projectId: string }) => ({ projectId: p.projectId,
    ...Object.fromEntries(reportSectionKinds.map(kind => [kind, { kind: 'synthesis', segments: [{ basis: 'uncertainty',
      text: '协议替身仅核对正文保存，尚未验证自然报告语义。', citations: [] }] }])) })) };
  return { text: '', toolCalls: [{ id: 'test-final', name: 'final_response', arguments: JSON.stringify(result) }],
    finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 100 } };
};
const dependencies = { retriever: { retrieve: async () => [] }, model };
async function drain(override = dependencies) {
  for (let n = 0; n < 80; n++) {
    const lease = await claimJob(); if (!lease) return;
    const run = (await scoped(tx => one(tx, sql`select purpose,policy_snapshot from app.assistant_runs where enterprise_id=${eid} and id=${lease.runId}`)))!;
    assert.equal(lease.enterpriseId, eid); assert.ok(['construction.report.facts','construction.report.compose'].includes(String(run.purpose)));
    const policy = run.policy_snapshot as Row, selection = (policy.reportComposition || policy) as Row;
    const r = await scoped(tx => one(tx, sql`select binding_id from app.construction_reports where enterprise_id=${eid} and id=${String(selection.reportId)}`));
    assert.ok(bindings.some(b => String(b.id) === String(r?.binding_id)), 'Never execute another test/customer job');
    if (run.purpose === 'construction.report.facts') await processConstructionReport(lease); else await processReportComposition(lease, override);
  }
  throw Error('Bounded owned queue did not drain');
}
async function enqueueOne(day: number) {
  return scoped(async tx => {
    const policy = (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!;
    const period = latestReportPeriod('daily', new Date(Date.now() + day * 86400000), '20:00');
    return (await enqueueReport(tx, eid, bindings[0], policy, period))!;
  });
}
async function run() {
  assert.equal(new URL(resolvePostgresRuntimeConfig().connectionString).port, '55432');
  release = await lockAssistantAcceptance(isolated.DATABASE_URL, { waitForLock: true });
  const dev = new pg.Client({ connectionString: developmentUrl });
  let agent: unknown, defaults: Row = {};
  try {
    await dev.connect(); await dev.query('begin read only'); await dev.query("select set_config('app.is_platform_admin','true',true)");
    defaults = (await dev.query('select agent_config,retention_days,daily_tokens,daily_requests,daily_cost_micros from app.assistant_enterprise_settings where enterprise_id=1454')).rows[0];
    agent = defaults.agent_config;
    log.configuredAgentHash = createHash('sha256').update(JSON.stringify(agent)).digest('hex');
    log.developmentAccountingBefore = (await dev.query("select count(*)::int n,sum(reserved_tokens)::text tokens from app.assistant_quota_reservations where enterprise_id=1454 and status='reconciling'")).rows[0];
    await dev.query('rollback');
  } finally { await dev.end(); }
  await step('fixed1454 isolated target, unchanged configured model and labelled service fixtures', async () => {
    assert.equal((await scoped(tx => one(tx, sql`select name from app.enterprises where id=${eid}`)))?.name, '微云');
    const existing=await scoped(tx=>one(tx,sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    assert.ok(!existing || recovery?.settingsOwned && existing.enabled===false,'Do not overwrite unrelated retained enterprise settings');
    const reservations=await scoped(tx=>rows(tx,sql`select q.run_id::text,r.status,r.error_code,
      exists(select 1 from app.ai_provider_attempts a where a.enterprise_id=r.enterprise_id and a.assistant_run_id=r.id) provider_attempt
      from app.assistant_quota_reservations q join app.assistant_runs r on r.enterprise_id=q.enterprise_id and r.id=q.run_id where q.enterprise_id=${eid}`));
    if(concurrencyRepair || remaining){assert.equal(reservations.length,queryUnknownOnly?13:remaining?12:5);assert.ok(reservations.every(r=>['succeeded','failed',...(queryUnknownOnly?['indeterminate']:[])].includes(String(r.status)) && !r.provider_attempt));
      assert.equal(createHash('sha256').update(JSON.stringify(existing!.agent_config)).digest('hex'),log.configuredAgentHash);
      log.reusedDailyProtocolEvidence={source:recoveryPath,runs:reservations.map(r=>r.run_id),newCalls:0,originalFailuresRetained:true};
    }else assert.equal(reservations.length,0,'No original ledger may be replaced');
    if(!existing)await scoped(tx=>tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id) values(${eid})`));
    await scoped(tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify(agent)}::jsonb,
      retention_days=${Number(defaults.retention_days)},daily_tokens=${String(defaults.daily_tokens)},daily_requests=${Number(defaults.daily_requests)},daily_cost_micros=${String(defaults.daily_cost_micros)} where enterprise_id=${eid}`));settingsCreated=true;
    await withPlatformTransaction(async tx => {
      for (let i=users.length;i<2;i++) users.push(String((await one(tx, sql`insert into app.users(nickname,phone,context_version)
        values(${prefix + ':customer:' + i},${'139' + String(Date.now()).slice(-7) + i},1) returning id`))!.id));
      for (const role of ['enterprise_admin','construction_staff','designer'].slice(admins.length)) admins.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
        values(${eid},${prefix + ':' + role},${'合成协议测试·' + role},'unusable-local-fixture',${role},'active',false) returning id`))!.id));
      for(const aid of admins)assert.ok(await one(tx,sql`update app.admin_users set status='active' where enterprise_id=${eid} and id=${aid} and username like ${prefix+':%'} returning id`));
    });
    owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] });
    for (let i=0;i<2;i++) {
      const retained=projects[i];
      const lead = retained ? await scoped(tx=>one(tx,sql`select l.* from app.leads l join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id where p.enterprise_id=${eid} and p.id=${retained} and l.name like ${prefix+':lead:%'}`)) : (await scoped(tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${eid},${users[i]},${prefix + ':lead:' + i},${'138' + String(Date.now()).slice(-7) + i},'natural') returning id`)))!;
      assert.ok(lead);
      const pid = retained || String((await owner.execute('create', { leadId: String(lead.id), name: '合成协议测试·正文工地' + i, managerId: admins[1], rooms: ['厨房'] }, randomUUID())).id);
      if(!retained)projects.push(pid);else await scoped(tx=>tx.execute(sql`update app.construction_projects set status='active',customer_access=true where enterprise_id=${eid} and id=${pid} and lead_id=${String(lead.id)}`));
      await owner.execute('member', { projectId: pid, expectedVersion: ((await owner.execute('detail',{ projectId:pid })).project as Row).version,
        adminId: admins[2], role:'designer',active:true,workLabel:'合成协议测试' }, randomUUID());
      if(records[i]){assert.ok(await scoped(tx=>one(tx,sql`select id from app.construction_site_records where enterprise_id=${eid} and id=${records[i]} and project_id=${pid}
        and (status='published' or ${savedWithdrawalRead} and status='withdrawn')`)));continue;}
      const worker = new SiteChatService({ enterpriseId:eid,adminId:admins[1] });
      const record = await worker.withWriteScope(pid, async (tx,c) => {
        const message = await appendMessage(tx,worker.actor,String(c.id),{ author:'admin',clientMessageId:randomUUID(),purpose:'site.source',
          content:{version:1,blocks:[{type:'text',text:'厨房线路走向已核对，插座位置还要和业主确认。'}]} });
        const r = (await one(tx,sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
          values(${eid},${pid},${String(c.id)},${String(message.id)},${admins[1]},'draft',
          ${JSON.stringify({title:'合成协议测试·原记录',roomId:null,completed:'厨房线路走向已核对',pending:'插座位置待业主确认',coordination:'',note:'协议夹具，不是模型答复'})}::jsonb) returning *`))!;
        await recordVersion(tx,eid,r,admins[1],'organized');return r;
      });
      await new SiteChatService(owner.actor).mutate(pid,String(record.id),'publish',{expectedVersion:Number(record.version),audience:'customer'},randomUUID()); records.push(String(record.id));
    }
    const others = await scoped(tx => rows(tx,sql`select id from app.admin_users where enterprise_id=${eid} and status='active' and role in ('enterprise_admin','admin','super_admin') and id<>${admins[0]}`));
    const controls: string[]=[];
    for(const a of others)await scoped(async tx=>{
      const old=await one(tx,sql`select id,status from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:'+String(a.id)} and audience='boss'`);
      assert.ok(!old || old.status==='stopped','Never seize an enabled destination owned by another user');
      const b=await ensureFollowupBinding(tx,eid,{kind:'admin',id:String(a.id),audience:'boss'});
      await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);controls.push(String(b.id));
    });
    log.unrelatedOwnerControls=controls;
    const config = new ConstructionReportService(owner.actor);
    const plan=await scoped(tx=>one(tx,sql`select version from app.construction_report_settings where enterprise_id=${eid}`));
    await config.configure({expectedVersion:Number(plan?.version||0),enabled:true,dailyTime:'20:00',weeklyTime:'08:00',projectIds:projects,stageKeys:[]},randomUUID());
    if(concurrencyRepair || remaining){
      const stopped=await scoped(tx=>rows(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and status='stopped'
        and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]}))`));
      for(const b of stopped)await new FollowupService(actor(b.user_id?'user':'admin',String(b.user_id||b.admin_id)))
        .change(String(b.id),'resume',Number(b.version),randomUUID());
    }
    bindings.push(...await scoped(tx => rows(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and status='enabled'
      and (user_id in (${users[0]},${users[1]}) or admin_id in (${admins[0]},${admins[1]},${admins[2]}))`)));
    assert.equal(bindings.length,5);
    // Stable first binding for subsequent targeted failures is a customer.
    bindings.sort((a,b)=>a.audience==='customer'?-1:b.audience==='customer'?1:0);
    log.fixture={users,admins,projects,records,bindingIds:bindings.map(b=>String(b.id))};
    return { audiences:bindings.map(b=>b.audience), settings:'new isolated settings only; original development unchanged' };
  });
  if(!remaining)await step('automatic daily/weekly fact and body runs, four private audiences, independent of ordinary chat',async()=>{
    await scoped(async tx=>{
      await appendMessage(tx,actor('user',String(bindings[0].user_id)),String(bindings[0].conversation_id),{author:'user',clientMessageId:randomUUID(),purpose:'reply',
        content:{version:1,blocks:[{type:'text',text:'今天先聊书房的台灯，我还没选好。'}]} });
      if(!concurrencyRepair)await tx.execute(sql`update app.construction_report_settings set next_daily_at=now()-interval '1 second',next_weekly_at=now()-interval '1 second' where enterprise_id=${eid}`);
    });
    const clock = new Date(new Date(Date.now()+28800000).toISOString().slice(0,10)+'T12:00:00Z');
    if(concurrencyRepair){
      const weekly=await scoped(tx=>rows(tx,sql`select r.* from app.construction_reports r where r.enterprise_id=${eid} and r.kind='weekly'
        and ${JSON.stringify(bindings.map(b=>String(b.id)))}::jsonb ? r.binding_id::text for update`));assert.equal(weekly.length,5);
      for(const r of weekly)await scoped(async tx=>{const settings=(await one(tx,sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!;
        assert.ok(await enqueueReportCorrection(tx,eid,r,settings,new Date(String(r.period_end))));});
    }else{const tick=await advanceConstructionReports(clock,eid);assert.equal(tick.errors.length,0);assert.equal(tick.queued,10);}
    await drain();assert.equal(await deliverConstructionReports(eid),concurrencyRepair?5:10);
    for(const b of bindings){
      const s=new FollowupService(actor(b.user_id?'user':'admin',String(b.user_id||b.admin_id)));
      const list=await s.reports(String(b.id));assert.equal(list.items.length,2);
      for(const report of list.items as Row[]){assert.equal(report.contentStatus,'composed');assert.equal(report.generationState,'ready');assert.ok((report.body as unknown[]).length);}
    }
    assert.equal(await deliverConstructionReports(eid),0);return {reports:10,injectedModelCalls:log.injectedModelCalls};
  });
  if(!remaining)await step('exact report reentry, distinct read receipt and cross-recipient denial',async()=>{
    const b=bindings[0], service=new FollowupService(actor('user',String(b.user_id)));
    const report=(await service.reports(String(b.id))).items[0] as Row;
    await service.acknowledge(String(b.id),String(report.reportId),Number(report.revision),String(report.readToken),randomUUID());
    const again=(await service.reports(String(b.id))).items.find(r=>r.reportId===report.reportId)! as Row;
    assert.ok(again.readAt);assert.deepEqual(again.body,report.body);
    const other=users.find(uid=>uid!==String(b.user_id))!;
    await assert.rejects(()=>new FollowupService(actor('user',other)).reports(String(b.id)));
    return {reportId:report.reportId,revision:report.revision,read:true};
  });
  if(!remaining)await step('pre-provider retrieval failure is explicit and safely retryable on the same fact version',async()=>{
    const r=await enqueueOne(2);await drain({ ...dependencies,retriever:{retrieve:async()=>{throw Error('synthetic retrieval transport failure');}} });
    const version=(await scoped(tx=>one(tx,sql`select v.*,j.provider_started_at from app.construction_report_versions v join app.assistant_jobs j on j.enterprise_id=v.enterprise_id and j.run_id=v.body_run_id where v.enterprise_id=${eid} and v.report_id=${r.reportId}`)))!;
    assert.equal(version.knowledge_status,'failed');assert.equal(version.provider_started_at,null);
    const b=bindings[0],service=new FollowupService(actor('user',String(b.user_id))),key=randomUUID();
    const retry=await service.retry(String(b.id),r.reportId,1,key);assert.equal(retry.status,'queued');
    assert.deepEqual(await service.retry(String(b.id),r.reportId,1,key),retry);await drain();
    const ready=(await service.reports(String(b.id))).items.find(v=>v.reportId===r.reportId)! as Row;
    assert.equal(ready.contentStatus,'composed');return {reportId:r.reportId,oldRunId:String(version.body_run_id),retryRunId:retry.runId};
  });
  if(!savedWithdrawalRead)await step('source withdrawal hides generated prose and removes unauthorized original facts',async()=>{
    const b=bindings.find(b=>b.user_id===users[0])!,service=new FollowupService(actor('user',users[0]));
    const beforeWithdraw=(await service.reports(String(b.id))).items;
    const affected=beforeWithdraw.filter(r=>r.facts?.projects.some(p=>p.records.some(record=>record.id===records[0]))).map(r=>r.reportId);
    assert.ok(affected.length,'The original record must actually have entered a saved report');
    assert.ok((beforeWithdraw.filter(r=>affected.includes(r.reportId)) as Row[]).every(r=>r.contentStatus==='composed'));
    await new SiteChatService(owner.actor).mutate(projects[0],records[0],'withdraw',
      {expectedVersion:Number((await scoped(tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${records[0]}`)))!.version),reason:'合成协议测试·核对来源撤回'},randomUUID());
    const list=await service.reports(String(b.id));assert.ok((list.items.filter(r=>affected.includes(r.reportId)) as Row[]).every(r=>r.contentStatus==='facts_only' && !(r.body as unknown[])?.length));
    return {affected,bodyVisible:false};
  });
  if(savedWithdrawalRead && !queryUnknownOnly)await step('read-only discriminator of saved withdrawal: complete unavailable DTO, no remutation or source-journey upgrade',async()=>{
    const b=bindings.find(b=>b.user_id===users[0])!,service=new FollowupService(actor('user',users[0]));
    const raw=await scoped(tx=>rows(tx,sql`select r.id::text,v.body is not null saved_body from app.construction_reports r join app.construction_report_versions v
      on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision where r.enterprise_id=${eid} and r.binding_id=${String(b.id)}
      and jsonb_path_exists(v.facts,'$.projects[*].records[*] ? (@.id == $record)'::jsonpath,${JSON.stringify({record:records[0]})}::jsonb)`));
    assert.ok(raw.length && raw.every(r=>r.saved_body));
    const list=await service.reports(String(b.id));
    const views=list.items.filter(v=>raw.some(r=>r.id===v.reportId)) as Row[];
    assert.equal(views.length,raw.length);
    assert.ok(views.every(v=>v.available===false && v.state==='source_unavailable' && !v.facts && !v.body));
    log.sourceHarnessRepairIterations=2;log.sourceJourneyStillFailed=true;log.savedWithdrawalDto=views;
    return {reports:raw.map(r=>r.id),visibleBody:false,sourceMutations:0,newModelCalls:0};
  });
  if(!queryUnknownOnly)await step('unknown provider outcome retains original hold and cannot be retried or automatically redispatched',async()=>{
    const r=await enqueueOne(3);let attempts=0;
    await drain({...dependencies,model:async()=>{attempts++;log.injectedModelCalls=Number(log.injectedModelCalls)+1;throw Error('synthetic lost provider receipt');}});
    const v=(await scoped(tx=>one(tx,sql`select v.body_run_id,r.status,q.status as reservation_status,j.provider_started_at from app.construction_report_versions v
      join app.assistant_runs r on r.enterprise_id=v.enterprise_id and r.id=v.body_run_id join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
      join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id where v.enterprise_id=${eid} and v.report_id=${r.reportId}`)))!;
    assert.equal(v.status,'indeterminate');assert.equal(v.reservation_status,'reconciling');assert.ok(v.provider_started_at);assert.equal(attempts,1);
    await assert.rejects(()=>new FollowupService(actor('user',String(bindings[0].user_id))).retry(String(bindings[0].id),r.reportId,1,randomUUID()));
    assert.equal(await claimJob(),null);return {reportId:r.reportId,runId:String(v.body_run_id),attempts};
  });
  if(queryUnknownOnly)await step('unknown query usage fences text dispatch, retains reconciliation and denies retry',async()=>{
    const r=await enqueueOne(4);let modelCalls=0;
    await drain({retriever:{retrieve:async()=>{
      await scoped(async tx=>{const run=await rows(tx,sql`select id from app.assistant_runs where enterprise_id=${eid} and purpose='construction.report.compose' and status='running'`);assert.equal(run.length,1);
        await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,measurement_kind)
          values(${eid},${String(run[0].id)},'synthetic-unknown-query','query_embedding','unavailable')`);});return[];
    }},model:async()=>{modelCalls++;throw Error('Text must not be dispatched after unknown query usage');}});
    const v=(await scoped(tx=>one(tx,sql`select r.id::text,r.status,r.error_code,j.provider_started_at,q.status as reservation_status
      from app.construction_report_versions v join app.assistant_runs r on r.enterprise_id=v.enterprise_id and r.id=v.body_run_id
      join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
      where v.enterprise_id=${eid} and v.report_id=${r.reportId}`)))!;
    assert.equal(modelCalls,0);assert.equal(v.provider_started_at,null);assert.equal(v.status,'indeterminate');assert.equal(v.reservation_status,'reconciling');
    const s=new FollowupService(actor('user',String(bindings[0].user_id))),detail=await s.detail(String(bindings[0].id),r.reportId,1);
    assert.ok('generationRetryable' in detail && detail.generationRetryable===false);
    await assert.rejects(()=>s.retry(String(bindings[0].id),r.reportId,1,randomUUID()));
    return {reportId:r.reportId,runId:v.id,modelCalls,realEmbeddingCalls:0,syntheticUsageMarker:true};
  });
  log.passed=true;
}
async function execute() {
try{await run();}catch(error){log.error=(error as Error).message;process.exitCode=1;console.error((error as Error).stack);}
finally{
  try {
    if(settingsCreated)await scoped(async tx=>{
      await tx.execute(sql`update app.construction_report_settings set enabled=false,version=version+1,dispatch_epoch=dispatch_epoch+1 where enterprise_id=${eid}`);
      if(bindings.length)await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and ${JSON.stringify(bindings.map(b=>String(b.id)))}::jsonb ? id::text`);
      if(projects.length)await tx.execute(sql`update app.construction_projects set status='archived',customer_access=false where enterprise_id=${eid} and ${JSON.stringify(projects)}::jsonb ? id::text`);
      if(admins.length)await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and ${JSON.stringify(admins)}::jsonb ? id::text`);
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
      const active=await rows(tx,sql`select r.id,j.provider_started_at from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
        where r.enterprise_id=${eid} and r.status in ('queued','running')`);
      for(const r of active){
        await tx.execute(sql`update app.assistant_runs set status='cancelled',completed_at=now(),error_code='synthetic_protocol_cleanup' where enterprise_id=${eid} and id=${String(r.id)}`);
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${eid} and run_id=${String(r.id)}`);
        await tx.execute(sql`update app.assistant_quota_reservations set status=${r.provider_started_at?'reconciling':'released'} where enterprise_id=${eid} and run_id=${String(r.id)}`);
      }
    });
    log.cleanup=true;
    const after=hashes(),drift=Object.keys(before).filter(p=>before[p]!==after[p]);fs.writeFileSync(path.join(output,'binding.json'),JSON.stringify({before,after,drift},null,2));assert.deepEqual(drift,[]);log.drift=drift;
  }catch(error){log.cleanupError=(error as Error).message;process.exitCode=1;}
  const dev=new pg.Client({connectionString:developmentUrl});
  try{await dev.connect();await dev.query('begin read only');await dev.query("select set_config('app.is_platform_admin','true',true)");
    log.developmentAccountingAfter=(await dev.query("select count(*)::int n,sum(reserved_tokens)::text tokens from app.assistant_quota_reservations where enterprise_id=1454 and status='reconciling'")).rows[0];
    assert.deepEqual(log.developmentAccountingAfter,log.developmentAccountingBefore);await dev.query('rollback');
  }catch(error){log.developmentReadbackError=(error as Error).message;process.exitCode=1;}finally{await dev.end().catch(()=>undefined);}
  log.finishedAt=new Date().toISOString();save();await closePostgresPool();await release?.();
}
}
execute().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
