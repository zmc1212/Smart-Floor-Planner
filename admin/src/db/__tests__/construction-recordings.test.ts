import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
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
import {fail} from '@/lib/assistant/contracts';

class Recorder extends WvpClient {
  linked:number|null=null;foreign=false;deletionFails=false;deleted:number[]=[];failPage=0;clockOffsetMs=0;clockFails=false;writerStalled=false;writerPinned=false;resumeOnPlay=false;startAttempts=0;stopAttempts=0;beforeIndex?:()=>Promise<void>;
  files=new Set<string>();records:Record<string,unknown>[]=[];
  constructor(){super({origin:'http://wvp.test',mediaOrigin:'http://media.test',username:'fixture',password:'fixture',mediaSecret:'fixture'});}
  async channels(){return [{deviceId:'90020000001320000003',channelId:'90020000001320000004',name:'Synthetic recorder',online:true,ptzType:0}];}
  async recordingChannel(){return {id:1,planId:this.foreign?99:this.linked};}
  async recordingPlan(){return 500;}
  async linkRecording(_channel:number,planId:number|null){this.linked=planId;}
  async isRecording(){return (this.linked!==null||this.writerPinned)&&!this.writerStalled;}
  async startRecording(){this.startAttempts++;this.writerStalled=false;}
  async stopRecording(){this.stopAttempts++;this.writerPinned=false;}
  async play(){if(this.resumeOnPlay)this.writerPinned=true;return {app:'rtp',stream:'fixture'};}
  async recordingClock(){if(this.clockFails)fail('camera_recording_clock_unavailable',503);return new Date(Math.floor((Date.now()-this.clockOffsetMs)/1000)*1000);}
  async cloudRecordings(_stream:{app:string;stream:string},from:Date,to:Date,page=1){
    await this.beforeIndex?.();
    if(page===this.failPage)throw Error('Synthetic page outage');
    const records=this.records.filter(r=>Number(r.startTime)*1000>=from.getTime()&&Number(r.endTime)*1000<=to.getTime()).sort((a,b)=>Number(a.startTime)-Number(b.startTime));
    return {items:records.slice((page-1)*100,page*100),total:records.length};
  }
  async cloudPath(id:number){return this.records.find(r=>r.id===id)?.filePath as string|undefined??null;}
  async recordingFileStatus(file:string){return this.files.has(file)?200:404;}
  async deleteCloudRecording(id:number){if(this.deletionFails)throw Error('Synthetic provider deletion unavailable');this.files.delete((await this.cloudPath(id))!);this.records=this.records.filter(r=>r.id!==id);this.deleted.push(id);}
  add(id:number,start:number,seconds=20){const file='/opt/media/www/record/rtp/fixture/'+id+'.mp4';this.records.push({id,app:'rtp',stream:'fixture',mediaServerId:'wvp-zlm-01',filePath:file,startTime:start,endTime:start+seconds,fileSize:4096});this.files.add(file);}
}
const source=new Recorder(),prefix='recording-test-'+randomUUID(),eids:string[]=[],uids:string[]=[],aids:string[][]=[],projects:string[][]=[];
let owner:ConstructionActor,manager:ConstructionActor,platform:ConstructionActor,superAdmin:ConstructionActor,bindingId='',cameraId='',recordId='',expiredId='';
let viewer:Awaited<ReturnType<typeof exchangeCameraEntry>>;
let storageServer:Server,storageAvailable=900n,storageOutage=false;
const storageToken='synthetic-capacity-test-token-at-least-32-characters';
const fixtureCamera=()=>new CameraService(owner,source);
async function current(){return (await fixtureCamera().list(projects[0][0])).items[0];}
async function enter(actor=manager,pid=projects[0][0]){const entry=await new CameraService(actor,source).entry(pid);return exchangeCameraEntry(entry.url.split('#entry=')[1]);}
before(async()=>{
  const database=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(database.port,'55432');assert.equal(database.pathname,'/cloud_camera_unit_eval');
  storageServer=createServer((req,res)=>{
    if(req.headers.authorization!=='Bearer '+storageToken){res.writeHead(401).end();return;}
    if(storageOutage){res.writeHead(503).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,node:'wvp-zlm-01',sampledAt:new Date().toISOString(),totalBytes:String(1000n*1024n**3n),freeBytes:String(storageAvailable*1024n**3n),availableBytes:String(storageAvailable*1024n**3n),files:'100000',availableFiles:'90000'}));
  });
  await new Promise<void>(r=>storageServer.listen(0,'127.0.0.1',r));
  process.env.CAMERA_STORAGE_ORIGIN='http://127.0.0.1:'+(storageServer.address() as {port:number}).port;process.env.CAMERA_STORAGE_TOKEN=storageToken;
  await withPlatformTransaction(async tx=>{
    await tx.execute(sql`delete from app.construction_camera_storage_health`);
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
  for(const eid of eids){for(const table of ['construction_camera_sessions','construction_recordings','construction_camera_recording_periods','construction_camera_recording_policies','construction_camera_controls','construction_camera_snapshots','construction_camera_entries','construction_camera_bindings','construction_cameras','construction_audits','construction_members','construction_projects','leads'])await tx.execute(sql`delete from ${sql.raw('app.'+table)} where enterprise_id=${eid}`);}
  for(const list of aids)for(const aid of list)await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  for(const eid of eids)await tx.execute(sql`delete from app.enterprises where id=${eid}`);
  for(const uid of uids)await tx.execute(sql`delete from app.users where id=${uid}`);
});}finally{await closePostgresPool();await new Promise<void>(r=>{storageServer.close(()=>r());storageServer.closeAllConnections();});}});

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
  await withTenantTransaction(eids[0],async tx=>{
    await tx.execute(sql`update app.construction_camera_recording_policies set started_at=now()-interval '6 days',imported_until=null,index_swept_at=null where binding_id=${bindingId}`);
    await tx.execute(sql`update app.construction_camera_recording_periods set started_at=now()-interval '6 days',source_started_at=now()-interval '6 days' where binding_id=${bindingId}`);
  });
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
test('a periodic sweep recovers a late sealed file behind the incremental cursor',async()=>{
  source.add(110,Math.floor(Date.now()/1000)-300);
  await reconcileRecordings(source);
  assert.equal((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.construction_recordings where source_id=110`))).length,0);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_camera_recording_policies set index_swept_at=now()-interval '11 minutes' where binding_id=${bindingId}`));
  await reconcileRecordings(source);
  assert.equal((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.construction_recordings where source_id=110`))).length,1);
  assert.equal((await withTenantTransaction(eids[1],tx=>rows(tx,sql`select id from app.construction_camera_recording_periods where binding_id=${bindingId}`))).length,0);
});

test('stop and reenable keep earlier owned intervals while excluding the disabled gap',async()=>{
  let c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:5,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
  await withTenantTransaction(eids[0],async tx=>{
    await tx.execute(sql`update app.construction_camera_recording_periods set ended_at=now()-interval '4 minutes',source_ended_at=now()-interval '4 minutes' where binding_id=${bindingId}`);
    await tx.execute(sql`update app.construction_camera_recording_policies set stopped_at=now()-interval '4 minutes' where binding_id=${bindingId}`);
  });
  c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:5,expectedVersion:Number(c.recording_version)});
  await reconcileRecordings(source);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_camera_recording_periods set started_at=now()-interval '2 minutes',source_started_at=now()-interval '2 minutes' where binding_id=${bindingId} and ended_at is null`));
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_camera_recording_policies set started_at=now()-interval '2 minutes',index_swept_at=null where binding_id=${bindingId}`));
  const now=Math.floor(Date.now()/1000);source.add(111,now-360);source.add(112,now-200);source.add(113,now-60);
  await reconcileRecordings(source);
  const saved=await withTenantTransaction(eids[0],tx=>rows(tx,sql`select source_id from app.construction_recordings where source_id in (111,112,113) order by source_id`));
  assert.deepEqual(saved.map(r=>Number(r.source_id)),[111,113]);
  const periods=await withTenantTransaction(eids[0],tx=>rows(tx,sql`select ended_at from app.construction_camera_recording_periods where binding_id=${bindingId}`));assert.equal(periods.length,2);assert.equal(periods.filter(r=>r.ended_at===null).length,1);
});

test('bounded sweep pages survive a provider failure and a fresh worker client',async()=>{
  const now=Math.floor(Date.now()/1000);for(let n=0;n<231;n++)source.add(2000+n,now-3600-n*30);
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.construction_camera_recording_policies set index_swept_at=null where binding_id=${bindingId}`));
  await reconcileRecordings(source);
  const read=()=>withTenantTransaction(eids[0],tx=>one(tx,sql`select scan_page,scan_to,state from app.construction_camera_recording_policies where binding_id=${bindingId}`));
  let cursor=await read();assert.equal(Number(cursor!.scan_page),3);assert.ok(cursor!.scan_to);
  source.failPage=3;await reconcileRecordings(source);cursor=await read();assert.equal(cursor!.state,'error');assert.equal(Number(cursor!.scan_page),3);
  source.failPage=0;const restarted=new Recorder();restarted.records=source.records;restarted.linked=source.linked;
  await reconcileRecordings(restarted);cursor=await read();assert.equal(cursor!.state,'recording');assert.equal(cursor!.scan_to,null);
  assert.equal((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.construction_recordings where source_id between 2000 and 2230`))).length,231);
});

test('saving a policy and worker indexing serialize without a deadlock or lost settings',async()=>{
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
  const c=await current();source.beforeIndex=async()=>{enter();await gate;};
  const worker=reconcileRecordings(source);await entered;let saved=false;
  const saving=saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:4,expectedVersion:Number(c.recording_version)}).then(r=>{saved=true;return r;});
  try{await new Promise(r=>setTimeout(r,100));assert.equal(saved,false,'Save waits before taking binding row locks');}
  finally{source.beforeIndex=undefined;release();}
  await Promise.all([worker,saving]);assert.equal(Number((await current()).retention_days),4);
  await reconcileRecordings(source);assert.equal((await current()).recording_state,'recording');
});

test('media clock lag keeps the first sealed segment without relaxing binding ownership',async()=>{
  let c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:4,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
  source.clockOffsetMs=5000;c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:4,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
  const period=await withTenantTransaction(eids[0],tx=>one(tx,sql`select * from app.construction_camera_recording_periods where binding_id=${bindingId} and ended_at is null`));
  const start=new Date(String(period!.source_started_at)).getTime();assert.ok(start<new Date(String(period!.started_at)).getTime());assert.ok(Number(period!.clock_offset_min_ms)>3000);
  await new Promise(r=>setTimeout(r,2200));source.add(120,start/1000,1);await reconcileRecordings(source);
  const saved=await withTenantTransaction(eids[0],tx=>one(tx,sql`select started_at,clock_offset_min_ms,clock_offset_max_ms from app.construction_recordings where binding_id=${bindingId} and source_id=120`));
  assert.ok(saved);assert.equal(new Date(String(saved.started_at)).getTime(),start);
  assert.ok(Number(saved.clock_offset_min_ms)<=Number(period!.clock_offset_min_ms));assert.ok(Number(saved.clock_offset_max_ms)>=Number(period!.clock_offset_max_ms));
  c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:4,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
  source.clockOffsetMs=0;c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:4,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
});

test('unavailable clock evidence blocks indexing but never prevents disabling the owned writer',async()=>{
  let c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:4,expectedVersion:Number(c.recording_version)});
  source.clockFails=true;await reconcileRecordings(source);assert.equal(source.linked,null);assert.equal((await current()).recording_state,'error');
  source.clockFails=false;await reconcileRecordings(source);assert.equal((await current()).recording_state,'stopped');
  c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:4,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
});

test('capacity warnings persist once, recover on reentry, and raw node metrics remain platform scoped',async()=>{
  storageAvailable=150n;await reconcileRecordings(source);assert.equal((await current()).recording_state,'recording');
  let health=await fixtureCamera().list(projects[0][0]);assert.equal(health.storage!.level,'warning');
  assert.equal((await new CameraService(manager,source).list(projects[0][0])).storage,null);
  const read=()=>withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.construction_audits where project_id=${projects[0][0]} and action='camera.storage.warning'`));
  const count=(await read()).length;assert.ok(count>0);await reconcileRecordings(source);assert.equal((await read()).length,count);
  health=await fixtureCamera().list(projects[0][0]);assert.equal(health.storage!.level,'warning');
  assert.equal((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select * from app.construction_camera_storage_health`))).length,0);
});

test('critical free space stops the owned writer, preserves history/intent, and resumes with hysteresis',async()=>{
  storageAvailable=40n;source.writerPinned=true;const stops=source.stopAttempts;await reconcileRecordings(source);let c=await current();assert.equal(source.linked,null);assert.equal(source.stopAttempts,stops+1);assert.equal(c.recording_enabled,true);assert.equal(c.recording_state,'error');assert.equal(c.recording_error,'camera_storage_low');
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select state from app.construction_recordings where id=${recordId}`)))!.state,'ready');
  const member=await enter(),day=new Date(Date.now()+28800000).toISOString().slice(0,10),list=await listCameraRecordings(member.session,day,member.csrf);assert.equal(list.recordingNotice,'camera_storage_low');assert.ok(list.items.length>0);
  const playback=await startRecordingView(member.session,member.csrf,recordId);assert.equal((await authorizeRecordingMedia(member.session,playback.generation,recordId)).id,recordId);
  source.resumeOnPlay=true;await startCameraView(member.session,member.csrf,bindingId,source);assert.equal(source.linked,null);assert.equal(await source.isRecording(),false);source.resumeOnPlay=false;await sessionHeartbeat(member.session,member.csrf,true);
  storageAvailable=70n;await reconcileRecordings(source);assert.equal(source.linked,null);
  storageAvailable=120n;source.writerStalled=true;const starts=source.startAttempts;await reconcileRecordings(source);c=await current();assert.equal(c.recording_state,'recording');assert.equal(source.linked,500);assert.equal(c.recording_enabled,true);assert.equal(source.startAttempts,starts+1,'An existing live stream must regain its owned MP4 writer');
});

