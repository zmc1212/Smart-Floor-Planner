import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { GET as webHandoffGet, POST as webHandoffPost } from '@/app/api/assistant/handoffs/[[...path]]/route';
import { GET as webProfileGet } from '@/app/api/leads/[id]/renovation-profile/route';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { runAssistantRetention } from '@/lib/assistant/retention/service';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { getJwtSecret } from '@/lib/jwt-secret';
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
const webAdminIds: string[] = [];
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
  const pending=await chat.send(c,randomUUID(),{version:1,blocks:[{type:'text',text:'旧房量房前要准备什么？'}]});
  assert.ok(pending.runId);
  const lateLease=await claimJob({enterpriseId:actor.enterpriseId,runId:String(pending.runId)});assert.ok(lateLease);
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

test('Web handoff gives platform managers selected-enterprise access to consenting customers', async t => {
  const customer = new HandoffService(actor);
  const photo = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#00b979' } }).png().toBuffer();
  for (const role of ['enterprise_admin', 'admin', 'super_admin'] as const) {
    await t.test(role, async () => {
      const platform = role !== 'enterprise_admin';
      const operatorId = platform ? await withPlatformTransaction(async tx => {
        const operator = await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password)
          values(${prefix + role},'test',${role},'active',false) returning id`);
        const id = String(operator!.id);
        webAdminIds.push(id);
        return id;
      }) : adminId;
      const token = await new SignJWT({ id: operatorId, role, enterpriseId: platform ? null : actor.enterpriseId })
        .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(getJwtSecret());
      const { chat, c } = await setup('我家是套旧房 打算重新装修');
      const uploaded = await new AssistantMediaService(actor).upload(c, randomUUID(), photo, 'image', '客厅');
      const call = (path: string[], body?: Record<string, unknown>, enterpriseId: string | null = actor.enterpriseId) => {
        const request = new NextRequest('http://localhost:3006/api/assistant/handoffs/' + path.join('/'), {
          method: body ? 'POST' : 'GET',
          headers: { Cookie: `auth_token=${token}${enterpriseId ? `; global_tenant_id=${enterpriseId}` : ''}`,
            'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return (body ? webHandoffPost : webHandoffGet)(request, { params: Promise.resolve({ path }) });
      };

      if (platform) assert.equal((await call([], undefined, null)).status, 400);
      assert.equal((await call([c])).status, 404);
      await customer.customerWrite(c, randomUUID(), { action: 'request', recipientId: adminId });
      if (platform) assert.equal((await call([c], { action: 'claim' })).status, 404);
      await customer.customerWrite(c, randomUUID(), { action: 'cancel' });

      await customer.customerWrite(c, randomUUID(), { action: 'request', mediaConsent: true });
      if (platform) assert.equal((await call([c], undefined, other.enterpriseId)).status, 404);
      const queue = await call([]);
      assert.equal(queue.status, 200);
      assert.ok((await queue.json()).data.items.some((item: { conversationId: string }) => item.conversationId === c));
      const waiting = await call([c]);
      assert.equal(waiting.status, 200);
      const waitingDetail = (await waiting.json()).data;
      assert.equal(waitingDetail.handoff.packet, undefined);
      assert.deepEqual(waitingDetail.messages, []);
      assert.equal((await call([c, 'media', String(uploaded.id)])).status, 404);

      assert.equal((await call([c], { action: 'claim' })).status, 200);
      const detail = await call([c]);
      assert.equal(detail.status, 200);
      const active = (await detail.json()).data;
      assert.equal(active.handoff.ownerId, operatorId);
      assert.equal(active.handoff.packet.summary.draft_fields.housing.text, '我家是套旧房 打算重新装修');
      assert.equal((await call([c, 'media', String(uploaded.id)])).status, 200);
      assert.equal((await call([c], { action: 'reply', text: '继续聊聊这套旧房。' })).status, 200);
      assert.ok((await chat.messages(c)).items.some(message => message.authorKind === 'admin'));
      const supplement = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '我和父母一起住。' }] });
      assert.equal(supplement.runId, null);
      assert.equal((await customer.customerRead(c)).handoff?.ownerAvailable, true);

      assert.equal((await call([c], { action: 'release' })).status, 200);
      assert.equal((await call([c, 'media', String(uploaded.id)])).status, 404);
      assert.equal((await call([c], { action: 'claim' })).status, 200);
      if (platform) {
        await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=true where id=${operatorId}`));
        assert.equal((await call([c])).status, 403);
        assert.equal((await customer.customerRead(c)).handoff?.ownerAvailable, false);
        await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=false where id=${operatorId}`));
      }
      assert.equal((await call([c], { action: 'end' })).status, 200);
      assert.equal((await call([c])).status, 404);
      assert.equal((await chat.detail(c)).mode, 'ai');
    });
  }
});

before(async()=>{
  // Knowledge-enabled runs must read the local pgvector index rather than an
  // unconfigured managed provider; the missing answer model must stay the only
  // failure this suite asserts.
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = 'local';
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, process.env.XIAOK_ISOLATED_POSTGRES_PORT || '55432');
  assert.equal(url.pathname,'/xiaok_embedding_eval');
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
    for (const adminId of webAdminIds) await tx.execute(sql`delete from app.admin_users where id=${adminId}`);
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
test('renovation profile follows the confirmed home, merges corrections, and withdraws access', async () => {
  const { chat, c } = await setup('我家是套旧房打算重新装修。我和父母一起住。');
  const household = '我和父母一起住';
  const identity = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1,
    mode: 'customer', enterpriseId: actor.enterpriseId, role: 'user', source: 'wechat' });
  const ops = async (path: string[], body?: Record<string, unknown>, requestKey = randomUUID()) => {
    const url = 'http://localhost/api/miniprogram/assistant/' + path.join('/') + (body ? '' : '?profile=1');
    return assistantHttp(new Request(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + identity, 'Idempotency-Key': requestKey },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), path);
  };
  const fixtures = await withPlatformTransaction(async tx => {
    const secondHome = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${actor.enterpriseId},${users[0]},${prefix+'-second-home'},'13000000000','manual') returning id`);
    const operators = [];
    for (const role of ['admin', 'super_admin', 'designer', 'designer'] as const) {
      const staff = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
        values(${role === 'designer' ? actor.enterpriseId : null},${prefix + '-profile-' + operators.length},'test',${role},'active',false) returning id`);
      const operator = { id: String(staff!.id), role };
      if (role !== 'designer') webAdminIds.push(operator.id);
      operators.push(operator);
    }
    await tx.execute(sql`update app.leads set assigned_to=${operators[2].id} where id=${leadId}`);
    return { secondHome: String(secondHome!.id), operators };
  });
  const manager = { id: adminId, role: 'enterprise_admin' };
  const adminRead = async (operator = manager, target = leadId, enterpriseId: string | null = actor.enterpriseId) => {
    const token = await new SignJWT({ id: operator.id, role: operator.role,
      enterpriseId: ['admin','super_admin'].includes(operator.role) ? null : actor.enterpriseId })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(getJwtSecret());
    return webProfileGet(new Request('http://localhost/api/leads/' + target + '/renovation-profile', {
      headers: { Cookie: `auth_token=${token}${enterpriseId ? '; global_tenant_id=' + enterpriseId : ''}` },
    }), { params: Promise.resolve({ id: target }) });
  };
  const requirements = ['conversations', c, 'requirements'];
  const snapshot = (await (await ops(requirements)).json()).data;
  assert.equal(snapshot.profile.leadId, null);
  assert.ok(snapshot.profile.options.find((choice: { id: string }) => choice.id === fixtures.secondHome));
  assert.deepEqual((await (await adminRead()).json()).data, null);
  const initialBody = { action: 'share_profile', draftId: snapshot.latest.id, expectedVersion: snapshot.latest.version,
    fields: { ...fields, housing: '旧房重新装修', household, style: '' }, leadId, profileVersion: 0, consent: true };
  assert.equal((await ops(requirements, { ...initialBody, consent: false })).status, 422);
  assert.equal((await ops(requirements, { ...initialBody, leadId: foreignLead })).status, 404);
  const key = randomUUID();
  const savedResponse = await ops(requirements, initialBody, key);
  const saved = (await savedResponse.json()).data;
  assert.equal(savedResponse.status, 200);
  assert.equal(saved.profile.current.version, 1);
  assert.equal(saved.profile.current.leadId, leadId);
  assert.equal((await (await ops(requirements, initialBody, key)).json()).data.profileVersion, 1);
  for (const operator of [manager, ...fixtures.operators.slice(0, 3)]) {
    const web = await adminRead(operator);
    assert.equal(web.status, 200);
    const profile = (await web.json()).data;
    assert.equal(profile.fields.find((field: { key: string }) => field.key === 'household').value, household);
    assert.ok(!profile.fields.some((field: { key: string }) => field.key === 'budget'));
  }
  assert.equal((await adminRead(fixtures.operators[3])).status, 404);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set assigned_to=null where id=${leadId}`));
  assert.equal((await adminRead(fixtures.operators[2])).status, 404);
  assert.equal((await adminRead(fixtures.operators[1], leadId, other.enterpriseId)).status, 404);
  assert.equal((await adminRead(fixtures.operators[1], leadId, null)).status, 400);
  assert.equal((await (await adminRead(manager, fixtures.secondHome)).json()).data, null);

  const entry = (await (await ops(['entry-context'], { leadId })).json()).data;
  const next = (await (await ops(['conversations'], { entryToken: entry.entryToken })).json()).data;
  const nextId = String(next.id);
  assert.equal((await (await ops(['conversations', nextId])).json()).data.hasRequirementSummary, true);
  const messageKey = randomUUID();
  const sent = (await (await ops(['conversations', nextId, 'messages'], {
    clientMessageId: messageKey, content: { version: 1, blocks: [{ type: 'text', text: '回顾一下这套房已确认的装修需求。' }] },
  }, messageKey)).json()).data;
  const lease = await claimJob({ enterpriseId: actor.enterpriseId, runId: sent.runId });
  assert.ok(lease);
  await processAnswer(lease);
  const recap = await chat.messages(nextId);
  assert.match(JSON.stringify(recap.items[0].content), /我和父母一起住/);
  await send(chat, nextId, '这套房现在两个人住。');
  const nextPath = ['conversations', nextId, 'requirements'];
  const corrected = (await (await ops(nextPath)).json()).data;
  const update = { ...initialBody, draftId: corrected.latest.id, expectedVersion: corrected.latest.version,
    fields: { housing: '', household: '两个人住', style: '', budget: '', timeline: '' }, profileVersion: 1 };
  assert.equal((await ops(nextPath, { ...update, leadId: fixtures.secondHome })).status, 404);
  assert.equal((await ops(nextPath, { ...update, profileVersion: 0 })).status, 409);
  const updated = await ops(nextPath, update);
  assert.equal(updated.status, 200);
  assert.deepEqual(Object.fromEntries((await updated.json()).data.profile.current.fields
    .map((field: { key: string; value: string }) => [field.key, field.value])),
  { housing: '旧房重新装修', household: '两个人住', timeline: fields.timeline });
  assert.doesNotMatch(JSON.stringify((await chat.messages(nextId)).items.find(message => message.id === recap.items[0].id)?.content), /我和父母一起住/);

  const withdrawPath = ['conversations', c, 'renovation-profile'];
  const withdrawKey = randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    const withdrawn = await ops(withdrawPath, { leadId, expectedVersion: 2 }, withdrawKey);
    assert.equal(withdrawn.status, 200);
    assert.equal((await withdrawn.json()).data.options[0].shared, false);
  }
  assert.equal((await (await ops(requirements, initialBody, key)).json()).data.profile.current, null);
  assert.equal((await (await adminRead()).json()).data, null);
  const retained = (await (await ops(requirements)).json()).data.latest;
  const reshare = await ops(requirements, { ...initialBody, expectedVersion: retained.version, profileVersion: 3 });
  assert.equal(reshare.status, 200);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set archived_at=now() where id=${leadId}`));
  assert.equal((await adminRead()).status, 404);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set archived_at=null where id=${leadId}`));
  assert.equal((await (await adminRead()).json()).data, null);
});
test('ordinary service chat builds a staff-only profile and preserves other homes and withdrawn sources', async () => {
  const home = await withTenantTransaction(actor.enterpriseId, async tx => String((await one(tx, sql`
    insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${actor.enterpriseId},${users[0]},${prefix+'-automatic-profile'},'13000000000','manual') returning id`))!.id));
  const miniToken = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1,
    mode: 'customer', enterpriseId: actor.enterpriseId, role: 'user', source: 'wechat' });
  const calls: string[] = [];
  const bridge = async (path: string, method: string, body: Record<string, unknown>, options: { headers: Record<string, string> }) => {
    calls.push(method+' '+path);
    const url = new URL('http://localhost/api'+path);
    if (method === 'GET') for (const [key, value] of Object.entries(body)) url.searchParams.set(key, String(value));
    const response = await assistantHttp(new Request(url, {
      method, headers: { Authorization: 'Bearer '+miniToken, ...options.headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }), path.replace('/miniprogram/assistant/','').split('/'));
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const request = async (path: string[], body: Record<string, string | boolean>) =>
    (await bridge('/miniprogram/assistant/'+path.join('/'), 'POST', body,
      { headers: { 'Idempotency-Key': randomUUID() } })).data;
  const staffToken = await new SignJWT({ id: adminId, role: 'enterprise_admin', enterpriseId: actor.enterpriseId })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(getJwtSecret());
  const readStaff = async (id = home, expected = 200) => {
    const response = await webProfileGet(new Request('http://localhost/api/leads/'+id+'/renovation-profile', {
      headers: { Cookie: 'auth_token='+staffToken },
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, expected);
    return (await response.json()).data;
  };
  const chat = new ConversationService(actor);
  const linked = await request(['entry-context'], { leadId: home });
  assert.equal(linked.staffProfileCapture, true);
  const newChat = async () => String((await request(['conversations'], {
    entryToken: linked.entryToken, staffProfileNotice: true,
  })).id);
  const earlierClient = await request(['conversations'], { entryToken: linked.entryToken });
  await send(chat, earlierClient.id, '我们喜欢奶油风。');
  assert.equal(await readStaff(), null);
  const ambiguous = await request(['entry-context'], {});
  assert.equal(ambiguous.staffProfileCapture, undefined);
  const unbound = await request(['conversations'], { entryToken: ambiguous.entryToken, staffProfileNotice: true });
  await send(chat, unbound.id, '这套新房准备装修。');
  assert.equal(await readStaff(), null);

  const requireMini = createRequire(join(process.cwd(),'package.json'));
  const { AssistantClient } = requireMini('../miniprogram/packages/assistant/lib/client.js');
  const { ChatController } = requireMini('../miniprogram/packages/assistant/lib/chat.js');
  const client = new ChatController({ client: new AssistantClient(bridge), identity: () => miniToken, emit() {},
    schedule: () => 0, unschedule() {} });
  const span = calls.length;
  await client.show({ leadId: home });
  assert.equal(client.state.staffProfileCapture, true);
  client.input('我家是套旧房，打算重新装修。');
  await client.sendMessage();
  const c = String(client.state.conversation.id);
  const runId = String(client.state.run.id);
  assert.ok(calls.slice(span).includes('POST /miniprogram/assistant/conversations/'+c+'/messages'));
  assert.ok(calls.slice(span).every(call => !call.includes('/requirements')));
  client.dispose();
  await chat.run(runId,'cancel',randomUUID());
  await send(chat, c, '我和父母一起住。预算二十万。');
  const profile = await readStaff();
  assert.deepEqual(profile.fields.map(({ key, value, source }: { key: string; value: string; source: string }) => [key,value,source]), [
    ['housing', '我家是套旧房', 'consultation'],
    ['household', '我和父母一起住', 'consultation'],
  ]);
  assert.equal(await readStaff(leadId), null);
  const customer = await new RequirementService(actor).read(c, true);
  assert.equal(customer.profile?.current, null);
  assert.ok(profile.fields.every((field: Record<string, unknown>) => field.recordedAt && !field.confirmedAt));

  const next = await newChat();
  const corrected = await send(chat, next, '后来改了，这套房现在两个人住。');
  assert.deepEqual((await readStaff()).fields.map((field: { value: string }) => field.value), [
    '我家是套旧房', '这套房现在两个人住',
  ]);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
    set content='{"version":1,"blocks":[{"type":"notice","code":"speech_deleted"}]}'::jsonb
    where enterprise_id=${actor.enterpriseId} and id=${String(corrected.messageId)}`));
  assert.deepEqual((await readStaff()).fields.map((field: { key: string }) => field.key), ['housing']);

  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set archived_at=now() where id=${home}`));
  await readStaff(home, 404);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set archived_at=null where id=${home}`));
  await send(chat, c, '我改主意了，还是原木风。');
  assert.equal(await readStaff(), null);
  await send(chat, await newChat(), '我们想做原木风。');
  assert.deepEqual((await readStaff()).fields.map((field: { key: string }) => field.key), ['style']);
});
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

test('P2S guidance follows topic changes and natural corrections without requiring summary approval', async t => {
  const settings = new GuidanceSettingsService(actor.enterpriseId, adminId);
  const old = await settings.execute();
  const agent = await withTenantTransaction(actor.enterpriseId, async tx => {
    const original = await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`);
    await tx.execute(sql`update app.assistant_enterprise_settings set agent_config='{"enterpriseKnowledgeEnabled":true}'::jsonb
      where enterprise_id=${actor.enterpriseId}`);
    return original!.agent_config;
  });
  t.after(async () => {
    await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings
      set agent_config=${JSON.stringify(agent)}::jsonb where enterprise_id=${actor.enterpriseId}`));
    const current = await settings.execute();
    await settings.execute({ expectedVersion: current.version, config: old.config });
  });
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
  await settings.execute({ expectedVersion: saved.version, config: { ...config, enabled: false } });
  await assert.rejects(chat.create(randomUUID()), /entry_context_invalid/);
});

test('ordinary LangGraph replies honor the saved guidance switch before provider dispatch', async t => {
  const settings = new GuidanceSettingsService(actor.enterpriseId, adminId);
  const old = await settings.execute();
  const original = await withTenantTransaction(actor.enterpriseId, tx => one(tx,
    sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`));
  const previousFile = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  const fetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), 'xiaok-guidance-'));
  const binding = join(directory, 'native.json');
  const writeBinding = () => writeFileSync(binding, JSON.stringify({ agentV2: { protocol: 'fastgpt-agent-v2-v1',
    enterpriseId: actor.enterpriseId, appId: 'a'.repeat(24), model: 'qwen3.7-flash', bridgeKey: randomUUID(), runtime: 'langgraph-v1' } }));
  writeBinding();
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw Error('Unexpected provider call in guidance test'); };
  const configure = (value: unknown) => withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`
    update app.assistant_enterprise_settings set agent_config=${JSON.stringify(value)}::jsonb where enterprise_id=${actor.enterpriseId}`));
  try {
    const saved = await settings.execute({ expectedVersion: old.version, config: { ...old.config, enabled: true } });
    for (const native of [false, true]) {
      await t.test(native ? 'native executor with enterprise knowledge off' : 'LangGraph with enterprise knowledge on', async () => {
        if (native) process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = binding;
        else delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
        await configure({ runtime: 'langgraph-v1', model: 'qwen3.7-flash', providerKey: 'dashscope', imageInput: false,
          tools: true, probeVersion: 'guidance-test', enterpriseKnowledgeEnabled: !native });
        const chat = new ConversationService({ ...actor, entry: { guidanceVersion: saved.version } });
        const cid = String((await chat.create(randomUUID())).id);
        const text = '我家是套旧房，准备重新装修。';
        const body = { version: 1, blocks: [{ type: 'text', text }] };
        const key = randomUUID();
        const sent = await chat.send(cid, key, body);
        const runId = String(sent.runId);
        const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`
          select policy_snapshot->'agent'->>'runtime' as agent, policy_snapshot->'agentRuntime'->>'protocol' as executor
          from app.assistant_runs where enterprise_id=${actor.enterpriseId} and id=${runId}`));
        assert.deepEqual(stored, { agent: 'langgraph-v1', executor: native ? 'xiaok-native-executor-v1' : null });
        const lease = await claimJob({ enterpriseId: actor.enterpriseId, runId });
        assert.ok(lease);
        await processAnswer(lease);
        const run = await chat.run(runId);
        assert.equal(run.status, 'succeeded', JSON.stringify(run));
        const messages = (await new ConversationService(actor).messages(cid)).items;
        assert.equal(messages[0].authorKind, 'assistant');
        assert.match(JSON.stringify(messages[0].content), /平时有哪些人住/);
        assert.equal((await new RequirementService(actor).read(cid)).latest?.status, 'draft');
        assert.equal((await chat.send(cid, key, body)).runId, sent.runId);
        assert.equal((await chat.messages(cid)).items.length, 2);
        const accounting = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`
          select q.status, j.provider_started_at, m.purpose from app.assistant_quota_reservations q
          join app.assistant_jobs j on j.enterprise_id=q.enterprise_id and j.run_id=q.run_id
          join app.assistant_messages m on m.enterprise_id=q.enterprise_id and m.id=${messages[0].id}
          where q.enterprise_id=${actor.enterpriseId} and q.run_id=${runId}`));
        assert.deepEqual(accounting, { status: 'released', provider_started_at: null, purpose: 'requirements.guidance' });
        const correction = await chat.send(cid, randomUUID(), { version: 1,
          blocks: [{ type: 'text', text: '风格改一下，我更喜欢现代简约，不想要大面积木色。' }] });
        const correctionLease = await claimJob({ enterpriseId: actor.enterpriseId, runId: String(correction.runId) });
        assert.ok(correctionLease);
        await processAnswer(correctionLease);
        const corrected = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`
          select draft_fields->'housing'->>'text' as housing, draft_fields->'style'->>'text' as style
          from app.assistant_requirement_summaries where enterprise_id=${actor.enterpriseId}
            and conversation_id=${cid} order by id desc limit 1`));
        assert.deepEqual(corrected, { housing: '我家是套旧房', style: '我更喜欢现代简约' });
        const question = await chat.send(cid, randomUUID(), { version: 1,
          blocks: [{ type: 'text', text: '厨房收纳有什么建议？' }] });
        const questionLease = await claimJob({ enterpriseId: actor.enterpriseId, runId: String(question.runId) });
        assert.ok(questionLease);
        await processAnswer(questionLease);
        const questionRun = await chat.run(questionLease.runId);
        assert.equal(questionRun.errorCode, 'model_unavailable');
        assert.equal(questionRun.outputMessageId, null);
        if (native) {
          const followup = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '我们一家三口住。' }] });
          const next = await claimJob({ enterpriseId: actor.enterpriseId, runId: String(followup.runId) });
          assert.ok(next);
          writeBinding();
          await processAnswer(next);
          const rejected = await chat.run(next.runId);
          assert.equal(rejected.errorCode, 'context_changed');
          assert.equal(rejected.outputMessageId, null);
        } else {
          const handoff = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '我和父母一起住，想转人工。' }] });
          const next = await claimJob({ enterpriseId: actor.enterpriseId, runId: String(handoff.runId) });
          assert.ok(next);
          await processAnswer(next);
          const ordinaryReply = await chat.run(next.runId);
          assert.equal(ordinaryReply.errorCode, 'model_unavailable');
          assert.equal(ordinaryReply.outputMessageId, null);
        }
      });
    }
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = fetch;
    if (previousFile === undefined) delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
    else process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = previousFile;
    unlinkSync(binding);
    rmdirSync(directory);
    await configure(original!.agent_config);
    const current = await settings.execute();
    await settings.execute({ expectedVersion: current.version, config: old.config });
  }
});
