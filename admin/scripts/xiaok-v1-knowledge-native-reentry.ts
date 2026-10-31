/* eslint-disable @typescript-eslint/no-explicit-any -- Native RPC and fixture JSON are checked at their boundaries. */
/** Saved-answer native verification only. Never sends a new Agent question. */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import {SignJWT,decodeJwt} from 'jose';
import {loadEnvConfig} from '@next/env';
import {withPlatformTransaction,withTenantTransaction} from '@/db/transaction';
import {one} from '@/db/repositories/assistant-repository';
import {sql} from 'drizzle-orm';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '@/lib/postgresql';
import {wechatideNativeClient} from './wechatide-native-client';
import {lockAssistantAcceptance} from './assistant-acceptance-safety.mjs';
import {KnowledgeService} from '@/lib/assistant/knowledge/service';
import {ConstructionService} from '@/lib/construction/service';
loadEnvConfig(process.cwd(),true);
type Row=Record<string,any>;
const root=path.resolve('..'),project=path.join(root,'miniprogram'),label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)||'native-confirmed-01';
assert.match(label,/^[a-z0-9-]+$/);
const output=path.join(root,'tmp/v1-01-weiyun-jingyi',label);fs.mkdirSync(output,{recursive:true});
assert.ok(!fs.existsSync(path.join(output,'report.json')),'Preserve original attempts');
const report:Row={startedAt:new Date().toISOString(),project,modelCalls:0,checks:[],passed:false,
  placement:{confirmed:true,source:'Direct human reply: 已在副屏，可继续自动化',date:'2026-10-31'}};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