test('missing capacity evidence pauses safely; disabling remains possible and recovery respects saved off intent',async()=>{
  storageOutage=true;await reconcileRecordings(source);let c=await current();assert.equal(source.linked,null);assert.equal(c.recording_error,'camera_storage_unavailable');
  await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);c=await current();assert.equal(c.recording_state,'stopped');
  await assert.rejects(saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:3,expectedVersion:Number(c.recording_version)}),/camera_storage_unavailable/);
  storageOutage=false;storageAvailable=40n;await reconcileRecordings(source);
  await assert.rejects(saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:3,expectedVersion:Number(c.recording_version)}),/camera_storage_low/);
  storageAvailable=900n;await reconcileRecordings(source);assert.equal((await current()).recording_state,'stopped');assert.equal(source.linked,null);
  c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:true,retentionDays:3,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);
});

test('capacity pressure cannot overwrite or stop a foreign recording plan',async()=>{
  storageAvailable=40n;source.foreign=true;await reconcileRecordings(source);assert.equal(source.linked,500);assert.equal((await current()).recording_error,'camera_recording_conflict');
  source.foreign=false;storageAvailable=900n;await reconcileRecordings(source);assert.equal((await current()).recording_state,'recording');
});

test('unbind/rebind retains old recordings in the original project and rejects a cross-boundary segment',async()=>{
  const c=await current();await saveRecordingPolicy(owner,projects[0][0],{bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});await reconcileRecordings(source);assert.equal((await current()).recording_state,'stopped');
  await fixtureCamera().bind(projects[0][0],{cameraId,expectedVersion:2,bind:false});
  await fixtureCamera().bind(projects[0][1],{cameraId,expectedVersion:3,bind:true});
  const old=await enter(owner,projects[0][0]),play=await startRecordingView(old.session,old.csrf,recordId);assert.equal((await authorizeRecordingMedia(old.session,play.generation,recordId)).id,recordId);
  const other=await enter(owner,projects[0][1]);await assert.rejects(startRecordingView(other.session,other.csrf,recordId),/unavailable/);
  await withTenantTransaction(eids[0],async tx=>{
    await tx.execute(sql`update app.construction_camera_bindings set ended_at=now()-interval '30 seconds' where id=${bindingId}`);
    await tx.execute(sql`update app.construction_camera_recording_policies set index_swept_at=null where binding_id=${bindingId}`);
  });
  source.add(104,Math.floor(Date.now()/1000)-40);source.foreign=true;await reconcileRecordings(source);await reconcileRecordings(source);
  assert.equal((await withTenantTransaction(eids[0],tx=>rows(tx,sql`select id from app.construction_recordings where source_id=104`))).length,0);
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select state from app.construction_camera_recording_policies where binding_id=${bindingId}`)))!.state,'stopped');
});
