/** Bounded deterministic day-close acceptance, reusing labelled 248/249 fixtures.
 * No provider/knowledge/native invocation; original failures and reports remain. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { executeSiteIssue, parseSiteVersions, type SiteIssueCommand } from '@/lib/construction/site-issues';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { advanceConstructionReports, deliverConstructionReports } from '@/lib/construction/report-worker';
import { enqueueReport, ensureFollowupBinding } from '@/lib/construction/report-store';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { dailySupplementCandidates } from '@/lib/construction/report-supplements';
import type { ReportFacts } from '@/lib/construction/report-scope';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', projects = ['248','249'], admins = ['5410','5411','5412'];
const output = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || '../tmp/v1-02-late-reports/service-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Never overwrite an original batch');
fs.mkdirSync(output, { recursive: true });
const day = process.argv.find(v => v.startsWith('--day='))?.slice(6) || '2026-11-18';
assert.match(day,/^\d{4}-\d{2}-\d{2}$/);
const prefix = 'synthetic-v1-02-late-' + randomUUID(), start = new Date(day + 'T00:00:00+08:00');
const recheckLifecycle = process.argv.find(v=>v.startsWith('--recheck-lifecycle='))?.slice(20);
const at = (hours: number) => new Date(start.getTime() + hours * 3600000);
const report: Row = { prefix, startedAt: new Date().toISOString(), scope: 'closed-day late publications; fixed deterministic service matrix',
  fixedPeriod: { start, cutoff: at(20), end: at(24), lookbackDays: 7, reportChecksPerTick: 20 }, fixture: { projects, admins, reused: 'tmp/v1-02-first-enable/service-01/report.json' }, checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, work: () => Promise<unknown>) {
  try { const result = await work(); (report.checks as Row[]).push({ name, passed: true, result }); console.log(name + ': PASS'); return result; }
  catch (error) { (report.checks as Row[]).push({ name, passed: false, error: (error as Error).message }); throw error; }
  finally { save(); }
}
const files = execFileSync('rg', ['--files','admin/src/lib/assistant','admin/src/lib/construction','admin/src/db','admin/src/lib/ai','admin/drizzle'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).map(f => f.replaceAll('\\','/'));
files.push('admin/src/app/api/internal/assistant/jobs/run/route.ts','admin/scripts/xiaok-v1-02-late-reports-check.ts','admin/scripts/assistant-acceptance-safety.mjs',
  'admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/.env.local');
const binding = () => Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const bound = binding();
function bindCheck() { const after = binding(), drift = Object.keys(bound).filter(f => bound[f] !== after[f]);
  fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before: bound, after, drift }, null, 2)); assert.deepEqual(drift, []); }
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
const owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] }), config = new ConstructionReportService(owner.actor);
const staff = new SiteChatService({ enterpriseId: eid, adminId: admins[1] });
const actor = (adminId: string): ActorContext => ({ enterpriseId: eid, principal: { kind: 'admin', adminId }, contextVersion: 0, capabilities: ['assistant.followup.self'] });
let release: (() => Promise<void>) | undefined, policyBefore: Row | undefined, setup = false;
const muted: Row[] = [], bindings: Row[] = [], services: FollowupService[] = [], baseViews: Row[] = [];
const accounting = () => withPlatformTransaction(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  attempt3753: await one(tx, sql`select id::text,status,input_tokens from app.assistant_knowledge_attempts where id=3753`),
}));
async function updateProject(pid: string, extra: Row) {
  return owner.execute('update', { projectId: pid, expectedVersion: ((await owner.execute('detail', { projectId: pid })).project as Row).version,
    name: '合成测试·V1-02迟到补记', status: 'active', customerAccess: true, ...extra }, randomUUID());
}
async function drain() {
  for (let n = 0; n < 20; n++) {
    const owned = await read(tx => rows(tx, sql`select run.id::text,run.status,run.error_code from app.assistant_runs run
      join app.construction_report_versions v on v.enterprise_id=run.enterprise_id and v.run_id=run.id
      join app.construction_reports r on r.enterprise_id=v.enterprise_id and r.id=v.report_id
      where run.enterprise_id=${eid} and ${JSON.stringify(bindings.map(b => String(b.id)))}::jsonb ? r.binding_id::text`));
    report.ownedRuns = owned; save();
    assert.equal(owned.filter(r => ['failed','unknown','cancelled'].includes(String(r.status))).length, 0, 'Retain failures; never regenerate them');
    if (!owned.some(r => ['queued','running'].includes(String(r.status)))) return;
    const r = await fetch('http://localhost:3006/api/internal/assistant/jobs/run', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! }, signal: AbortSignal.timeout(180000) });
    assert.ok(r.ok); const body = await r.json(); assert.equal(body.success, true); assert.ok(body.data.constructionReportChecks);
  }
  throw Error('Bounded queue drain ended with active original jobs');
}
async function publication(pid: string, label: string, audience: 'internal' | 'customer', time: Date) {
  const r = await staff.withWriteScope(pid, async (tx, c) => {
    const room = (await one(tx,sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} order by id limit 1`))!;
    assert.ok(room,'Formal issue fixtures use the retained actual room, not project-wide records');
    const m = await appendMessage(tx, staff.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + ' ' + label }] } });
    const r = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,room_id,room_name_snapshot,data)
      values(${eid},${pid},${String(c.id)},${String(m.id)},${admins[1]},'draft',${String(room.id)},${String(room.name)},
      ${JSON.stringify({ title: '合成测试·' + label, roomId: String(room.id), completed: '', pending: label, coordination: '', note: prefix })}::jsonb) returning *`))!;
    await recordVersion(tx, eid, r, admins[1], 'organized'); return r;
  });
  const published = await new SiteChatService(owner.actor).mutate(pid, String(r.id), 'publish', { expectedVersion: Number(r.version), audience }, randomUUID());
  await read(async tx => {
    const e = (await one(tx, sql`select id,created_at from app.domain_event_outbox where enterprise_id=${eid} and type='construction.record.publish.v1'
      and aggregate_id=${String(r.id)} and aggregate_version=${Number(published.version)}`))!;
    assert.ok(e);
    await tx.execute(sql`update app.construction_site_records set published_at=${time} where enterprise_id=${eid} and id=${String(r.id)}`);
    await tx.execute(sql`update app.construction_site_record_versions set created_at=${time} where enterprise_id=${eid} and record_id=${String(r.id)} and version=${Number(published.version)}`);
    await tx.execute(sql`update app.domain_event_outbox set created_at=${time} where enterprise_id=${eid} and id=${String(e.id)}`);
    report.clockedPublications = [...((report.clockedPublications as Row[]) || []), { recordId: String(r.id), version: published.version, eventId: String(e.id), originalAt: e.created_at, controlledAt: time }]; save();
  });
  return String(r.id);
}
async function issue(cmd: SiteIssueCommand, time: Date) {
  const versions = parseSiteVersions((await staff.read(projects[1])).versions);
  return staff.withWriteScope(projects[1], async (tx, c, _p, permission) => {
    const m = await appendMessage(tx, staff.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: prefix + ' 合成明确操作 ' + JSON.stringify(cmd) }] } });
    const result = await executeSiteIssue(tx, staff.actor, projects[1], String(m.id), cmd, versions, permission.manage);
    await tx.execute(sql`update app.domain_event_outbox set created_at=${time} where enterprise_id=${eid} and correlation_id=${String(m.id)}`);
    return result as Row;
  });
}
const factRecords = (v: Row) => (v.facts as ReportFacts).projects.flatMap(p => p.records.map(r => r.id));
async function lifecycleOnly(previousPath: string) {
  const previous=JSON.parse(fs.readFileSync(path.resolve(previousPath),'utf8'));
  assert.equal(previous.checks.length,7);assert.ok(previous.checks.slice(0,6).every((c:Row)=>c.passed));assert.equal(previous.checks[6].passed,false);
  const oldBinding=JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(previousPath)),'binding.json'),'utf8'));
  const changed=Object.keys(oldBinding.before).filter(f=>oldBinding.before[f]!==bound[f]);assert.deepEqual(changed,['admin/scripts/xiaok-v1-02-late-reports-check.ts']);
  report.scope='targeted lifecycle remainder after formal-room service-03; reuse original six passed blocks and reports';
  report.reusedEvidence={path:path.resolve(previousPath),sha256:createHash('sha256').update(fs.readFileSync(path.resolve(previousPath))).digest('hex'),changed,originalReports:previous.baseViews.map((v:Row)=>v.reportId)};
  await step('reuse original service reports and activate only the retained designer destination',async()=>{
    policyBefore=await read(tx=>one(tx,sql`select * from app.construction_report_settings where enterprise_id=${eid}`));assert.ok(!policyBefore?.enabled);
    const originalFixture=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-02-first-enable/service-01/report.json'),'utf8'));
    await withPlatformTransaction(async tx=>{for(const aid of admins){
      const a=(await one(tx,sql`select username,status from app.admin_users where enterprise_id=${eid} and id=${aid}`))!;
      assert.ok(String(a.username).startsWith(originalFixture.prefix));assert.equal(a.status,'disabled');
      await tx.execute(sql`update app.admin_users set status='active' where id=${aid}`);
    }});setup=true;
    for(const pid of projects) await updateProject(pid,{});
    await read(async tx=>{for(const a of await rows(tx,sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${admins[0]}`)){
      assert.ok(!await one(tx,sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:'+String(a.id)} and audience='boss'`));
      const b=await ensureFollowupBinding(tx,eid,{kind:'admin',id:String(a.id),audience:'boss'});muted.push(b);
      await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
    }});
    await config.configure({expectedVersion:Number(policyBefore?.version||0),enabled:true,dailyTime:'20:00',weeklyTime:'08:00',projectIds:projects,stageKeys:[]},randomUUID(),start);
    bindings.push(...await read(tx=>rows(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id in(28,29,30,31) order by id`)));
    const designer=new FollowupService(actor(admins[2])),b=bindings.find(b=>String(b.id)==='31')!;
    await designer.change('31','resume',Number(b.version),randomUUID());
    await publication(projects[1],'后续定向检查的原记录','customer',at(10));
    const tick=await advanceConstructionReports(at(20),eid);assert.deepEqual(tick.errors,[]);assert.equal(tick.queued,1);await drain();
    const v=((await designer.reports('31')).items as Row[]).find(v=>v.kind==='daily')!;assert.equal(v.state,'facts_ready');report.lifecycleReportId=v.reportId;
    return {newReport:v.reportId,reusedReports:previous.baseViews.map((v:Row)=>v.reportId),newIdentities:0};
  });
  await step('stopped/deleted/redacted recipients and removed-rejoined designer do not receive a supplement',async()=>{
    await publication(projects[1],'定向检查截止后的真实发布','customer',at(21));
    const worker=new FollowupService(actor(admins[1])),b=bindings.find(b=>String(b.id)==='30')!;
    await worker.change('30','delete',Number(b.version),randomUUID());
    for(const pid of projects) for(const active of [false,true]){
      const old=(await read(tx=>one(tx,sql`select coalesce(max(id),0) id from app.construction_audits where enterprise_id=${eid} and project_id=${pid}`)))!;
      await owner.execute('member',{projectId:pid,expectedVersion:((await owner.execute('detail',{projectId:pid})).project as Row).version,
        adminId:admins[2],role:'designer',active,workLabel:'合成补记撤权'},randomUUID());
      const audit=await read(tx=>one(tx,sql`select id,created_at from app.construction_audits where enterprise_id=${eid} and project_id=${pid}
        and id>${String(old.id)} and action='member' and snapshot->>'adminId'=${admins[2]} and snapshot->>'active'=${String(active)} order by id desc limit 1`));assert.ok(audit);
      await read(tx=>tx.execute(sql`update app.construction_audits set created_at=${at(active?23:22)} where enterprise_id=${eid} and id=${String(audit.id)}`));
      report.clockedAudits=[...((report.clockedAudits as Row[])||[]),{id:String(audit.id),originalAt:audit.created_at,controlledAt:at(active?23:22)}];save();
    }
    const tick=await advanceConstructionReports(at(24),eid);assert.deepEqual(tick.errors,[]);assert.equal(tick.queued,0);
    assert.equal((await advanceConstructionReports(at(24.1),eid)).queued,0);
    assert.equal((await read(tx=>one(tx,sql`select latest_revision from app.construction_reports where enterprise_id=${eid} and id=${String(report.lifecycleReportId)}`)))!.latest_revision,1);
    assert.equal((await new FollowupService(actor(admins[2])).detail('31',String(report.lifecycleReportId))).available,false);
    const states=await read(tx=>rows(tx,sql`select b.id::text,b.status,c.entry_snapshot from app.construction_followup_bindings b join app.assistant_conversations c
      on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id where b.enterprise_id=${eid} and b.id in(28,29,30) order by b.id`));
    assert.equal(states[0].status,'stopped');assert.equal((states[1].entry_snapshot as Row).retentionRedacted,true);assert.equal(states[2].status,'deleted');
    assert.deepEqual(await read(tx=>rows(tx,sql`select r.id ${dailySupplementCandidates(eid,at(24*10))}`)),[]);
    return {states,memberRegrantCannotRehydrate:true,expiredDayCandidates:0};
  });
  await step('combined runs add no provider/knowledge attempt and keep source binding',async()=>{
    report.accountingAfter=await accounting();assert.deepEqual(report.accountingAfter,report.accountingBefore);assert.deepEqual(report.accountingAfter,previous.accountingBefore);bindCheck();return report.accountingAfter;
  });report.passed=true;
}
async function main() {
  const db = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['127.0.0.1','localhost'].includes(db.hostname) && db.port === '5432' && db.pathname === '/smart_floor_planner');
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  report.accountingBefore = await accounting(); bindCheck();
  if(recheckLifecycle){await lifecycleOnly(recheckLifecycle);return;}
  await step('reuse labelled Weiyun fixtures, real policy and explicit personal resumes', async () => {
    assert.equal((await read(tx => one(tx, sql`select name from app.enterprises where id=${eid}`)))!.name, '微云');
    policyBefore = await read(tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`)); assert.ok(!policyBefore?.enabled);
    const fixture = JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-02-first-enable/service-01/report.json'),'utf8'));
    await withPlatformTransaction(async tx => {
      for (const aid of admins) {
        const a = (await one(tx, sql`select username,status from app.admin_users where id=${aid} and enterprise_id=${eid}`))!;
        assert.ok(String(a.username).startsWith(fixture.prefix)); assert.equal(a.status, 'disabled');
        await tx.execute(sql`update app.admin_users set status='active' where id=${aid}`);
      }
    }); setup = true;
    for (const pid of projects) { assert.equal(((await owner.execute('detail',{projectId:pid})).project as Row).status, 'archived'); await updateProject(pid, {}); }
    await read(async tx => {
      for (const a of await rows(tx, sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and id<>${admins[0]}`)) {
        assert.ok(!await one(tx, sql`select id from app.construction_followup_bindings where enterprise_id=${eid} and principal_key=${'admin:'+String(a.id)} and audience='boss'`));
        const b = await ensureFollowupBinding(tx,eid,{kind:'admin',id:String(a.id),audience:'boss'}); muted.push(b);
        await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${String(b.id)}`);
      }
    });
    await config.configure({expectedVersion:Number(policyBefore?.version||0),enabled:true,dailyTime:'20:00',weeklyTime:'08:00',projectIds:projects,stageKeys:[]},randomUUID(),start);
    const customer = (await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=3915`)))!;
    services.push(new FollowupService({enterpriseId:eid,principal:{kind:'user',userId:'3915'},contextVersion:Number(customer.context_version),capabilities:['assistant.followup.self']}),
      new FollowupService(actor(admins[0])),new FollowupService(actor(admins[1])),new FollowupService(actor(admins[2])));
    for (const [i,bid] of ['28','29','30','31'].entries()) {
      const b = (await read(tx=>one(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`)))!;
      await services[i].change(bid,'resume',Number(b.version),randomUUID()); bindings.push(b);
    }
    assert.equal((await read(tx=>one(tx,sql`select status from app.construction_followup_bindings where enterprise_id=${eid} and id=27`)))!.status,'stopped');
    assert.equal((await read(tx=>one(tx,sql`select count(*)::int n from app.construction_reports where enterprise_id=${eid} and binding_id in(28,29,30,31)`)))!.n,0);
    return {bindingIds:bindings.map(b=>String(b.id)),retentionBinding27Preserved:true,newIdentities:0};
  });
  let original = '', late = '', withdrawn = '', nextDay = '', issueId = '';
  await step('published originals and issue state produce four actual cutoff snapshots', async () => {
    await publication(projects[0],'A内部已核对记录','internal',at(10));
    original = await publication(projects[1],'B对客已核对记录','customer',at(11));
    await publication(projects[1],'B内部交接','internal',at(12));
    issueId=String((await issue({action:'open',target:original,value:'点位仍待核对，没有记录的期限'},at(19))).issueId);
    const tick=await advanceConstructionReports(at(20),eid); assert.deepEqual(tick.errors,[]); assert.equal(tick.queued,4);
    await drain(); await deliverConstructionReports(eid);
    for (const [i,s] of services.entries()) { const v=((await s.reports(String(bindings[i].id))).items as Row[]).find(v=>v.kind==='daily')!; assert.equal(v.state,'facts_ready');baseViews.push(v); }
    report.baseViews=baseViews; return {reportIds:baseViews.map(v=>v.reportId),issueId,redactedDestinationHasNoRun:true};
  });
  await step('late durable publications wait for day close; withdrawn and midnight records are distinct', async () => {
    late=await publication(projects[1],'B截止后对客记录','customer',at(20.5));
    await publication(projects[1],'B截止后内部记录','internal',at(21));
    await publication(projects[0],'A截止后内部记录','internal',at(22));
    withdrawn=await publication(projects[1],'发布后撤回的迟到记录','customer',at(23));
    const r=(await read(tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${withdrawn}`)))!;
    await new SiteChatService(owner.actor).mutate(projects[1],withdrawn,'withdraw',{expectedVersion:Number(r.version),reason:'合成测试撤回'},randomUUID());
    nextDay=await publication(projects[1],'恰在次日午夜发布，只能属于次日','customer',at(24));
    await issue({action:'claim',target:issueId,value:''},at(25));
    const tick=await advanceConstructionReports(at(23.9),eid);assert.deepEqual(tick.errors,[]);assert.equal(tick.queued,0);
    return {late,withdrawn,nextDay,beforeMidnightQueued:0};
  });
  await step('concurrent midnight ticks append exactly one immutable version per private recipient', async () => {
    const ticks=await Promise.all([advanceConstructionReports(at(24),eid),advanceConstructionReports(at(24),eid)]);
    assert.ok(ticks.every(t=>!t.errors.length));assert.equal(ticks.reduce((n,t)=>n+t.queued,0),4);
    assert.equal((await advanceConstructionReports(at(24.1),eid)).queued,0);
    await drain();await deliverConstructionReports(eid);await deliverConstructionReports(eid);
    for (const [i,s] of services.entries()) {
      const v=await s.detail(String(bindings[i].id),String(baseViews[i].reportId)) as Row;assert.equal(v.revision,2);assert.equal(v.state,'facts_ready');
      assert.equal(new Date(String(v.periodEnd)).toISOString(),at(24).toISOString());assert.equal(new Date(String(v.cutoffAt)).toISOString(),at(24).toISOString());
      assert.ok(factRecords(v).includes(late));assert.ok(!factRecords(v).includes(nextDay));assert.ok(!factRecords(v).includes(withdrawn));
      if (i===0) assert.equal(factRecords(v).length,2);
      const old=await s.detail(String(bindings[i].id),String(baseViews[i].reportId),1);assert.deepEqual(old.facts,baseViews[i].facts);
      for (const p of (v.facts as ReportFacts).projects) assert.deepEqual(p.issues,(baseViews[i].facts as ReportFacts).projects.find(old=>old.id===p.id)!.issues);
    }
    const versions=await read(tx=>rows(tx,sql`select report_id::text,revision,facts_hash from app.construction_report_versions where enterprise_id=${eid}
      and ${JSON.stringify(baseViews.map(v=>String(v.reportId)))}::jsonb ? report_id::text order by report_id,revision`));report.savedVersions=versions;
    const duplicates=await read(tx=>rows(tx,sql`select report_id,revision,binding_id from app.construction_report_deliveries where enterprise_id=${eid} group by report_id,revision,binding_id having count(*)>1`));assert.deepEqual(duplicates,[]);
    return {versionCount:versions.length,duplicateDeliveries:0,firstVersionUnchanged:true,afterMidnightIssueNotBackfilled:true};
  });
  await step('explicit later correction and weekly correction keep the original time and project scope', async () => {
    const daily=await config.correct(String(baseViews[1].reportId),2,randomUUID(),at(27));await drain();
    const d=await services[1].detail(String(bindings[1].id),String(daily.reportId)) as Row;assert.equal(new Date(String(d.cutoffAt)).toISOString(),at(24).toISOString());assert.ok(!factRecords(d).includes(nextDay));
    const weeklyPeriod=latestReportPeriod('weekly',at(24*6+8),'08:00');
    const weekly=await read(async tx=>enqueueReport(tx,eid,(await one(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=29`))!,
      (await one(tx,sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!,weeklyPeriod));assert.ok(weekly);await drain();
    const w=await services[1].detail('29',weekly.reportId);assert.equal(w.state,'facts_ready');
    const afterWeek=await publication(projects[1],'周截止之后的新记录','customer',new Date(weeklyPeriod.end.getTime()+3600000));
    await issue({action:'reply',target:issueId,value:'周截止之后才回复，不能回填'},new Date(weeklyPeriod.end.getTime()+7200000));
    await config.correct(weekly.reportId,1,randomUUID(),new Date(weeklyPeriod.end.getTime()+86400000));await drain();
    const corrected=await services[1].detail('29',weekly.reportId) as Row;assert.equal(new Date(String(corrected.cutoffAt)).toISOString(),weeklyPeriod.end.toISOString());
    assert.deepEqual(corrected.facts,w.facts);assert.ok(!factRecords(corrected).includes(afterWeek));
    return {dailyRevision:daily.revision,weeklyReportId:weekly.reportId,weeklyHistoryUnchanged:true};
  });
  await step('source withdrawal hides saved new sections without rewriting any stored fact hash', async () => {
    const before=await read(tx=>rows(tx,sql`select report_id::text,revision,facts_hash from app.construction_report_versions where enterprise_id=${eid}
      and ${JSON.stringify(baseViews.map(v=>String(v.reportId)))}::jsonb ? report_id::text order by report_id,revision`));
    const r=(await read(tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${late}`)))!;
    await new SiteChatService(owner.actor).mutate(projects[1],late,'withdraw',{expectedVersion:Number(r.version),reason:'合成测试：补记来源撤回'},randomUUID());
    assert.equal((await services[0].detail('28',String(baseViews[0].reportId),2)).available,false);
    assert.equal((await services[0].detail('28',String(baseViews[0].reportId),1)).available,true);
    assert.deepEqual(await read(tx=>rows(tx,sql`select report_id::text,revision,facts_hash from app.construction_report_versions where enterprise_id=${eid}
      and ${JSON.stringify(baseViews.map(v=>String(v.reportId)))}::jsonb ? report_id::text order by report_id,revision`)),before);
    return {savedHashesUnchanged:true,revokedSupplementHidden:true,originalUnaffected:true};
  });
  await step('stop/delete/retention and removed-rejoined membership block automatic day-close work', async () => {
    const tick=await advanceConstructionReports(at(44),eid);assert.deepEqual(tick.errors,[]);assert.equal(tick.queued,4);await drain();
    const dayTwo=await Promise.all(services.map((s,i)=>s.reports(String(bindings[i].id))));
    const dayTwoIds=dayTwo.map(v=>(v.items as Row[]).find(v=>v.kind==='daily')!.reportId);
    await publication(projects[1],'第二日截止后对客记录','customer',at(45));
    for (const [i,action] of [[0,'stop'],[2,'delete']] as const) {
      const b=(await read(tx=>one(tx,sql`select version from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(bindings[i].id)}`)))!;
      await services[i].change(String(bindings[i].id),action,Number(b.version),randomUUID());
    }
    await read(tx=>tx.execute(sql`update app.assistant_conversations set entry_snapshot='{"retentionRedacted":true,"retentionVersion":1}'::jsonb where enterprise_id=${eid} and id=${String(bindings[1].conversation_id)}`));
    for (const pid of projects) for (const active of [false,true]) {
      const old=(await read(tx=>one(tx,sql`select coalesce(max(id),0) id from app.construction_audits where enterprise_id=${eid} and project_id=${pid}`)))!;
      await owner.execute('member',{projectId:pid,expectedVersion:((await owner.execute('detail',{projectId:pid})).project as Row).version,adminId:admins[2],role:'designer',active,workLabel:'合成补记撤权'},randomUUID());
      await read(tx=>tx.execute(sql`update app.construction_audits set created_at=${at(active?47:46)} where enterprise_id=${eid} and project_id=${pid}
        and id>${String(old.id)} and action='member' and snapshot->>'adminId'=${admins[2]} and snapshot->>'active'=${String(active)}`));
    }
    const end=await advanceConstructionReports(at(48),eid);assert.deepEqual(end.errors,[]);assert.equal(end.queued,0);
    for (const rid of dayTwoIds) assert.equal((await read(tx=>one(tx,sql`select latest_revision from app.construction_reports where enterprise_id=${eid} and id=${String(rid)}`)))!.latest_revision,1);
    assert.deepEqual(await read(tx=>rows(tx,sql`select r.id ${dailySupplementCandidates(eid,at(24*10))}`)),[]);
    return {blockedReports:dayTwoIds,afterRegrantNewRevision:false,expiredDayCandidates:0};
  });
  await step('no model/ingestion attempt or unknown-outcome reset; stable source binding', async () => {
    report.accountingAfter=await accounting();assert.deepEqual(report.accountingAfter,report.accountingBefore);bindCheck();return report.accountingAfter;
  });report.passed=true;
}
async function run() {
  try { await main(); } catch(error) {report.error=(error as Error).stack;process.exitCode=1;console.error((error as Error).message);}
  finally {
    try {
      if (setup) {
        const current=await config.settings();await config.configure({expectedVersion:Number(current.version),enabled:false,dailyTime:String(policyBefore?.daily_time||'20:00'),weeklyTime:String(policyBefore?.weekly_time||'08:00'),
          projectIds:policyBefore?.project_ids||[],stageKeys:policyBefore?.stage_keys||[]},randomUUID());
        for (const pid of projects) await updateProject(pid,{name:'合成测试·V1-02已归档',status:'archived',customerAccess:false});
        await withPlatformTransaction(async tx=>{
          for (const b of muted) {
            assert.equal((await one(tx,sql`select count(*)::int n from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`))!.n,0);
            await tx.execute(sql`delete from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(b.id)}`);
            await tx.execute(sql`delete from app.assistant_participants where enterprise_id=${eid} and conversation_id=${String(b.conversation_id)}`);
            await tx.execute(sql`delete from app.assistant_conversations where enterprise_id=${eid} and id=${String(b.conversation_id)}`);
          }
          for (const b of bindings) await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=${eid} and id=${String(b.id)} and status<>'deleted'`);
          for (const aid of admins) await tx.execute(sql`update app.admin_users set status='disabled' where id=${aid}`);
          const owned=JSON.stringify(bindings.map(b=>String(b.id)));
          await tx.execute(sql`update app.assistant_jobs j set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed'
            from app.construction_report_versions v join app.construction_reports r on r.enterprise_id=v.enterprise_id and r.id=v.report_id
            where j.enterprise_id=${eid} and j.run_id=v.run_id and ${owned}::jsonb ? r.binding_id::text and j.status in('queued','running')`);
          await tx.execute(sql`update app.assistant_runs run set status='cancelled',error_code='synthetic_fixture_closed',completed_at=now()
            from app.assistant_jobs j where run.enterprise_id=${eid} and run.id=j.run_id and j.last_error='synthetic_fixture_closed' and run.status in('queued','running')`);
        });
      }
      bindCheck();report.cleanup={policyOff:true,projectsArchived:projects,accountsDisabled:admins,temporaryEmptySuppressionRemoved:true};
    } catch(error) {report.cleanupError=(error as Error).stack;process.exitCode=1;}
    finally {if(release) await release();await closePostgresPool();report.finishedAt=new Date().toISOString();save();}
  }
}
void run().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