const mp=wechatideNativeClient(project,output);
const files=cp.execFileSync('rg',['--files','admin/src/lib/assistant','admin/src/lib/construction','admin/src/db','miniprogram/packages/assistant','miniprogram/packages/construction/chat','miniprogram/utils'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/)
  .filter(file=>/\.(ts|tsx|js|wxml|less|json)$/.test(file)).concat(['admin/scripts/xiaok-v1-knowledge-native-reentry.ts','admin/scripts/wechatide-native-client.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/.env.local','admin/package-lock.json']);
const snapshot=()=>Object.fromEntries(files.sort().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const before=snapshot();report.bindingBefore=before;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let release:(()=>Promise<void>)|undefined;
let installed=false,ownerId='',ownerUserId='',memberToRestore:Row|undefined,faultServer:http.Server|undefined;
const opened:Row[]=[],knowledge=new KnowledgeService({enterpriseId:'1454',adminId:'16'}),construction=new ConstructionService({enterpriseId:'1454',adminId:'16'});
const evaluate=async(source:string,...args:unknown[])=>{const r=await mp.call('automation_evaluate',{project,fnSource:source,args});return r.result.result;};
async function wait<T>(read:()=>Promise<T|false|null|undefined>,name:string,seconds=45):Promise<T>{const end=Date.now()+seconds*1000;
  while(Date.now()<end){const value=await read();if(value)return value;await delay(350);}throw Error('Timed out: '+name);}
async function api(url:string,token:string,method='GET',body?:unknown){const response=await fetch('http://localhost:3006/api'+url,{method,
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();assert.ok(response.ok&&result.success,`${url}: ${response.status}/${result.error||result.code}`);return result.data||result;}
async function session(token:string){const bootstrap=await api('/miniprogram/bootstrap',token);return {token,bootstrap,user:bootstrap.user||{},userId:decodeJwt(token).sub};}
async function login(account:Row){const value=await api('/auth/miniprogram','','POST',{type:'password',username:account.username,password:account.password});
  assert.equal(value.context.enterpriseId,'1454');return session(value.token);}
async function pageAt(route:string){return wait(async()=>{const page=await mp.currentPage();if(page?.path!==route)return null;const data=await page.data();
  if(data.fatal||data.needsLogin)throw Error(JSON.stringify({route,fatal:data.fatal,needsLogin:data.needsLogin,error:data.error}));return !data.loading?page:null;},route);}
async function identity(current:Row,url:string){await evaluate(`function(current){const app=getApp(),s=app.__qaV1KnowledgeNativeReentry;s.memory.clear();s.memory.set('token',current.token);
  app.globalData.token=current.token;app.globalData.bootstrap=current.bootstrap;app.globalData.userInfo=current.user;}`,current);await mp.redirectTo('/'+url);return pageAt(url.split('?')[0]);}
async function capture(name:string,route:string){assert.equal((await mp.currentPage())?.path,route);const stack=await evaluate('function(){return getCurrentPages().map(p=>p.route);}');assert.equal(stack.at(-1),route);
  const file=path.join(output,name+'.png');await mp.screenshot({path:file});const data=fs.readFileSync(file);assert.equal(data.subarray(1,4).toString(),'PNG');
  const result={name,file,route,stack,logical:[390,844],encoded:[data.readUInt32BE(16),data.readUInt32BE(20)]};(report.captures||=[]).push(result);save();return result;}
async function closeSheet(){await evaluate('function(){getCurrentPages().at(-1).closeSheet(true);}');await delay(300);}
async function sourceTap(page:NonNullable<Awaited<ReturnType<typeof mp.currentPage>>>,citationId:string,shared:boolean){const selector=shared?`.record-actions .text-button[data-id="${citationId}"]`:`.citation-chip[data-id="${citationId}"]`;
  const messageId=await evaluate(`function(id,shared){const p=getCurrentPages().at(-1),items=shared?p.data.items:p.data.messages;
    const item=items.find(i=>(shared?(i.response&&i.response.citations)||[]:i.citations||[]).some(c=>String(c.id)===id));
    if(!item)throw Error('Citation not present in actual page data');return String(shared?item.message.id:item.id);}`,citationId,shared);
  await evaluate(`function(target){const p=getCurrentPages().at(-1);p.setData({scrollTarget:''},()=>p.setData({scrollTarget:target}));}`,(shared?'source-':'message-')+messageId);await delay(500);
  const element=await page.$(selector);assert.ok(element,'Actual citation button '+citationId);
  if(!(report.sourceContextCaptured||[]).includes(shared)){await capture(shared?'before-shared-source':'before-customer-source',shared?'packages/construction/chat/chat':'packages/assistant/chat/chat');(report.sourceContextCaptured||=[]).push(shared);save();}
  const position={citationId,selector,offset:await element.offset(),size:await element.size()};(report.sourcePositions||=[]).push(position);save();
  await element.tap();}
async function counts(){return withTenantTransaction('1454',async tx=>({runs:await one(tx,sql`select count(*)::text n,max(id)::text last from app.assistant_runs where enterprise_id=1454`),
  models:await one(tx,sql`select count(*)::text n,max(id)::text last from app.assistant_run_steps where enterprise_id=1454 and kind='agent_model'`)}));}
async function fullChecks(){const securityOnly=process.argv.includes('--security-only'),remainingOnly=securityOnly||process.argv.includes('--remaining-only');
  if(remainingOnly)await check('reuse unchanged customer worker designer native evidence',async()=>{const previous=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi/native-reentry-02/report.json'),'utf8'));
    const names=['customer saved original and persisted native reentry','worker actual shared answer and internal source','designer actual shared answer and internal source'];
    for(const name of names)assert.ok(previous.checks.some((c:Row)=>c.name===name&&c.passed));
    const changed=Object.keys(previous.bindingBefore).filter(file=>file!=='admin/scripts/xiaok-v1-knowledge-native-reentry.ts'&&previous.bindingBefore[file]!==before[file]);
    if(securityOnly){assert.deepEqual(changed.map(file=>file.replaceAll('\\','/')),['miniprogram/packages/construction/chat/chat.js']);
      const old=fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi/native-change-before/miniprogram__packages__construction__chat__chat.js'),'utf8');
      assert.equal(createHash('sha256').update(old).digest('hex'),previous.bindingBefore[changed[0]]);
      const normalize=(s:string)=>s.replace(/\r\n/g,'\n').replace(/  poll\(\)[\s\S]*?\n  refresh\(\)/,'  poll-verified-change\n  refresh()');
      assert.equal(normalize(fs.readFileSync(path.join(root,'miniprogram/packages/construction/chat/chat.js'),'utf8')),normalize(old));
      const prior=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi/native-reentry-03/report.json'),'utf8'));
      for(const name of ['boss actual shared answer and internal source','native deterministic project query writes and reenters without Agent dispatch'])assert.ok(prior.checks.some((c:Row)=>c.name===name&&c.passed));
      report.reusedAdditional={batch:'native-reentry-03',scope:'Owner authorization and actual deterministic native write/reentry only; failed member-revocation case is retained and rerun.'};
    }else assert.deepEqual(changed,[]);
    report.reusedEvidence={batch:'native-reentry-02',checks:names,changedFiles:changed,impact:securityOnly?'Only the source-sheet poll gate changed; role entry/initial source reads and all other product/helper code are byte/normalized-method checked unchanged. New source polling, HTTP503/retry and member/source revocation are executed again. Old failed batches remain failed.':'Only owned-owner contact preparation and test-driver scrolling/types changed; product, helper, account roles, source text/version and model configuration remain. Prior failed batches stay failed.'};return report.reusedEvidence;});
  const saved=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi/semantic-final-01/report.json'),'utf8'));
  const shared=saved.trials[0].turns[0],trace=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi/semantic-final-01',shared.traceFile),'utf8'));
  const publicTrace=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi/wire-http-01/run-1600.json'),'utf8'));
  const sharedRoute='packages/construction/chat/chat',publicRoute='packages/assistant/chat/chat',sharedUrl=sharedRoute+'?projectId=237';
  report.semanticAcceptance=false;report.savedFailure={runId:shared.runId,retained:true,partialAnswer:true,outputHash:createHash('sha256').update(JSON.stringify(trace.output.content)).digest('hex')};report.countsBefore=await counts();save();
  await check('prepare owned synthetic source lifecycle fixture',async()=>withTenantTransaction('1454',async tx=>{
    const source=await one(tx,sql`select d.id,d.title,d.status,d.version,d.published_version_id,v.content_hash from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v
      on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id where d.enterprise_id=1454 and d.id=${String(saved.temporaryKnowledge.cloneId)} for update of d`);
    assert.ok(source);assert.equal(source.status,'retired');assert.match(String(source.title),/^合成测试/);assert.equal(String(source.published_version_id),String(saved.temporaryKnowledge.cloneVersion));
    await tx.execute(sql`update app.assistant_knowledge_documents set status='active',version=version+1,updated_at=now() where enterprise_id=1454 and id=${String(source.id)}`);
    await tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1,version=version+1,updated_at=now() where enterprise_id=1454`);
    const owned={...source,activatedVersion:Number(source.version)+1};opened.push(owned);report.ownedSource=owned;return {id:source.id,onlySynthetic:true,productRestoreCapability:false};}));
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-manual-fixture-20261030/manifest.json'),'utf8'));
  const user=await withPlatformTransaction(tx=>one(tx,sql`select id,context_version from app.users where id=${String(fixture.customerId)}`));assert.ok(user);assert.ok(process.env.JWT_SECRET);
  const token=await new SignJWT({id:String(user.id),mode:'customer',role:'user',enterpriseId:'1454',contextVersion:Number(user.context_version),source:'wechat'}).setProtectedHeader({alg:'HS256'})
    .setSubject(String(user.id)).setAudience('miniprogram').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const customer=await session(token),accounts=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-manual-fixture-20261030/accounts.private.json'),'utf8')).accounts;
  const worker=await login(accounts.worker),designer=await login(accounts.designer_a),observer=await login(accounts.observer);
  let boss:Row|undefined;
  if(!securityOnly){const username='synthetic-v1-native-owner-'+randomUUID(),password=randomBytes(24).toString('base64url'),passwordHash=await bcrypt.hash(password,10);
  ownerId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password,menu_permissions)
    values(1454,${username},'合成测试·微云原生负责人',${passwordHash},'enterprise_admin','active',false,ARRAY['construction-projects']) returning id`)))!.id);report.ownedOwnerId=ownerId;save();
  const initialBoss=await login({username,password});ownerUserId=String(initialBoss.userId);
  await withPlatformTransaction(async tx=>{const phone='1990000'+ownerId.slice(-4).padStart(4,'0');
    const seeded=await one(tx,sql`update app.users u set phone=${phone} where u.id=${ownerUserId} and coalesce(u.phone,'')=''
      and exists(select 1 from app.admin_users a where a.id=${ownerId} and a.user_id=u.id and a.enterprise_id=1454 and a.username=${username})
      and not exists(select 1 from app.users other where other.phone=${phone} and other.id<>u.id) returning id`);assert.ok(seeded);
    report.ownerContactFixture={userId:ownerUserId,synthetic:true,phoneVerificationChanged:false,proof:'owner-contact-diagnosis.json'};save();});
  boss=await login({username,password});assert.equal(String(boss.userId),ownerUserId);
  await api('/miniprogram/construction/projects/237/chat',boss.token);
  }
  faultServer=http.createServer((_req,res)=>{report.faultRequests=(report.faultRequests||0)+1;setTimeout(()=>{if(res.destroyed)return;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:'assistant_unavailable'}));},12000);});
  await new Promise<void>(resolve=>faultServer!.listen(0,'127.0.0.1',resolve));const faultPort=(faultServer.address() as {port:number}).port;
  await evaluate(`function(port){const app=getApp();if(app.__qaV1Knowledge||app.__qaV1KnowledgeNativeReentry)throw Error('Another controller owns the native fixture');
    const s=app.__qaV1KnowledgeNativeReentry={global:{...app.globalData},hydrate:app.hydrateStoredSession,memory:new Map(),fault:false,faultPort:port,
      originals:{get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,request:wx.request}};
    const page=getCurrentPages().at(-1);s.route=page.route;s.options=page.options||{};
    wx.getStorageSync=function(k){return s.memory.get(k);};wx.setStorageSync=function(k,v){s.memory.set(k,v);};wx.removeStorageSync=function(k){s.memory.delete(k);};
    wx.request=function(o){const copy={...o},at=String(copy.url).indexOf('/api/');if(at>=0){copy.url='http://127.0.0.1:3006/api/'+String(copy.url).slice(at+5);
      if(s.fault&&/\\/chat\\/citations\\//.test(copy.url))copy.url='http://127.0.0.1:'+s.faultPort+'/source-unavailable';}return s.originals.request.call(wx,copy);};
    app.hydrateStoredSession=async function(){return true;};}`,faultPort);installed=true;
  if(!remainingOnly)await check('customer saved original and persisted native reentry',async()=>{const url=publicRoute+'?conversationId='+publicTrace.output.conversation_id,page=await identity(customer,url),citation=publicTrace.citations[0];
    await wait(async()=>JSON.stringify((await page.data()).messages).includes('闭水试验'),'saved public answer');await sourceTap(page,String(citation.id),false);
    await wait(async()=>{const d=await page.data();return d.citation?.available&&d.citation.quote;},'public source');await capture('customer-source',publicRoute);await closeSheet();
    await mp.redirectTo('/'+url);await pageAt(publicRoute);return {runId:'1600',sourceId:citation.id,realWeChatLogin:false};});
  for(const [role,current] of (securityOnly?[['worker',worker]]:remainingOnly?[['boss',boss!]]:[['worker',worker],['designer',designer],['boss',boss!]]) as Array<[string,Row]>)await check(role+' actual shared answer and internal source',async()=>{
    const page=await identity(current,sharedUrl);await wait(async()=>JSON.stringify((await page.data()).items).includes(shared.text.slice(0,25)),'saved shared partial answer');
    await sourceTap(page,String(shared.citations[0].id),true);await wait(async()=>{const d=await page.data();return d.citation?.available&&d.citation.quote;},'actual internal source');
    await capture(role+'-shared-source',sharedRoute);await closeSheet();await mp.redirectTo('/'+sharedUrl);await pageAt(sharedRoute);return {savedRun:shared.runId,partialAnswerRetained:true};});
  if(!securityOnly)await check('native deterministic project query writes and reenters without Agent dispatch',async()=>{const page=await identity(worker,sharedUrl),question='客厅最近有哪些现场记录？',started=new Date().toISOString();
    await(await page.$('.composer-input'))!.input(question);await wait(async()=>(await page.data()).draft===question,'real input');await(await page.$('.send'))!.tap();
    const message=await wait<Row>(()=>withTenantTransaction('1454',tx=>one(tx,sql`select m.id::text,m.client_message_id from app.assistant_messages m join app.construction_chats c
      on c.enterprise_id=m.enterprise_id and c.conversation_id=m.conversation_id where m.enterprise_id=1454 and c.project_id=237 and m.author_kind='admin'
      and m.created_at>=${started}::timestamptz and m.content->'blocks'->0->>'text'=${question} order by m.id desc limit 1`)),'real native write');assert.ok(message);
    await wait(async()=>{const d=await page.data();return !d.busy&&(d.items||[]).some((i:Row)=>i.message.id===message.id&&i.response?.text);},'real deterministic receipt');
    report.nativeMessage=message;save();await capture('native-project-query',sharedRoute);await mp.redirectTo('/'+sharedUrl);const reentry=await pageAt(sharedRoute);
    assert.ok((await reentry.data()).items.some((i:Row)=>i.message.id===message.id));return message;});
  await check('real HTTP503 source loading failure and original retry',async()=>{const page=await identity(worker,sharedUrl);
    await evaluate('function(){getApp().__qaV1KnowledgeNativeReentry.fault=true;}');await sourceTap(page,String(shared.citations[0].id),true);
    await wait(async()=>(await page.data()).citationLoading,'visible loading');await capture('source-loading',sharedRoute);
    await wait(async()=>{const d=await page.data();return d.citationError&&!d.citation?.quote;},'HTTP503 without leaked quote');await capture('source-error',sharedRoute);
    await evaluate('function(){getApp().__qaV1KnowledgeNativeReentry.fault=false;}');await(await page.$('.sheet-body .text-button'))!.tap();
    await wait(async()=>{const d=await page.data();return d.citation?.available&&d.citation.quote&&!d.citationError;},'retry real source');await capture('source-retry',sharedRoute);await closeSheet();return {faultRequests:report.faultRequests};});
  await check('member removal clears native history and an open original',async()=>{const detail=await construction.execute('detail',{projectId:'237'}),member=(detail.members as Row[]).find(m=>String(m.admin_id)==='5372');assert.ok(member?.active);
    assert.ok(!(detail.assignments as Row[]).some(a=>String(a.admin_id)==='5372'));const page=await identity(observer,sharedUrl);await sourceTap(page,String(shared.citations[0].id),true);
    await wait(async()=>(await page.data()).citation?.available,'observer read original');memberToRestore=member;report.memberRestore=member;save();
    await construction.execute('member',{projectId:'237',expectedVersion:Number((detail.project as Row).version),adminId:'5372',role:member.role,active:false,workLabel:member.work_label},randomUUID());
    await wait(async()=>{const d=await page.data();report.lastMemberState={fatal:d.fatal,items:d.items.length,hasQuote:!!d.citation?.quote,sheet:d.sheet};save();return d.fatal&&!d.items.length&&!d.citation?.quote;},'revoked member clears state');await capture('member-revoked',sharedRoute);
    const latest=await construction.execute('detail',{projectId:'237'});await construction.execute('member',{projectId:'237',expectedVersion:Number((latest.project as Row).version),adminId:'5372',role:member.role,active:member.active,workLabel:member.work_label},randomUUID());memberToRestore=undefined;return {removedThenRestored:true};});
  await check('actual source retirement clears popup and persisted reentry',async()=>{const page=await identity(worker,sharedUrl);await sourceTap(page,String(shared.citations[0].id),true);
    await wait(async()=>(await page.data()).citation?.available,'source before withdrawal');const detail=await knowledge.execute('detail',{documentId:String(opened[0].id)});
    await knowledge.execute('retire',{documentId:String(opened[0].id),expectedVersion:Number((detail.document as Row).version)},randomUUID());opened[0].retired=true;
    await wait(async()=>{const d=await page.data();return d.citation?.available===false&&!d.citation.quote;},'withdrawal clears open source');await capture('source-withdrawn',sharedRoute);
    await closeSheet();await mp.redirectTo('/'+sharedUrl);const reentry=await pageAt(sharedRoute);assert.ok(JSON.stringify((await reentry.data()).items).includes('原回答不再沿用'));return {sourceRetired:true};});
  report.countsAfter=await counts();assert.deepEqual(report.countsAfter,report.countsBefore,'Native checks must not create any Agent run/model call');
  const original=await withTenantTransaction('1454',tx=>one(tx,sql`select content from app.assistant_messages where enterprise_id=1454 and id=${String(trace.output.id)}`));
  assert.equal(createHash('sha256').update(JSON.stringify(original!.content)).digest('hex'),report.savedFailure.outputHash,'Saved model failure must remain unchanged');
}
async function check(name:string,work:()=>Promise<unknown>){try{const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result;}
  catch(error){report.checks.push({name,passed:false,error:(error as Error).message});throw error;}finally{save();}}
