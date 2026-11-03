import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {sql} from 'drizzle-orm';
import {withPlatformTransaction,withTenantTransaction} from '@/db/transaction';
import {one,rows} from '@/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '@/lib/postgresql';
import {CameraService,exchangeCameraEntry} from '@/lib/construction/camera/service';
import {saveRecordingPolicy,saveRetentionDefault,listCameraRecordings,purgeCameraRecordings} from '@/lib/construction/camera/recordings';
import {deleteConstructionData} from '@/db/repositories/construction-cleanup';
import type {ConstructionActor} from '@/lib/construction/contracts';

const prefix='retention-default-'+randomUUID(),eids:string[]=[],aids:string[]=[],uids:string[]=[],pids:string[]=[],bids:string[]=[];
let owner:ConstructionActor,admin:ConstructionActor,superAdmin:ConstructionActor,manager:ConstructionActor,member:ConstructionActor;
let server:Server,outage=false;
const actor=(n:number)=>({enterpriseId:eids[0],adminId:aids[n]});
const policy=(i:number)=>withTenantTransaction(eids[0],tx=>one(tx,sql`select * from app.construction_camera_recording_policies where binding_id=${bids[i]}`));
before(async()=>{
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(url.port,'55432');assert.match(url.pathname,/^\/cloud_camera_unit_eval_[a-z0-9_]+$/);
  server=createServer((_req,res)=>{if(outage){res.writeHead(503).end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,node:'wvp-zlm-01',sampledAt:new Date().toISOString(),totalBytes:String(1000n*1024n**3n),freeBytes:String(900n*1024n**3n),availableBytes:String(900n*1024n**3n),files:'100000',availableFiles:'90000'}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  process.env.CAMERA_STORAGE_ORIGIN='http://127.0.0.1:'+(server.address() as {port:number}).port;process.env.CAMERA_STORAGE_TOKEN='synthetic-defaults-token-long-enough';
  await withPlatformTransaction(async tx=>{
    for(let n=0;n<2;n++){
      eids.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
      const uid=String((await one(tx,sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id);uids.push(uid);
      const lid=String((await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[n]},${uid},'合成默认留存客户','13800000000','natural') returning id`))!.id);
      pids.push(String((await one(tx,sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eids[n]},${lid},'合成默认留存工地') returning id`))!.id));
    }
    for(const role of ['enterprise_admin','admin','super_admin','construction_staff','construction_staff']){
      aids.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${role==='admin'||role==='super_admin'?null:eids[0]},${prefix+aids.length},'synthetic-only',${role},'active',false) returning id`))!.id));
    }
    for(const n of [3,4])await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eids[0]},${pids[0]},${aids[n]},${n===3?'manager':'worker'})`);
    for(let n=0;n<6;n++){
      const cid=String((await one(tx,sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name) values(${eids[0]},${'9002000000132000010'+n},${'9002000000132000020'+n},${'合成留存摄像头'+n}) returning id`))!.id);
      const bid=String((await one(tx,sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at) values(${eids[0]},${pids[0]},${cid},now()-interval '7 days') returning id`))!.id);bids.push(bid);
      if(n<5)await tx.execute(sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,enabled,retention_days,retention_override_days,state,recording_mode)
        values(${eids[0]},${pids[0]},${bid},${cid},${n===4},${n===1?4:3},${n===1?4:null},'stopped',${n===2?'sd':'cloud'})`);
      if(n===3)await tx.execute(sql`update app.construction_camera_bindings set ended_at=now() where id=${bid}`);
    }
  });
  [owner,admin,superAdmin,manager,member]=[0,1,2,3,4].map(actor);
});
after(async()=>{try{await withPlatformTransaction(async tx=>{
  for(const eid of eids){
    await tx.execute(sql`update app.construction_camera_recording_policies set enabled=false,state='stopped' where enterprise_id=${eid}`);
    await tx.execute(sql`delete from app.construction_camera_sessions where enterprise_id=${eid}`);
    await tx.execute(sql`delete from app.construction_recordings where enterprise_id=${eid}`);
    await deleteConstructionData(tx,BigInt(eid));
    await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
  }
  for(const aid of aids)await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  for(const eid of eids)await tx.execute(sql`delete from app.enterprises where id=${eid}`);
  for(const uid of uids)await tx.execute(sql`delete from app.users where id=${uid}`);
});}finally{await closePostgresPool();await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});}});

test('three management roles persist and reenter one versioned enterprise default; retries have one audit',async()=>{
  assert.equal((await new CameraService(owner).list(pids[0])).retentionDefault?.version,0);
  let expectedVersion=0;
  for(const [i,a] of [owner,admin,superAdmin].entries()){
    const input={retentionDays:3+i,expectedVersion};const receipt=await saveRetentionDefault(a,pids[0],input);
    assert.equal(receipt.version,expectedVersion+1);expectedVersion=receipt.version;
    assert.deepEqual(await saveRetentionDefault(a,pids[0],input),receipt);
    assert.equal((await new CameraService(a).list(pids[0])).retentionDefault?.retentionDays,3+i);
  }
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select count(*) n from app.construction_audits where action='camera.retention.default'`)))!.n,'3');
  assert.equal((await policy(0))!.retention_days,5);assert.equal((await policy(0))!.enabled,false);
  assert.equal((await policy(4))!.enabled,true);
  for(const [i,days] of [[1,4],[2,3],[3,3]])assert.equal((await policy(i))!.retention_days,days);
  assert.equal((await new CameraService(owner).list(pids[0])).items.find(c=>String(c.binding_id)===bids[5])!.retention_days,5);
});
test('permission, tenant RLS, bounds and stale versions deny without mutating defaults',async()=>{
  for(const a of [manager,member])await assert.rejects(saveRetentionDefault(a,pids[0],{retentionDays:2,expectedVersion:3}),/forbidden/);
  await assert.rejects(saveRetentionDefault({...owner,enterpriseId:eids[1]},pids[0],{retentionDays:2,expectedVersion:3}));
  await assert.rejects(saveRetentionDefault(owner,pids[1],{retentionDays:2,expectedVersion:3}),/project_unavailable/);
  for(const days of [0,8,1.5,'3'])await assert.rejects(saveRetentionDefault(owner,pids[0],{retentionDays:days,expectedVersion:3}),/invalid_retention/);
  await assert.rejects(saveRetentionDefault(owner,pids[0],{retentionDays:2,expectedVersion:1}),/version_conflict/);
  assert.equal((await withTenantTransaction(eids[1],tx=>rows(tx,sql`select * from app.construction_camera_retention_defaults`))).length,0);
  assert.equal((await new CameraService(manager).list(pids[0])).retentionDefault,null);
});
test('explicit camera override and inherited reentry change independently; repeated saves remain idempotent',async()=>{
  let p=(await policy(0))!;
  const save=(extra:Record<string,unknown>)=>saveRecordingPolicy(owner,pids[0],{bindingId:bids[0],enabled:false,expectedVersion:Number(p.version),...extra});
  const input={retentionSource:'camera',retentionDays:4};const receipt=await save(input);assert.equal((await save(input))!.version,receipt!.version);
  p=(await policy(0))!;assert.equal(p.retention_override_days,4);
  await saveRetentionDefault(admin,pids[0],{retentionDays:2,expectedVersion:3});assert.equal((await policy(0))!.retention_days,4);
  await save({retentionSource:'enterprise'});p=(await policy(0))!;assert.equal(p.retention_days,2);assert.equal(p.retention_override_days,null);
  await assert.rejects(saveRecordingPolicy(owner,pids[0],{bindingId:bids[0],enabled:false,retentionDays:1,expectedVersion:Number(p.version)-1}),/version_conflict/);
});
test('storage outage rolls back default and propagation; same request recovers after failure',async()=>{
  const before=(await policy(4))!,input={retentionDays:5,expectedVersion:4};
  // Invalidate the documented 15-second cache so this checks a real probe failure.
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_camera_storage_health set checked_at=now()-interval '1 minute'`));
  outage=true;
  try{await assert.rejects(saveRetentionDefault(owner,pids[0],input),/camera_storage/);}finally{outage=false;}
  assert.equal((await policy(4))!.version,before.version);
  assert.equal((await new CameraService(owner).list(pids[0])).retentionDefault?.version,4);
  await saveRetentionDefault(owner,pids[0],input);assert.equal((await policy(4))!.retention_days,5);
});
test('effective default immediately gates private H5 playback and deletion; SD and retired history stay unchanged',async()=>{
  const record=await withTenantTransaction(eids[0],tx=>one(tx,sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,clock_offset_min_ms,clock_offset_max_ms)
    values(${eids[0]},${pids[0]},${bids[0]},91001,'wvp-zlm-01','rtp','retention','/opt/media/www/record/rtp/retention/91001.mp4',now()-interval '3 days',now()-interval '3 days'+interval '20 seconds',1000,0,0) returning id`));
  const entry=await new CameraService(manager).entry(pids[0]),session=await exchangeCameraEntry(entry.url.split('#entry=')[1]);
  const date=new Date(Date.now()-3*86400000+28800000).toISOString().slice(0,10);
  assert.equal((await listCameraRecordings(session.session,date,session.csrf,bids[0])).items.length,1);
  await saveRetentionDefault(owner,pids[0],{retentionDays:2,expectedVersion:5});
  assert.equal((await listCameraRecordings(session.session,date,session.csrf,bids[0])).items.length,0);
  await saveRetentionDefault(owner,pids[0],{retentionDays:5,expectedVersion:6});
  // If a valid file reaches the provider this sentinel fails the test.
  await purgeCameraRecordings({recordingFileStatus:()=>{throw Error('Valid file must be retained');}} as never);
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select state from app.construction_recordings where id=${String(record!.id)}`)))!.state,'ready');
  assert.equal((await listCameraRecordings(session.session,date,session.csrf,bids[0])).items.length,1);
  for(const n of [2,3])assert.equal((await policy(n))!.retention_days,3);
});
