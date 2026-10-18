import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { runAssistantRetention } from '@/lib/assistant/retention/service';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { GuidanceSettingsService } from '@/lib/assistant/requirements/guidance-settings';
import { defaultGuidance } from '@/lib/assistant/requirements/guidance';
import { claimJob, completeGuidance } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { HandoffService } from '@/lib/assistant/handoff/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import sharp from 'sharp';
import { AssistantMediaService } from '@/lib/assistant/media/service';

const prefix='requirements-'+randomUUID();
const tenants:string[]=[],users:string[]=[];
let actor:ActorContext, stranger:ActorContext, other:ActorContext, adminId:string, leadId:string, foreignLead:string;
const fields={housing:'90平米旧房',household:'两个人住',style:'现代简约',budget:'尚未确定',timeline:'半年内入住'};
test('P2A.2 formal plan snapshots bind an owned room/version and never write the graph',async()=>{
  const layout = {version:4,measurementMode:'surveying',surveyGraph:{kind:'survey-wall-graph',activeFloorId:'f',floors:[{
    id:'f',name:'一层',ceilingHeightMm:2800,
    nodes:[{id:'a',xMm:0,yMm:0},{id:'b',xMm:4000,yMm:0},{id:'c',xMm:4000,yMm:3000},{id:'d',xMm:0,yMm:3000}],
    walls:[{id:'ab',startNodeId:'a',endNodeId:'b'},{id:'bc',startNodeId:'b',endNodeId:'c'},{id:'cd',startNodeId:'c',endNodeId:'d'},{id:'da',startNodeId:'d',endNodeId:'a'}],
    openings:[],spaces:[{id:'study',name:'书房',closed:true,wallIds:['ab','bc','cd','da']}],
  }]}};
  const plan = await withTenantTransaction(actor.enterpriseId,async tx=>{
    const p=(await one(tx,sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
      values(${actor.enterpriseId},${users[0]},'测试正式户型','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!;
    await tx.execute(sql`update app.leads set primary_floor_plan_id=${String(p.id)} where id=${leadId}`);return String(p.id);
  });
  try {
    const c=String((await new ConversationService(actor).create(randomUUID())).id), media=new AssistantMediaService(actor);
    const options=await media.floorPlans(c); assert.equal(options.items.length,1);assert.equal(options.items[0].rooms[0].id,'study');
    const input={leadId,floorPlanId:plan,layoutHash:options.items[0].layoutHash,roomId:'study'};
    await assert.rejects(media.attachFormal(c,randomUUID(),{...input,leadId:foreignLead}),/context_changed/);
    await assert.rejects(media.attachFormal(c,randomUUID(),{...input,roomId:'foreign-room'}),/invalid_message/);
    await assert.rejects(media.attachFormal(c,randomUUID(),{...input,layoutHash:'stale'}),/context_changed/);
    const key=randomUUID(), result=await media.attachFormal(c,key,input);
    assert.deepEqual(await media.attachFormal(c,key,input),result);
    assert.equal((await media.list(c)).items[0].roomName,'书房');
    assert.equal(((await media.list(c)).items[0].source as {floorPlanId:string}).floorPlanId,plan);
    assert.ok((await media.read(c,String(result.id))).data.length);
    assert.deepEqual((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select layout_data from app.floor_plans where id=${plan}`)))!.layout_data,layout);
    await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.leads set primary_floor_plan_id=null where id=${leadId}`));
    assert.equal((await media.list(c)).items.length,0);
    await assert.rejects(media.read(c,String(result.id)),/assistant_resource_not_found/);
  } finally {
    await withTenantTransaction(actor.enterpriseId,async tx=>{
      await tx.execute(sql`update app.leads set primary_floor_plan_id=null where id=${leadId}`);
      await tx.execute(sql`delete from app.floor_plans where id=${plan}`);
    });
  }
});
test('first-photo entry persists one honest receipt across retries and reentry, without interrupting handoff', async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const media = new AssistantMediaService(actor);
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#00b979' } }).png().toBuffer();
  await assert.rejects(media.upload(c, randomUUID(), Buffer.from('invalid'), 'image', ''), /media_invalid/);
  assert.equal((await chat.messages(c)).items.length, 0);
  const requestKey = randomUUID();
  const results = await Promise.all([media.upload(c, requestKey, bytes, 'image', ''), media.upload(c, requestKey, bytes, 'image', '')]);
  assert.deepEqual(results[0], results[1]);
  await new AssistantMediaService(actor).upload(c, requestKey, bytes, 'image', '');
  const messages = (await new ConversationService(actor).messages(c)).items;
  assert.equal(messages.length, 2);
  const receipt = messages.find(m => m.authorKind === 'system');
  assert.match(JSON.stringify(receipt?.content), /media_received/);
  assert.match(JSON.stringify(receipt?.content), /暂不能识别图片内容/);
  assert.equal((await chat.detail(c)).latestRun, null);
  const handoff = new HandoffService(actor);
  await handoff.customerWrite(c, randomUUID(), { action: 'request' });
  await media.upload(c, randomUUID(), bytes, 'image', '');
  const staff = new HandoffService({ enterpriseId: actor.enterpriseId, principal: { kind: 'admin', adminId },
    contextVersion: 0, capabilities: ['assistant.handoff.staff'] });
  await staff.staffWrite(c, randomUUID(), { action: 'claim' });
  await media.upload(c, randomUUID(), bytes, 'image', '');
  const later = (await chat.messages(c)).items;
  assert.equal(later.filter(m => JSON.stringify(m.content).includes('media_received')).length, 1);
  assert.equal(later.filter(m => m.authorKind === 'user').length, 3);
  assert.equal((await chat.detail(c)).latestRun, null);
});

test('P2A.2 private images: real HTTP upload, idempotency, grant isolation, delete and retention',async()=>{
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const media = new AssistantMediaService(actor);
  const bytes = await sharp({create:{width:120,height:80,channels:3,background:'#00b979'}}).png().toBuffer();
  const token = await signMiniProgramToken({sub:users[0],id:users[0],contextVersion:1,mode:'customer',role:'user',source:'wechat'});
  const requestKey = randomUUID(), body = {data:bytes.toString('base64'),kind:'floorplan',roomName:'书房'};
  const response = await assistantHttp(new Request('http://localhost/api/miniprogram/assistant/conversations/'+c+'/media',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Idempotency-Key':requestKey},body:JSON.stringify(body),
  }),['conversations',c,'media']);
  assert.equal(response.status,200); const first = (await response.json()).data;
  assert.deepEqual(await media.upload(c,requestKey,bytes,'floorplan','书房'),first);
  assert.equal((await media.list(c)).items.length,1);
  const stored = await media.read(c,first.id);
  assert.equal((await sharp(stored.data).metadata()).format,'jpeg');
  assert.equal((await sharp(stored.data).metadata()).exif,undefined);
  assert.equal((await chat.messages(c)).items.length,2);
  assert.equal((await chat.detail(c)).latestRun,null);
  await assert.rejects(media.upload(c,requestKey,bytes,'image','书房'),/idempotency_conflict/);
  await assert.rejects(media.upload(c,randomUUID(),Buffer.from('<svg/>'),'image',''),/media_invalid/);
  await assert.rejects(new AssistantMediaService(stranger).read(c,first.id),/assistant_resource_not_found/);
  await assert.rejects(new AssistantMediaService(other).list(c),/assistant_resource_not_found/);
  assert.equal((await withTenantTransaction(other.enterpriseId,tx=>rows(tx,sql`select id from app.assistant_media where id=${first.id}`))).length,0);
  const staffActor:ActorContext={enterpriseId:actor.enterpriseId,principal:{kind:'admin',adminId},contextVersion:0,capabilities:['assistant.handoff.staff']};
  const staff = new HandoffService(staffActor), staffMedia = new AssistantMediaService(staffActor), handoff = new HandoffService(actor);
  const request = {action:'request',consent:true,contactConsent:false};
  await handoff.customerWrite(c,randomUUID(),request);
  await assert.rejects(staffMedia.list(c),/assistant_resource_not_found/); // Legacy text consent is not media consent.
  await handoff.customerWrite(c,randomUUID(),{action:'cancel'});
  await handoff.customerWrite(c,randomUUID(),{...request,mediaConsent:true});
  await assert.rejects(staffMedia.list(c),/assistant_resource_not_found/);
  await staff.staffWrite(c,randomUUID(),{action:'claim'});
  assert.equal((await staffMedia.list(c)).items[0].id,first.id);
  assert.ok((await staffMedia.read(c,first.id)).data.length);
  await media.remove(c,first.id); await media.remove(c,first.id);
  await assert.rejects(staffMedia.read(c,first.id),/assistant_resource_not_found/);
  await assert.rejects(media.upload(c,requestKey,bytes,'floorplan','书房'),/idempotency_conflict|assistant_resource_not_found/);
  const second = await media.upload(c,randomUUID(),bytes,'image','客厅');
  await handoff.customerWrite(c,randomUUID(),{action:'end'});
  await assert.rejects(staffMedia.read(c,String(second.id)),/assistant_resource_not_found/);
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_conversations set status='archived',updated_at=now()-interval '40 days' where id=${c}`));
  await runAssistantRetention({enterpriseId:actor.enterpriseId,adminId,mode:'apply'});
  await assert.rejects(media.list(c),/assistant_resource_not_found/);
  const cleared = await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select data,room_name from app.assistant_media where id=${String(second.id)}`));
  assert.equal(cleared!.data,null); assert.equal(cleared!.room_name,'');
});
test('P2B consent, concurrent claim, human replies, reentry, cancellation and revoked staff access',async()=>{
  const {chat,c}=await setup();
  const customer=new HandoffService(actor);
  const staffActor:ActorContext={enterpriseId:actor.enterpriseId,principal:{kind:'admin',adminId},contextVersion:0,capabilities:['assistant.handoff.staff']};
  const staff=new HandoffService(staffActor);
  const secondId=await withTenantTransaction(actor.enterpriseId,async tx=>String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,user_id)
    values(${actor.enterpriseId},${prefix+'second'},'test','designer','active',false,${users[1]}) returning id`))!.id));
  const second=new HandoffService({...staffActor,principal:{kind:'admin',adminId:secondId}});
  await assert.rejects(customer.customerWrite(c,randomUUID(),{action:'request',consent:false,contactConsent:false}),/invalid_message/);
  await assert.rejects(staff.staffRead(c),/assistant_resource_not_found/);
  const pending=await chat.send(c,randomUUID(),{version:1,blocks:[{type:'text',text:'想和设计师聊'}]});
  const lateLease=await claimJob();assert.ok(lateLease);assert.equal(lateLease.runId,pending.runId);
  const requestKey=randomUUID();
  const request={action:'request',consent:true,contactConsent:false};
  const requested=await customer.customerWrite(c,requestKey,request);
  assert.equal(requested.mode,'handoff_requested');
  assert.equal((await chat.run(String(pending.runId))).status,'cancelled');
  await assert.rejects(completeGuidance(lateLease,'不应出现的旧AI追问'));
  assert.equal((await customer.customerWrite(c,requestKey,request)).handoff?.requestId,requestKey);
  assert.ok((await staff.staffList()).items.some(x=>x.conversationId===c));
  assert.equal((await staff.staffRead(c)).messages.length,0);
  const race=await Promise.allSettled([staff.staffWrite(c,randomUUID(),{action:'claim'}),second.staffWrite(c,randomUUID(),{action:'claim'})]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
  const owner=race[0].status==='fulfilled'?staff:second;
  const loser=race[0].status==='fulfilled'?second:staff;
  await assert.rejects(loser.staffRead(c),/assistant_resource_not_found/);
  await owner.staffWrite(c,randomUUID(),{action:'reply',text:'我是设计师，接着聊你的办公需求。'});
  const sent=await chat.send(c,randomUUID(),{version:1,blocks:[{type:'text',text:'好的，我每周两天办公'}]});
  assert.equal(sent.runId,null);assert.equal(sent.status,'succeeded');
  assert.ok((await chat.messages(c)).items.some(m=>m.authorKind==='admin'));
  assert.equal((await customer.customerRead(c)).mode,'human');
  await customer.customerWrite(c,randomUUID(),{action:'end'});
  assert.equal((await chat.detail(c)).mode,'ai');
  await assert.rejects(owner.staffRead(c),/assistant_resource_not_found/);
  await customer.customerWrite(c,randomUUID(),{...request,recipientId:secondId});
  await assert.rejects(staff.staffRead(c),/assistant_resource_not_found/);
  await second.staffWrite(c,randomUUID(),{action:'claim'});
  const staffToken=await signMiniProgramToken({sub:users[1],id:users[1],contextVersion:1,mode:'staff',enterpriseId:actor.enterpriseId,staffId:secondId,role:'designer',source:'wechat'});
  const staffResponse=await assistantHttp(new Request('http://localhost/api/miniprogram/assistant/handoffs/'+c,{headers:{Authorization:'Bearer '+staffToken}}),['handoffs',c]);
  assert.equal(staffResponse.status,200);assert.equal((await staffResponse.json()).data.mode,'human');
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.admin_users set status='disabled' where id=${secondId}`));
  await assert.rejects(second.staffRead(c),/assistant_capability_forbidden/);
  assert.equal((await customer.customerRead(c)).handoff?.ownerAvailable,false);
  assert.equal((await new ConversationService(actor).detail(c)).ownerAvailable,false);
  const revokedResponse=await assistantHttp(new Request('http://localhost/api/miniprogram/assistant/handoffs/'+c,{headers:{Authorization:'Bearer '+staffToken}}),['handoffs',c]);
  assert.ok([401,403].includes(revokedResponse.status));
  await customer.customerWrite(c,randomUUID(),{action:'cancel'});
  await assert.rejects(new HandoffService(stranger).customerRead(c),/assistant_resource_not_found/);
});
before(async()=>{
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.port,'55432'); assert.equal(url.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++){
      const e=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;
      tenants.push(String(e.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${tenants[i]},true,1000,12000000,1000000000,30)`);
      const u=(await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!;
      users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
      const l=(await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${tenants[i]},${users[i]},'test','13000000000','manual') returning id`))!;
      if(i===0)leadId=String(l.id);else foreignLead=String(l.id);
    }
    const a=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${tenants[0]},${prefix},'test','enterprise_admin','active',ARRAY['assistant-retention','assistant-knowledge'],false) returning id`))!;
    adminId=String(a.id);
  });
  actor={enterpriseId:tenants[0],principal:{kind:'user',userId:users[0]},contextVersion:1,capabilities:['assistant.chat.self']};
  stranger={...actor,principal:{kind:'user',userId:users[1]}};
  other={...actor,enterpriseId:tenants[1]};
});
after(async()=>{
  await withPlatformTransaction(async tx=>{
    for(const t of tenants){await deleteAssistantData(tx,BigInt(t));await tx.execute(sql`delete from app.leads where enterprise_id=${t}`);
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${t}`);await tx.execute(sql`delete from app.enterprises where id=${t}`);}
    for(const u of users)await tx.execute(sql`delete from app.users where id=${u}`);
  });
  await closePostgresPool();
});
async function setup(text='90平米旧房。两个人住。预算还没定。半年内入住。'){
  const chat=new ConversationService(actor),requirements=new RequirementService(actor);
  const c=String((await chat.create(randomUUID())).id);
  await send(chat,c,text);
  return {chat,requirements,c};
}
async function send(chat:ConversationService,c:string,text:string){
  const sent=await chat.send(c,randomUUID(),{version:1,blocks:[{type:'text',text}]});
  await chat.run(String(sent.runId),'cancel',randomUUID());return sent;
}
test('draft/confirm are atomic and replay-safe; own lead association leaves attribution and assignment unchanged',async()=>{
  const {requirements,c}=await setup();
  const draft=await requirements.write(c,'draft',{action:'draft'});
  assert.deepEqual(await requirements.write(c,'draft',{action:'draft'}),draft);
  const input={action:'confirm',draftId:draft.id,expectedVersion:draft.version,fields,leadId,consent:true};
  const beforeLead=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select * from app.leads where id=${leadId}`));
  const [a,b]=await Promise.all([requirements.write(c,'confirm',input),requirements.write(c,'confirm',input)]);
  assert.deepEqual(a,b);assert.equal(a.status,'confirmed');assert.equal(a.leadId,leadId);
  assert.deepEqual(a.confirmedFields,fields);
  assert.deepEqual((await requirements.read(c)).confirmed,a);
  assert.deepEqual(await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select * from app.leads where id=${leadId}`)),beforeLead);
  assert.equal(Number((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select count(*) n from app.domain_event_outbox
    where type='assistant.requirements.confirmed.v1' and aggregate_id=${c}`)))!.n),1);
  await assert.rejects(requirements.write(c,'confirm',{...input,fields:{...fields,budget:'改动'}}),/idempotency_conflict/);
});
test('customer ownership, tenant RLS, feature switch and preview boundaries remain enforced',async()=>{
  const {requirements,c}=await setup();
  const draft=await requirements.write(c,'draft',{action:'draft'});
  await assert.rejects(new RequirementService(stranger).read(c),/assistant_resource_not_found/);
  await assert.rejects(new RequirementService(other).read(c),/assistant_resource_not_found/);
  assert.throws(()=>new RequirementService({...actor,principal:{kind:'admin',adminId},capabilities:['assistant.preview.self']}),/assistant_capability_forbidden/);
  assert.equal((await withTenantTransaction(other.enterpriseId,tx=>rows(tx,sql`select id from app.assistant_requirement_summaries where id=${draft.id}`))).length,0);
  await assert.rejects(requirements.write(c,'foreign',{action:'confirm',draftId:draft.id,expectedVersion:1,fields,leadId:foreignLead,consent:true}),/assistant_resource_not_found/);
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${actor.enterpriseId}`));
  try{assert.ok((await requirements.read(c)).latest);await assert.rejects(requirements.write(c,'off',{action:'draft'}),/assistant_disabled/);}
  finally{await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${actor.enterpriseId}`));}
});
test('new customer messages/newer drafts invalidate confirmations; consent and bounded schemas are mandatory',async()=>{
  const {chat,requirements,c}=await setup();
  const draft=await requirements.write(c,'draft',{action:'draft'});
  const input={action:'confirm',draftId:draft.id,expectedVersion:1,fields,consent:true};
  assert.throws(()=>requirements.write(c,'no-consent',{...input,consent:false}),/invalid_message/);
  assert.throws(()=>requirements.write(c,'tenant',{action:'draft',enterpriseId:tenants[1]}),/invalid_message/);
  await send(chat,c,'预算修改为20万。');
  await assert.rejects(requirements.write(c,'stale',input),/requirements_stale|version_conflict/);
  const next=await requirements.write(c,'new-draft',{action:'draft'});
  await assert.rejects(requirements.write(c,'old',input),/version_conflict/);
  assert.equal((next.draftFields as Record<string,{text:string}>).budget.text,'预算修改为20万');
  const detail=await chat.detail(c);await chat.archive(c,Number(detail.version),'archive');
  await assert.rejects(requirements.write(c,'archived',{action:'draft'}),/context_changed/);
});
test('retention clears summaries and confirmed text; idempotent replay never restores private data',async()=>{
  const {chat,requirements,c}=await setup('PRIVATE预算20万元');
  const draft=await requirements.write(c,'draft',{action:'draft'});
  const input={action:'confirm',draftId:draft.id,expectedVersion:1,fields:{...fields,budget:'PRIVATE确认预算'},consent:true};
  await requirements.write(c,'confirm',input);
  const handoff = new HandoffService(actor);
  const request = {action:'request',consent:true,contactConsent:true,phone:'13800000001'};
  await handoff.customerWrite(c,'retention-handoff',request);
  await chat.archive(c,Number((await chat.detail(c)).version),'archive');
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_conversations set updated_at=now()-interval '100 days' where id=${c}`));
  const report=await runAssistantRetention({enterpriseId:actor.enterpriseId,adminId,mode:'apply',now:new Date()});
  assert.ok(report.applied.requirementSummaries >= 2);
  const replay=await requirements.write(c,'confirm',input);
  assert.equal(replay.status,'redacted');assert.equal(replay.confirmedFields,null);assert.deepEqual(replay.draftFields,{});
  assert.equal((await requirements.read(c)).confirmed,null);
  assert.equal((await handoff.customerWrite(c,'retention-handoff',request)).handoff,null);
  const handoffRecords=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select result from app.assistant_idempotency_records where operation=${'handoff:'+c}`));
  assert.equal(/PRIVATE|13800000001/.test(JSON.stringify(handoffRecords)),false);
  const records=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select result from app.assistant_idempotency_records where operation=${'requirements:'+c}`));
  assert.equal(JSON.stringify(records).includes('PRIVATE'),false);
});
test('HTTP routes use bearer identity and strict schema, with no-store responses',async()=>{
  const {c}=await setup();
  const token=await signMiniProgramToken({sub:users[0],id:users[0],contextVersion:1,mode:'customer',role:'user',source:'wechat'});
  const path=['conversations',c,'requirements'];
  const call=(method:string,body?:unknown,auth=token)=>assistantHttp(new Request('http://localhost/api/miniprogram/assistant/'+path.join('/'),{
    method,headers:{Authorization:'Bearer '+auth,'Idempotency-Key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body),
  }),path);
  const result=await call('POST',{action:'draft'});assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.equal((await call('GET')).status,200);
  assert.equal((await call('POST',{action:'draft',enterpriseId:tenants[1]})).status,422);
  assert.equal((await call('GET',undefined,'invalid')).status,401);
});

test('native controller completes edit, confirmation and fresh-entry through real authenticated HTTP handlers',async()=>{
  const {c}=await setup();
  const token=await signMiniProgramToken({sub:users[0],id:users[0],contextVersion:1,mode:'customer',role:'user',source:'wechat'});
  const require=createRequire(import.meta.url);
  const {AssistantClient}=require('../../../../miniprogram/packages/assistant/lib/client.js');
  const {RequirementsController}=require('../../../../miniprogram/packages/assistant/lib/requirements.js');
  const request=async(url:string,method:string,body:Record<string,unknown>,options:{headers:Record<string,string>})=>{
    const route=url.replace('/miniprogram/assistant/','').split('/');
    const response=await assistantHttp(new Request('http://localhost/api'+url,{
      method,headers:{Authorization:'Bearer '+token,...options.headers},body:method==='GET'?undefined:JSON.stringify(body),
    }),route);
    const result=await response.json();
    if(!response.ok)throw {...result,statusCode:response.status};
    return result;
  };
  const create=()=>new RequirementsController({client:new AssistantClient(request),identity:()=>token,emit(){}});
  const page=create();await page.show(c);
  assert.equal(page.state.error,'');assert.equal(page.state.rows.length,5);
  await page.edit('budget');page.input('budget','总预算25万元');
  assert.equal(await page.act('confirm'),true);page.dispose();
  const reopened=create();await reopened.show(c);
  assert.equal(reopened.state.confirmed,true);assert.equal(reopened.fields().budget,'总预算25万元');
  await reopened.edit('style');reopened.input('style','现代简约');
  assert.equal(await reopened.act('confirm'),true);reopened.dispose();
  const final=create();await final.show(c);
  assert.equal(final.fields().budget,'总预算25万元');assert.equal(final.fields().style,'现代简约');final.dispose();
});

test('P2S direct chat handoff, waiting supplements, private staff review and restoration', async () => {
  const chat = new ConversationService(actor), customer = new HandoffService(actor);
  const c = String((await chat.create(randomUUID())).id);
  const staffActor: ActorContext = { enterpriseId: actor.enterpriseId, principal: { kind: 'admin', adminId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] };
  const staff = new HandoffService(staffActor);
  const sent = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '请设计师接着聊' }] });
  assert.equal(sent.runId, null); assert.equal((await chat.detail(c)).mode, 'handoff_requested');
  const supplement = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '90平旧房，预算未定，书房书桌靠窗' }] });
  assert.equal(supplement.runId, null);
  const requirement = await new RequirementService(actor).read(c);
  assert.equal(requirement.latest?.status, 'draft'); assert.equal(requirement.confirmed, null);
  assert.match(JSON.stringify(requirement.latest?.draftFields), /靠窗/);
  const media = new AssistantMediaService(actor);
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#123456' } }).png().toBuffer();
  const upload = await media.upload(c, randomUUID(), bytes, 'image', '');
  assert.equal('packet' in ((await staff.staffRead(c)).handoff || {}), false);
  assert.equal('packet' in ((await staff.staffList()).items.find(i => i.conversationId === c)!.handoff || {}), false);
  await assert.rejects(new AssistantMediaService(staffActor).read(c, upload.id), /assistant_resource_not_found/);
  await staff.staffWrite(c, randomUUID(), { action: 'claim' });
  assert.ok((await new AssistantMediaService(staffActor).read(c, upload.id)).data.length);
  let detail = await staff.staffRead(c);
  const correction = { action: 'correct', expectedVersion: detail.version, field: 'room', text: '书房保留现有书桌，靠窗', sourceMessageId: supplement.messageId, note: '依据客户原话，未批准方案' };
  const correctionKey = randomUUID();
  await staff.staffWrite(c, correctionKey, correction);
  await staff.staffWrite(c, correctionKey, correction);
  detail = await staff.staffRead(c);
  assert.ok(detail.handoff && 'packet' in detail.handoff);
  assert.equal((detail.handoff.packet.corrections as unknown[]).length, 1);
  assert.equal((await customer.customerRead(c)).handoff?.packet.corrections, undefined);
  await assert.rejects(staff.staffWrite(c, randomUUID(), correction), /version_conflict/);
  await staff.staffWrite(c, randomUUID(), { action: 'associate', expectedVersion: detail.version, mediaId: upload.id, category: 'site', roomName: '书房', leadId: null, floorPlanId: null, roomId: null });
  detail = await staff.staffRead(c);
  assert.ok(detail.handoff && 'packet' in detail.handoff);
  assert.match(JSON.stringify(detail.handoff.packet.mediaAnnotations), /书房/);
  await assert.rejects(staff.staffWrite(c, randomUUID(), { action: 'link', expectedVersion: detail.version, leadId: foreignLead }), /assistant_resource_not_found/);
  await staff.staffWrite(c, randomUUID(), { action: 'link', expectedVersion: detail.version, leadId });
  await staff.staffWrite(c, randomUUID(), { action: 'reply', text: '周六下午方便吗？我们就在这里聊。' });
  assert.equal((await chat.detail(c)).latestRun, null);
  await staff.staffWrite(c, randomUUID(), { action: 'release' });
  assert.equal((await chat.detail(c)).mode, 'handoff_requested');
  await assert.rejects(new AssistantMediaService(staffActor).read(c, upload.id), /assistant_resource_not_found/);
  await customer.customerWrite(c, randomUUID(), { action: 'cancel' });
  assert.equal((await chat.detail(c)).mode, 'ai');
  await customer.customerWrite(c, randomUUID(), { action: 'request' });
  assert.equal((await customer.customerRead(c)).handoff?.contactConsent, false);
});

