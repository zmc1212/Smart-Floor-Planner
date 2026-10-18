/** Explicit development-only synthetic P4B fixtures + real HTTP smoke checks.
 * IDs/results only are persisted. Test sessions stay in memory and expire.
 * No existing enterprise, homeowner or project is changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { SignJWT } from 'jose';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { Row } from '@/db/repositories/assistant-repository';

type Scenario={name:string;projectId:string;leadId:string;conversationId:string;recordId:string;siteId:string;versionId:string;revision:number;status:string};
type Manifest={prefix:string;enterpriseId:string;adminId:string;ownerId:string;visitorId:string;visitorConversationId:string;scenarios:Scenario[];complete:boolean};
async function main(){
  loadEnvConfig(process.cwd(),true);
  const {sql}=await import('drizzle-orm');
  const {withPlatformTransaction,withTenantTransaction}=await import('@/db/transaction');
  const {one}=await import('@/db/repositories/assistant-repository');
  const {resolvePostgresRuntimeConfig,closePostgresPool}=await import('@/lib/postgresql');
  const {ConstructionService}=await import('@/lib/construction/service');
  const {SiteChatService}=await import('@/lib/construction/site-chat');
  const {PublicMaterialService}=await import('@/lib/construction/public-service');
  const {PublicCustomerService}=await import('@/lib/construction/public-customer');
  const {ConversationService}=await import('@/lib/assistant/core/conversation');
  const {signMiniProgramToken}=await import('@/lib/miniprogram-jwt');
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  if(!process.argv.includes('--development')||!['localhost','127.0.0.1'].includes(target.hostname)||target.port!=='5432'||target.pathname!=='/smart_floor_planner')throw Error('Explicit localhost:5432 development target required');
  const file=path.resolve('../tmp/xiaok-vector/p4b-development-fixture.json');
  let manifest:Manifest;
  if(fs.existsSync(file)){
    manifest=JSON.parse(fs.readFileSync(file,'utf8'));if(!manifest.complete)throw Error('Incomplete fixture manifest;inspect its synthetic IDs before resuming');
    const e=await withPlatformTransaction(tx=>one(tx,sql`select name from app.enterprises where id=${manifest.enterpriseId}`));
    if(!e||!String(e.name).startsWith('测试专用 · 小K公开工地'))throw Error('Synthetic enterprise no longer matches');
    for(const scenario of manifest.scenarios){
      const state=await withTenantTransaction(manifest.enterpriseId,tx=>one(tx,sql`select current_version_id,revision,status from app.construction_public_sites where enterprise_id=${manifest.enterpriseId} and id=${scenario.siteId}`));
      if(!state)throw Error('Synthetic scenario no longer exists');
      scenario.versionId=String(state.current_version_id);scenario.revision=Number(state.revision);scenario.status=String(state.status);
    }fs.writeFileSync(file,JSON.stringify(manifest,null,2));
  }else{
    const prefix='p4b-development-'+randomUUID();
    const ids=await withPlatformTransaction(async tx=>{
      const eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 小K公开工地',${prefix},'active') returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,1000,10000000,100000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","imageInput":true,"tools":true,"probeVersion":"p4b-development-fixture"}')`);
      const aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${prefix},${'unusable:'+randomUUID()},'enterprise_admin','active',false,'测试负责人') returning id`))!.id);
      const users=[];for(const name of ['测试业主','测试访客']){
        const uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${name},1) returning id`))!.id);users.push(uid);
        await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix+uid})`);
      }return {eid,aid,users};
    });
    manifest={prefix,enterpriseId:ids.eid,adminId:ids.aid,ownerId:ids.users[0],visitorId:ids.users[1],visitorConversationId:'',scenarios:[],complete:false};
    const save=()=>fs.writeFileSync(file,JSON.stringify(manifest,null,2));save();
    const actor={enterpriseId:ids.eid,adminId:ids.aid},construction=new ConstructionService(actor),site=new SiteChatService(actor),materials=new PublicMaterialService(actor);
    const customer=(uid:string,leadId?:string):ActorContext=>({enterpriseId:ids.eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self'],entry:leadId?{kind:'lead',id:leadId}:{kind:'identity'}});
    manifest.visitorConversationId=String((await new ConversationService(customer(ids.users[1])).create(randomUUID())).id);save();
    const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="#d4cec0"/><path d="M160 0v510h800M210 0v460h750" stroke="#bf543e" stroke-width="18" fill="none"/><path d="M260 0v410h700M310 0v360h650" stroke="#507f9b" stroke-width="18" fill="none"/><rect y="610" width="960" height="110" fill="#fff"/><text x="40" y="680" font-size="40" fill="#1e4c41">TEST DATA · P4B · NOT A REAL SITE</text><rect x="710" y="30" width="220" height="100" fill="#f4f4f4"/><text x="730" y="90" font-size="25">MASK TEST</text></svg>');
    const bytes=await sharp(svg).png().toBuffer();
    for(const [index,status]of ['draft','pending_owner','owner_approved','published','declined','withdrawn','rejected','source_revoked','text_only'].entries()){
      const name='测试工地 · '+({draft:'草稿',pending_owner:'待业主决定',owner_approved:'待企业审核',published:'已公开',declined:'业主暂不公开',withdrawn:'撤回演练',rejected:'审核退回',source_revoked:'来源撤销',text_only:'仅文字公开'} as Record<string,string>)[status];
      const leadId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,community_name,source)
        values(${ids.eid},${ids.users[0]},'测试业主','19900000000',${name},'natural') returning id`)))!.id);
      const pid=String((await construction.execute('create',{leadId,name,managerId:ids.aid,rooms:['测试书房']},randomUUID())).id);
      const media=status==='text_only'?null:String((await site.upload(pid,randomUUID(),bytes)).id);
      const sent=await site.send(pid,{text:'测试记录：书房线管已铺好，底盒未固定，等设计师核对。',mediaIds:media?[media]:[]},randomUUID()),rid=String(sent.recordId);
      const row=await withTenantTransaction(ids.eid,tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${ids.eid} and id=${rid}`));
      const edited=await site.mutate(pid,rid,'edit',{expectedVersion:Number(row!.version),data:{title:'测试水电点位核对',roomId:null,completed:'测试线管已铺好',pending:'测试底盒未固定',coordination:'等设计师核对点位',note:'仅为功能测试，不代表验收或正式批准'}},randomUUID());
      const record=await site.mutate(pid,rid,'publish',{expectedVersion:edited.version,audience:'customer'},randomUUID());
      const c=new ConversationService(customer(ids.users[0],leadId)),cid=String((await c.create(randomUUID())).id),decisions=new PublicCustomerService(customer(ids.users[0],leadId),cid);
      const source=((await materials.read(pid)).sourceItems as Row[]).find(s=>s.id===rid)!;
      let state=await materials.save(pid,{expectedRevision:0,material:{name,cityCode:'420500',district:index%2?'伍家岗区':'西陵区',sources:[{kind:source.kind,id:source.id,sourceHash:source.sourceHash,text:source.text}],photos:media?[{recordId:rid,mediaId:media,masks:[{x:.73,y:.03,width:.25,height:.17}]}]:[]}},randomUUID());
      const input=()=>({expectedRevision:state.revision,versionId:state.versionId});
      if(status!=='draft')state=await materials.mutate(pid,'submit',input(),randomUUID());
      if(status==='declined')state=await decisions.decide(String(state.id),'decline',input(),randomUUID());
      if(['owner_approved','published','withdrawn','rejected','source_revoked','text_only'].includes(status)){
        state=await decisions.decide(String(state.id),'preview',input(),randomUUID());state=await decisions.decide(String(state.id),'approve',input(),randomUUID());
        if(status==='rejected')state=await materials.mutate(pid,'reject',{...input(),reason:'测试退回：请核对公开范围'},randomUUID());
        else if(status!=='owner_approved')state=await materials.mutate(pid,'publish',input(),randomUUID());
      }
      if(status==='source_revoked')await site.mutate(pid,rid,'withdraw',{expectedVersion:record.version,reason:'测试来源撤回失效'},randomUUID());
      await c.messages(cid);
      manifest.scenarios.push({name,projectId:pid,leadId,conversationId:cid,recordId:rid,siteId:String(state.id),versionId:String(state.versionId),revision:Number(state.revision),status:String(state.status)});save();
    }
    manifest.complete=true;save();
  }
  // Only this manifest's synthetic operator can be enabled for a smoke run.
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=${manifest.adminId} and enterprise_id=${manifest.enterpriseId} and username=${manifest.prefix}`));
  const releaseSession=async()=>{const released=await withPlatformTransaction(tx=>one(tx,sql`update app.admin_users set status='disabled' where id=${manifest.adminId} and enterprise_id=${manifest.enterpriseId} and username=${manifest.prefix} returning id`));assert.ok(released);await closePostgresPool();};
  const secret=new TextEncoder().encode(process.env.JWT_SECRET),base='http://localhost:3006';
  const adminToken=await new SignJWT({id:manifest.adminId,role:'enterprise_admin',enterpriseId:manifest.enterpriseId,permissions:['construction-projects']}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('20m').sign(secret);
  const token=async(uid:string)=>signMiniProgramToken({sub:uid,id:uid,mode:'customer',role:'user',contextVersion:1,source:'wechat'});
  const ownerToken=await token(manifest.ownerId),visitorToken=await token(manifest.visitorId);
  const get=async(url:string,auth?:string,init:RequestInit={})=>{const response=await fetch(base+url,{...init,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...init.headers},signal:AbortSignal.timeout(60000)});return {status:response.status,body:await response.json()};};
  const checks:Record<string,unknown>={enterpriseId:manifest.enterpriseId,scenarios:manifest.scenarios.length};
  const list=await get('/api/public/construction/'+manifest.enterpriseId+'/sites');assert.equal(list.status,200);assert.ok(list.body.data.items.length>=2);checks.publicItems=list.body.data.items.length;
  const owner=manifest.scenarios.find(s=>s.status==='pending_owner')!,url='/api/miniprogram/assistant/conversations/'+owner.conversationId+'/public-sites/'+owner.siteId+'?versionId='+owner.versionId;
  assert.equal((await get(url,ownerToken)).status,200);assert.equal((await get(url,visitorToken)).status,404);checks.ownerVisitorIsolation=true;
  const admin=await get('/api/construction/projects/'+owner.projectId+'/public-materials',undefined,{headers:{cookie:'auth_token='+adminToken}});assert.equal(admin.status,200);checks.cookieDraftRead=true;
  const entry=await get('/api/miniprogram/assistant/entry-context',visitorToken,{method:'POST',body:JSON.stringify({publicEnterpriseId:manifest.enterpriseId})});assert.equal(entry.status,200);assert.equal(entry.body.data.resumeConversationId,manifest.visitorConversationId);checks.ownConsultationEntry=true;
  const messageKey=manifest.prefix+'.region',messagePath='/api/miniprogram/assistant/conversations/'+manifest.visitorConversationId+'/messages';
  const message=await get(messagePath,visitorToken,{method:'POST',headers:{'Idempotency-Key':messageKey},body:JSON.stringify({clientMessageId:messageKey,content:{version:1,blocks:[{type:'text',text:'测试咨询：我在宜昌市伍家岗区，先看看这里已公开的测试工地。'}]}})});assert.equal(message.status,202);
  const recommendations=await get('/api/miniprogram/assistant/conversations/'+manifest.visitorConversationId+'/public-sites/recommendations',visitorToken);assert.equal(recommendations.status,200);assert.ok(recommendations.body.data.items.length>0);assert.ok(recommendations.body.data.items.every((s:{district:string})=>s.district==='伍家岗区'));checks.realRegionRecommendations=true;
  const pub=list.body.data.items[0],context='/api/miniprogram/assistant/conversations/'+manifest.visitorConversationId+'/public-sites/'+pub.id+'/context';
  assert.equal((await get(context,visitorToken,{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({versionId:pub.versionId})})).status,200);checks.realContextWrite=true;
  const revoked=manifest.scenarios.find(s=>s.name.endsWith('来源撤销'))!;assert.equal((await get('/api/public/construction/'+manifest.enterpriseId+'/sites/'+revoked.siteId+'?versionId='+revoked.versionId)).status,404);checks.revokedSourceHidden=true;
  const withdrawal=manifest.scenarios.find(s=>s.name.endsWith('撤回演练'))!;
  if(withdrawal.status==='published'){
    const detail=await get('/api/public/construction/'+manifest.enterpriseId+'/sites/'+withdrawal.siteId);assert.equal(detail.status,200);
    const action='/api/miniprogram/assistant/conversations/'+withdrawal.conversationId+'/public-sites/'+withdrawal.siteId+'/withdraw';
    const result=await get(action,ownerToken,{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({versionId:withdrawal.versionId,expectedRevision:withdrawal.revision})});assert.equal(result.status,200);
    withdrawal.status='withdrawn';withdrawal.revision=result.body.data.revision;fs.writeFileSync(file,JSON.stringify(manifest,null,2));
    assert.equal((await get('/api/public/construction/'+manifest.enterpriseId+'/sites/'+withdrawal.siteId)).status,404);
    const image=await fetch(base+'/api/public/construction/'+manifest.enterpriseId+'/sites/'+withdrawal.siteId+'/media/'+detail.body.data.photos[0].id+'?versionId='+withdrawal.versionId);assert.equal(image.status,404);
  }checks.realWithdrawalRevocation=true;
  fs.writeFileSync(path.resolve('../tmp/xiaok-vector/p4b-development-smoke.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
  if(process.argv.includes('--serve')){
    const server=http.createServer(async(req,res)=>{
      if(req.method!=='POST'||req.url!=='/admin-session'){res.writeHead(404);res.end();return;}
      res.setHeader('Set-Cookie','auth_token='+adminToken+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=1200');res.setHeader('Cache-Control','no-store');res.end('Synthetic enterprise session ready');
    });server.listen(8398,'127.0.0.1',()=>console.log('Temporary localhost test-account session helper ready (synthetic enterprise only)'));
    const stop=()=>server.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const timer=setTimeout(stop,20*60*1000);server.on('close',()=>{clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);void releaseSession();});
  }else {
    await releaseSession();
    const publicRead=await get('/api/public/construction/'+manifest.enterpriseId+'/sites');assert.equal(publicRead.status,200);assert.ok(publicRead.body.data.items.length>=2);
    checks.testSessionDisabled=true;checks.publicItemsAfterSessionClosed=publicRead.body.data.items.length;
    fs.writeFileSync(path.resolve('../tmp/xiaok-vector/p4b-development-smoke.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify({testSessionDisabled:true,publicItems:checks.publicItemsAfterSessionClosed}));
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Fixture failed');process.exitCode=1;void import('@/lib/postgresql').then(m=>m.closePostgresPool());});
