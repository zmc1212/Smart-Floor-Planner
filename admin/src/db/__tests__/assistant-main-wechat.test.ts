import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '../transaction';
import { one, rows, type Row } from '../repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getDefaultMenuKeys } from '@/lib/admin-user-roles';
import { ConstructionService } from '@/lib/construction/service';
import { ensureFollowupBinding, enqueueReport } from '@/lib/construction/report-store';
import { deliverConstructionReports, processConstructionReport } from '@/lib/construction/report-worker';
import { FollowupService } from '@/lib/construction/followup-service';
import { handleFollowup } from '@/lib/construction/followup-http';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { appendMessage, cancelRuns } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { claimJob, completeRun } from '@/lib/assistant/infrastructure/job-queue';
import { startChannel, pollChannel, recipientState, readChannel } from '@/lib/assistant/wechat/channels';
import { tickWechatChannel } from '@/lib/assistant/wechat/worker';
import { weixinOrigin, type weixinClient, type WeixinInbound, type WeixinAccount, type WeixinDeliveryClient } from '@/lib/assistant/wechat/ilink';
import { mainDialogueTools, reportToolName, stageToolName } from '@/lib/xiaok-v1/main-dialogue-tools';
import { manageMainPublication } from '@/lib/xiaok-v1/main-publication';
import { stageIds } from '@/lib/xiaok-v1/stages';
import { xiaokTestDatabase } from './xiaok-test-database';

