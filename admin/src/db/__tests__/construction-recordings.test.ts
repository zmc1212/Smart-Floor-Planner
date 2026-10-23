import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {withPlatformTransaction,withTenantTransaction} from '@/db/transaction';
import {one,rows} from '@/db/repositories/assistant-repository';
import {deleteConstructionData} from '@/db/repositories/construction-cleanup';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '@/lib/postgresql';
import {CameraService,exchangeCameraEntry,startCameraView,authorizeCameraMedia,sessionHeartbeat} from '@/lib/construction/camera/service';
import {saveRecordingPolicy,reconcileRecordings,listCameraRecordings,startRecordingView,authorizeRecordingMedia,purgeCameraRecordings} from '@/lib/construction/camera/recordings';
import {shanghaiDay,recordingFilePath} from '@/lib/construction/camera/recording-contract';
import {WvpClient} from '@/lib/construction/camera/wvp';
import type {ConstructionActor} from '@/lib/construction/contracts';

class Recorder extends WvpClient {
  linked:number|null=null;foreign=false;deletionFails=false;deleted:number[]=[];
  files=new Set<string>();records:Record<string,unknown>[]=[];
  constructor(){super({origin:'http://wvp.test',mediaOrigin:'http://media.test',username:'fixture',password:'fixture',mediaSecret:'fixture'});}
  async channels(){return [{deviceId:'90020000001320000003',channelId:'90020000001320000004',name:'Synthetic recorder',online:true,ptzType:0}];}
  async recordingChannel(){return {id:1,planId:this.foreign?99:this.linked};}
  async recordingPlan(){return 500;}
  async linkRecording(_channel:number,planId:number|null){this.linked=planId;}
  async isRecording(){return this.linked!==null;}
  async play(){return {app:'rtp',stream:'fixture'};}
  async cloudRecordings(){return {items:this.records,total:this.records.length};}
  async cloudPath(id:number){return this.records.find(r=>r.id===id)?.filePath as string|undefined??null;}
  async recordingFileStatus(file:string){return this.files.has(file)?200:404;}
  async deleteCloudRecording(id:number){if(this.deletionFails)throw Error('Synthetic provider deletion unavailable');this.files.delete((await this.cloudPath(id))!);this.records=this.records.filter(r=>r.id!==id);this.deleted.push(id);}
  add(id:number,start:number){const file='/opt/media/www/record/rtp/fixture/'+id+'.mp4';this.records.push({id,app:'rtp',stream:'fixture',mediaServerId:'wvp-zlm-01',filePath:file,startTime:start,endTime:start+20,fileSize:4096});this.files.add(file);}
}
const source=new Recorder(),prefix='recording-test-'+randomUUID(),eids:string[]=[],uids:string[]=[],aids:string[][]=[],projects:string[][]=[];
let owner:ConstructionActor,manager:ConstructionActor,platform:ConstructionActor,superAdmin:ConstructionActor,bindingId='',cameraId='',recordId='',expiredId='';
let viewer:Awaited<ReturnType<typeof exchangeCameraEntry>>;
const fixtureCamera=()=>new CameraService(owner,source);
async function current(){return (await fixtureCamera().list(projects[0][0])).items[0];}
async function enter(actor=manager,pid=projects[0][0]){const entry=await new CameraService(actor,source).entry(pid);return exchangeCameraEntry(entry.url.split('#entry=')[1]);}
before(async()=>{
  const database=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(database.port,'55432');assert.equal(database.pathname,'/cloud_camera_unit_eval');
  await withPlatformTransaction(async tx=>{
    for(let n=0;n<2;n++){
      eids.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));aids.push([]);projects.push([]);
      for(let i=0;i<(n===0?2:1);i++){
        const uid=String((await one(tx,sql`insert into app.users(nickname) values(${prefix+n+i}) returning id`))!.id);uids.push(uid);
        const lead=String((await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[n]},${uid},'合成录像验收客户','13800000000','natural') returning id`))!.id);
        projects[n].push(String((await one(tx,sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eids[n]},${lead},'合成录像验收工地') returning id`))!.id));
      }
      for(const role of ['enterprise_admin','construction_staff','admin','super_admin'])aids[n].push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eids[n]},${prefix+n+role},'synthetic-only',${role},'active',false) returning id`))!.id));
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eids[n]},${projects[n][0]},${aids[n][1]},'manager')`);
    }
    await tx.execute(sql`update app.admin_users set enterprise_id=null where id in (${aids[0][2]},${aids[0][3]})`);
  });
  owner={enterpriseId:eids[0],adminId:aids[0][0]};manager={enterpriseId:eids[0],adminId:aids[0][1]};platform={enterpriseId:eids[0],adminId:aids[0][2]};superAdmin={enterpriseId:eids[0],adminId:aids[0][3]};
  const c=await new CameraService(platform,source).register({deviceId:'90020000001320000003',channelId:'90020000001320000004',name:'合成录像设备'});cameraId=String(c.id);
  bindingId=String((await fixtureCamera().bind(projects[0][0],{cameraId,expectedVersion:1,bind:true})).bindingId);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_camera_bindings set started_at=now()-interval '7 days' where id=${bindingId}`));
});
after(async()=>{try{await withPlatformTransaction(async tx=>{
  for(const eid of eids){for(const table of ['construction_camera_sessions','construction_recordings','construction_camera_recording_policies','construction_camera_controls','construction_camera_snapshots','construction_camera_entries','construction_camera_bindings','construction_cameras','construction_audits','construction_members','construction_projects','leads'])await tx.execute(sql`delete from ${sql.raw('app.'+table)} where enterprise_id=${eid}`);}
  for(const list of aids)for(const aid of list)await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  for(const eid of eids)await tx.execute(sql`delete from app.enterprises where id=${eid}`);
  for(const uid of uids)await tx.execute(sql`delete from app.users where id=${uid}`);
});}finally{await closePostgresPool();}});

test('date and recording paths reject normalization, traversal and impossible dates',()=>{
  assert.equal(shanghaiDay('2026-10-23').from.toISOString(),'2026-10-22T16:00:00.000Z');
  for(const day of ['2026-02-30','2026-1-01','../2026-01-01'])assert.throws(()=>shanghaiDay(day),/invalid_date/);
  for(const file of ['/etc/passwd','/opt/media/www/record/../secret.mp4','/opt/media/www/recording/foreign.mp4','/opt/media/www/record/a\\b.mp4'])assert.throws(()=>recordingFilePath(file),/invalid_recording/);
});
test('only owner management roles save policies; admin and super_admin need no employment; receipts are idempotent',async()=>{
  await assert.rejects(saveRecordingPolicy(manager,projects[0][0],{bindingId,enabled:true,retentionDays:3,expectedVersion:0}),/forbidden/);
  let expectedVersion=0;
  for(const [i,actor] of [owner,platform,superAdmin].entries()){
    const input={bindingId,enabled:true,retentionDays:3+i,expectedVersion};const receipt=await saveRecordingPolicy(actor,projects[0][0],input);expectedVersion=Number(receipt!.version);
    assert.equal(Number((await saveRecordingPolicy(actor,projects[0][0],input))!.version),expectedVersion);
  }
  await assert.rejects(saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:8,expectedVersion}),/invalid_retention/);
  await reconcileRecordings(source);assert.equal((await current()).recording_state,'recording');
  await assert.rejects(fixtureCamera().bind(projects[0][0],{cameraId,expectedVersion:2,bind:false}),/recording_busy/);
});
test('provider acknowledgement is not recording; foreign plans are preserved and retries recover',async()=>{
  source.foreign=true;await reconcileRecordings(source);assert.equal((await current()).recording_state,'error');assert.equal(source.linked,500);
  source.foreign=false;await reconcileRecordings(source);assert.equal((await current()).recording_state,'recording');
});
test('sealed records retain project/tenant ownership; early foreign intervals are quarantined',async()=>{
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_camera_recording_policies set started_at=now()-interval '6 days' where binding_id=${bindingId}`));
  const now=Math.floor(Date.now()/1000);source.add(101,now-5*86400-100);source.add(102,now-90);source.add(103,now-8*86400);
  await reconcileRecordings(source);
  const own=await withTenantTransaction(eids[0],tx=>rows(tx,sql`select * from app.construction_recordings where binding_id=${bindingId}`));assert.equal(own.length,2);
  recordId=String(own.find(r=>Number(r.source_id)===102)!.id);expiredId=String(own.find(r=>Number(r.source_id)===101)!.id);
  assert.equal((await withTenantTransaction(eids[1],tx=>rows(tx,sql`select id from app.construction_recordings where id=${recordId}`))).length,0);
  viewer=await enter();const day=new Date(Date.now()+28800000).toISOString().slice(0,10);const list=await listCameraRecordings(viewer.session,day,viewer.csrf);assert.equal(list.items.length,1);
  assert.equal(list.items[0].file_path,undefined);assert.equal(list.items[0].source_id,undefined);
});
test('private playback generations exclude live media, expire on stop, and revoke with membership',async()=>{
  const live=await startCameraView(viewer.session,viewer.csrf,bindingId,source);
  const play=await startRecordingView(viewer.session,viewer.csrf,recordId);assert.ok(play.url.startsWith('/camera-recording/'));
  await assert.rejects(authorizeCameraMedia(viewer.session,live.generation),/expired/);
  assert.equal((await authorizeRecordingMedia(viewer.session,play.generation,recordId)).id,recordId);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_members set active=false where project_id=${projects[0][0]} and admin_id=${manager.adminId}`));
  await assert.rejects(authorizeRecordingMedia(viewer.session,play.generation,recordId),/unavailable/);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_members set active=true where project_id=${projects[0][0]} and admin_id=${manager.adminId}`));
  viewer=await enter();const next=await startRecordingView(viewer.session,viewer.csrf,recordId);await sessionHeartbeat(viewer.session,viewer.csrf,true);
  await assert.rejects(authorizeRecordingMedia(viewer.session,next.generation,recordId),/expired/);
});
test('failed physical deletion stays deleting; retry confirms missing bytes before marking deleted',async()=>{
  await assert.rejects(withTenantTransaction(eids[0],tx=>deleteConstructionData(tx,BigInt(eids[0]))),/recordings_require_cleanup/);
  source.deletionFails=true;await purgeCameraRecordings(source);
  let record=await withTenantTransaction(eids[0],tx=>one(tx,sql`select state,last_error from app.construction_recordings where id=${expiredId}`));assert.equal(record!.state,'deleting');assert.ok(record!.last_error);
  source.deletionFails=false;await purgeCameraRecordings(source);record=await withTenantTransaction(eids[0],tx=>one(tx,sql`select state from app.construction_recordings where id=${expiredId}`));assert.equal(record!.state,'deleted');assert.deepEqual(source.deleted,[101]);
});
test('unbind/rebind retains old recordings in the original project and rejects a cross-boundary segment',async()=>{
  const c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);assert.equal((await current()).recording_state,'stopped');
  await fixtureCamera().bind(projects[0][0],{cameraId,expectedVersion:2,bind:false});
  await fixtureCamera().bind(projects[0][1],{cameraId,expectedVersion:3,bind:true});
  const old=await enter(owner,projects[0][0]),play=await startRecordingView(old.session,old.csrf,recordId);assert.equal((await authorizeRecordingMedia(old.session,play.generation,recordId)).id,recordId);
  const other=await enter(owner,projects[0][1]);await assert.rejects(startRecordingView(other.session,other.csrf,recordId),/unavailable/);
  source.add(104,Math.floor(Date.now()/1000)-10);source.foreign=true;await reconcileRecordings(source);
  assert.equal((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.construction_recordings where source_id=104`))).length,0);
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select state from app.construction_camera_recording_policies where binding_id=${bindingId}`)))!.state,'stopped');
});
