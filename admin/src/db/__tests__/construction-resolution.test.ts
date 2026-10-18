import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PlanCustomerService } from '@/lib/construction/site-plans';
import { resolutionCommand, readSiteResolution } from '@/lib/construction/site-resolution';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { customerSiteMedia } from '@/lib/construction/site-publications';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { queryNeedIssues, needIssueSnapshotAvailable } from '@/lib/construction/need-issues';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';

const prefix = 'synthetic-p5-resolution-' + randomUUID(), eids: string[] = [], users: string[] = [], admins: string[] = [], platform: string[] = [];
let pid: string, otherPid: string, room: string, cid: string, leadId: string, cases=0, owner: ConstructionService, boss: SiteChatService, designer: SiteChatService, worker: SiteChatService, observer: SiteChatService, chat: ConversationService, customer: PlanCustomerService;
// Service fixtures fetch only their concurrency tokens; native QA separately exercises full page projections.
const versions = () => withTenantTransaction(eids[0],async tx=>{
  const records=await rows(tx,sql`select id::text,version from app.construction_site_records where enterprise_id=${eids[0]} and project_id=${pid}`);
  const issues=await rows(tx,sql`select e.id::text,coalesce((select x.aggregate_version from app.domain_event_outbox x where x.enterprise_id=e.enterprise_id and x.type='construction.site.issue.progress.v1' and x.aggregate_id=e.id::text order by x.aggregate_version desc limit 1),1) revision from app.domain_event_outbox e where e.enterprise_id=${eids[0]} and e.type='construction.site.issue.opened.v1' and e.payload->>'projectId'=${pid}`);
  const plans=await rows(tx,sql`select e.id::text,coalesce((select x.aggregate_version from app.domain_event_outbox x where x.enterprise_id=e.enterprise_id and x.type='construction.plan.status.v1' and x.aggregate_id=e.id::text order by x.aggregate_version desc limit 1),1) revision from app.domain_event_outbox e where e.enterprise_id=${eids[0]} and e.type='construction.plan.published.v1' and e.payload->>'projectId'=${pid}`);
  const resolutions=await rows(tx,sql`select distinct on(aggregate_id) aggregate_id as id,aggregate_version revision from app.domain_event_outbox where enterprise_id=${eids[0]} and type='construction.site.issue.lifecycle.v1' and payload->>'projectId'=${pid} order by aggregate_id,aggregate_version desc`);
  return {records:Object.fromEntries(records.map(r=>[String(r.id),Number(r.version)])),issues:Object.fromEntries(issues.map(r=>[String(r.id),Number(r.revision)])),plans:Object.fromEntries(plans.map(r=>[String(r.id),Number(r.revision)])),resolutions:Object.fromEntries(resolutions.map(r=>[String(r.id),Number(r.revision)])),materials:{[room]:(await sharedMaterials(tx,eids[0],pid,room)).version}};
});
const command = async (staff: SiteChatService, raw: string, mediaIds: string[] = [], requestKey: string = randomUUID(), versions?: Row) => {
  if (process.env.RESOLUTION_TRACE) console.log('COMMAND',raw.split('\n')[0]);
  return staff.send(pid, { text: raw, mediaIds, versions: versions || await fixtureVersions() }, requestKey);
};
const fixtureVersions=versions;
const image = () => sharp({create:{width:64,height:48,channels:3,background:'#d7edda'}}).png().toBuffer();
const upload = async (staff = designer) => String((await staff.upload(pid, randomUUID(), await image())).id);
const decide = async (plan: string, action: string) => customer.decide(plan, action, {expectedRevision:(await customer.read(plan)).revision}, randomUUID());
const planText = (issueId: string) => `发布方案事项${issueId}\n标题：书房插座位置\n差异：增设桌面右侧插座\n费用变化：+500.00元\n工期变化：+2天`;
const finish = (issueId: string, close = false, originals = true) => `${close ? '关闭' : '解决'}事项${issueId}\n结论：内部核对细节不应对外披露\n回传：书房右侧插座已按本次方案落实，团队已核对。\n回传原件：${originals ? '是' : '否'}`;
const resolution = (issueId: string) => withTenantTransaction(eids[0], tx => readSiteResolution(tx, eids[0], pid, issueId));
const issue = (issueId: string) => withTenantTransaction(eids[0], tx => readSiteIssue(tx, eids[0], pid, issueId));
async function record(completed = false, published = false, withImage = completed) {
  if (process.env.RESOLUTION_TRACE) console.log('RECORD',completed,published,withImage);
  const sent = await worker.send(pid, {text: completed ? '书房右侧插座今天已经装好。' : '书房底盒还没固定，等设计师核对。',mediaIds:withImage ? [await upload(worker)] : []}, randomUUID());
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({text:JSON.stringify({title:'合成现场记录',roomId:room,completed:completed?'右侧插座已安装':'',pending:completed?'':'底盒待核对',coordination:'',note:''}),toolCalls:[],finishReason:'stop',providerRequestId:null,usage:{inputTokens:50,outputTokens:40}}));
  const rid = String(sent.recordId);
  let r = (await withTenantTransaction(eids[0],tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${eids[0]} and id=${rid}`)))!;
  if (published) r=await worker.mutate(pid,rid,'publish',{expectedVersion:Number(r.version),audience:'internal'},randomUUID());
  const original=await withTenantTransaction(eids[0],tx=>one(tx,sql`select media_id from app.construction_site_attachments where enterprise_id=${eids[0]} and project_id=${pid} and record_id=${rid} order by position limit 1`));
  return {id:rid,version:Number(r.version),mediaId:String(original?.media_id || '')};
}
async function setup(approved = true) {
  cid=String((await chat.create(randomUUID())).id);customer=new PlanCustomerService(chat.actor,cid);
  const name='合成落实场景'+(++cases);pid=String((await owner.execute('create',{leadId,name,managerId:admins[0],rooms:['书房','客厅']},randomUUID())).id);
  for(const [i,role] of ['designer','worker','observer','manager'].entries())await owner.execute('member',{projectId:pid,expectedVersion:Number(((await owner.execute('detail',{projectId:pid})).project as Row).version),adminId:admins[i+1],role,active:true,workLabel:''},randomUUID());
  room=String(((await boss.read(pid)).rooms as Row[]).find(r=>r.name==='书房')!.id);
  await chat.send(cid,randomUUID(),{version:1,blocks:[{type:'text',text:`共享${name}·书房需求：两人办公，右侧需要电脑和台灯插座。`}]},siteWatchInterceptor);
  const source = await record();
  const issueId = String((await command(boss,'跟进记录'+source.id)).issueId);
  await command(designer,'接手事项'+issueId); await command(designer,'回复事项'+issueId+'：已核对本次图纸与需求。');
  const planId = String((await command(designer,planText(issueId),[await upload()])).planId);
  if (approved) { await decide(planId,'preview'); await decide(planId,'approve'); }
  const proof = await record(true,true);
  return {issueId,planId,source,proof};
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const implement = (f: Fixture, staff = designer, key?: string) => command(staff,`落实事项${f.issueId}方案${f.planId}记录${f.proof.id}：右侧插座已安装，现场尺寸已复核。`,[],key);
async function complete(f: Fixture, originals = true) { await implement(f);await command(boss,finish(f.issueId,false,originals));await command(boss,finish(f.issueId,true,originals));await deliverSiteResults(); }
const media = (f: Fixture, conversationId = cid, actor = chat.actor) => withTenantTransaction(actor.enterpriseId,async tx=>{
  const c=(await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${conversationId}`))!;
  return customerSiteMedia(tx,actor,c,f.proof.id,f.proof.mediaId,f.proof.version);
});