test('P2S guidance follows topic changes and natural corrections without requiring summary approval', async () => {
  const settings = new GuidanceSettingsService(actor.enterpriseId, adminId);
  const old = await settings.execute();
  const config = { ...defaultGuidance, opening: '自定义企业开场白' };
  const saved = await settings.execute({ expectedVersion: old.version, config });
  assert.deepEqual(await settings.execute({ expectedVersion: old.version, config }), saved);
  await assert.rejects(settings.execute({ expectedVersion: old.version, config: { ...config, opening: '冲突' } }), /version_conflict/);
  const chat = new ConversationService({ ...actor, entry: { guidanceVersion: saved.version } });
  const c = String((await chat.create(randomUUID())).id);
  assert.match(String((await chat.detail(c)).guidanceOpening), /新房还是旧房/);
  const respond = async (text: string) => {
    const sent = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAnswer(lease, { retriever: { retrieve: async () => [] } });
    assert.equal((await chat.run(String(sent.runId))).status, 'succeeded');
    return JSON.stringify((await chat.messages(c)).items[0].content);
  };
  await respond('90平旧房，两个人住，喜欢原木风');
  const interrupted = await respond('这面墙能拆吗？');
  assert.doesNotMatch(interrupted, /预算有大致|什么时候开始装修|需求摘要/);
  assert.equal((await chat.detail(c)).guidance, null);
  const corrected = await respond('预算改成25万元');
  assert.match(corrected, /预算改成25万元/); assert.doesNotMatch(corrected, /需求摘要|确认保存/);
  const recap = await respond('你帮我记了哪些想法？');
  assert.match(recap, /25万元/); assert.match(recap, /90平旧房/);
  const requirements = await new RequirementService(actor).read(c);
  assert.equal(requirements.latest?.status, 'draft'); assert.equal(requirements.confirmed, null);
  const updated = await settings.execute({ expectedVersion: saved.version, config: { ...config, enabled: false } });
  await assert.rejects(chat.create(randomUUID()), /entry_context_invalid/);
  await settings.execute({ expectedVersion: updated.version, config: old.config });
});
