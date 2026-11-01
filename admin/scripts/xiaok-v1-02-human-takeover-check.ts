/** Approved11: real local handoff/messages/report isolation. No model/ingestion. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import sharp from 'sharp';
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
const output = path.resolve(arg('output') || '../tmp/v1-02-human-takeover/http-01'), reuse = arg('fixture'), nativeScript = arg('native-script'), cleanupOnly = arg('finish-cleanup'), remaining = arg('remaining');
assert.ok(process.argv.includes('--development'));
const database = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1','localhost'].includes(database.hostname) && database.port === '5432' && database.pathname === '/smart_floor_planner');
assert.ok(!fs.existsSync(path.join(output,'report.json')), 'Retain original evidence'); fs.mkdirSync(output,{recursive:true});
const report: Row = { startedAt: new Date().toISOString(), fixedScope: ['same private destination and original reception grants',
  'human/waiting messages, original-key recovery and real staff reply', 'saved reports remain readable, no AI insertion/backlog',
  'media/current owner/member/tenant isolation', 'explicit end/cancel, reentry and cleanup'], checks: [] };
const save = () => fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
const files = execFileSync('rg',['--files','admin/src','admin/drizzle','miniprogram'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).map(f=>f.replaceAll('\\','/'));
files.push('admin/scripts/xiaok-v1-02-human-takeover-check.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/.env.local');
if(nativeScript){
  files.push(path.relative(root,path.resolve(nativeScript)).replaceAll('\\','/'),'admin/scripts/wechatide-native-client.ts','tmp/wechat-devtools-version-test/window.ps1','tmp/v1-02-human-takeover/host-passive.ps1','tmp/v1-02-human-takeover/native.cjs');
  const install='D:/微信开发工具/微信web开发者工具';files.push(install+'/微信开发者工具.exe',install+'/resources/app.asar');
  const walk=(d:string)=>{for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);if(x.isDirectory())walk(f);else if(/\.(js|cjs|json|node)$/.test(f))files.push(f);}};
  walk(install+'/resources/app.asar.unpacked/js/common/cli');
}
const bind=()=>Object.fromEntries([...new Set(files)].sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.isAbsolute(f)?f:path.join(root,f))).digest('hex')]));
const before=bind(), read=<T>(fn:Parameters<typeof withTenantTransaction<T>>[1])=>withTenantTransaction(eid,fn);
const owner=new ConstructionService({enterpriseId:eid,adminId:'5410'}), plan=new ConstructionReportService(owner.actor);
const accounts:Row[]=[], users:Row[]=[], runs:string[]=[], savedReports:Row[]=[], actors: Array<{name:string;uid:string;id:string;role:string;token:string;entry?:string}>=[];
let release:(()=>Promise<void>)|undefined, pid='', bid='', cid='', policyBefore:Row|undefined;
const accounting=()=>withPlatformTransaction(async tx=>({providerMax:String((await one(tx,sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax:String((await one(tx,sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown:await one(tx,sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`)}));
const controls=()=>read(tx=>rows(tx,sql`select b.id::text,b.status,b.conversation_id::text,c.mode from app.construction_followup_bindings b
  join app.assistant_conversations c on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id where b.enterprise_id=${eid} and b.id in(27,50)`));
async function step(name:string,fn:()=>Promise<unknown>){try{const data=await fn();(report.checks as Row[]).push({name,passed:true,data});console.log(name+': PASS');return data;}
  catch(e){(report.checks as Row[]).push({name,passed:false,error:(e as Error).stack});throw e;}finally{save();}}
async function http(name:string,suffix:string,body?:Row,requestKey=randomUUID(),expected=200,base='followups'){
  const a=actors.find(a=>a.name===name)!;
  const response=await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/'+base+suffix,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+a.token,...(a.entry?{'X-Assistant-Entry':a.entry}:{}),...(body?{'Content-Type':'application/json','Idempotency-Key':requestKey}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.equal(response.status,expected,name+'/'+base+suffix+': '+response.status+'/'+data.code);return expected===200?data.data:data;
}
const getBinding=()=>read(async tx=>(await one(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!);
const customerActor=()=>({enterpriseId:eid,principal:{kind:'user' as const,userId:'3914'},contextVersion:0,capabilities:['assistant.followup.self']});
async function updateProject(customerAccess:boolean,status='active'){
  const p=(await owner.execute('detail',{projectId:pid})).project as Row;
  return owner.execute('update',{projectId:pid,expectedVersion:p.version,name:p.name,status,customerAccess},randomUUID());
}
async function ownerStatus(status:string){assert.ok(['active','disabled'].includes(status));await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status=${status} where id=5419 and username like 'synthetic-v1-02-%'`));}
async function createReport(kind:'daily'|'weekly',at:string,defer=false){
  const made=await read(async tx=>enqueueReport(tx,eid,(await getBindingIn(tx)),(await one(tx,sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!,
    latestReportPeriod(kind,new Date(at),kind==='daily'?'20:00':'08:00')));
  assert.ok(made);runs.push(made.runId);savedReports.push({...made,kind});report.savedReports=savedReports;save();
  if(!defer)await finishReport(made.runId);
  return made;
}
async function finishReport(runId:string){
  for(let n=0;n<20;n++){
    const state=await read(tx=>one(tx,sql`select status from app.assistant_jobs where enterprise_id=${eid} and run_id=${runId}`));
    if(!['queued','running'].includes(String(state?.status)))break;
    const job=await claimJob();if(!job){await new Promise(r=>setTimeout(r,50));continue;}
    assert.equal(job.enterpriseId,eid);assert.ok(runs.includes(job.runId));await processConstructionReport(job);
  }
  const v=await read(tx=>one(tx,sql`select status from app.construction_report_versions where enterprise_id=${eid} and run_id=${runId}`));
  assert.equal(v?.status,'facts_ready');
}
async function getBindingIn(tx:Parameters<Parameters<typeof withTenantTransaction>[1]>[0]){return (await one(tx,sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${bid}`))!;}
async function main(){
  release=await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL,{waitForLock:true});
  assert.equal((await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where status in('queued','running')`)))!.n,0);
  report.accountingBefore=await accounting();report.controlsBefore=await controls();
  if(cleanupOnly){
    const source=path.resolve(cleanupOnly),old=JSON.parse(fs.readFileSync(source,'utf8')),saved=JSON.parse(fs.readFileSync(path.join(path.dirname(source),'fixtures-before.private.json'),'utf8'));
    assert.equal(old.cleanup,false);assert.deepEqual(old.drift,[]);accounts.push(...saved.accounts);users.push(...saved.users);
    pid=old.projectId;bid=old.bindingId;cid=old.conversationId;savedReports.push(...old.savedReports);runs.push(...old.savedReports.map((r:Row)=>String(r.runId)));
    policyBefore=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-02-report-history/native-07-final-visual/fixtures-before.private.json'),'utf8')).policyBefore;
    report.policyRecovery={source:'tmp/v1-02-report-history/native-07-final-visual/fixtures-before.private.json',scope:'unchanged user configuration; semantic restore only, not version/timestamp rollback'};
    const u=(await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=3914`)))!;
    const token=await new SignJWT({sub:'3914',id:'3914',mode:'customer',role:'user',enterpriseId:eid,contextVersion:Number(u.context_version),source:'password'})
      .setProtectedHeader({alg:'HS256'}).setSubject('3914').setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    actors.push({name:'customer',uid:'3914',id:'3914',role:'user',token});
    const entry=await http('customer','',{leadId:'3143'},undefined,200,'entry-context');actors[0].entry=entry.entryToken;
    report.accountingBefore=old.accountingBefore;report.controlsBefore=old.controlsBefore;report.reusedFailure=old.error;
    report.projectId=pid;report.bindingId=bid;report.conversationId=cid;report.savedReports=savedReports;report.passed=true;return;
  }
  await step('canonical local0107 guard migration',async()=>{
    const latest=await read(tx=>one(tx,sql`select max(created_at)::text at from app.__drizzle_migrations`));
    if(Number(latest?.at)<1794038400000){const x=spawnSync(process.execPath,['scripts/postgres-migrate.mjs'],{encoding:'utf8',windowsHide:true});
      fs.writeFileSync(path.join(output,'migration.log'),x.stdout+x.stderr);assert.equal(x.status,0);}
    return read(tx=>one(tx,sql`select max(created_at)::text at from app.__drizzle_migrations`));
  });
  await step('labelled customer project and original Mini identities',async()=>{
    await withPlatformTransaction(async tx=>{
      for(const [name,id] of [['boss','5410'],['designer','5419']]){
        const a=(await one(tx,sql`select * from app.admin_users where id=${id}`))!;assert.match(String(a.username),/^synthetic-v1-02-/);assert.equal(a.status,'disabled');accounts.push(a);
        const u=(await one(tx,sql`select id,phone,context_version from app.users where id=${String(a.user_id)}`))!;users.push(u);
        fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,users}));
        await tx.execute(sql`update app.admin_users set status='active' where id=${id}`);
        if(!u.phone)await tx.execute(sql`update app.users set phone=${'199'+String(u.id).padStart(8,'0')} where id=${String(u.id)}`);
        actors.push({name,id,uid:String(a.user_id),role:String(a.role),token:''});
      }
      actors.push({name:'customer',id:'3914',uid:'3914',role:'user',token:''},{name:'other',id:'3915',uid:'3915',role:'user',token:''});
    });
    for(const a of actors){const u=(await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=${a.uid}`)))!;
      a.token=await new SignJWT({sub:a.uid,id:a.uid,mode:a.role==='user'?'customer':'staff',role:a.role,...(a.role!=='user'?{staffId:a.id}:{}),enterpriseId:eid,
        contextVersion:Number(u.context_version),source:'password'}).setProtectedHeader({alg:'HS256'}).setSubject(a.uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));}
    if(reuse){const old=JSON.parse(fs.readFileSync(path.resolve(reuse),'utf8'));assert.equal(old.cleanup,true);assert.deepEqual(old.drift,[]);
      pid=old.projectId;bid=old.bindingId;cid=old.conversationId;savedReports.push(...old.savedReports);report.reused={source:path.resolve(reuse),sha256:createHash('sha256').update(fs.readFileSync(path.resolve(reuse))).digest('hex'),businessReplay:false};
      const p=(await owner.execute('detail',{projectId:pid})).project as Row;assert.match(String(p.name),/^合成测试11/);assert.equal(p.status,'archived');await updateProject(true);
    }else{const lead=(await read(tx=>one(tx,sql`select name from app.leads where enterprise_id=${eid} and id=3143`)))!;assert.match(String(lead.name),/^synthetic-v1-02-|^合成测试/);
      const p=await owner.execute('create',{leadId:'3143',name:'合成测试11·人工接待',managerId:'5410',rooms:[]},randomUUID());pid=String(p.id);report.projectId=pid;save();await updateProject(true);
      const current=(await owner.execute('detail',{projectId:pid})).project as Row;
      await owner.execute('progress',{projectId:pid,expectedVersion:current.version,stageKey:'utilities',note:'合成测试11：水电人工接待',sendReminder:false},randomUUID());}
    const entry=await http('customer','',{leadId:'3143'},undefined,200,'entry-context');actors.find(a=>a.name==='customer')!.entry=entry.entryToken;
    const otherEntry=await http('other','',{leadId:'3144'},undefined,200,'entry-context');actors.find(a=>a.name==='other')!.entry=otherEntry.entryToken;
    const op=await http('customer','/open',{projectId:pid});bid=op.bindingId;cid=op.conversationId;
    const b=await getBinding();if(b.status!=='enabled')await http('customer','/'+bid+'/resume',{expectedVersion:Number(b.version)});
    policyBefore=await plan.settings();assert.equal(policyBefore.enabled,false);
    fs.writeFileSync(path.join(output,'fixtures-before.private.json'),JSON.stringify({accounts,users,policyBefore}));
    const dto=reportPlanDto(policyBefore,eid);await plan.configure({expectedVersion:dto.version,enabled:true,stageEnabled:false,projectIds:[pid],stageKeys:[],audiences:['customer'],
      dailyTime:'20:00',weeklyTime:'08:00',weeklyDay:1,inactivePolicy:'pause_inactive'},randomUUID());
    report.projectId=pid;report.bindingId=bid;report.conversationId=cid;report.savedReports=savedReports;save();
    return {projectId:pid,bindingId:bid,conversationId:cid};
  });
  if(!reuse)await step('a real durable report before reception',async()=>{
    const r=await createReport('daily','2027-06-01T20:00:00+08:00');assert.equal(await deliverConstructionReports(eid),1);
    const view=await http('customer',`/${bid}/reports/${r.reportId}`);assert.equal(view.available,true);assert.equal(view.deliveryState,'delivered');return {reportId:r.reportId,state:view.state};
  });
  if(nativeScript){const native=(await import(pathToFileURL(path.resolve(nativeScript)).href)).default;
    report.native=await native({root,output,actors,bindingId:bid,conversationId:cid,projectId:pid,savedReports,http,ownerStatus});report.passed=true;return;}
  if(remaining){const old=JSON.parse(fs.readFileSync(path.resolve(remaining),'utf8'));
    assert.equal(old.checks.length,9);assert.ok(old.checks.slice(0,8).every((c:Row)=>c.passed));assert.deepEqual(old.drift,[]);
    const prior=JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(remaining)),'binding.json'),'utf8'));
    const changed=Object.keys(prior.before).filter(p=>before[p]!==prior.before[p]);assert.deepEqual(changed,['admin/scripts/xiaok-v1-02-human-takeover-check.ts']);
    report.reusedChecks=old.checks.slice(0,8);report.reusedBindingChanges=changed;
  }else{
  await step('waiting supplements, real staff claim and current private participant',async()=>{
    const queued=await createReport('daily','2027-06-08T20:00:00+08:00',true);
    const requested=await http('customer',`/${bid}/conversation/handoff`,{action:'request',consent:true});assert.equal(requested.mode,'handoff_requested');
    const k=randomUUID();const sent=await http('customer',`/${bid}/conversation/messages`,{clientMessageId:k,content:{version:1,blocks:[{type:'text',text:'厨房插座的位置我想再确认一下，先不要改。'}]}},k);
    assert.equal(sent.runId,null);assert.equal(sent.status,'succeeded');
    const list=await http('designer','',undefined,undefined,200,'handoffs');assert.ok(list.items.some((c:Row)=>c.conversationId===cid));
    await http('designer','/'+cid,{action:'claim'},undefined,200,'handoffs');
    const job=await read(tx=>one(tx,sql`select status from app.assistant_jobs where enterprise_id=${eid} and run_id=${queued.runId}`));assert.equal(job!.status,'queued');
    await finishReport(queued.runId);assert.equal(await deliverConstructionReports(eid),0);
    const c=await http('customer',`/${bid}/conversation`);assert.equal(c.mode,'human');assert.equal(c.ownerAvailable,true);
    return {sameDestination:c.id,mode:c.mode,queuedReportSurvivedRequestAndClaim:queued.runId};
  });
  await step('human text/reply and original-key exact replay without an AI run',async()=>{
    const k=randomUUID(),body={clientMessageId:k,content:{version:1,blocks:[{type:'text',text:'我刚才说漏了，阳台不需要插座。'}]}};
    const first=await http('customer',`/${bid}/conversation/messages`,body,k),again=await http('customer',`/${bid}/conversation/messages`,body,k);assert.equal(first.messageId,again.messageId);
    await http('customer',`/${bid}/conversation/messages`,{...body,content:{version:1,blocks:[{type:'text',text:'不同内容'}]}},k,409);
    await http('designer','/'+cid,{action:'reply',text:'收到，我先核对厨房的位置；阳台这项按你的补充再确认。'},undefined,200,'handoffs');
    const messages=await http('customer',`/${bid}/conversation/messages`);assert.ok(messages.items.some((m:Row)=>m.authorKind==='admin'));
    const counts=await read(tx=>one(tx,sql`select count(*)::int n from app.assistant_runs where enterprise_id=${eid} and conversation_id=${cid} and purpose='chat_turn'`));assert.equal(counts!.n,0);
    return {messageId:first.messageId,chatRuns:counts!.n,messages:messages.items.length};
  });
  await step('original private photo upload and consented staff read',async()=>{
    const bytes=await sharp({create:{width:40,height:30,channels:3,background:'#dcc9a6'}}).png().toBuffer();
    const image=await http('customer',`/${bid}/conversation/media`,{data:bytes.toString('base64'),kind:'image',roomName:''});
    const media=await http('designer','/'+cid+'/media',undefined,undefined,200,'handoffs');assert.ok(media.items.some((m:Row)=>m.id===image.id));
    const staff=actors.find(a=>a.name==='designer')!;
    const response=await fetch(`http://127.0.0.1:3006/api/miniprogram/assistant/handoffs/${cid}/media/${image.id}`,{headers:{Authorization:'Bearer '+staff.token}});assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>0);
    return {mediaId:image.id,privateBytesReadable:true};
  });
  await step('background facts save during human reception; history reads never resume AI',async()=>{
    for(const day of ['02','03'])await createReport('daily',`2027-06-${day}T20:00:00+08:00`);
    await createReport('weekly','2027-06-07T08:00:00+08:00');assert.equal(await deliverConstructionReports(eid),0);
    const deliveries=await read(tx=>rows(tx,sql`select state from app.construction_report_deliveries where enterprise_id=${eid} and binding_id=${bid} and state='held'`));assert.equal(deliveries.length,4);
    const index=await http('customer',`/${bid}/reports`);assert.equal(index.items.length,5);
    for(const r of index.items){const detail=await http('customer',`/${bid}/reports/${r.reportId}`);assert.equal(detail.available,true);}
    assert.equal((await http('customer',`/${bid}/conversation`)).mode,'human');return {held:deliveries.length,readable:index.items.length,aiPaused:true};
  });
  await step('unavailable owner keeps AI paused, while explicit end revokes the original grant and backlog',async()=>{
    await ownerStatus('disabled');try{const c=await http('customer',`/${bid}/conversation`);assert.equal(c.ownerAvailable,false);assert.equal(c.mode,'human');
      const k=randomUUID();await http('customer',`/${bid}/conversation/messages`,{clientMessageId:k,content:{version:1,blocks:[{type:'text',text:'接待人回来后再说。'}]}},k,409);
      assert.equal((await http('customer',`/${bid}/reports`)).items.length,5);
    }finally{await ownerStatus('active');}
    const queued=await createReport('daily','2027-06-09T20:00:00+08:00',true);
    const k=randomUUID(),first=await http('customer',`/${bid}/conversation/handoff`,{action:'end'},k);
    const second=await http('customer',`/${bid}/conversation/handoff`,{action:'end'},k);assert.equal(first.mode,'ai');assert.equal(second.mode,'ai');
    await http('designer','/'+cid,undefined,undefined,404,'handoffs');await finishReport(queued.runId);assert.equal(await deliverConstructionReports(eid),0);
    assert.equal((await read(tx=>one(tx,sql`select count(*)::int n from app.construction_report_deliveries where enterprise_id=${eid} and binding_id=${bid} and state='held'`)))!.n,0);
    assert.equal((await http('customer',`/${bid}/reports`)).items.length,6);return {explicitResume:true,noBacklogInserted:true,queuedReportFinishedAfterEnd:queued.runId};
  });
  }
  await step('customer/tenant/identity boundaries and current project withdrawal',async()=>{
    await http('other',`/${bid}/conversation`,undefined,undefined,404);await http('designer',`/${bid}/conversation`,undefined,undefined,403);
    await assert.rejects(new FollowupService({...customerActor(),enterpriseId:'2759'}).context(bid));
    const u=(await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=3914`)))!;
    const stale=await new SignJWT({sub:'3914',id:'3914',mode:'customer',role:'user',enterpriseId:eid,contextVersion:Number(u.context_version)+1,source:'password'})
      .setProtectedHeader({alg:'HS256'}).setSubject('3914').setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    actors.push({name:'stale',uid:'3914',id:'3914',role:'user',token:stale});await http('stale',`/${bid}/conversation`,undefined,undefined,401);
    await http('customer',`/${bid}/conversation/handoff`,{action:'request',consent:true});await http('designer','/'+cid,{action:'claim'},undefined,200,'handoffs');
    await updateProject(false);await http('customer',`/${bid}/conversation`,undefined,undefined,404);await http('customer',`/${bid}/reports`,undefined,undefined,404);
    await http('designer','/'+cid,undefined,undefined,404,'handoffs');const list=await http('designer','',undefined,undefined,200,'handoffs');assert.ok(!list.items.some((x:Row)=>x.conversationId===cid));
    await updateProject(true);await http('customer',`/${bid}/conversation/handoff`,{action:'end'});
    await http('customer',`/${bid}/conversation/handoff`,{action:'request',consent:true});await http('customer',`/${bid}/conversation/handoff`,{action:'cancel'});
    const counts=await read(tx=>one(tx,sql`select count(*)::int n from app.assistant_participants where enterprise_id=${eid} and conversation_id=${cid} and participant_role='handoff_staff' and status='active'`));assert.equal(counts!.n,0);
    return {otherCustomerDenied:true,staffPrivateDenied:true,currentWithdrawal:true,cancelled:true};
  });
  report.passed=true;
}
async function run(){
try{await main();}catch(e){report.passed=false;report.error=(e as Error).stack;console.error((e as Error).message);process.exitCode=1;}
finally{
  try{
    if(accounts.length){
      if(pid&&bid){await updateProject(true);const c=await http('customer',`/${bid}/conversation`);
        if(['human','handoff_requested'].includes(c.mode))await http('customer',`/${bid}/conversation/handoff`,{action:c.mode==='human'?'end':'cancel'});
        const b=await getBinding();if(b.status==='enabled'){const a=customerActor();a.contextVersion=Number((await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=3914`)))!.context_version);
          await new FollowupService(a).change(bid,'stop',Number(b.version),randomUUID());}}
      for(const run of runs)await read(async tx=>{await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='synthetic_fixture_closed' where enterprise_id=${eid} and run_id=${run} and status in('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='cancelled',completed_at=now() where enterprise_id=${eid} and id=${run} and purpose='construction.report.facts' and status in('queued','running')`);});
      if(policyBefore){const v=reportPlanDto(await plan.settings(),eid);await plan.configure({expectedVersion:v.version,enabled:false,stageEnabled:policyBefore.stage_enabled!==false,
        projectIds:policyBefore.project_ids||[],stageKeys:policyBefore.stage_keys||[],audiences:policyBefore.audiences||['customer','worker','designer','boss'],dailyTime:String(policyBefore.daily_time),weeklyTime:String(policyBefore.weekly_time),
        weeklyDay:Number(policyBefore.weekly_day||1),inactivePolicy:policyBefore.inactive_policy||'pause_inactive'},randomUUID());}
      if(pid)await updateProject(false,'archived');
      await withPlatformTransaction(async tx=>{for(const a of accounts)await tx.execute(sql`update app.admin_users set status=${String(a.status)} where id=${String(a.id)}`);
        for(const u of users)if(!u.phone)await tx.execute(sql`update app.users set phone=${u.phone as string|null} where id=${String(u.id)}`);});
    }
    report.accountingAfter=await accounting();assert.deepEqual(report.accountingAfter,report.accountingBefore);
    report.controlsAfter=await controls();assert.deepEqual(report.controlsAfter,report.controlsBefore);
    report.finalState=await withPlatformTransaction(async tx=>({queue:(await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in('queued','running')`))!.n,
      policy:await one(tx,sql`select enabled,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`),
      project:pid?await one(tx,sql`select id::text,status,customer_access from app.construction_projects where enterprise_id=${eid} and id=${pid}`):null,
      binding:bid?await one(tx,sql`select b.id::text,b.status,b.conversation_id::text,c.mode from app.construction_followup_bindings b join app.assistant_conversations c on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id where b.enterprise_id=${eid} and b.id=${bid}`):null}));
    assert.equal((report.finalState as Row).queue,0);report.cleanup=true;
  }catch(e){report.cleanup=false;report.cleanupError=(e as Error).stack;report.passed=false;console.error('cleanup: '+(e as Error).message);process.exitCode=1;}
  finally{await release?.();await closePostgresPool();}
  const after=bind();report.drift=Object.keys(before).filter(f=>before[f]!==after[f]);if((report.drift as string[]).length){report.passed=false;process.exitCode=1;}
  fs.writeFileSync(path.join(output,'binding.json'),JSON.stringify({before,after},null,2));report.finishedAt=new Date().toISOString();save();
}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
