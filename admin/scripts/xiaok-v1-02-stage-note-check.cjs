/* eslint-disable @typescript-eslint/no-require-imports -- Adapter for the existing real-service acceptance runner. */
const path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
module.exports=async ctx=>{
 const {root,actor,pid,bid,owner,read,step,report,save}=ctx,req=createRequire(path.join(root,'admin/package.json'));
 const {sql}=req('drizzle-orm'),{one}=req('./src/db/repositories/assistant-repository.ts');
 const {ConstructionReportService,reportPlanDto}=req('./src/lib/construction/report-service.ts'),{FollowupService}=req('./src/lib/construction/followup-service.ts');
 const {advanceConstructionReports,processConstructionReport,deliverConstructionReports}=req('./src/lib/construction/report-worker.ts'),{claimJob}=req('./src/lib/assistant/infrastructure/job-queue.ts');
 const {readStageSettings}=req('./src/lib/construction/stages-store.ts'),plan=new ConstructionReportService(owner.actor),service=new FollowupService(actor);
 const progress=async(key,note)=>{const p=(await owner.execute('detail',{projectId:pid})).project;await owner.execute('progress',{projectId:pid,expectedVersion:p.version,stageKey:key,note,sendReminder:false},randomUUID());};
 const event=()=>read(tx=>one(tx,sql`select e.id,e.aggregate_version,e.payload,p.progress_revision,p.current_stage_key from app.domain_event_outbox e join app.construction_projects p
  on p.enterprise_id=e.enterprise_id and p.id::text=e.aggregate_id where e.enterprise_id=1454 and e.type='construction.stage.updated.v1' and e.aggregate_id=${pid} order by e.aggregate_version desc limit 1`));
 const tick=async()=>{const t=await read(tx=>one(tx,sql`select clock_timestamp()+interval '2 milliseconds' now`));const r=await advanceConstructionReports(new Date(t.now),'1454');assert.deepEqual(r.errors,[]);return r.queued;};
 const latest=()=>read(tx=>one(tx,sql`select r.id,r.stage_event_id,v.run_id from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
  where r.enterprise_id=1454 and r.binding_id=${bid} and r.kind='stage' order by r.id desc limit 1`));
 const execute=async r=>{let job=await claimJob();for(let i=0;!job&&i<50;i++){await new Promise(r=>setTimeout(r,100));job=await claimJob();}assert.equal(job?.runId,r.run_id);await processConstructionReport(job);await deliverConstructionReports('1454');return service.detail(bid,String(r.id),1);};
 report.scope='V1-02 real same-stage note edits must preserve latest-event reminders before scheduling and before Worker; real stage corrections must still supersede old events; zero actual provider/ingestion';save();
 const stages=await read(tx=>readStageSettings(tx,'1454')),other=stages.stages.find(s=>s.key!=='utilities');assert.ok(other);
 await progress(other.key,'合成测试：准备阶段对照');const settings=reportPlanDto(await plan.settings(),'1454');
 await plan.configure({expectedVersion:settings.version,enabled:true,stageEnabled:true,projectIds:[pid],stageKeys:[],audiences:['customer'],dailyTime:settings.dailyTime,weeklyTime:settings.weeklyTime,weeklyDay:settings.weeklyDay,inactivePolicy:settings.inactivePolicy},randomUUID());
 await step('same-stage note edited before scheduler still produces exactly one stage reminder',async()=>{
  await progress('utilities','合成测试：进入水电');const before=await event();await progress('utilities','合成测试：仅补水电备注，阶段未变');const after=await event();
  assert.equal(String(after.id),String(before.id));assert.ok(Number(after.progress_revision)>Number(after.aggregate_version));
  const queued=await tick();report.beforeScheduler={eventId:String(after.id),eventRevision:Number(after.aggregate_version),projectRevision:Number(after.progress_revision),stageKey:after.current_stage_key,expectedQueued:1,actualQueued:queued};save();
  assert.equal(queued,1);assert.equal(await tick(),0);const r=await latest(),d=await execute(r);assert.equal(d.state,'facts_ready');assert.equal(d.deliveryState,'delivered');
  assert.equal(d.facts.projects[0].stageKey,'utilities');assert.equal(d.facts.projects[0].progressRevision,Number(before.aggregate_version));report.noteReportA=String(r.id);save();return {...report.beforeScheduler,reportId:String(r.id),delivered:true};
 });
 await step('same-stage note edited after scheduling retains Worker facts and private delivery',async()=>{
  await progress(other.key,'合成测试：真实阶段对照');await progress('utilities','合成测试：再次进入水电');const source=await event();assert.equal(await tick(),1);const r=await latest();
  await progress('utilities','合成测试：Worker前仅补充备注');const edited=await event();assert.equal(String(edited.id),String(source.id));assert.ok(Number(edited.progress_revision)>Number(source.aggregate_version));
  const d=await execute(r);assert.equal(d.state,'facts_ready');assert.equal(d.deliveryState,'delivered');assert.equal(d.facts.projects[0].progressRevision,Number(source.aggregate_version));report.noteReportB=String(r.id);save();return {reportId:String(r.id),eventId:String(source.id),frozenStage:d.facts.projects[0].stageKey,eventRevision:Number(source.aggregate_version),projectRevision:Number(edited.progress_revision)};
 });
 await step('a real correction after enqueue still rejects the superseded event, then recovers with the new current event',async()=>{
  await progress(other.key,'合成测试：真实切换');await progress('utilities','合成测试：待纠正的水电事件');assert.equal(await tick(),1);const stale=await latest();
  await progress(other.key,'合成测试：明确阶段更正');const failed=await execute(stale);assert.notEqual(failed.state,'facts_ready');assert.equal(failed.facts,null);
  assert.equal(await tick(),1);const current=await latest(),d=await execute(current);assert.equal(d.state,'facts_ready');assert.equal(d.deliveryState,'delivered');assert.equal(d.facts.projects[0].stageKey,other.key);assert.equal(await tick(),0);
  report.latestStageReport=String(current.id);report.latestStageKey=other.key;save();return {supersededReport:String(stale.id),supersededState:failed.state,currentReport:String(current.id),currentStage:other.key,staleNotDelivered:true};
 });
 await step('a real stage change away and back to the same key still supersedes the queued event',async()=>{
  await progress('utilities','合成测试：旧水电事件');assert.equal(await tick(),1);const stale=await latest();
  await progress(other.key,'合成测试：实际离开水电');await progress('utilities','合成测试：新水电事件，不能复活旧提醒');const now=await event();
  assert.ok(Number(now.aggregate_version)>0);const rejected=await execute(stale);assert.notEqual(rejected.state,'facts_ready');assert.equal(rejected.facts,null);
  assert.equal(await tick(),1);const current=await latest();assert.notEqual(String(current.stage_event_id),String(stale.stage_event_id));const d=await execute(current);
  assert.equal(d.state,'facts_ready');assert.equal(d.deliveryState,'delivered');assert.equal(d.facts.projects[0].stageKey,'utilities');assert.equal(await tick(),0);
  return {oldReport:String(stale.id),newReport:String(current.id),oldEvent:String(stale.stage_event_id),newEvent:String(current.stage_event_id),oldState:rejected.state,currentStage:'utilities',onlyLatestDelivered:true};
 });
 return {sameStageNotes:true,trueCorrectionGuard:true,modelCalls:0,embeddingCalls:0,ingestionCalls:0};
};
