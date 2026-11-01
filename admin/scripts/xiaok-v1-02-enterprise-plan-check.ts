import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { enqueueReport } from '@/lib/construction/report-store';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { advanceConstructionReports, processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', pid = '248', bid = '50';
const arg = (key: string) => process.argv.find(a => a.startsWith('--' + key + '='))?.slice(key.length + 3);
const output = path.resolve(arg('output') || '../tmp/v1-02-enterprise-plan/http-01');
const nativeScript = arg('native-script'), migrateOnly = process.argv.includes('--migrate-only');
const cleanupOnly=arg('finish-cleanup'), permissionOnly=arg('permission-only');
assert.ok(process.argv.includes('--development')); assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain original batches');
const url = new URL(process.env.DATABASE_URL!); assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.port === '5432' && url.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const originalOutputFiles=new Set(fs.readdirSync(output));
const report: Row = { startedAt: new Date().toISOString(), fixedScope: ['roles and signed context','CAS and same-key save','controlled daily/weekly and audience scope',
  'stage off/on without replay','lifecycle at queue and delivery','disabled-epoch no backlog','current permission and RLS','cleanup and accounting'], checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const files = execFileSync('rg', ['--files','admin/src','admin/drizzle','miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\','/'));
files.push('admin/scripts/xiaok-v1-02-enterprise-plan-check.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/scripts/postgres-migrate.mjs',
  'admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/.env.local');
if (nativeScript) files.push(path.relative(root, path.resolve(nativeScript)).replaceAll('\\','/'),'admin/scripts/wechatide-native-client.ts','tmp/wechat-devtools-version-test/window.ps1');
if(nativeScript){
  const install='D:/微信开发工具/微信web开发者工具';
  files.push(install+'/微信开发者工具.exe',install+'/resources/app.asar');
  const walk=(directory:string)=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())walk(file);else if(/\.(js|cjs|json|node)$/.test(file))files.push(file);}};
  walk(install+'/resources/app.asar.unpacked/js/common/cli');
}
const bind = () => Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.isAbsolute(f)?f:path.join(root,f))).digest('hex')]));
const before = bind();
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const owner = new ConstructionService({ enterpriseId: eid, adminId: '5410' }), policy = new ConstructionReportService(owner.actor);
const accounts: Row[] = [], users: Row[] = [], runs: string[] = [];
const actors: Array<{ name: string; id: string; uid: string; role: string; token: string; entry?: string }> = [];
let release: (() => Promise<void>) | undefined, projectBefore: Row | undefined, policyBefore: Row | undefined, bindingBefore: Row | undefined;
const accounting = () => withPlatformTransaction(async tx => ({ providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown: await one(tx, sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`) }));
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).message }); throw e; } finally { save(); }
}
async function http(name: string, route = '/plan', body?: Row, requestKey = randomUUID(), expected: number | number[] = 200) {
  const a = actors.find(a => a.name === name)!;
  const response = await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/followups' + route, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + a.token, ...(a.entry ? {'X-Assistant-Entry':a.entry} : {}), ...(body ? { 'Content-Type': 'application/json','Idempotency-Key': requestKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), name + route + ': ' + response.status + '/' + (data.code || data.error || ''));
  return response.status === 200 ? data.data : data;
}
const settingsInput = (s: Row, changes: Row = {}) => { const dto=reportPlanDto(s,eid); return { expectedVersion:dto.version, enabled:dto.enabled,stageEnabled:dto.stageEnabled,
  dailyTime:dto.dailyTime,weeklyTime:dto.weeklyTime,weeklyDay:dto.weeklyDay,projectIds:dto.projectIds,stageKeys:dto.stageKeys,audiences:dto.audiences,inactivePolicy:dto.inactivePolicy,...changes }; };
async function configure(changes: Row, now?: Date) { const s = await policy.settings(); return policy.configure(settingsInput(s, changes), randomUUID(), now); }
async function project(status: string) { const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status, customerAccess: true }, randomUUID()); }
async function progress(stageKey: string, note = '合成测试10企业报告计划') { const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('progress', { projectId: pid, expectedVersion: p.version, stageKey, note, sendReminder: false }, randomUUID()); }
async function enqueue(day: string) {
  const result = await read(async tx => enqueueReport(tx, eid, (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!,
    (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!, latestReportPeriod('daily', new Date(day + 'T20:00:00+08:00'), '20:00')));
  if (result) runs.push(result.runId); return result;
}
async function drain() {
  const found = await read(tx => rows(tx, sql`select id from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running') and purpose='construction.report.facts'`));
  runs.push(...found.map(r => String(r.id)).filter(id => !runs.includes(id)));
  for (let n = 0; n < 20; n++) { const job = await claimJob(); if (!job) return;
    assert.ok(job.enterpriseId === eid && runs.includes(job.runId), 'Only owned local report jobs'); await processConstructionReport(job); }
  throw Error('Bounded drain exhausted');
}
async function main() {
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n,0);
  report.accountingBefore = await accounting();
  if(cleanupOnly){
    const directory=path.dirname(path.resolve(cleanupOnly)),saved=JSON.parse(fs.readFileSync(path.join(directory,'fixtures-before.private.json'),'utf8')),
      domain=JSON.parse(fs.readFileSync(path.join(directory,'domain-before.private.json'),'utf8'));
    for(const a of saved.accounts){assert.match(String(a.username),/^synthetic-v1-02-/);assert.equal(a.status,'disabled');accounts.push(a);}users.push(...saved.users);
    projectBefore=domain.projectBefore;policyBefore=domain.policyBefore;bindingBefore=domain.bindingBefore;
    report.cleanupOnly={source:path.resolve(cleanupOnly),businessReplay:false};return;
  }
  if(permissionOnly){
    const file=path.resolve(permissionOnly),old=JSON.parse(fs.readFileSync(file,'utf8')),binding=JSON.parse(fs.readFileSync(path.join(path.dirname(file),'binding.json'),'utf8'));
    assert.ok(old.checks.slice(0,7).every((c:Row)=>c.passed));assert.deepEqual(old.drift,[]);
    const changed=Object.keys(binding.before).filter(f=>before[f]!==binding.before[f]);assert.deepEqual(changed,['admin/scripts/xiaok-v1-02-enterprise-plan-check.ts']);
    report.reusedEvidence={source:file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),checks:old.checks.slice(0,7),changed};
  }
  if (migrateOnly) {
    await step('canonical local0106 migration', async () => {
      const x = spawnSync(process.execPath, ['scripts/postgres-migrate.mjs'], { encoding: 'utf8', windowsHide: true });
      fs.writeFileSync(path.join(output,'migration.log'), x.stdout + x.stderr); assert.equal(x.status,0);
      const columns = await read(tx => rows(tx, sql`select column_name from information_schema.columns where table_schema='app' and table_name='construction_report_settings'
        and column_name in ('stage_enabled','weekly_day','audiences','inactive_policy','dispatch_epoch')`)); assert.equal(columns.length,5); return { columns };
    }); return;
  }
  await step('reuse labelled fixtures and retain private before-values', async () => {
    await withPlatformTransaction(async tx => {
      for (const [id,name] of [['5410','boss'],['5411','worker'],['5413','admin'],['5414','super'],['5419','designer']]) {
        const a = (await one(tx, sql`select * from app.admin_users where id=${id}`))!; assert.match(String(a.username),/^synthetic-v1-02-/); assert.equal(a.status,'disabled'); accounts.push(a);
        const u = (await one(tx, sql`select id::text,phone,context_version from app.users where id=${String(a.user_id)}`))!; users.push(u);
        fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({ accounts,users },null,2));
        await tx.execute(sql`update app.admin_users set status='active' where id=${id}`);
        if (!u.phone) await tx.execute(sql`update app.users set phone=${'199' + String(u.id).padStart(8,'0')} where id=${String(u.id)}`);
        actors.push({ name,id,uid:String(a.user_id),role:String(a.role),token:'' });
      }
      actors.push({ name:'customer',id:'3914',uid:'3914',role:'user',token:'' });
    });
    for (const a of actors) { const u = (await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${a.uid}`)))!;
      a.token = await new SignJWT({ sub:a.uid,id:a.uid,mode:a.name==='customer'?'customer':'staff',role:a.role,...(a.name==='customer'?{}:{staffId:a.id}),
        enterpriseId:eid,contextVersion:Number(u.context_version),source:'password' }).setProtectedHeader({alg:'HS256'}).setSubject(a.uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!)); }
    projectBefore = (await owner.execute('detail',{projectId:pid})).project as Row; assert.match(String(projectBefore.name),/^合成测试/); assert.equal(projectBefore.status,'archived');
    policyBefore = await policy.settings(); assert.equal(policyBefore.enabled,false);
    bindingBefore = (await read(tx => one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`)))!;
    assert.equal(bindingBefore.admin_id,'5419'); assert.equal(bindingBefore.status,'stopped');
    fs.writeFileSync(path.join(output,'domain-before.private.json'),JSON.stringify({projectBefore,policyBefore,bindingBefore},null,2));
    await project('active'); const b = (await http('designer','/manage')).items.find((b:Row) => b.bindingId===bid); assert.ok(b);
    await http('designer','/'+bid+'/resume',{expectedVersion:b.version});
    const customer=actors.find(a=>a.name==='customer')!;
    const entry=await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/entry-context',{method:'POST',headers:{Authorization:'Bearer '+customer.token,'Content-Type':'application/json'},
      body:JSON.stringify({leadId:String(projectBefore.lead_id)}),signal:AbortSignal.timeout(30000)});const result=await entry.json();assert.equal(entry.status,200,result.error);customer.entry=result.data.entryToken;
    return { enterpriseId:eid,projectId:pid,bindingId:bid,accounts:actors.map(a=>({name:a.name,id:a.id})) };
  });
  if (nativeScript) { const native = (await import(pathToFileURL(path.resolve(nativeScript)).href)).default;
    report.native = await native({ root,output,actors,enterpriseId:eid,bindingId:bid,readPlan:()=>policy.plan(),configure,visualOnly:process.argv.includes('--visual-only') }); return; }
  if(!permissionOnly){
  await step('manager inheritance and non-manager denial on real HTTP', async () => {
    for (const name of ['boss','admin','super']) { const p = await http(name); assert.equal(p.enterprise.id,eid); assert.ok(p.projects.some((p:Row)=>p.id===pid)); }
    for (const name of ['worker','designer','customer']) await http(name,'/plan',undefined,undefined,403);
    const a = settingsInput(await policy.settings(),{projectIds:[pid],enabled:false,weeklyDay:3,stageEnabled:false,audiences:['designer']});
    for (const name of ['worker','designer','customer']) await http(name,'/plan',a,randomUUID(),403);
    await http('boss','/plan',{...a,enterpriseId:'2759'},randomUUID(),422); return {managers:3,denied:3};
  });
  await step('saved fields CAS concurrency same-key receipt and invalid scope', async () => {
    const input = settingsInput(await policy.settings(),{projectIds:[pid],enabled:false,weeklyDay:3,stageEnabled:false,audiences:['designer']}), key=randomUUID();
    const first = await http('boss','/plan',input,key); assert.deepEqual(await http('boss','/plan',input,key),first);
    await http('boss','/plan',{...input,weeklyDay:2},key,409);
    await http('admin','/plan',input,randomUUID(),409);
    const current = (await http('super')).settings; assert.equal(current.weeklyDay,3); assert.equal(current.stageEnabled,false);
    await http('super','/plan',{...input,expectedVersion:current.version,projectIds:['999999999']},randomUUID(),404);
    const save = {...input,expectedVersion:current.version,dailyTime:'19:45'};
    const attempts = await Promise.all([http('admin','/plan',save,randomUUID(),[200,409]),http('super','/plan',save,randomUUID(),[200,409])]);
    assert.equal(attempts.filter(x=>x.version).length,1);assert.equal(attempts.filter(x=>x.code==='version_conflict').length,1);
    return {sameKey:true,oneConcurrentWinner:true,version:(await policy.settings()).version};
  });
  await step('controlled daily weekly scope and saved facts without foreground client', async () => {
    await configure({enabled:true,projectIds:[pid],stageEnabled:false,weeklyDay:3,weeklyTime:'08:00',dailyTime:'20:00',audiences:['designer']},new Date('2026-12-01T07:59:00+08:00'));
    const first=await advanceConstructionReports(new Date('2026-12-02T20:00:00+08:00'),eid); assert.deepEqual(first.errors,[]); assert.equal(first.queued,2);
    const again=await advanceConstructionReports(new Date('2026-12-02T20:00:00+08:00'),eid); assert.equal(again.queued,0);
    await drain(); assert.equal(await deliverConstructionReports(eid),2);
    const found=await read(tx=>rows(tx,sql`select r.kind,b.audience,v.status,run.policy_snapshot from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
      join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      where r.enterprise_id=${eid} and ${JSON.stringify(runs)}::jsonb ? run.id::text`));
    assert.equal(found.length,2); assert.ok(found.every(r=>r.audience==='designer'&&r.status==='facts_ready')); return {runs:[...runs],savedKinds:found.map(r=>r.kind),AIReport:false};
  });
  await step('stage switch applies to future events without replaying disabled events', async () => {
    await progress('design'); const off=await advanceConstructionReports(new Date('2026-12-02T20:01:00+08:00'),eid); assert.equal(off.queued,0);
    await configure({stageEnabled:true},new Date('2026-12-02T20:02:00+08:00'));
    assert.equal((await advanceConstructionReports(new Date('2026-12-02T20:02:00+08:00'),eid)).queued,0);
    await progress('utilities'); const on=await advanceConstructionReports(new Date('2026-12-02T20:03:00+08:00'),eid); assert.equal(on.queued,1);
    await drain(); assert.equal(await deliverConstructionReports(eid),1); return {off:0,afterEnableOldEvents:0,newEvent:1};
  });
  await step('paused completed archived projects cannot queue or receive a later insertion', async () => {
    await project('paused'); assert.equal(await enqueue('2026-12-03'),null);
    assert.ok((await http('designer','/'+bid+'/reports')).items.length);
    await project('active'); await progress('completion'); assert.equal(await enqueue('2026-12-03'),null);
    await progress('utilities'); const delayed=await enqueue('2026-12-03'); assert.ok(delayed); await drain();
    await project('paused'); assert.equal(await deliverConstructionReports(eid),0);
    const d=await read(tx=>one(tx,sql`select state from app.construction_report_deliveries where enterprise_id=${eid} and report_id=${delayed.reportId}`)); assert.equal(d!.state,'revoked');
    await project('archived'); assert.equal(await enqueue('2026-12-04'),null); await project('active'); return {paused:true,completed:true,archived:true,oldDeliveryRevoked:true};
  });
  await step('master disable invalidates an old delivery even after re-enabling', async () => {
    const old=await enqueue('2026-12-05'); assert.ok(old); await drain();
    await configure({enabled:false}); await configure({enabled:true}); assert.equal(await deliverConstructionReports(eid),0);
    const d=await read(tx=>one(tx,sql`select state from app.construction_report_deliveries where enterprise_id=${eid} and report_id=${old.reportId}`)); assert.equal(d!.state,'revoked');
    const stale=await enqueue('2026-12-06'); assert.ok(stale); await configure({enabled:false}); await configure({enabled:true}); await drain();
    const run=await read(tx=>one(tx,sql`select status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${stale.runId}`)); assert.equal(run!.status,'failed');
    return {oldDelivery:'revoked',oldRun:run};
  });
  }
  await step('current manager status and tenant RLS remain authoritative', async () => {
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=true where id=5410`)); await http('boss','/plan',undefined,undefined,403);
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=false,status='disabled' where id=5410`)); await http('boss','/plan',undefined,undefined,401);
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=5410`));
    await assert.rejects(new ConstructionReportService({enterpriseId:'2759',adminId:'5410'}).plan());
    const foreign=await withTenantTransaction('2759',tx=>rows(tx,sql`select enterprise_id from app.construction_report_settings where enterprise_id=${eid}`)); assert.deepEqual(foreign,[]);
    return {password:true,disabled:true,foreignTenantDenied:true};
  });
}
main().catch(e=>{report.error=(e as Error).stack;process.exitCode=1;}).finally(async()=>{
  try {
    if(accounts.some(a=>String(a.id)==='5410')) await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active',must_change_password=false where id=5410`));
    if (bindingBefore) await read(async tx=>{
      const owned=await rows(tx,sql`select run.id from app.assistant_runs run join app.construction_report_versions v on v.enterprise_id=run.enterprise_id and v.run_id=run.id
        where run.enterprise_id=${eid} and v.report_id in(select id from app.construction_reports where enterprise_id=${eid} and binding_id=${bid}) and run.status in ('queued','running')`);
      for(const r of owned){await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_plan_closed' where enterprise_id=${eid} and run_id=${String(r.id)} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='cancelled',error_code='synthetic_plan_closed',completed_at=now() where enterprise_id=${eid} and id=${String(r.id)} and status in ('queued','running')`);}
      await tx.execute(sql`update app.construction_followup_bindings set status=${String(bindingBefore!.status)},version=version+1 where enterprise_id=${eid} and id=${bid}`);
    });
    if(policyBefore) await configure({...settingsInput(policyBefore),expectedVersion:Number((await policy.settings()).version),enabled:false});
    if(projectBefore){const p=(await owner.execute('detail',{projectId:pid})).project as Row;
      if(p.current_stage_key!==projectBefore.current_stage_key||p.progress_note!==projectBefore.progress_note){if(p.status!=='active')await project('active');await progress(String(projectBefore.current_stage_key),String(projectBefore.progress_note||''));}
      const current=(await owner.execute('detail',{projectId:pid})).project as Row;
      await owner.execute('update',{projectId:pid,expectedVersion:current.version,name:projectBefore.name,status:projectBefore.status,customerAccess:projectBefore.customer_access},randomUUID());}
  } catch(e){report.cleanupError=(e as Error).stack;process.exitCode=1;}
  try {
    await withPlatformTransaction(async tx=>{for(const a of accounts)await tx.execute(sql`update app.admin_users set status=${String(a.status)},must_change_password=${a.must_change_password as boolean} where id=${String(a.id)}`);
      for(const u of users)await tx.execute(sql`update app.users set phone=${u.phone as string|null} where id=${String(u.id)}`);});
    report.accountingAfter=await accounting();assert.deepEqual(report.accountingAfter,report.accountingBefore);
    report.cleanup=await withPlatformTransaction(async tx=>({queue:await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`),
      policy:await one(tx,sql`select enabled,version from app.construction_report_settings where enterprise_id=${eid}`)}));
    assert.equal((report.cleanup as Row).queue && ((report.cleanup as Row).queue as Row).n,0);assert.equal(((report.cleanup as Row).policy as Row).enabled,false);
  } catch(e){report.cleanupFinalError=(e as Error).stack;process.exitCode=1;}
  finally {
    try { const removed:string[]=[];
      for(const name of fs.readdirSync(output)) if(!originalOutputFiles.has(name)&&/^cli-args-[0-9a-f-]{36}\.private\.json$/i.test(name)) {
        const file=path.resolve(output,name);assert.equal(path.dirname(file),output);assert.ok(fs.lstatSync(file).isFile());fs.rmSync(file);removed.push(name);
      }
      report.privateArgsRemoved=removed;
    } catch(e){report.privateArgsCleanupError=(e as Error).stack;process.exitCode=1;}
    const after=bind(),drift=Object.keys(before).filter(f=>before[f]!==after[f]);report.drift=drift;report.runs=runs;report.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(output,'binding.json'),JSON.stringify({before,after},null,2));save();await release?.();await closePostgresPool();
    if(drift.length)process.exitCode=1;console.log(JSON.stringify({output,checks:(report.checks as Row[]).length,error:report.error,cleanupError:report.cleanupError,cleanupFinalError:report.cleanupFinalError,drift}));}
});