async function main(){const database=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development')&&database.hostname==='localhost'&&database.port==='5432'&&database.pathname==='/smart_floor_planner');
  release=await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL,{waitForLock:true});
  await check('idle real development queue',async()=>{const count=await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int active from app.assistant_jobs where status in ('queued','running')`));assert.equal(count?.active,0);return count;});
  await check('registered Stable CLI version and login',async()=>{const status=await mp.call('check_wechatide_status',{skillVersion:'0.3.11'});
    assert.ok(['equal','agent_ahead'].includes(status.versionRelation));assert.equal(status.loginExpired,false);assert.equal(status.cliTokenRequired,false);
    return {versionRelation:status.versionRelation,loginExpired:false,skillVersion:status.skillVersion};});
  await check('fresh exact-project compilation and live official SDK',async()=>{let last:unknown;
    for(let attempt=1;attempt<=2;attempt++){try{const compile=await mp.call('simulator_refresh',{project});report.compileAttempts=[...(report.compileAttempts||[]),{attempt,result:compile}];save();await delay(5000);
      const info=await mp.systemInfo(),page=await mp.currentPage();assert.ok(page);const data=await page.data();assert.ok(data&&Object.keys(data).length);
      assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);assert.equal(info.SDKVersion,'3.17.2');
      report.runtime={info,route:page.path};return {project,route:page.path,logical:[390,844],baseLibrary:info.SDKVersion};
    }catch(error){last=error;report.compileAttempts=[...(report.compileAttempts||[]),{attempt,error:(error as Error).message}];save();}}
    throw last;});
  if(process.argv.includes('--preflight')){report.passed=true;return;}
  await fullChecks();report.passed=true;
}
main().catch(error=>{report.error=(error as Error).stack||String(error);process.exitCode=1;}).finally(async()=>{
  const cleanup=async(name:string,work:()=>Promise<unknown>)=>{try{const value=await work();(report.cleanup||=[]).push({name,passed:true,value});}
    catch(error){(report.cleanup||=[]).push({name,passed:false,error:(error as Error).message});report.passed=false;process.exitCode=1;}save();};
  if(installed)await cleanup('restore actual native identity/storage/request and route',async()=>{const original=await evaluate(`function(){const app=getApp(),s=app.__qaV1KnowledgeNativeReentry;if(!s)return null;
    const page=getCurrentPages().at(-1);if(page.onHide)page.onHide();const original={route:s.route,options:s.options};
    wx.getStorageSync=s.originals.get;wx.setStorageSync=s.originals.set;wx.removeStorageSync=s.originals.remove;wx.request=s.originals.request;app.hydrateStoredSession=s.hydrate;
    for(const key of Object.keys(app.globalData))delete app.globalData[key];Object.assign(app.globalData,s.global);delete app.__qaV1KnowledgeNativeReentry;return original;}`);
    if(original?.route)await mp.reLaunch('/'+original.route+(Object.keys(original.options).length?'?'+new URLSearchParams(original.options).toString():''));return {restored:true};});
  if(memberToRestore)await cleanup('restore only owned observer membership',async()=>{const latest=await construction.execute('detail',{projectId:'237'});return construction.execute('member',{
    projectId:'237',expectedVersion:Number((latest.project as Row).version),adminId:'5372',role:memberToRestore!.role,active:memberToRestore!.active,workLabel:memberToRestore!.work_label},randomUUID());});
  for(const source of opened)await cleanup('retire owned synthetic source '+source.id,async()=>{const detail=await knowledge.execute('detail',{documentId:String(source.id)}),document=detail.document as Row;
    assert.equal(String(document.published_version_id),String(source.published_version_id));if(document.status!=='retired'){
      assert.equal(Number(document.version),source.activatedVersion);await knowledge.execute('retire',{documentId:String(source.id),expectedVersion:Number(document.version)},randomUUID());}
    const final=await withTenantTransaction('1454',tx=>one(tx,sql`select d.status,v.content_hash from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id
      and v.id=d.published_version_id where d.enterprise_id=1454 and d.id=${String(source.id)}`));assert.equal(final?.status,'retired');assert.equal(final.content_hash,source.content_hash);return final;});
  if(ownerId)await cleanup('disable owned temporary owner and invalidate its Mini session',async()=>withPlatformTransaction(async tx=>{
    await tx.execute(sql`update app.admin_users set status='disabled' where id=${ownerId} and username like 'synthetic-v1-native-owner-%'`);
    if(ownerUserId)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${ownerUserId}`);return {ownerId,disabled:true};}));
  if(faultServer)await cleanup('close owned HTTP fault listener',async()=>{faultServer!.closeAllConnections();await new Promise<void>(resolve=>faultServer!.close(()=>resolve()));return true;});
  if(report.countsBefore)await cleanup('zero new Agent runs or model calls',async()=>{report.finalCounts=await counts();assert.deepEqual(report.finalCounts,report.countsBefore);return report.finalCounts;});
  report.bindingAfter=snapshot();report.drift=files.filter(file=>before[file]!==report.bindingAfter[file]);if(report.drift.length){report.passed=false;process.exitCode=1;}
  if(release)await release();report.finishedAt=new Date().toISOString();save();await closePostgresPool();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,modelCalls:0,drift:report.drift}));
});
