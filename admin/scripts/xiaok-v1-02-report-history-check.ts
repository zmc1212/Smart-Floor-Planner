/** Approved05: bounded real local index/read receipts; no provider or ingestion. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { FollowupService } from '@/lib/construction/followup-service';
import { enqueueReport } from '@/lib/construction/report-store';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { processConstructionReport, deliverConstructionReports } from '@/lib/construction/report-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454', arg = (k: string) => process.argv.find(a => a.startsWith('--' + k + '='))?.slice(k.length + 3);
const output = path.resolve(arg('output') || '../tmp/v1-02-report-history/http-01'), nativeScript = arg('native-script'), reuse = arg('reuse'), fixtureFrom = arg('complete-fixture'), remaining = arg('remaining');
assert.ok(process.argv.includes('--development'));
const database = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1','localhost'].includes(database.hostname) && database.port === '5432' && database.pathname === '/smart_floor_planner');
assert.ok(!fs.existsSync(path.join(output,'report.json')), 'Do not overwrite evidence'); fs.mkdirSync(output,{recursive:true});
const originalOutputFiles = new Set(fs.readdirSync(output));
const contextOnly = process.argv.includes('--context-only');
type IndexReport = { reportId: string; kind: string; readAt: string | null; readToken: string | null; revision: number; facts: { projects: Array<{ id: string }> } };
const report: Row = { startedAt:new Date().toISOString(), fixedScope:['real saved index, project/month/kind/cursor','Shanghai month and cross-month week',
  'current project/tenant/identity rejection','read-only index and rendered acknowledgement','same-key read/reentry','cleanup/accounting'],checks:[] };
const save = () => fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
const files = execFileSync('rg',['--files','admin/src','admin/drizzle','miniprogram'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).map(f=>f.replaceAll('\\','/'));
files.push('admin/scripts/xiaok-v1-02-report-history-check.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/.env.local');
if(nativeScript){
  files.push(path.relative(root,path.resolve(nativeScript)).replaceAll('\\','/'),'admin/scripts/wechatide-native-client.ts','tmp/wechat-devtools-version-test/window.ps1');
  const install='D:/微信开发工具/微信web开发者工具'; files.push(install+'/微信开发者工具.exe',install+'/resources/app.asar');
  const walk=(d:string)=>{for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);if(x.isDirectory())walk(f);else if(/\.(js|cjs|json|node)$/.test(f))files.push(f);}};
  walk(install+'/resources/app.asar.unpacked/js/common/cli');
}
const bind=()=>Object.fromEntries([...new Set(files)].sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.isAbsolute(f)?f:path.join(root,f))).digest('hex')]));
const before=bind(), read=<T>(fn:Parameters<typeof withTenantTransaction<T>>[1])=>withTenantTransaction(eid,fn);
const owner=new ConstructionService({enterpriseId:eid,adminId:'5410'}), plan=new ConstructionReportService(owner.actor);
const accounts:Row[]=[], projectBefore:Row[]=[], runs:string[]=[], actors:Row[]=[], savedReports:Row[]=[], historyProjects:Row[]=[];
let release:(()=>Promise<void>)|undefined, policyBefore:Row|undefined, bindingBefore:Row|undefined, bid='';
const accounting=()=>withPlatformTransaction(async tx=>({providerMax:String((await one(tx,sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax:String((await one(tx,sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown:await one(tx,sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`)}));
async function step(name:string,fn:()=>Promise<unknown>){try{const data=await fn();(report.checks as Row[]).push({name,passed:true,data});console.log(name+': PASS');return data;}
  catch(e){(report.checks as Row[]).push({name,passed:false,error:(e as Error).stack});throw e;}finally{save();}}
async function http(name:string,suffix:string,body?:Row,key=randomUUID(),expected=200){
  const a=actors.find(a=>a.name===name)!;
  const response=await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/followups'+suffix,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+a.token,...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.equal(response.status,expected,name+suffix+': '+response.status+'/'+data.code);return expected===200?data.data:data;
}
async function restoreProject(p:Row){const current=(await owner.execute('detail',{projectId:String(p.id)})).project as Row;
  await owner.execute('update',{projectId:String(p.id),expectedVersion:current.version,name:current.name,status:p.status,customerAccess:p.customer_access},randomUUID());}
async function main(){
  release=await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL,{waitForLock:true});
  assert.equal((await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n,0);
  report.accountingBefore=await accounting();
  await step('labelled fixtures and current Mini contexts',async()=>{
    for(const [name,id] of [['boss','5410'],['designer','5419']]){
      const a=(await withPlatformTransaction(tx=>one(tx,sql`select * from app.admin_users where id=${id}`)))!;
      assert.match(String(a.username),/^synthetic-v1-02-/);assert.equal(a.status,'disabled');accounts.push(a);
      fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,projectBefore,policyBefore,bindingBefore},null,2));
      await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=${id}`));
      const u=(await withPlatformTransaction(tx=>one(tx,sql`select id,context_version from app.users where id=${String(a.user_id)}`)))!;
      const token=await new SignJWT({sub:String(u.id),id:String(u.id),mode:'staff',role:a.role,staffId:String(a.id),enterpriseId:eid,contextVersion:Number(u.context_version),source:'password'})
        .setProtectedHeader({alg:'HS256'}).setSubject(String(u.id)).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
      actors.push({name,id:String(a.id),uid:String(u.id),role:String(a.role),token});
    }
    policyBefore=await plan.settings();assert.equal(policyBefore.enabled,false);
    for(const id of ['248','249']){const p=(await owner.execute('detail',{projectId:id})).project as Row;assert.match(String(p.name),/^合成测试/);assert.equal(p.status,'archived');projectBefore.push(p);
      fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,projectBefore,policyBefore,bindingBefore},null,2));
      await owner.execute('update',{projectId:id,expectedVersion:p.version,name:p.name,status:'active',customerAccess:p.customer_access},randomUUID());}
    const b=(await read(tx=>one(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and admin_id='5410' and audience='boss'`)))!;
    assert.ok(b);assert.equal(b.status,'stopped');bindingBefore=b;bid=String(b.id);assert.notEqual(bid,'27');
    fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,projectBefore,policyBefore,bindingBefore},null,2));
    await http('boss','/'+bid+'/resume',{expectedVersion:Number(b.version)});
    return {enterpriseId:eid,projects:['248','249'],bindingId:bid,principals:actors.map(a=>({name:a.name,id:a.id}))};
  });
  if(reuse||remaining){
    const source=path.resolve((reuse||remaining)!);const old=JSON.parse(fs.readFileSync(source,'utf8'));assert.equal(old.passed,remaining?false:true);assert.deepEqual(old.drift,[]);assert.equal(old.cleanup,true);
    if(remaining){const prior=JSON.parse(fs.readFileSync(path.join(path.dirname(source),'binding.json'),'utf8'));assert.ok(old.checks.slice(0,4).every((c:Row)=>c.passed));
      const changes=Object.keys(prior.before).filter(f=>before[f]!==prior.before[f]);assert.deepEqual(changes,['admin/scripts/xiaok-v1-02-report-history-check.ts']);report.reusedChecks=old.checks.slice(0,4);report.changed=changes;}
    savedReports.push(...old.savedReports);historyProjects.push(...old.historyProjects||[]);report.reused={path:source,sha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),reports:savedReports.length,businessReplay:false};
  }else await step('real durable facts across month and weekly boundaries, paginated index',async()=>{
    if(fixtureFrom){
      const old=JSON.parse(fs.readFileSync(path.resolve(fixtureFrom),'utf8')),oldBinding=JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(fixtureFrom)),'binding.json'),'utf8'));
      assert.equal(old.passed,false);assert.equal(old.cleanup,true);assert.deepEqual(old.drift,[]);assert.equal(old.savedReports.length,23);
      const changes=Object.keys(oldBinding.before).filter(f=>before[f]!==oldBinding.before[f]);assert.deepEqual(changes,['admin/scripts/xiaok-v1-02-report-history-check.ts']);
      savedReports.push(...old.savedReports);runs.push(...old.savedReports.map((r:Row)=>String(r.runId)));
      report.reusedFixture={source:path.resolve(fixtureFrom),retainedFailure:old.checks.at(-1).error,changed:changes,replayed:false};
    }
    const p=reportPlanDto(await plan.settings(),eid);await plan.configure({expectedVersion:p.version,enabled:true,stageEnabled:false,projectIds:['248','249'],stageKeys:[],audiences:['boss'],dailyTime:'20:00',weeklyTime:'08:00',weeklyDay:1,inactivePolicy:'pause_inactive'},randomUUID());
    const periods=fixtureFrom?[latestReportPeriod('weekly',new Date('2027-05-03T08:00:00+08:00'),'08:00'),latestReportPeriod('daily',new Date('2027-04-22T20:00:00+08:00'),'20:00')]:[...Array.from({length:21},(_,i)=>latestReportPeriod('daily',new Date(`2027-04-${String(i+1).padStart(2,'0')}T20:00:00+08:00`),'20:00')),
      latestReportPeriod('daily',new Date('2027-03-31T20:00:00+08:00'),'20:00'),latestReportPeriod('weekly',new Date('2027-04-05T08:00:00+08:00'),'08:00')];
    for(const period of periods){const made=await read(async tx=>enqueueReport(tx,eid,(await one(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!,
      (await one(tx,sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!,period));assert.ok(made);runs.push(made.runId);savedReports.push({...made,kind:period.kind,start:period.start.toISOString()});report.savedReports=savedReports;save();}
    for(let n=0;n<80;n++){
      const queued=await read(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${eid} and ${JSON.stringify(runs)}::jsonb ? run_id::text and status in ('queued','running')`));
      if(!queued!.n)break;const job=await claimJob();if(!job){await new Promise(r=>setTimeout(r,50));continue;}
      assert.ok(job.enterpriseId===eid&&runs.includes(job.runId));await processConstructionReport(job);
    }
    let delivered=0;for(let n=0;n<8;n++){delivered+=await deliverConstructionReports(eid);if(delivered===periods.length)break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(delivered,periods.length);
    const state=await read(tx=>rows(tx,sql`select v.status,d.state,d.read_at from app.construction_report_versions v join app.construction_report_deliveries d
      on d.enterprise_id=v.enterprise_id and d.report_id=v.report_id and d.revision=v.revision where v.enterprise_id=${eid} and ${JSON.stringify(runs)}::jsonb ? v.run_id::text`));
    assert.equal(state.length,fixtureFrom?24:23);assert.ok(state.every(r=>r.status==='facts_ready'&&!r.read_at));return {saved:state.length,newDelivered:delivered,modelCalls:0};
  });
  report.savedReports=savedReports;
  if(contextOnly&&!historyProjects.length){
    const leadId=String(projectBefore[0].lead_id),lead=(await read(tx=>one(tx,sql`select name from app.leads where enterprise_id=${eid} and id=${leadId}`)))!;
    assert.match(String(lead.name),/^synthetic-v1-02-|^合成测试/);
    for(let i=0;i<21;i++){
      const name='合成测试05·历史项目选项'+String(i+1).padStart(2,'0');
      const made=await owner.execute('create',{leadId,name,managerId:'5410',rooms:[]},randomUUID());
      const current=(await owner.execute('detail',{projectId:String(made.id)})).project as Row;
      historyProjects.push({id:String(made.id),name,leadId});projectBefore.push({...current,status:'archived',customer_access:false});
      report.historyProjects=historyProjects;fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,projectBefore,policyBefore,bindingBefore},null,2));save();
      await owner.execute('update',{projectId:String(made.id),expectedVersion:current.version,name,status:'active',customerAccess:false},randomUUID());
    }
  }else if(historyProjects.length){
    for(const saved of historyProjects){const p=(await owner.execute('detail',{projectId:saved.id})).project as Row;
      assert.equal(p.name,saved.name);assert.equal(p.status,'archived');projectBefore.push(p);
      fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,projectBefore,policyBefore,bindingBefore},null,2));
      await owner.execute('update',{projectId:saved.id,expectedVersion:p.version,name:p.name,status:'active',customerAccess:false},randomUUID());}
  }
  report.historyProjects=historyProjects;
  if(contextOnly){
    await step('authorized project pagination and selected project beyond the first page',async()=>{
      const target=String(historyProjects.at(-1)!.id);let cursor:string|undefined,found=false,pages=0;const ids=new Set<string>();
      do{const value=await http('boss','/'+bid+(cursor?'?afterProjectId='+cursor:''));pages++;
        assert.ok(value.projects.length<=20);for(const p of value.projects){assert.ok(!ids.has(p.id));ids.add(p.id);if(p.id===target)found=true;}
        cursor=value.projectsNextCursor||undefined;assert.ok(pages<30);
      }while(cursor&&!found);assert.ok(found);assert.ok(pages>1);
      const selected=await http('boss','/'+bid+'?projectId='+target);assert.equal(selected.selectedProject.id,target);
      assert.ok(!selected.projects.some((p:Row)=>p.id===target));assert.ok(selected.projectsNextCursor);
      await http('boss','/'+bid+'?projectId=999999999',undefined,undefined,404);await http('boss','/'+bid+'?afterProjectId=0',undefined,undefined,422);
      await http('designer','/'+bid+'?projectId=248',undefined,undefined,403);
      const index=await http('boss',`/${bid}/reports?projectId=248&month=2027-04&kind=daily`);assert.equal(index.items.length,20);assert.ok(index.items.every((r:IndexReport)=>r.facts.projects[0].id==='248'));
      return {pages,authorizedOptions:ids.size,target,selectedBeyondPage:true,indexStillScoped:true};
    });report.passed=true;return;
  }
  if(nativeScript){const native=(await import(pathToFileURL(path.resolve(nativeScript)).href)).default;
    const nativeRemaining=arg('native-remaining');
    if(nativeRemaining){const source=path.resolve(nativeRemaining),old=JSON.parse(fs.readFileSync(source,'utf8')),prior=JSON.parse(fs.readFileSync(path.join(path.dirname(source),'binding.json'),'utf8')),
      priorNative=JSON.parse(fs.readFileSync(path.join(path.dirname(source),'native.json'),'utf8'));
      assert.equal(priorNative.checks[2].passed,true);assert.deepEqual(old.drift,[]);assert.equal(old.cleanup,true);
      const changes=Object.keys(prior.before).filter(f=>before[f]!==prior.before[f]);assert.ok(changes.every(f=>['admin/scripts/xiaok-v1-02-report-history-check.ts','tmp/v1-02-report-history/native.cjs'].includes(f)));
      report.reusedNative={source,checks:priorNative.checks.slice(0,3),changed:changes};}
    report.native=await native({root,output,actors,bindingId:bid,savedReports,historyProjects,http,remaining:!!nativeRemaining,visualOnly:process.argv.includes('--visual-only'),
      ownerStatus:(status:string)=>{assert.ok(['active','disabled'].includes(status));return withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status=${status} where id='5410' and username like 'synthetic-v1-02-%'`));}});report.passed=true;return;}
  if(!remaining){await step('project month kind and cursor keep one scope without read writes',async()=>{
    const first=await http('boss',`/${bid}/reports?projectId=248&month=2027-04&kind=daily`);assert.equal(first.items.length,20);assert.ok(first.nextCursor);
    const dailyCount=savedReports.filter(r=>r.kind==='daily'&&new Date(new Date(String(r.start)).getTime()+8*3600000).toISOString().startsWith('2027-04')).length;
    const next=await http('boss',`/${bid}/reports?projectId=248&month=2027-04&kind=daily&beforeId=${first.nextCursor}`);assert.equal(next.items.length,dailyCount-20);assert.equal(next.nextCursor,null);
    const all=[...first.items,...next.items];assert.equal(new Set(all.map((r:Row)=>r.reportId)).size,dailyCount);
    assert.ok(all.every((r:IndexReport)=>r.kind==='daily'&&!r.readAt&&r.facts.projects.length===1&&r.facts.projects[0].id==='248'&&r.readToken===null));
    assert.equal((await http('boss',`/${bid}/reports?month=2027-05&kind=daily`)).items.length,0);
    const second=await http('boss',`/${bid}/reports?projectId=249&month=2027-04&kind=daily`);assert.equal(second.items.length,20);assert.ok(second.items.every((r:IndexReport)=>r.facts.projects[0].id==='249'));
    return {first:20,next:next.items.length,unique:dailyCount,indexReadOnly:true,otherProject:true};
  });
  await step('cross-month weekly report is indexed by Shanghai period start',async()=>{
    const month=fixtureFrom?'2027-04':'2027-03',next=fixtureFrom?'2027-05':'2027-04';
    const found=await http('boss',`/${bid}/reports?projectId=248&month=${month}&kind=weekly`),later=await http('boss',`/${bid}/reports?projectId=248&month=${next}&kind=weekly`);
    assert.equal(found.items.length,1);assert.equal(later.items.length,0);assert.equal(new Date(found.items[0].periodStart).toISOString(),fixtureFrom?'2027-04-25T16:00:00.000Z':'2027-03-28T16:00:00.000Z');
    assert.equal(new Date(found.items[0].periodEnd).toISOString(),fixtureFrom?'2027-05-02T16:00:00.000Z':'2027-04-04T16:00:00.000Z');return {month,found:1,nextMonth:0};
  });}
  await step('invalid query foreign project and private binding rejection',async()=>{
    for(const query of ['month=2027-13','month=','kind=stage','projectId=0','month=2027-04&month=2027-03','audience=boss'])await http('boss',`/${bid}/reports?${query}`,undefined,undefined,422);
    await http('boss',`/${bid}/reports?projectId=999999999&month=2027-04`,undefined,undefined,404);
    await http('designer',`/${bid}/reports?month=2027-04`,undefined,undefined,403);
    const foreign=new FollowupService({enterpriseId:'2759',principal:{kind:'admin',adminId:'5410'},contextVersion:0,capabilities:['assistant.followup.self']});
    await assert.rejects(()=>foreign.reports(bid,undefined,{month:'2027-04'}));return {invalid:6,currentProject:true,privatePrincipal:true,tenant:true};
  });
  await step('detail supplies read grant, same-key receipt persists reentry without list writes',async()=>{
    const rid=String(savedReports.at(-1)!.reportId),detail=await http('boss',`/${bid}/reports/${rid}`);assert.ok(detail.available&&detail.readToken);assert.equal(detail.readAt,null);
    const body={revision:detail.revision,readToken:detail.readToken},key=randomUUID();const receipt=await http('boss',`/${bid}/reports/${rid}/acknowledge`,body,key);
    assert.deepEqual(await http('boss',`/${bid}/reports/${rid}/acknowledge`,body,key),receipt);
    assert.ok((await http('boss',`/${bid}/reports/${rid}`)).readAt);const list=await http('boss',`/${bid}/reports?projectId=248&month=2027-04&kind=daily&beforeId=${BigInt(rid)+1n}`);
    assert.ok(list.items.find((r:Row)=>r.reportId===rid).readAt);return {reportId:rid,read:true,sameKey:true};
  });
  report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=(e as Error).stack;process.exitCode=1;}).finally(async()=>{
  try{
    if(runs.length)await read(tx=>tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${eid} and ${JSON.stringify(runs)}::jsonb ? run_id::text and status in ('queued','running')`));
    if(runs.length)await read(tx=>tx.execute(sql`update app.assistant_runs set status='cancelled',error_code='synthetic_fixture_stopped',completed_at=now() where enterprise_id=${eid} and purpose='construction.report.facts' and ${JSON.stringify(runs)}::jsonb ? id::text and status in ('queued','running')`));
    if(bindingBefore){const a=actors.find(a=>a.name==='boss')!;const svc=new FollowupService({enterpriseId:eid,principal:{kind:'admin',adminId:String(a.id)},contextVersion:0,capabilities:['assistant.followup.self']});
      const b=await svc.context(bid);if(b.status!=='stopped')await svc.change(bid,'stop',b.version,randomUUID());}
    if(policyBefore){const current=reportPlanDto(await plan.settings(),eid),old=reportPlanDto(policyBefore,eid);await plan.configure({expectedVersion:current.version,enabled:old.enabled,stageEnabled:old.stageEnabled,dailyTime:old.dailyTime,weeklyTime:old.weeklyTime,weeklyDay:old.weeklyDay,projectIds:old.projectIds,stageKeys:old.stageKeys,audiences:old.audiences,inactivePolicy:old.inactivePolicy},randomUUID());}
    for(const p of projectBefore)await restoreProject(p);
    for(const a of accounts)await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status=${a.status} where id=${String(a.id)}`));
    report.accountingAfter=await accounting();assert.deepEqual(report.accountingAfter,report.accountingBefore);
    report.queue=await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));assert.equal((report.queue as Row).n,0);
    report.cleanup=true;
  }catch(e){report.passed=false;report.cleanup=false;report.cleanupError=(e as Error).stack;process.exitCode=1;}
  try{const after=bind();report.drift=Object.keys(before).filter(f=>before[f]!==after[f]);fs.writeFileSync(path.join(output,'binding.json'),JSON.stringify({before,after,drift:report.drift},null,2));assert.deepEqual(report.drift,[]);}
  catch(e){report.passed=false;report.bindingError=(e as Error).stack;process.exitCode=1;}
  for(const name of fs.readdirSync(output)){if(originalOutputFiles.has(name)||!/^cli-args-[0-9a-f-]{36}\.private\.json$/i.test(name))continue;
    const target=path.resolve(output,name);assert.equal(path.dirname(target),output);fs.rmSync(target);}
  if(release)await release();await closePostgresPool();save();
});