before(async()=>{
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(target.port,'55432');assert.equal(target.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let n=0;n<2;n++){eids.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eids[n]},true,200,12000000,1000000000,30)`);}
    for(const [i,role] of ['enterprise_admin','designer','construction_staff','construction_staff','construction_staff'].entries())admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${eids[0]},${prefix+i},'synthetic-only',${role},'active',false,${'合成成员'+i}) returning id`))!.id));
    for(let n=0;n<2;n++){users.push(String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+n},1) returning id`))!.id));await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[n]},${prefix+n})`);}
    for(const role of ['admin','super_admin'])platform.push(String((await one(tx,sql`insert into app.admin_users(username,password_hash,role,status,must_change_password) values(${prefix+role},'synthetic-only',${role},'active',false) returning id`))!.id));
  });
  owner=new ConstructionService({enterpriseId:eids[0],adminId:admins[0]});boss=new SiteChatService(owner.actor);designer=new SiteChatService({enterpriseId:eids[0],adminId:admins[1]});worker=new SiteChatService({enterpriseId:eids[0],adminId:admins[2]});observer=new SiteChatService({enterpriseId:eids[0],adminId:admins[3]});
  const lead=leadId=String((await withTenantTransaction(eids[0],tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[0]},${users[0]},'合成落实业主','13800000000','natural') returning id`)))!.id);
  pid=String((await owner.execute('create',{leadId:lead,name:'合成落实工地',managerId:admins[0],rooms:['书房','客厅']},randomUUID())).id);
  otherPid=String((await owner.execute('create',{leadId:lead,name:'合成隔离工地',managerId:admins[0],rooms:['书房']},randomUUID())).id);
  for(const [i,role] of ['designer','worker','observer','manager'].entries())await owner.execute('member',{projectId:pid,expectedVersion:Number(((await owner.execute('detail',{projectId:pid})).project as Row).version),adminId:admins[i+1],role,active:true,workLabel:''},randomUUID());
  room=String(((await boss.read(pid)).rooms as Row[]).find(r=>r.name==='书房')!.id);
  chat=new ConversationService({enterpriseId:eids[0],principal:{kind:'user',userId:users[0]},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:lead}});
  cid=String((await chat.create(randomUUID())).id);customer=new PlanCustomerService(chat.actor,cid);
  await chat.send(cid,randomUUID(),{version:1,blocks:[{type:'text',text:'共享合成落实工地·书房需求：两人办公，右侧需要电脑和台灯插座。'}]},siteWatchInterceptor);
});
after(async()=>{try{await withPlatformTransaction(async tx=>{
  for(const eid of eids){await deleteConstructionData(tx,BigInt(eid));await deleteAssistantData(tx,BigInt(eid));await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);await tx.execute(sql`delete from app.enterprises where id=${eid}`);}
  for(const uid of users){await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`);await tx.execute(sql`delete from app.users where id=${uid}`);}
  for(const aid of platform)await tx.execute(sql`delete from app.admin_users where id=${aid}`);
});}finally{await closePostgresPool();}});

