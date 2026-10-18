import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PlanCustomerService, planCommand, readPlan, deliverPlans } from '@/lib/construction/site-plans';
import { queryNeedIssues } from '@/lib/construction/need-issues';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';

const prefix = 'synthetic-p5-' + randomUUID(), eids: string[] = [], users: string[] = [], admins: string[] = [];
const platformAdmins: string[] = [];
let pid: string, otherPid: string, rid: string, issueId: string, cid: string;
let owner: ConstructionService, boss: SiteChatService, designer: SiteChatService, worker: SiteChatService, privateChat: ConversationService, customer: PlanCustomerService;
let first: string, second: string, third: string, fourth: string;
let planDerivedMessageId = '';
const roomId = async () => String(((await boss.read(pid)).rooms as Row[]).find(r => r.name === '书房')!.id);
const command = async (staff: SiteChatService, raw: string, mediaIds: string[] = [], requestKey: string = randomUUID(), versions?: Row) =>
  staff.send(pid, { text: raw, mediaIds, versions: versions || (await staff.read(pid)).versions }, requestKey);
const say = (text: string) => privateChat.send(cid, randomUUID(), {version:1,blocks:[{type:'text',text}]}, siteWatchInterceptor);
const raw = () => `发布方案事项${issueId}\n标题：书房插座调整\n差异：由单人桌改为双人桌，增设一组插座，按本图纸位置复核。\n费用变化：+500.00元\n工期变化：+2天`;
const upload = async (staff = designer) => String((await staff.upload(pid,randomUUID(),await sharp({create:{width:64,height:48,channels:3,background:'#cef4e5'}}).png().toBuffer())).id);
const view = (versionId: string) => customer.read(versionId);
const publish = async (staff = designer) => String((await command(staff,raw(),[await upload(staff)])).planId);
const decide = async (versionId: string, action: string, reason?: string) => customer.decide(versionId, action,
  {expectedRevision:(await view(versionId)).revision,...(reason?{reason}:{})},randomUUID());