// Run after assistant-wechat-channel.test.ts on the dedicated, migrated loopback fixture.
test('主小K发布、双端互认、工地报告查询、订退、撤权与确定投递', { skip: !process.env.XIAOK_MAIN_WECHAT_FIXTURE }, async t => {
  xiaokTestDatabase();
  t.after(closePostgresPool);
  const eid = '1454', label = '合成微信主应用-' + randomUUID().slice(0,8);
  const managers = await withPlatformTransaction(tx => rows(tx,sql`select a.id,a.username,e.code from app.admin_users a
    join app.enterprises e on e.id=a.enterprise_id where a.username in ('fixture-owner','fixture-other') order by a.enterprise_id`));
  assert.equal(managers[0].code,'wechat-fixture-1454');
  assert.equal(managers[1].code,'wechat-fixture-1455');
  const adminId = String(managers[0].id);
  const publish = async (enabled: boolean) => {
    const previous = await manageMainPublication(eid,adminId);
    return manageMainPublication(eid,adminId,{expectedVersion:previous.version,enabled,reports:true,stages:[...stageIds]});
  };
  await publish(false);
  const publication = await publish(true);
  assert.equal(publication.stages.length,10);
  assert.deepEqual(await manageMainPublication(eid,adminId),publication);
  await assert.rejects(manageMainPublication(eid,String(managers[1].id)),/forbidden/);
  await assert.rejects(manageMainPublication(eid,adminId,{expectedVersion:0,enabled:true,reports:true,stages:[]}),/version_conflict/);

  const fixture = await withPlatformTransaction(async tx => {
    const users = await rows(tx,sql`insert into app.users(enterprise_id,nickname,role)
      values(1454,${label+'业主'},'user'),(1454,${label+'对照业主'},'user'),(1454,${label+'经理'},'user') returning id`);
    const staff = async (role: string, name: string) => {
      const menus = JSON.stringify(getDefaultMenuKeys(role));
      return String((await one(tx,sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,menu_permissions)
        values(1454,${name==='经理' ? String(users[2].id) : null},${label+name},'local-test-only',${role},'active',false,
        ARRAY(select jsonb_array_elements_text(${menus}::jsonb))) returning id`))!.id);
    };
    return { user:String(users[0].id), control:String(users[1].id), manager:await staff('construction_staff','经理'), boss:await staff('enterprise_admin','老板') };
  });
  const manage = new ConstructionService({enterpriseId:eid,adminId:fixture.boss});
  const lead = await withTenantTransaction(eid,async tx => String((await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(1454,${fixture.user},${label},'15900001111','natural') returning id`))!.id));
  const p = await manage.execute('create',{leadId:lead,name:label+'云栖花园',managerId:fixture.manager,rooms:['厨房']},randomUUID());
  const projectId = String(p.id);
  const project = (await manage.execute('detail',{projectId})).project as Row;
  await manage.execute('progress',{projectId,expectedVersion:project.version,stageKey:'utilities',note:'合成水电施工',sendReminder:false},randomUUID());
  const actor: ActorContext = { enterpriseId:eid,principal:{kind:'user',userId:fixture.user},contextVersion:1,capabilities:['assistant.followup.self'] };
  const binding = await withTenantTransaction(eid,tx=>ensureFollowupBinding(tx,eid,{kind:'user',id:fixture.user,audience:'customer',projectId}));
  const bindingId = String(binding.id), recipient = {actor,bindingId,projectId};
  const signed = new SiteChatService({enterpriseId:eid,adminId:fixture.manager});
  const fact = '厨房线管已铺设，插座点位待复核。';
  const source = await signed.withWriteScope(projectId,async (tx,c)=>{
    const message = await appendMessage(tx,signed.actor,String(c.id),{author:'admin',clientMessageId:randomUUID(),
      purpose:'site.source',content:{version:1,blocks:[{type:'text',text:fact}]}});
    const room = (await one(tx,sql`select id from app.construction_rooms where enterprise_id=1454 and project_id=${projectId} limit 1`))!;
    const record = (await one(tx,sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,
      status,data,room_id,room_name_snapshot) values(1454,${projectId},${String(c.id)},${String(message.id)},${fixture.manager},
      'draft',${JSON.stringify({title:'厨房线管',completed:fact,pending:'',coordination:'',note:'',roomId:String(room.id)})}::jsonb,${String(room.id)},'厨房') returning *`))!;
    await recordVersion(tx,eid,record,fixture.manager,'organized'); return record;
  });
  await signed.mutate(projectId,String(source.id),'publish',{expectedVersion:source.version,audience:'customer'},randomUUID());
  const route = 'http://localhost/followups/'+bindingId+'/wechat?projectId='+projectId;
  const state = () => recipientState(recipient);
  const request = (body?: Record<string,unknown>) => handleFollowup(new Request(route,body ? {method:'POST',body:JSON.stringify(body)}:{}),[bindingId,'wechat'],actor);
  const input: WeixinInbound[] = [], sent: {context:string; text:string}[] = [];
  const images: { context: string; png: Buffer }[] = [];
  let stagedImage: Buffer | undefined;
  let ambiguous = false;
  const client: WeixinDeliveryClient & Pick<typeof weixinClient, 'login' | 'status'> = {
    async login(){return {code:randomUUID(),display:'https://example.test/fixture'};},
    async status(){return {state:'confirmed' as const,origin:weixinOrigin,bot:'test-main-bot',peer:'test-main-peer',token:'test-main-session'};},
    async updates(){return {cursor:randomUUID(),messages:input.splice(0)};},
    async reply(a:WeixinAccount,context:string,_id:string,text:string){assert.equal(a.peer,'test-main-peer');sent.push({context,text});},
    async uploadImage(a, image) {
      assert.equal(a.peer,'test-main-peer');
      stagedImage = image;
      return { type: 2, image_item: { media: { encrypt_query_param: 'fixture-image', aes_key: 'fixture', encrypt_type: 1 }, mid_size: image.length } };
    },
    async replyImage(a, context, _id, item) {
      assert.equal(a.peer,'test-main-peer');
      assert.ok(context);
      assert.equal(item.image_item.mid_size, stagedImage?.length);
      assert.ok(stagedImage);
      images.push({ context, png: stagedImage });
      if (ambiguous) throw Error('synthetic provider timeout');
    },
  };
  const scope = {enterpriseId:eid,adminId,stage:'main' as const};
  const publicChannel = await startChannel(scope,client); assert.ok(publicChannel);
  const channelId = publicChannel.id;
  await pollChannel(scope,channelId,undefined,client);
  async function tick() {
    await withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_wechat_channels set poll_after=now() where id=${channelId} and lease_id is null`));
    return tickWechatChannel(eid,client);
  }
  async function ask(text:string){const key=randomUUID();input.push({key,text,context:'ctx-'+key});assert.equal(await tick(),'queued');
    const event=await withTenantTransaction(eid,tx=>one(tx,sql`select run_id from app.assistant_wechat_events where channel_id=${channelId} and event_key=${key}`));
    const run=await claimJob({enterpriseId:eid,runId:String(event?.run_id)});assert.ok(run);return run;}
  const before = await ask('我家这周做到哪儿了？');
  const instruction = await withTenantTransaction(eid,async tx=>{
    const tools=await mainDialogueTools(tx,before,'我家这周做到哪儿了？');assert.ok(tools);
    assert.ok(tools.definitions.some(d=>d.name===stageToolName));return tools.invoke(tx,reportToolName,'{"period":"weekly"}',3190);
  });
  assert.match(instruction,/关联本人微信/);
  const localUsage={inputTokens:0,outputTokens:0};
  await completeRun(before,{content:{version:1,blocks:[{type:'text',text:instruction}]},usage:localUsage});await tick();
  assert.ok(!sent.at(-1)?.text.includes(fact));
  const personal = await startChannel({enterpriseId:eid,stage:'main',recipient},client); assert.ok(personal);
  const pending=(await state()).channel;assert.ok(pending?.command);
  await assert.rejects(request({action:'preferences',id:pending.id,version:pending.version,daily:true,weekly:true}),/context_changed/);
  await assert.rejects(recipientState({...recipient,actor:{...actor,principal:{kind:'user',userId:fixture.control}}}),/not_found/);
  await assert.rejects(recipientState({...recipient,projectId:'9999999'}),/not_found/);
  input.push({key:randomUUID(),text:pending.command,context:'verified-peer'});
  await tick(); const linked=(await state()).channel;assert.ok(linked?.verified);assert.equal(linked.id,channelId);
  assert.equal(linked.daily,false);assert.equal(linked.weekly,false);assert.equal(linked.command,null);
  assert.ok(!(await readChannel(scope))?.qr);
  await request({action:'preferences',id:linked.id,version:linked.version,daily:true,weekly:true});
  await assert.rejects(request({action:'preferences',id:linked.id,version:linked.version,daily:false,weekly:false}),/version_conflict/);

  const cutoff=new Date(Date.now()+1000);
  const reports=await withTenantTransaction(eid,async tx=>{
    const settings=(await one(tx,sql`insert into app.construction_report_settings(enterprise_id,enabled,next_daily_at,next_weekly_at,audiences,project_ids)
      values(1454,true,now()+interval '1 day',now()+interval '7 days','["customer","worker","designer","boss"]'::jsonb,${JSON.stringify([projectId])}::jsonb)
      on conflict(enterprise_id) do update set enabled=true,project_ids=excluded.project_ids returning *`))!;
    const result=[];
    for(const kind of ['daily','weekly'] as const){
      const start=new Date(cutoff.getTime()-(kind==='daily'?1:7)*86400000);
      const r=await enqueueReport(tx,eid,binding,settings,{kind,start,end:cutoff,cutoff,scheduledAt:cutoff});assert.ok(r);result.push(r);
    }
    return result;
  });
  for(const r of reports){const lease=await claimJob({enterpriseId:eid,runId:r.runId});assert.ok(lease);await processConstructionReport(lease);}
  await deliverConstructionReports(eid);
  for(const r of reports){const actual=await new FollowupService(actor).detail(bindingId,r.reportId,r.revision);
    assert.ok(actual.available && actual.facts?.projects[0].records.some(record=>record.data.completed===fact));}
  const baseline=sent.length;
  await tick();await tick();await tick();
  assert.equal(sent.length,baseline+1);
  assert.ok(sent.at(-1)?.text.includes('日报') && sent.at(-1)?.text.includes(fact) && sent.at(-1)?.context==='verified-peer');
  assert.equal(images.length,1);
  assert.equal(images[0].context,'verified-peer');
  assert.equal(images[0].png.readUInt32BE(16),780);
  const weekly = reports[1];
  const poster = await new FollowupService(actor).reportImage(bindingId, weekly.reportId, weekly.revision, projectId);
  assert.ok(images[0].png.equals(poster), 'legacy delivery uses the same authorized weekly poster as the Mini Program');
  const question='我家这个星期进展怎么样？', lookup=await ask(question);
  await withTenantTransaction(eid,async tx=>{const tools=await mainDialogueTools(tx,lookup,question);assert.ok(tools);
    const result=await tools.invoke(tx,reportToolName,'{"period":"weekly"}',3190);assert.ok(!result.includes(fact));});
  await completeRun(lookup,{content:{version:1,blocks:[{type:'text',text:'已找到本周工地报告。'}]},usage:localUsage}); await tick();
  assert.ok(sent.at(-1)?.text.includes('周报')&&sent.at(-1)?.text.includes(fact));
  assert.equal(images.length,1);

  const prior=(await state()).channel!;await request({action:'preferences',id:prior.id,version:prior.version,daily:false,weekly:true});
  assert.equal((await state()).channel?.daily,false);
  const replay = async (kind:'daily'|'weekly') => withTenantTransaction(eid,tx=>tx.execute(sql`insert into app.assistant_wechat_events
    (enterprise_id,channel_id,event_key,report_kind,report_id,report_revision,recipient_version,proactive)
    select enterprise_id,channel_id,${'fixture-'+randomUUID()},report_kind,report_id,report_revision,recipient_version,true
    from app.assistant_wechat_events where channel_id=${channelId} and proactive and report_kind=${kind} order by id limit 1`));
  await replay('daily');const afterUnsubscribe=sent.length;await tick();assert.equal(sent.length,afterUnsubscribe);
  await replay('weekly');ambiguous=true;await tick();ambiguous=false;await tick();
  assert.equal(sent.length,afterUnsubscribe);
  assert.equal(images.length,2);
  assert.match(images[1].context,/^ctx-/);
  const hasUnknown=await withTenantTransaction(eid,tx=>one(tx,sql`select 1 from app.assistant_wechat_events where channel_id=${channelId} and proactive and status='unknown'`));
  assert.ok(hasUnknown);
  async function customerAccess(enabled:boolean) {const current=(await manage.execute('detail',{projectId})).project as Row;
    await manage.execute('update',{projectId,expectedVersion:current.version,name:current.name,status:current.status,customerAccess:enabled},randomUUID());}
  await replay('weekly');await customerAccess(false);const afterRevoke=sent.length;await tick();
  assert.equal(sent.length,afterRevoke);
  assert.equal(images.length,2);
  await assert.rejects(state(),/(forbidden|not_found)/);await customerAccess(true);
  await publish(false);assert.equal((await state()).channel,null);assert.equal(await tick(),false);
  const finalPublication=await publish(true);
  await withTenantTransaction(eid,async tx=>{
    for (const report of reports) {
      const task=await one(tx,sql`select a.id,a.conversation_id from app.construction_report_versions v
        join app.assistant_runs a on a.enterprise_id=v.enterprise_id and a.id=v.body_run_id
        where v.enterprise_id=${eid} and v.report_id=${report.reportId} and v.revision=${report.revision}
        and a.status='queued' and a.purpose='construction.report.compose'`);
      if(task) await cancelRuns(tx,actor,String(task.conversation_id),String(task.id));
    }
  });
  // Leave a labelled general release for the separate model/native journeys. No credentials in the receipt.
  if(process.env.XIAOK_WECHAT_QA_OUTPUT)writeFileSync(join(process.env.XIAOK_WECHAT_QA_OUTPUT,'fixture.json'),
    JSON.stringify({enterpriseId:eid,label,adminId,actor,bindingId,projectId,leadId:lead,source:String(source.id),reports,publication:finalPublication.version},null,2));
});
