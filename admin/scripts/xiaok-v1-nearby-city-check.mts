/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated deterministic service/native acceptance; no model quality claim. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/package.json');require('@next/env').loadEnvConfig(process.cwd(),true);
process.env.DATABASE_URL=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8')).DATABASE_URL;
const {sql}=require('drizzle-orm'),root=path.resolve('..'),imp=(p:string)=>import(pathToFileURL(path.resolve(p)).href);
const {withTenantTransaction,withPlatformTransaction}=await imp('src/db/transaction.ts');
const {one}=await imp('src/db/repositories/assistant-repository.ts');
const {closePostgresPool}=await imp('src/lib/postgresql.ts');
const {ConstructionService}=await imp('src/lib/construction/service.ts');
const {SiteChatService}=await imp('src/lib/construction/site-chat.ts');
const {processSiteRecord}=await imp('src/lib/construction/site-worker.ts');
const {claimJob}=await imp('src/lib/assistant/infrastructure/job-queue.ts');
const {ConversationService}=await imp('src/lib/assistant/core/conversation.ts');
const {processAgentAnswer}=await imp('src/lib/assistant/agent/worker.ts');
const {PublicMaterialService}=await imp('src/lib/construction/public-service.ts');
const {PublicCustomerService}=await imp('src/lib/construction/public-customer.ts');
const {PublicSiteCatalog}=await imp('src/lib/construction/public-read.ts');
const {PortfolioCatalog}=await imp('src/lib/portfolio/catalog.ts');
const {lockAssistantAcceptance}=await imp('scripts/assistant-acceptance-safety.mjs');
const baseline=process.argv.includes('--expect-gap'),native=process.argv.includes('--native');
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'../tmp/v1-nearby-city-20261106/service01');fs.mkdirSync(out,{recursive:true});
assert.ok(!fs.existsSync(path.join(out,'report.json')),'Never overwrite an earlier result');
const eid='1454',prefix='synthetic-v1-nearby-'+randomUUID(),read=(fn:any)=>withTenantTransaction(eid,fn),platform=(fn:any)=>withPlatformTransaction(fn);
const report:any={passed:false,expectedBaselineGap:baseline,enterpriseId:eid,fixturePrefix:prefix,question:'我家在杭州，想看看附近已经公开的工地。',
 scope:'Deterministic city handoff and existing approved public catalogue, original source reads/reentry/withdrawal. No physical camera, live publishing, external model or image calls.',fixtures:[],checks:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const ts=require('typescript'),cfg=ts.readConfigFile('tsconfig.json',ts.sys.readFile),options=ts.parseJsonConfigFileContent(cfg.config,ts.sys,process.cwd()).options,files=new Set<string>();
function visit(f:string){if(files.has(f)||f.includes('node_modules')||!fs.existsSync(f))return;files.add(f);for(const i of ts.preProcessFile(fs.readFileSync(f,'utf8'),true,true).importedFiles){const r=ts.resolveModuleName(i.fileName,f,options,ts.sys).resolvedModule?.resolvedFileName;if(r)visit(path.resolve(r));}}
for(const f of ['src/lib/construction/public-customer.ts','src/lib/construction/public-service.ts','src/lib/construction/public-http.ts','src/lib/construction/site-worker.ts',
 'src/lib/assistant/application/http.ts','src/lib/assistant/agent/worker.ts','scripts/wechatide-native-client.ts','scripts/assistant-acceptance-safety.mjs'])visit(path.resolve(f));
for(const f of [fileURLToPath(import.meta.url),'scripts/xiaok-v1-nearby-city-native.cjs','.env.local','package.json','package-lock.json','tsconfig.json','../tmp/xiaok-vector/connection.private.json'])files.add(path.resolve(f));
const walk=(d:string)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','.git','miniprogram_npm'].includes(e.name))continue;const f=path.join(d,e.name);if(e.isDirectory())walk(f);else files.add(f);}};if(native)walk(path.join(root,'miniprogram'));
const binding=()=>Object.fromEntries([...files].sort().map(f=>[path.relative(root,f).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const counts=()=>platform(async(tx:any)=>({provider:Number((await one(tx,sql`select count(*)::int n from app.ai_provider_attempts`)).n),queue:Number((await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n)}));
const users:string[]=[],projects:any[]=[],chats:any[]=[];let settings:any,release:any,managerId='',owner:any,materials:any,viewer:any;
const originalFetch=globalThis.fetch;
async function withdraw(f:any){const d=await materials.read(f.pid);if(d.status==='published'||d.material?.status==='published')return materials.mutate(f.pid,'withdraw',{versionId:d.material.versionId,expectedRevision:d.revision,reason:'合成测试·来源撤回/结束'},randomUUID());
 const s=await read((tx:any)=>one(tx,sql`select status,revision,current_version_id from app.construction_public_sites where enterprise_id=1454 and id=${f.siteId}`));
 if(s?.status==='published')return materials.mutate(f.pid,'withdraw',{versionId:String(s.current_version_id),expectedRevision:Number(s.revision),reason:'合成测试结束'},randomUUID());}
try{
 const u=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(u.hostname)&&u.port==='55432'&&u.pathname==='/xiaok_embedding_eval');
 release=await lockAssistantAcceptance(process.env.DATABASE_URL,{waitForLock:true});report.before=await counts();assert.equal(report.before.queue,0);
 settings=await read((tx:any)=>one(tx,sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`));assert.equal(settings.enabled,false);
 await read((tx:any)=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({...settings.agent_config,model:'qwen3.8-flash',enterpriseKnowledgeEnabled:false})}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
 globalThis.fetch=async()=>{throw Error('No external or paid calls in this deterministic catalogue test');};
 report.bindingBefore=binding();save();
 for(let i=0;i<3;i++){const uid=String((await platform((tx:any)=>one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+':'+i},1) returning id`))).id);users.push(uid);
  await platform((tx:any)=>tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix+':'+i})`));}
 managerId=String((await platform((tx:any)=>one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(1454,${prefix},'unusable-local-fixture','enterprise_admin','active',false,'合成测试·公开资料管理') returning id`))).id);
 owner=new ConstructionService({enterpriseId:eid,adminId:managerId});materials=new PublicMaterialService(owner.actor);
 const actor=(uid:string,entry?:any)=>({enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self'],...(entry?{entry}:{})});
 for(const spec of [{cityCode:'330100',name:'杭州',district:'西湖区'},{cityCode:'510100',name:'成都',district:'武侯区'}]){
  const lead=await read((tx:any)=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(1454,${users[0]},${prefix+':'+spec.name},${'138'+String(Date.now()).slice(-8)},'natural') returning id`));
  const pid=String((await owner.execute('create',{leadId:String(lead.id),name:'合成测试·'+spec.name+'公开资料',managerId,rooms:[]},randomUUID())).id);
  const f:any={pid,...spec};projects.push(f);report.fixtures.push(f);save();
  const d=await owner.execute('detail',{projectId:pid});await owner.execute('update',{projectId:pid,expectedVersion:Number(d.project.version),name:d.project.name,status:'active',customerAccess:true},randomUUID());
  const site=new SiteChatService(owner.actor),sent=await site.send(pid,{text:'合成测试·现场记录待核对，仅供隔离城市筛选测试。',mediaIds:[]},randomUUID());
  const lease=await claimJob();assert.equal(lease.runId,sent.runId);
  await processSiteRecord(lease,async()=>({text:JSON.stringify({title:'合成测试·现场记录',roomId:null,completed:'合成记录已提交',pending:'待团队现场核对',coordination:'',note:'工程夹具，不是模型语义验收'}),toolCalls:[],finishReason:'stop',usage:{inputTokens:0,outputTokens:0}}));
  const record=await read((tx:any)=>one(tx,sql`select id,version,status from app.construction_site_records where enterprise_id=1454 and id=${sent.recordId}`));assert.equal(record.status,'draft');
  await site.mutate(pid,String(record.id),'publish',{expectedVersion:Number(record.version),audience:'customer'},randomUUID());
  const view=await materials.read(pid),source=view.sourceItems.find((s:any)=>s.id===String(record.id));assert.ok(source);
  let state=await materials.save(pid,{expectedRevision:view.revision,material:{name:'合成测试·'+spec.name+'公开工地',cityCode:spec.cityCode,district:spec.district,
   sources:[{kind:source.kind,id:source.id,sourceHash:source.sourceHash,text:source.text}],photos:[]}},randomUUID());
  Object.assign(f,{siteId:state.id,versionId:state.versionId});save();
  state=await materials.mutate(pid,'submit',{versionId:state.versionId,expectedRevision:state.revision},randomUUID());
  const a=actor(users[0],{kind:'lead',id:String(lead.id)}),service=new ConversationService(a),cid=String((await service.create(randomUUID())).id);chats.push({service,cid});
  const consent=new PublicCustomerService(a,cid);state=await consent.decide(String(state.id),'preview',{versionId:state.versionId,expectedRevision:state.revision},randomUUID());
  state=await consent.decide(String(state.id),'approve',{versionId:state.versionId,expectedRevision:state.revision},randomUUID());
  state=await materials.mutate(pid,'publish',{versionId:state.versionId,expectedRevision:state.revision},randomUUID());f.state=state;
 }
 const a=actor(users[1]),service=new ConversationService(a),cid=String((await service.create(randomUUID())).id);viewer={actor:a,service,cid};chats.push(viewer);
 const reply=async(text:string)=>{
  const ready=await service.send(cid,randomUUID(),{version:1,blocks:[{type:'text',text}]});
  assert.ok(ready.runId);
  let readyLease=await claimJob();
  for(let wait=0;!readyLease&&wait<10;wait++){
   assert.equal((await service.run(ready.runId)).status,'queued');
   await new Promise(resolve=>setTimeout(resolve,200));
   readyLease=await claimJob();
  }
  assert.equal(readyLease?.runId,ready.runId);assert.ok(readyLease);
  await processAgentAnswer(readyLease,{model:async()=>({text:JSON.stringify({kind:'general',text:'合成测试：用于核对聊天内公开推荐的触发与重进。'}),
   toolCalls:[],finishReason:'stop',usage:{inputTokens:0,outputTokens:0}})});
  const result=await service.run(ready.runId);assert.equal(result.status,'succeeded');assert.ok(result.outputMessageId);
  return result.outputMessageId;
 };
 const replyId=await reply(report.question);
 report.uiReadyFixture={replyId,completedThroughExistingWorker:true,engineeringModelFixture:true,providerCalls:0,notModelAcceptance:true};
 const before=await read((tx:any)=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=1454 and id=${cid}`));
 const query=new PublicCustomerService(a,cid),result=await query.recommendations(),catalog=new PublicSiteCatalog(eid);
 const all=await catalog.list('','');assert.ok(projects.every(f=>all.items.some((s:any)=>s.id===f.siteId)));report.actual=result;save();
 if(baseline){assert.equal(result.needRegion,true);assert.ok(!result.items.some((s:any)=>projects.some(f=>f.siteId===s.id)));report.observedGap=true;}
 else{
  assert.equal(result.needRegion,false);assert.equal(result.region.cityCode,'330100');assert.ok(result.items.some((s:any)=>s.id===projects[0].siteId));assert.ok(result.items.every((s:any)=>s.cityCode==='330100'));
  assert.deepEqual((await read((tx:any)=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=1454 and id=${cid}`))).entry_snapshot,before.entry_snapshot);
  assert.deepEqual(await new PublicCustomerService(a,cid).recommendations(),result);
  const other=new PublicCustomerService(actor(users[2]),cid);await assert.rejects(other.recommendations());
  report.checks.push({currentOriginalCity:true,otherCityExcluded:true,noImplicitNeedWrite:true,persistedReentry:true,otherCustomerDenied:true});
  const advance=async()=>{
   const ordinary=await reply('我后来改到成都了，哑光瓷砖怎么保养？');
   const works=await reply('想看看杭州做原木风的设计师作品。');
   const both=await reply('附近工地和设计师作品都想看看。');
   const messages=(await service.messages(cid)).items;
   for(const [id,expected] of [[replyId,{sites:true,works:false}],[ordinary,undefined],[works,{sites:false,works:true}],[both,{sites:true,works:true}]] as const){
    const message=messages.find((item:{id:string})=>item.id===id);assert.ok(message);assert.deepEqual(('discovery' in message)?message.discovery:undefined,expected);
   }
   assert.deepEqual(await query.recommendations(replyId),result);
   await assert.rejects(other.recommendations(replyId));await assert.rejects(query.recommendations(ordinary));
   const portfolio=new PortfolioCatalog(a,cid);
   assert.notEqual((await portfolio.recommend({replyId:works})).needContext,true);
   await assert.rejects(portfolio.recommend({replyId}));
   await assert.rejects(new PortfolioCatalog(actor(users[2]),cid).recommend({replyId:works}));
   report.checks.push({ordinaryHidden:true,requestedCategories:true,oldReplyUsesOriginalCity:true,scopedWorks:true,otherCustomerAndUnrelatedReplyDenied:true});save();
   return {ordinary,works,both};
  };
  if(native){const {SignJWT}=require('jose'),{assistantHttp}=await imp('src/lib/assistant/application/http.ts'),{publicCatalogHttp}=await imp('src/lib/construction/public-http.ts');
   const token=await new SignJWT({id:users[1],mode:'customer',role:'user',enterpriseId:eid,contextVersion:1,source:'password'}).setProtectedHeader({alg:'HS256'}).setSubject(users[1]).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
   report.native=await require(path.resolve('scripts/xiaok-v1-nearby-city-native.cjs'))({root,output:out,actor:{uid:users[1],token,cid,replyId,site:projects[0],otherSite:projects[1]},assistantHttp,publicCatalogHttp,advance,withdraw:()=>withdraw(projects[0])});save();assert.equal(report.native.passed,true);}
  else { await advance(); await withdraw(projects[0]); }
  assert.ok(!(await query.recommendations(replyId)).items.some((s:any)=>s.id===projects[0].siteId));await assert.rejects(catalog.detail(projects[0].siteId,projects[0].versionId));
  report.checks.push({withdrawnDetailAndListDenied:true});report.passed=true;
 }
}catch(e){report.error=(e as Error).stack||String(e);process.exitCode=1;}
finally{
 try{
  for(const f of projects)if(f.siteId)await withdraw(f);
  for(const f of projects){const d=await owner.execute('detail',{projectId:f.pid});if(d.project.status!=='archived')await owner.execute('update',{projectId:f.pid,expectedVersion:Number(d.project.version),name:d.project.name,status:'archived',customerAccess:false},randomUUID());}
  for(const c of chats){const d=await read((tx:any)=>one(tx,sql`select status,version from app.assistant_conversations where enterprise_id=1454 and id=${c.cid}`));if(d.status==='open')await c.service.archive(c.cid,Number(d.version),randomUUID());}
  for(const uid of users)await platform((tx:any)=>tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`));
  if(managerId)await platform((tx:any)=>tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=1454 and id=${managerId}`));
  if(settings)await read((tx:any)=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=${settings.enabled},agent_config=${JSON.stringify(settings.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  report.cleanup={projectsArchived:projects.length,publicSourcesWithdrawn:projects.filter(f=>f.siteId).length,chatsArchived:chats.length,syntheticUsersRevoked:users.length,settingsRestored:true};
  report.after=await counts();assert.equal(report.after.queue,0);assert.equal(report.after.provider,report.before.provider);
 }catch(e){report.cleanupError=String(e);report.passed=false;process.exitCode=1;}
 globalThis.fetch=originalFetch;if(release)await release();if(report.bindingBefore){report.bindingAfter=binding();report.drift=Object.keys(report.bindingBefore).filter(f=>report.bindingBefore[f]!==report.bindingAfter[f]);if(report.drift.length){report.passed=false;process.exitCode=1;}}
 save();await closePostgresPool();console.log(JSON.stringify({passed:report.passed,observedGap:report.observedGap,error:report.error,cleanup:report.cleanup,cleanupError:report.cleanupError,drift:report.drift,counts:report.after}));
}