test('PPT38 formal commands require exact objects and explicit original disclosure, never a conversational acknowledgement',()=>{
  for(const text of ['可以，已经解决了','能否关闭事项12？','“关闭事项12”','书房已经施工好了'])assert.equal(resolutionCommand(text),null);
  assert.throws(()=>resolutionCommand('解决事项12：好了'),/invalid_site_resolution/);
  assert.throws(()=>resolutionCommand('落实事项12方案13记录14：'),/invalid_site_resolution/);
  const cmd=resolutionCommand(finish('12'));assert.equal(cmd?.action,'resolve');if(cmd?.action==='resolve')assert.equal(cmd.originals,true);
});
test('customer approval alone, a draft, missing photos, pending original and wrong room cannot supply execution evidence',async()=>{
  const f=await setup(false);await assert.rejects(implement(f),/approved_plan_required/);
  await decide(f.planId,'preview');await decide(f.planId,'approve');
  await assert.rejects(command(boss,finish(f.issueId,true)),/site_resolution_state_conflict/);
  await assert.rejects(implement(f,worker),/construction_forbidden/);
  const draft=await record(true,false);await assert.rejects(implement({...f,proof:draft}),/site_execution_evidence_required/);
  const noPhotos=await record(true,true,false);await assert.rejects(implement({...f,proof:noPhotos}),/site_execution_evidence_required/);
  await assert.rejects(implement({...f,proof:f.source}),/site_execution_evidence_required/);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_site_records set room_id=(select id from app.construction_rooms where enterprise_id=${eids[0]} and project_id=${pid} and name='客厅'),room_name_snapshot='客厅' where enterprise_id=${eids[0]} and id=${f.proof.id}`));
  await assert.rejects(implement(f),/site_execution_evidence_required/);assert.equal(await resolution(f.issueId),null);
});
test('real reviewed original -> implementation -> separately authorized resolve/close -> exact original-consultation media',async()=>{
  const f=await setup();await assert.rejects(media(f),/assistant_resource_not_found/);
  await implement(f);assert.equal((await issue(f.issueId))!.status,'implemented');assert.equal((await customer.read(f.planId)).status,'approved');
  await assert.rejects(command(designer,finish(f.issueId)),/construction_forbidden/);
  await assert.rejects(command(boss,finish(f.issueId,true)),/site_resolution_state_conflict/);
  await command(boss,finish(f.issueId));assert.equal((await issue(f.issueId))!.status,'resolved');await deliverSiteResults();
  const resolved=await query();assert.match(resolved.displayText,/已正式解决，尚未关闭/);assert.doesNotMatch(resolved.displayText,/内部核对细节/);
  await command(boss,finish(f.issueId,true));await deliverSiteResults();
  assert.equal((await issue(f.issueId))!.status,'closed');const state=await resolution(f.issueId);assert.equal(state!.evidence!.recordId,f.proof.id);
  const rows=(await chat.messages(cid,undefined,100)).items;const returned=rows.find(m=>m.available&&(m.siteRecords||[]).some(r=>r.id===f.proof.id));assert.ok(returned);assert.deepEqual(returned.siteRecords![0].assets,[f.proof.mediaId]);
  const bytes=await media(f);assert.equal(createHash('sha256').update(bytes.data).digest('hex'),createHash('sha256').update((await worker.media(pid,f.proof.mediaId)).data).digest('hex'));
  const other=String((await chat.create(randomUUID())).id);await assert.rejects(media(f,other),/assistant_resource_not_found/);
  await assert.rejects(media(f,cid,{...chat.actor,principal:{kind:'user',userId:users[1]}}),/assistant_resource_not_found/);
  await assert.rejects(new SiteChatService({enterpriseId:eids[1],adminId:admins[0]}).read(pid));
  await assert.rejects(designer.send(otherPid,{text:`落实事项${f.issueId}方案${f.planId}记录${f.proof.id}：完成`,mediaIds:[],versions:{records:{},issues:{}}},randomUUID()));
  assert.match((await query()).displayText,/不代表工程验收通过、付款或结算/);
});
const query=()=>withTenantTransaction(eids[0],tx=>queryNeedIssues(tx,chat.actor,cid));
test('lost response reuses original key and exact receipt, conflicts roll back and never duplicate lifecycle effects',async()=>{
  const f=await setup();await implement(f);await command(boss,finish(f.issueId));
  const body={text:finish(f.issueId,true),mediaIds:[],versions:await versions()},key=randomUUID();
  const result=await boss.send(pid,body,key);assert.deepEqual(await boss.send(pid,body,key),result);assert.deepEqual((await boss.operation(pid,key)).result,result);
  await assert.rejects(boss.send(pid,{...body,text:finish(f.issueId,true,false)},key),/idempotency_conflict/);
  await assert.rejects(boss.send(pid,body,randomUUID()),/version_conflict/);
  const count=await withTenantTransaction(eids[0],tx=>one(tx,sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${eids[0]} and type='construction.site.issue.lifecycle.v1' and aggregate_id=${f.issueId}`));assert.equal(count!.n,3);
  await assert.rejects(command(designer,'回复事项'+f.issueId+'：收到'),/site_reopen_required/);
  await assert.rejects(command(boss,'取消事项'+f.issueId+'：撤回普通跟进请求'),/site_reopen_required/);
  await assert.rejects(command(boss,'恢复事项'+f.issueId+'：普通恢复不能绕过正式重新处理'),/context_changed|site_reopen_required/);
  await assert.rejects(command(designer,'重新核对事项'+f.issueId+'：再次核对'),/site_reopen_required/);
});
test('human reception and disabled assistant defer durable results; two workers skip obsolete resolve and deliver close only once',async()=>{
  const f=await setup();await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eids[0]} and id=${cid}`));
  await complete(f);assert.ok(!(await chat.messages(cid,undefined,100)).items.some(m=>m.available&&(m.siteRecords||[]).some(r=>r.id===f.proof.id)));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eids[0]} and id=${cid}`));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eids[0]}`));await deliverSiteResults();
  assert.ok(!(await chat.messages(cid,undefined,100)).items.some(m=>m.available&&(m.siteRecords||[]).some(r=>r.id===f.proof.id)));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${eids[0]}`));
  await Promise.all([deliverSiteResults(),deliverSiteResults()]);
  const receipts=await withTenantTransaction(eids[0],tx=>rows(tx,sql`select d.status from app.domain_event_outbox e join app.domain_event_deliveries d on d.enterprise_id=e.enterprise_id and d.event_id=e.id where e.enterprise_id=${eids[0]} and e.type='construction.site.issue.result.v1' and e.aggregate_id=${f.issueId} order by e.id`));assert.deepEqual(receipts.map(r=>r.status),['dead','delivered']);
});
test('text-only disclosure does not grant originals; reopen invalidates old result, media, receipts and source snapshots',async()=>{
  const f=await setup();await complete(f,false);await assert.rejects(media(f),/assistant_resource_not_found/);
  const before=await query();assert.ok(before.data.some(r=>r.issueId===f.issueId&&r.status==='closed'));
  await command(boss,'重新处理事项'+f.issueId+'：需要补充现场复核');assert.equal((await issue(f.issueId))!.status,'awaiting_review');
  assert.equal(await withTenantTransaction(eids[0],tx=>needIssueSnapshotAvailable(tx,eids[0],before)),false);
  await assert.rejects(command(boss,finish(f.issueId,true)),/site_resolution_state_conflict/);
  await complete(f);assert.equal((await issue(f.issueId))!.status,'closed');assert.ok((await media(f)).data.length);
});
test('a replacement plan cannot inherit old execution or approval, and replay cannot revive the old close receipt',async()=>{
  const f=await setup();await implement(f);await command(boss,finish(f.issueId));
  const key=randomUUID(),body={text:finish(f.issueId,true),mediaIds:[],versions:await versions()};await boss.send(pid,body,key);await deliverSiteResults();
  const replacement=String((await command(designer,planText(f.issueId),[await upload()])).planId);
  assert.equal((await issue(f.issueId))!.status,'invalidated');await assert.rejects(media(f),/assistant_resource_not_found/);await assert.rejects(boss.send(pid,body,key),/context_changed/);await assert.rejects(boss.operation(pid,key),/context_changed/);
  await assert.rejects(implement(f),/approved_plan_required/);await assert.rejects(implement({...f,planId:replacement}),/approved_plan_required/);
  await decide(replacement,'preview');await decide(replacement,'approve');await complete({...f,planId:replacement});assert.equal((await issue(f.issueId))!.status,'closed');
});
test('evidence correction/withdrawal, original deletion and live author/reviewer/owner membership revoke closure and media',{timeout:600000},async()=>{
  for(const kind of ['edit','withdraw','media','author','owner','publisher'] as const){
    const f=await setup();await complete(f);const snapshot=await query();assert.ok((await media(f)).data.length);
    if(kind==='edit')await worker.mutate(pid,f.proof.id,'edit',{expectedVersion:f.proof.version,data:{title:'更正',roomId:room,completed:'需要再次复核',pending:'',coordination:'',note:''}},randomUUID());
    else if(kind==='withdraw')await worker.mutate(pid,f.proof.id,'withdraw',{expectedVersion:f.proof.version,reason:'合成撤回'},randomUUID());
    else if(kind==='media')await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_site_media set data=null,deleted_at=now() where enterprise_id=${eids[0]} and id=${f.proof.mediaId}`));
    else await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eids[0]} and project_id=${pid} and admin_id=${kind==='author'?admins[2]:admins[1]}`));
    assert.equal((await resolution(f.issueId))!.available,false,kind);await assert.rejects(media(f),/assistant_resource_not_found/);assert.equal(await withTenantTransaction(eids[0],tx=>needIssueSnapshotAvailable(tx,eids[0],snapshot)),false);
    if(['author','owner','publisher'].includes(kind))await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_members set active=true where enterprise_id=${eids[0]} and project_id=${pid} and admin_id in (${admins[1]},${admins[2]})`));
  }
});
test('owner, admin and super_admin inherit formal resolve and close in the selected enterprise without employee membership',async()=>{
  for(const aid of [admins[0],...platform]){const f=await setup();await implement(f);const staff=new SiteChatService({enterpriseId:eids[0],adminId:aid});await command(staff,finish(f.issueId));await command(staff,finish(f.issueId,true));assert.equal((await issue(f.issueId))!.status,'closed');}
  const f=await setup();await assert.rejects(command(observer,finish(f.issueId)),/construction_forbidden/);
});
test('concurrent replacement and execution, plus close/evidence correction, cannot leave an effective stale closed state',async()=>{
  const f=await setup();const v=await versions();
  const nextImage=await upload();await Promise.allSettled([designer.send(pid,{text:`落实事项${f.issueId}方案${f.planId}记录${f.proof.id}：已复核`,mediaIds:[],versions:v},randomUUID()),designer.send(pid,{text:planText(f.issueId),mediaIds:[nextImage],versions:v},randomUUID())]);
  assert.notEqual((await resolution(f.issueId))?.available,true);
  const g=await setup();await implement(g);await command(boss,finish(g.issueId));await Promise.allSettled([command(boss,finish(g.issueId,true)),worker.mutate(pid,g.proof.id,'withdraw',{expectedVersion:g.proof.version,reason:'并发撤回'},randomUUID())]);
  assert.equal((await resolution(g.issueId))!.available,false);await assert.rejects(media(g),/assistant_resource_not_found/);
});
test('actual member removal and re-addition never resurrect an old approved plan or formal evidence',async()=>{
  const f=await setup();await complete(f);
  for(const active of [false,true])await owner.execute('member',{projectId:pid,expectedVersion:Number(((await owner.execute('detail',{projectId:pid})).project as Row).version),adminId:admins[1],role:'designer',active,workLabel:''},randomUUID());
  assert.equal((await resolution(f.issueId))!.available,false);await assert.rejects(customer.read(f.planId),/plan_unavailable/);await assert.rejects(media(f),/assistant_resource_not_found/);await assert.rejects(implement(f),/approved_plan_required/);
  const replacement=String((await command(designer,planText(f.issueId),[await upload()])).planId);assert.equal((await customer.read(replacement)).status,'pending_customer');
});
test('actual reviewer and manager downgrades cannot revive old approval or closure after role restoration',async()=>{
  const changeRole=async(adminId:string,role:string)=>owner.execute('member',{projectId:pid,expectedVersion:Number(((await owner.execute('detail',{projectId:pid})).project as Row).version),adminId,role,active:true,workLabel:''},randomUUID());
  const f=await setup();await complete(f);
  await changeRole(admins[1],'worker');await changeRole(admins[1],'designer');
  await assert.rejects(customer.read(f.planId),/plan_unavailable/);assert.equal((await resolution(f.issueId))!.available,false);await assert.rejects(media(f),/assistant_resource_not_found/);
  const g=await setup();await implement(g);const manager=new SiteChatService({enterpriseId:eids[0],adminId:admins[4]});
  await command(manager,finish(g.issueId));await command(manager,finish(g.issueId,true));await deliverSiteResults();assert.ok((await media(g)).data.length);
  await changeRole(admins[4],'designer');await changeRole(admins[4],'manager');
  assert.equal((await resolution(g.issueId))!.available,false);await assert.rejects(media(g),/assistant_resource_not_found/);assert.equal((await issue(g.issueId))!.status,'invalidated');
});
test('changed source can be re-reviewed on the same issue without reviving old closure or deadlocking its recovery',async()=>{
  const f=await setup();await complete(f);
  await worker.mutate(pid,f.source.id,'edit',{expectedVersion:f.source.version,data:{title:'原记录更正',roomId:room,completed:'',pending:'补充复核底盒位置',coordination:'',note:''}},randomUUID());
  assert.equal((await issue(f.issueId))!.status,'invalidated');
  await command(boss,'重新核对事项'+f.issueId+'：原记录已更正，重新核对来源');assert.equal((await issue(f.issueId))!.status,'awaiting_owner');
  await command(designer,'回复事项'+f.issueId+'：已重新核对原记录与本次需求');assert.equal((await issue(f.issueId))!.status,'awaiting_review');
  await assert.rejects(customer.read(f.planId),/plan_unavailable/);await assert.rejects(media(f),/assistant_resource_not_found/);
  const next=String((await command(designer,planText(f.issueId),[await upload()])).planId);await decide(next,'preview');await decide(next,'approve');await complete({...f,planId:next});assert.equal((await issue(f.issueId))!.status,'closed');
});
test('actual query_followups checkpoints formal closed evidence into the existing revocable Agent source chain',async()=>{
  const f=await setup();await complete(f);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.assistant_enterprise_settings set agent_config='{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p5-resolution-synthetic-v1"}'::jsonb where enterprise_id=${eids[0]}`));
  const sent=await chat.send(cid,randomUUID(),{version:1,blocks:[{type:'text',text:'书房现场是不是已经落实并关闭了，依据是什么？'}]},siteWatchInterceptor),lease=await claimJob();assert.equal(lease?.runId,sent.runId);
  await processAgentAnswer(lease!,{model:async(messages,_tools,turn)=>{
    if(turn===0)return{text:'',toolCalls:[{id:'check',name:'query_followups',arguments:'{}'}],finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:60,outputTokens:10}};
    const tool=messages.filter(m=>m.role==='tool').at(-1)!;const result=JSON.parse(String(tool.content));
    return{text:'',toolCalls:[{id:'finish',name:'final_response',arguments:JSON.stringify({kind:'business',resultKey:result.resultKey})}],finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:70,outputTokens:10}};
  }});
  const result=await withTenantTransaction(eids[0],tx=>one(tx,sql`select output_message_id,status,error_code from app.assistant_runs where enterprise_id=${eids[0]} and id=${String(sent.runId)}`));assert.equal(result!.status,'succeeded',JSON.stringify(result));
  // Reentry can deliver the original publication after its customer decision. That is the same formal fact,
  // so it must not replace the decision's provenance or invalidate a correctly sourced answer.
  const beforeDelivery=await query();
  const output=(await chat.messages(cid,undefined,100)).items.find(m=>m.id===String(result!.output_message_id))!;
  const afterDelivery=await query();assert.equal(afterDelivery.version,beforeDelivery.version,'Late publication must retain the exact decision source');
  if(!output.available){
    const diagnostic=await withTenantTransaction(eids[0],async tx=>{
      const steps=await rows(tx,sql`select kind,status,source_refs from app.assistant_run_steps where enterprise_id=${eids[0]} and run_id=${String(sent.runId)} order by step_seq`);
      const sources=[];for(const step of steps){
        if(step.kind==='agent_construction_context')for(const ref of step.source_refs as string[])sources.push({kind:step.kind,ref,available:await constructionNoticeAvailable(tx,eids[0],cid,ref,false,true)});
        if(step.kind==='agent_need_issue_context')for(const ref of step.source_refs as Parameters<typeof needIssueSnapshotAvailable>[2][])sources.push({kind:step.kind,available:await needIssueSnapshotAvailable(tx,eids[0],ref)});
      }
      return{run:result,steps,sources,current:await queryNeedIssues(tx,chat.actor,cid)};
    });
    assert.fail('Closed answer unexpectedly unavailable: '+JSON.stringify(diagnostic));
  }
  assert.match(JSON.stringify(output.content),/已正式关闭/);
  await command(boss,'重新处理事项'+f.issueId+'：补充复核');const revoked=(await chat.messages(cid,undefined,100)).items.find(m=>m.id===output.id)!;assert.equal(revoked.available,false);
});