before(async () => {
  const target=new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(target.port,'55432');assert.equal(target.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for(let n=0;n<2;n++){
      eids.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eids[n]},true,100,12000000,1000000000,30)`);
    }
    for(const [i,role] of ['enterprise_admin','designer','construction_staff'].entries())admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eids[0]},${prefix+i},'synthetic-only',${role},'active',false,${'合成员工'+i}) returning id`))!.id));
    users.push(String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[0]},${prefix})`);
  });
  owner=new ConstructionService({enterpriseId:eids[0],adminId:admins[0]});boss=new SiteChatService(owner.actor);designer=new SiteChatService({enterpriseId:eids[0],adminId:admins[1]});worker=new SiteChatService({enterpriseId:eids[0],adminId:admins[2]});
  const lead=String((await withTenantTransaction(eids[0],tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[0]},${users[0]},'合成方案业主','13800000000','natural') returning id`)))!.id);
  pid=String((await owner.execute('create',{leadId:lead,name:'合成方案工地',managerId:admins[0],rooms:['书房']},randomUUID())).id);
  otherPid=String((await owner.execute('create',{leadId:lead,name:'隔离反例',managerId:admins[0],rooms:['客厅']},randomUUID())).id);
  for(const [i,role] of ['designer','worker'].entries())await owner.execute('member',{projectId:pid,expectedVersion:Number(((await owner.execute('detail',{projectId:pid})).project as Row).version),adminId:admins[i+1],role,active:true,workLabel:''},randomUUID());
  privateChat=new ConversationService({enterpriseId:eids[0],principal:{kind:'user',userId:users[0]},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:lead}});
  cid=String((await privateChat.create(randomUUID())).id);customer=new PlanCustomerService(privateChat.actor,cid);
  await say('共享合成方案工地·书房需求：双人办公，需要电脑和台灯插座。');
  const source=await worker.send(pid,{text:'书房底盒还没固定，等设计师核对位置。',mediaIds:[]},randomUUID());rid=String(source.recordId);
  const room=await roomId(),lease=await claimJob();assert.equal(lease?.runId,source.runId);
  await processSiteRecord(lease!,async()=>({text:JSON.stringify({title:'书房进展',roomId:room,completed:'',pending:'底盒还没固定',coordination:'设计师核对位置',note:''}),toolCalls:[],finishReason:'stop',providerRequestId:null,usage:{inputTokens:50,outputTokens:40}}));
  issueId=String((await command(boss,'跟进记录'+rid)).issueId);await command(designer,'接手事项'+issueId);await command(designer,'回复事项'+issueId+'：已核对需求，准备明确版本图纸。');
});
after(async()=>{try{await withPlatformTransaction(async tx=>{
  for(const eid of eids){await deleteConstructionData(tx,BigInt(eid));await deleteAssistantData(tx,BigInt(eid));await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);await tx.execute(sql`delete from app.enterprises where id=${eid}`);}
  for(const uid of users){await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`);await tx.execute(sql`delete from app.users where id=${uid}`);}
  for(const aid of platformAdmins)await tx.execute(sql`delete from app.admin_users where id=${aid}`);
});}finally{await closePostgresPool();}});

test('PPT23 formal command requires exact stated differences and financial/time impact; acknowledgements do not authorize',()=>{
  assert.equal(planCommand('好，可以按V2做'),null);assert.equal(planCommand('能否发布方案事项12？'),null);
  assert.throws(()=>planCommand('发布方案事项12\n标题：缺影响'),/invalid_plan/);
  const p=planCommand(raw());assert.equal(p?.action,'publish');if(p?.action==='publish'){assert.equal(p.costDeltaCents,50000);assert.equal(p.scheduleDeltaDays,2);}
});
test('enterprise publication needs an actual issuer-owned drawing and authorized reviewer, not customer image or worker text',async()=>{
  await assert.rejects(command(designer,raw()),/plan_original_required/);
  await assert.rejects(command(worker,raw(),[await upload(worker)]),/construction_forbidden/);
  const key=randomUUID(),mid=await upload(),body={text:raw(),mediaIds:[mid],versions:(await designer.read(pid)).versions};
  const result=await designer.send(pid,body,key);first=String(result.planId);assert.ok(first&&first!=='undefined');assert.deepEqual(await designer.send(pid,body,key),result);
  const p=await view(first);assert.equal(p.number,1);assert.equal(p.previousVersionId,null);assert.equal(p.mediaId,mid);assert.equal(p.status,'pending_customer');
  assert.ok((await customer.media(first)).data.length);await deliverPlans();await deliverPlans();
  const messages=await privateChat.messages(cid,undefined,100);assert.equal(messages.items.filter(m=>m.planDecision?.id===first).length,1);
});
test('PPT23/38 exact-version preview, persistent later, requested changes and return to the same shared issue',async()=>{
  await assert.rejects(decide(first,'approve'),/plan_preview_required/);
  await decide(first,'defer');assert.equal((await view(first)).status,'deferred');
  await decide(first,'request-changes','请把新增插座移到桌面右侧');assert.equal((await view(first)).status,'changes_requested');
  assert.match(String(((await boss.read(pid)).plans as Row[])[0].text),/桌面右侧/);
  const progress=await withTenantTransaction(eids[0],tx=>one(tx,sql`select payload from app.domain_event_outbox where enterprise_id=${eids[0]} and type='construction.site.issue.progress.v1' and aggregate_id=${issueId} order by aggregate_version desc limit 1`));
  assert.equal((progress!.payload as Row).state,'awaiting_review');
  second=await publish();const p=await view(second);assert.equal(p.number,2);assert.equal(p.previousVersionId,first);assert.equal(p.previewed,false);assert.equal(p.status,'pending_customer');
  await assert.rejects(view(first),/plan_unavailable/);await assert.rejects(customer.media(first),/plan_unavailable/);
});
test('exact approval is idempotent after a lost response, does not close issue or imply execution, and is not inherited by V3',async()=>{
  await decide(second,'preview');const p=await view(second),body={expectedRevision:p.revision},key=randomUUID();
  const result=await customer.decide(second,'approve',body,key);assert.equal(result.status,'approved');assert.deepEqual(await customer.decide(second,'approve',body,key),result);
  assert.equal((await view(second)).status,'approved');
  const query=await command(designer,'书房资料在哪里？');
  const queryRow=((await boss.read(pid,undefined,100)).items as Row[]).find(i=>String((i.message as Row).id)===String(query.messageId))!;
  assert.match(String((queryRow.response as Row).text),/已同意这一版/);assert.match(String((queryRow.response as Row).text),/资料关联本身不改变决定/);
  const issue=await withTenantTransaction(eids[0],tx=>one(tx,sql`select payload from app.domain_event_outbox where enterprise_id=${eids[0]} and type='construction.site.issue.progress.v1' and aggregate_id=${issueId} order by aggregate_version desc limit 1`));
  assert.equal((issue!.payload as Row).state,'awaiting_review');
  third=await publish();assert.equal((await view(third)).number,3);assert.equal((await view(third)).status,'pending_customer');
  await assert.rejects(customer.decide(second,'approve',body,key),/plan_unavailable/);
});
test('tenant, project, recipient and original-consultation boundaries cover metadata, media, decisions and live role',async()=>{
  const other=String((await privateChat.create(randomUUID())).id);
  await assert.rejects(new PlanCustomerService(privateChat.actor,other).read(third),/plan_unavailable/);
  await assert.rejects(new PlanCustomerService({...privateChat.actor,enterpriseId:eids[1]},cid).read(third));
  await assert.rejects(new SiteChatService({enterpriseId:eids[0],adminId:admins[2]}).send(otherPid,{text:raw(),mediaIds:[],versions:{records:{},issues:{}}},randomUUID()));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eids[0]} and project_id=${pid} and admin_id=${admins[1]}`));
  await assert.rejects(view(third),/plan_unavailable/);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_members set active=true where enterprise_id=${eids[0]} and project_id=${pid} and admin_id=${admins[1]}`));
});
test('human reception defers the same publication and Worker delivery is durable and unique after returning to AI',async()=>{
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eids[0]} and id=${cid}`));
  await deliverPlans();assert.ok(!(await privateChat.messages(cid,undefined,100)).items.some(m=>m.planDecision?.id===third));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eids[0]} and id=${cid}`));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eids[0]}`));
  await deliverPlans();assert.ok(!(await privateChat.messages(cid,undefined,100)).items.some(m=>m.planDecision?.id===third));
  await assert.rejects(customer.decide(third,'preview',{expectedRevision:1},randomUUID()),/assistant_disabled/);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${eids[0]}`));
  await Promise.all([deliverPlans(),deliverPlans()]);
  assert.equal((await privateChat.messages(cid,undefined,100)).items.filter(m=>m.planDecision?.id===third).length,1);
});
test('Agent read model contains exact published version, impacts and customer state without granting approval',async()=>{
  const snapshot=await withTenantTransaction(eids[0],tx=>queryNeedIssues(tx,privateChat.actor,cid));
  assert.ok(snapshot.data.some(p=>p.kind==='formal_plan'&&p.sourceVersion));assert.match(snapshot.displayText,/500\.00元|\+500/);assert.match(snapshot.displayText,/不会自动落实或关闭事项/);
  await decide(third,'decline');assert.equal((await view(third)).status,'declined');
  const changed=await withTenantTransaction(eids[0],tx=>queryNeedIssues(tx,privateChat.actor,cid));assert.notEqual(changed.version,snapshot.version);assert.match(changed.displayText,/未同意这一版/);
});
test('actual query_followups tool checkpoints formal versions into revocable construction provenance',async()=>{
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_enterprise_settings set
    agent_config='{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb where enterprise_id=${eids[0]}`));
  const sent=await say('刚才发给我的书房方案具体改了什么？'),lease=await claimJob();assert.equal(lease?.runId,sent.runId);
  await processAgentAnswer(lease!,{model:async(messages,_tools,turn)=>{
    const resultKey=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content as string).resultKey).at(-1);
    return {text:'',toolCalls:[{id:'formal-'+turn,name:turn===0?'query_followups':'final_response',arguments:JSON.stringify(turn===0?{}:{kind:'business',resultKey})}],
      finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:60,outputTokens:30}};
  }});
  const run=await privateChat.run(String(sent.runId));assert.equal(run.status,'succeeded');planDerivedMessageId=String(run.outputMessageId);
  const step=await withTenantTransaction(eids[0],tx=>one(tx,sql`select source_refs from app.assistant_run_steps where enterprise_id=${eids[0]} and run_id=${String(sent.runId)} and kind='agent_construction_context'`));
  assert.ok(Array.isArray(step?.source_refs)&&(step.source_refs as string[]).length>0);
  assert.equal((await privateChat.messages(cid,undefined,100)).items.find(m=>m.id===planDerivedMessageId)!.available,true);
});
test('owner/admin/super_admin issue formal versions in the selected tenant without employment or project membership',async()=>{
  for(const role of ['enterprise_admin','admin','super_admin']){
    let aid=admins[0];
    if(role!=='enterprise_admin')aid=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(username,password_hash,role,status,must_change_password,display_name)
      values(${prefix+role},'synthetic-only',${role},'active',false,${'合成'+role}) returning id`)))!.id);
    if(role!=='enterprise_admin')platformAdmins.push(aid);
    const manager=new SiteChatService({enterpriseId:eids[0],adminId:aid}),version=await publish(manager);
    assert.equal((await view(version)).status,'pending_customer');
    const foreign=new SiteChatService({enterpriseId:eids[1],adminId:aid});await assert.rejects(foreign.read(pid));
  }
  assert.equal((await privateChat.messages(cid,undefined,100)).items.find(m=>m.id===planDerivedMessageId)!.available,false,'superseding the formal version revokes its inherited answer');
});
test('concurrent preview/approve and supersession serialize without duplicate decisions or a stale effective approval',async()=>{
  const version=await publish();await decide(version,'preview');const p=await view(version),mid=await upload(),versions=(await designer.read(pid)).versions;
  const results=await Promise.allSettled([
    customer.decide(version,'approve',{expectedRevision:p.revision},randomUUID()),
    designer.send(pid,{text:raw(),mediaIds:[mid],versions},randomUUID()),
  ]);
  assert.ok(results.some(r=>r.status==='fulfilled'));
  for(const r of results)if(r.status==='rejected')assert.match(String(r.reason),/plan_unavailable|version_conflict/);
  const approvals=await withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.domain_event_outbox where enterprise_id=${eids[0]}
    and type='construction.plan.status.v1' and aggregate_id=${version} and payload->>'status'='approved'`));assert.ok(approvals.length<=1);
  const current=(await boss.read(pid)).plans as Row[];assert.equal(current.filter(p=>p.available).length,1);
  if(results[1].status==='fulfilled'){const next=String(results[1].value.planId);assert.equal((await view(next)).status,'pending_customer');await assert.rejects(view(version),/plan_unavailable/);}
});
test('explicit withdrawal and source revocation invalidate media/history/old receipts and never reactivate an old approved version',async()=>{
  fourth=await publish();await deliverPlans();await decide(fourth,'preview');const v=await view(fourth),body={expectedRevision:v.revision},key=randomUUID();
  await customer.decide(fourth,'approve',body,key);
  await command(boss,'撤回方案'+fourth+'：现场尺寸需重新确认');
  await assert.rejects(view(fourth),/plan_unavailable/);await assert.rejects(customer.media(fourth),/plan_unavailable/);await assert.rejects(customer.decide(fourth,'approve',body,key),/plan_unavailable/);
  await assert.rejects(view(second),/plan_unavailable/);assert.ok(!(await privateChat.messages(cid,undefined,100)).items.some(m=>m.planDecision));
  const fifth=await publish();const need=await withTenantTransaction(eids[0],tx=>one(tx,sql`select id from app.domain_event_outbox where enterprise_id=${eids[0]} and type='construction.material.shared.v1' and payload->>'kind'='need' order by id desc limit 1`));
  await say('撤回共享资料'+String(need!.id));await assert.rejects(view(fifth),/plan_unavailable/);await deliverPlans();
  assert.equal(await withTenantTransaction(eids[0],tx=>readPlan(tx,eids[0],fifth)),null);
  assert.ok((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select * from app.domain_event_deliveries where enterprise_id=${eids[0]} and event_id=${fifth}`))).every(d=>d.status==='dead'));
});
