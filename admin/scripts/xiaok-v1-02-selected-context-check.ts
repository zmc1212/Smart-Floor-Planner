/** Zero-model V1-02 selected-enterprise management regression; local fixtures only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { MiniProgramIdentityRepository, EnterpriseRepository } from '@/db/repositories';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { ConstructionService } from '@/lib/construction/service';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root=path.resolve('..'), eid='1454', prefix='synthetic-v1-02-selected-context-'+randomUUID();
const out=path.resolve(process.argv.find(v=>v.startsWith('--output='))?.slice(9)||'../tmp/v1-02-followup-management/http-01');
const reusedControl=process.argv.find(v=>v.startsWith('--reuse-control='))?.slice(16);
const nativeScript=process.argv.find(v=>v.startsWith('--native-script='))?.slice(16);
const nativeOnly=process.argv.includes('--native-only');
assert.ok(!nativeOnly||nativeScript,'Native-only requires its fixed driver');
assert.ok(!fs.existsSync(path.join(out,'report.json')), 'Retain every original batch'); fs.mkdirSync(out,{recursive:true});
const fixedChecks=['labelled local fixtures and unchanged employment','owner admin super_admin explicit selected context and refresh',
  'management scope through original construction and followup services','explicit open and idempotent same destination',
  'other principals and enterprise isolation','ordinary staff cannot select another enterprise',
  'missing inactive stale disabled and password boundaries','unchanged provider knowledge policy and fixture cleanup'];
const report: Row={prefix,startedAt:new Date().toISOString(),fixedChecks,checks:[]};
if(nativeOnly)report.fixedChecks=['same labelled local fixtures','Stable selected-enterprise UI checks in native.json','original accounting and cleanup'];
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const hash=(p:string)=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const files=execFileSync('rg',['--files','admin/src/db','admin/src/lib/construction','admin/src/lib/assistant','admin/drizzle','admin/src/app/api/miniprogram','admin/src/lib',...(nativeOnly?['miniprogram']:[])],{cwd:root,encoding:'utf8'})
  .trim().split(/\r?\n/).map(p=>p.replaceAll('\\','/'));
files.push('admin/scripts/xiaok-v1-02-selected-context-check.ts','admin/scripts/assistant-acceptance-safety.mjs',
  'admin/src/app/api/auth/miniprogram/route.ts','admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/.env.local');
if(nativeScript)files.push(path.relative(root,path.resolve(nativeScript)).replaceAll('\\','/'),
  'admin/scripts/wechatide-native-client.ts','tmp/wechat-devtools-version-test/window.ps1',
  'tmp/v1-02-followup-management/native.cjs');
const binding=()=>Object.fromEntries([...new Set(files)].sort().map(p=>[p,hash(p)]));
const before=binding();
const accounts: Row[]=[], users: Row[]=[], actors: Array<{id:string;uid:string;role:string;token:string;selected?:string;binding?:string}>=[];
const saveFixtureBefore=()=>fs.writeFileSync(path.join(out,'fixtures-before.private.json'),JSON.stringify({
  accounts:accounts.map(a=>({id:String(a.id),status:a.status,mustChangePassword:a.must_change_password})),users,
},null,2));
let release:(()=>Promise<void>)|undefined, projectBefore:Row|undefined, controlId:string|undefined;
const owner=new ConstructionService({enterpriseId:eid,adminId:'5410'});
const read=<T>(work:Parameters<typeof withTenantTransaction<T>>[1])=>withTenantTransaction(eid,work);
const accounting=()=>withPlatformTransaction(async tx=>({
  providerMax:String((await one(tx,sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax:String((await one(tx,sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown:await one(tx,sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`),
}));
async function step(name:string,work:()=>Promise<unknown>){try{const data=await work();(report.checks as Row[]).push({name,passed:true,data});}
  catch(error){(report.checks as Row[]).push({name,passed:false,error:(error as Error).message});throw error;}finally{save();}}
async function request(token:string,route:string,body?:Row,key?:string,expected=200){
  const response=await fetch('http://localhost:3006/api'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,
    ...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json(); assert.equal(response.status,expected,route+': '+(result.code||result.error||''));
  if(expected===200)assert.equal(result.success,true,route);return result;
}
async function sign(a:typeof actors[number],enterpriseId?:string,version?:number){
  const u=(await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=${a.uid}`)))!;
  return new SignJWT({sub:a.uid,id:a.uid,mode:'staff',role:a.role,staffId:a.id,enterpriseId,
    contextVersion:version??Number(u.context_version),source:'password'}).setProtectedHeader({alg:'HS256'}).setSubject(a.uid)
    .setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}
async function main(){
 const target=new URL(resolvePostgresRuntimeConfig().connectionString);
 assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5432'&&target.pathname==='/smart_floor_planner');
 release=await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL);
 assert.equal((await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n,0);
 report.accountingBefore=await accounting();
 await step(fixedChecks[0],async()=>{
  await withPlatformTransaction(async tx=>{
   for(const id of ['5410','5411','5413','5414']){
    const a=(await one(tx,sql`select * from app.admin_users where id=${id}`))!;
    assert.match(String(a.username),/^synthetic-v1-02-/);assert.equal(a.status,'disabled');accounts.push(a);saveFixtureBefore();
    if(['admin','super_admin'].includes(String(a.role)))assert.equal(a.enterprise_id,null);
    await tx.execute(sql`update app.admin_users set status='active' where id=${id}`);
    const u=(await new MiniProgramIdentityRepository(tx).findUserById(BigInt(String(a.user_id))))!;
    users.push({id:String(u.id),phone:u.phone});saveFixtureBefore();
    if(!u.phone)await tx.execute(sql`update app.users set phone=${'199'+String(u.id).padStart(8,'0')} where id=${String(u.id)}`);
    actors.push({id,uid:String(u.id),role:String(a.role),token:''});
   }
   const repository=new EnterpriseRepository(tx);
   const control=reusedControl?await repository.findById(BigInt(reusedControl))
     :await repository.create({name:'合成测试·跟进选企隔离',code:prefix,status:'active'});
   assert.ok(control);assert.match(control.code,/^synthetic-v1-02-selected-context-/);
   if(reusedControl){assert.equal(control.status,'disabled');await repository.update(control.id,{status:'active'});}
   controlId=String(control.id);
  });
  for(const a of actors)a.token=await sign(a,a.role==='admin'||a.role==='super_admin'?undefined:eid);
  projectBefore=(await owner.execute('detail',{projectId:'248'})).project as Row;
  assert.match(String(projectBefore.name),/^合成测试/);assert.equal(projectBefore.status,'archived');
  await owner.execute('update',{projectId:'248',expectedVersion:projectBefore.version,name:projectBefore.name,status:'active',customerAccess:false},randomUUID());
  report.fixtures={enterpriseId:eid,controlId,adminIds:actors.map(a=>a.id),projectId:'248'};
  return {globalEmploymentUnchanged:true,projectId:'248',controlId};
 });
 if(nativeOnly){
  for(const a of actors.filter(a=>a.role!=='construction_staff'))a.selected=await sign(a,eid);
  const native=(await import(pathToFileURL(path.resolve(nativeScript!)).href)).default;
  report.native=await native({root,output:out,actors,enterpriseId:eid,controlId});return;
 }
 await step(fixedChecks[1],async()=>{
  for(const a of actors.filter(a=>a.role!=='construction_staff')){
   const r=await request(a.token,'/miniprogram/identity-contexts/switch',{mode:'staff',staffId:a.id,enterpriseId:eid});
   assert.equal(r.context.enterpriseId,eid);assert.equal(r.context.staffId,a.id);a.selected=String(r.token);
   const refreshed=await request(a.selected,'/auth/miniprogram',{type:'refresh',token:a.selected});
   assert.equal(refreshed.context.enterpriseId,eid);assert.equal(refreshed.user.enterpriseId,eid);a.selected=String(refreshed.token);
   const boot=await request(a.selected,'/miniprogram/bootstrap');assert.equal(boot.current.context.enterpriseId,eid);
  }
  return {roles:['enterprise_admin','admin','super_admin'],switchRefreshBootstrap:true};
 });
 await step(fixedChecks[2],async()=>{
  for(const a of actors.filter(a=>a.selected)){
   const p=await request(a.selected!,'/miniprogram/construction/projects');assert.equal(p.data.owner,true);
   assert.ok(p.data.items.some((p:Row)=>p.id==='248'));
   await request(a.selected!,'/miniprogram/assistant/followups');
  }return {roles:3,originalOwnerScope:true};
 });
 await step(fixedChecks[3],async()=>{
  for(const a of actors.filter(a=>a.selected)){
   const key=randomUUID(),r=await request(a.selected!,'/miniprogram/assistant/followups/open',{},key);
   a.binding=String(r.data.bindingId);
   const replay=await request(a.selected!,'/miniprogram/assistant/followups/open',{},key);assert.deepEqual(replay,r);
   const context=await request(a.selected!,'/miniprogram/assistant/followups/'+a.binding);
   assert.equal(context.data.audience,'boss');assert.equal(context.data.enterprise.id,eid);
  }return {sameKeyStable:true,bindings:actors.filter(a=>a.binding).map(a=>({adminId:a.id,bindingId:a.binding}))};
 });
 await step(fixedChecks[4],async()=>{
  const a=actors.find(a=>a.role==='admin')!,boss=actors.find(a=>a.role==='enterprise_admin')!;
  await request(a.selected!,'/miniprogram/assistant/followups/'+boss.binding,undefined,undefined,404);
  const other=await request(a.selected!,'/miniprogram/identity-contexts/switch',{mode:'staff',staffId:a.id,enterpriseId:controlId});
  assert.equal(other.context.enterpriseId,controlId);
  await request(other.token,'/miniprogram/assistant/followups/'+a.binding,undefined,undefined,404);
  await request(a.selected!,'/miniprogram/assistant/followups?enterpriseId='+controlId,undefined,undefined,422);
  return {ownPrincipalOnly:true,selectedTenantIsSigned:true};
 });
 await step(fixedChecks[5],async()=>{
  const a=actors.find(a=>a.role==='construction_staff')!;
  await request(a.token,'/miniprogram/identity-contexts/switch',{mode:'staff',staffId:a.id,enterpriseId:controlId},undefined,403);
  const forged=await sign(a,controlId);await request(forged,'/miniprogram/assistant/followups',undefined,undefined,401);
  return {tenantStaffCannotSwitch:true,forgedCrossTenantRejected:true};
 });
 await step(fixedChecks[6],async()=>{
  const a=actors.find(a=>a.role==='admin')!;
  await request(a.token,'/miniprogram/assistant/followups',undefined,undefined,403);
  await request(a.token,'/miniprogram/identity-contexts/switch',{mode:'staff',staffId:a.id,enterpriseId:'9223372036854775807'},undefined,403);
  const cv=Number((await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=${a.uid}`)))!.context_version);
  await request(await sign(a,eid,cv-1),'/miniprogram/assistant/followups',undefined,undefined,401);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=true where id=${a.id}`));
  try{await request(a.selected!,'/miniprogram/assistant/followups',undefined,undefined,403);}
  finally{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=false where id=${a.id}`));}
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='disabled' where id=${a.id}`));
  try{await request(a.selected!,'/miniprogram/assistant/followups',undefined,undefined,401);}
  finally{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=${a.id}`));}
  await withPlatformTransaction(tx=>new EnterpriseRepository(tx).update(BigInt(controlId!),{status:'disabled'}));
  await request(a.selected!,'/miniprogram/identity-contexts/switch',{mode:'staff',staffId:a.id,enterpriseId:controlId},undefined,403);
  return {requiresSelection:true,inactiveAndMissingRejected:true,currentIdentityAndPasswordPreserved:true};
 });
}
main().catch(error=>{report.error=(error as Error).message;process.exitCode=1;}).finally(async()=>{
 try{
  if(!release)return;
  for(const a of actors.filter(a=>a.binding&&a.selected)){
   const c=await request(a.selected!,'/miniprogram/assistant/followups/'+a.binding);
   if(c.data.status!=='stopped')await request(a.selected!,`/miniprogram/assistant/followups/${a.binding}/stop`,{expectedVersion:c.data.version},randomUUID());
  }
  if(projectBefore){const p=(await owner.execute('detail',{projectId:'248'})).project as Row;
   await owner.execute('update',{projectId:'248',expectedVersion:p.version,name:projectBefore.name,status:projectBefore.status,customerAccess:projectBefore.customer_access},randomUUID());}
  await withPlatformTransaction(async tx=>{
   for(const u of users)await tx.execute(sql`update app.users set phone=${u.phone as string|null} where id=${String(u.id)}`);
   for(const a of accounts)await tx.execute(sql`update app.admin_users set status=${String(a.status)},must_change_password=${a.must_change_password as boolean} where id=${String(a.id)}`);
  });
  if(controlId)await withPlatformTransaction(tx=>new EnterpriseRepository(tx).update(BigInt(controlId!),{status:'disabled'}));
  const after=await accounting();assert.deepEqual(after,report.accountingBefore);report.accountingAfter=after;
  const queue=await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));assert.equal(queue!.n,0);
  const employment=await withPlatformTransaction(tx=>rows(tx,sql`select id::text,enterprise_id::text,status from app.admin_users where id in (5413,5414)`));
  assert.ok(employment.every(a=>a.enterprise_id===null&&a.status==='disabled'));
  const policy=await read(tx=>one(tx,sql`select enabled,version from app.construction_report_settings where enterprise_id=${eid}`));assert.equal(policy!.enabled,false);
  report.cleanup={queue,employment,policy};
  if(!report.error)await step(fixedChecks[7],async()=>({zeroProviderKnowledgeDelta:true,restoredFixtures:true}));
 }catch(error){report.cleanupError=(error as Error).message;process.exitCode=1;}
 finally{
  const after=binding(),drift=Object.keys(before).filter(p=>before[p]!==after[p]);
  fs.writeFileSync(path.join(out,'binding.json'),JSON.stringify({before,after,drift},null,2));
  if(drift.length){report.drift=drift;process.exitCode=1;}
  if(release)await release();await closePostgresPool();report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({checks:report.checks,error:report.error,cleanupError:report.cleanupError,drift}));
 }
});
