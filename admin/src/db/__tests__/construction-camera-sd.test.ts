import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { CameraService, authorizeCameraMedia, exchangeCameraEntry, sessionHeartbeat } from '@/lib/construction/camera/service';
import { saveRecordingPolicy, reconcileRecordings } from '@/lib/construction/camera/recordings';
import { listSdRecordings, startSdRecordingView, reconcileSdPlaybacks, refreshSdWindow } from '@/lib/construction/camera/sd';
import { WvpClient, sdPlaybackStream } from '@/lib/construction/camera/wvp';
import { wvpTime } from '@/lib/construction/camera/recording-contract';
import type { ConstructionActor } from '@/lib/construction/contracts';

const prefix='camera-sd-'+randomUUID(),device='91020000001320000005',channel='91020000001320000006';
let eid='',uid='',pid='',otherPid='',owner:ConstructionActor,member:ConstructionActor,cid='',bid='',rid='';
let starts=0,stops=0,missing=false,startUnknown=false,stopFailure=false;
const streams=new Set<string>();
class Upstream extends WvpClient {
  constructor(){super({origin:'http://wvp.test',mediaOrigin:'http://media.test',username:'fixture',password:'fixture'});}
  async channels(){return [{deviceId:device,channelId:channel,name:'SD fixture',online:true,ptzType:0}];}
  async recordingPlan(){return null;}
  async recordingChannel(){return {id:1,planId:null};}
  async recordingClock(){return new Date();}
  async isRecording(){return false;}
  async cloudRecordings(){return {items:[],total:0};}
  async sdRecordings(_device:string,_channel:string,from:Date,to:Date){return missing?[]:[{deviceId:device,startTime:wvpTime(from),endTime:wvpTime(to)}];}
  async startSdPlayback(d:string,c:string,from:Date,to:Date){starts++;const s=sdPlaybackStream(d,c,from,to);streams.add(s.stream);if(startUnknown)throw Error('unknown start');return s;}
  async stopSdPlayback(_d:string,_c:string,stream:string){stops++;if(stopFailure)throw Error('unknown stop');streams.delete(stream);}
  async mediaExists(s:{app:string;stream:string}){return streams.has(s.stream);}
}
const upstream=new Upstream(),clock=async()=>({source:new Date(),serialHash:'a'.repeat(64)});
const service=()=>new CameraService(owner,upstream);
async function enter(actor=member,project=pid){const e=await new CameraService(actor,upstream).entry(project);return exchangeCameraEntry(e.url.split('#entry=')[1]);}
async function policy(){return withTenantTransaction(eid,tx=>one(tx,sql`select * from app.construction_camera_recording_policies where binding_id=${bid}`));}
async function windowFixture(){
  await withPlatformTransaction(async tx=>{
    await tx.execute(sql`update app.construction_camera_bindings set started_at=now()-interval '20 minutes' where id=${bid}`);
    await tx.execute(sql`update app.construction_camera_recording_policies set sd_activated_at=now()-interval '19 minutes' where binding_id=${bid}`);
    await tx.execute(sql`delete from app.construction_camera_sd_windows where binding_id=${bid}`);
    await tx.execute(sql`insert into app.construction_camera_sd_windows(enterprise_id,project_id,binding_id,serial_hash,business_from,checked_at,source_from,source_to,clock_min_ms,clock_max_ms)
      values(${eid},${pid},${bid},${'a'.repeat(64)},now()-interval '18 minutes',now()-interval '30 seconds',date_trunc('second',now()-interval '18 minutes'),date_trunc('second',now()-interval '30 seconds'),-3000,3000)`);
  });
}
before(async()=>{
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(url.port,'55432');assert.match(url.pathname,/^\/cloud_camera_unit_eval_/);
  await withPlatformTransaction(async tx=>{
    eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    uid=String((await one(tx,sql`insert into app.users(nickname) values(${prefix}) returning id`))!.id);
    const lead=String((await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'SD隔离验收客户','13800000000','natural') returning id`))!.id);
    for(const name of ['SD隔离验收工地','SD迁移对照工地']){const p=String((await one(tx,sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${lead},${name}) returning id`))!.id);if(!pid)pid=p;else otherPid=p;}
    const actors:ConstructionActor[]=[];
    for(const role of ['admin','construction_staff']){
      const aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eid},${prefix+role},'synthetic-only',${role},'active',false) returning id`))!.id);actors.push({enterpriseId:eid,adminId:aid});
    }
    [owner,member]=actors;
    await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${member.adminId},'worker')`);
  });
  const c=await service().register({deviceId:device,channelId:channel,name:'测试SD摄像头'});cid=String(c.id);
  bid=String((await service().bind(pid,{cameraId:cid,expectedVersion:1,bind:true})).bindingId);
});
after(async()=>{
  try{await withPlatformTransaction(async tx=>{
    for(const table of ['construction_camera_sessions','construction_camera_entries','construction_camera_sd_playbacks','construction_camera_sd_recordings','construction_camera_sd_windows','construction_recordings','construction_camera_recording_periods','construction_camera_recording_policies','construction_camera_bindings','construction_cameras','construction_audits','construction_members','construction_projects','leads','admin_users'])await tx.execute(sql`delete from ${sql.raw('app.'+table)} where enterprise_id=${eid}`);
    await tx.execute(sql`delete from app.enterprises where id=${eid}`);await tx.execute(sql`delete from app.users where id=${uid}`);
  });}finally{await closePostgresPool();}
});
test('SD owner configuration is durable/idempotent; members and cloud-upload intent are refused',async()=>{
  await assert.rejects(saveRecordingPolicy(member,pid,{bindingId:bid,enabled:false,retentionDays:3,expectedVersion:0,recordingMode:'sd'}),/forbidden/);
  await assert.rejects(saveRecordingPolicy(owner,pid,{bindingId:bid,enabled:true,retentionDays:3,expectedVersion:0,recordingMode:'sd'}),/invalid_request/);
  const a=await saveRecordingPolicy(owner,pid,{bindingId:bid,enabled:false,retentionDays:3,expectedVersion:0,recordingMode:'sd'});
  const b=await saveRecordingPolicy(owner,pid,{bindingId:bid,enabled:false,retentionDays:3,expectedVersion:0,recordingMode:'sd'});assert.equal(a!.version,b!.version);
  await reconcileRecordings(upstream);assert.equal((await policy())!.state,'stopped');
  assert.equal((await service().list(pid)).items[0].recording_mode,'sd');assert.equal(starts,0);
});
test('initial clock sample never adopts pre-binding footage; unavailable time never produces an empty-success query',async()=>{
  const s=await enter(),day=new Date(Date.now()+28800000).toISOString().slice(0,10);
  const initial=await listSdRecordings(s.session,s.csrf,day,bid,undefined,upstream,clock);assert.equal(initial.items.length,0);
  await assert.rejects(listSdRecordings(s.session,s.csrf,day,bid,undefined,upstream,async()=>{throw Error('clock offline');}),/clock offline/);
  await windowFixture();
});
test('actual SD ranges are clipped to calibrated ownership, capped at five minutes, tenant-scoped and reenterable',async()=>{
  const s=await enter(),day=new Date(Date.now()+28800000).toISOString().slice(0,10);
  const list=await listSdRecordings(s.session,s.csrf,day,bid,undefined,upstream,clock);assert.ok(list.items.length>=1);
  const w=await withTenantTransaction(eid,tx=>one(tx,sql`select * from app.construction_camera_sd_windows where binding_id=${bid} order by id desc limit 1`));
  for(const r of list.items){assert.ok(new Date(r.started_at as string)>=new Date(w!.source_from as string));assert.ok(new Date(r.ended_at as string).getTime()-new Date(r.started_at as string).getTime()<=300000);}
  rid=String(list.items[Math.min(1,list.items.length-1)].id);const reentry=await enter();assert.ok((await listSdRecordings(reentry.session,reentry.csrf,day,bid,undefined,upstream,clock)).items.some(r=>String(r.id)===rid));
  assert.equal((await withTenantTransaction('999999',tx=>rows(tx,sql`select id from app.construction_camera_sd_recordings where id=${rid}`))).length,0);
});
test('changed source identity or a clock jump cannot start an old cached SD index',async()=>{
  const s=await enter(),beforeStarts=starts,day=new Date(Date.now()+28800000).toISOString().slice(0,10);
  const changed=async()=>({source:new Date(),serialHash:'b'.repeat(64)});
  await assert.rejects(startSdRecordingView(s.session,s.csrf,rid,upstream,changed),/unavailable/);
  await assert.rejects(startSdRecordingView(s.session,s.csrf,rid,upstream,async()=>({source:new Date(Date.now()+20000),serialHash:'a'.repeat(64)})),/unavailable/);
  assert.equal(starts,beforeStarts);
  const list=await listSdRecordings(s.session,s.csrf,day,bid,undefined,upstream,changed);assert.equal(list.items.length,0);
  await withTenantTransaction(eid,tx=>tx.execute(sql`delete from app.construction_camera_sd_windows where binding_id=${bid} and serial_hash=${'b'.repeat(64)}`));
});
test('overwritten SD index refuses start; shared viewers stop only after the final lease; generations revoke',async()=>{
  const a=await enter(),b=await enter();missing=true;await assert.rejects(startSdRecordingView(a.session,a.csrf,rid,upstream,clock),/unavailable/);missing=false;assert.equal(starts,0);
  const first=await startSdRecordingView(a.session,a.csrf,rid,upstream,clock),second=await startSdRecordingView(b.session,b.csrf,rid,upstream,clock);assert.equal(starts,1);
  const stream=await authorizeCameraMedia(a.session,first.generation);assert.equal((await authorizeCameraMedia(b.session,second.generation)).stream,stream.stream);
  await sessionHeartbeat(a.session,a.csrf,true,upstream);assert.equal(stops,0);await assert.rejects(authorizeCameraMedia(a.session,first.generation),/expired/);
  await assert.rejects(saveRecordingPolicy(owner,pid,{bindingId:bid,enabled:false,retentionDays:3,expectedVersion:1,recordingMode:'cloud'}),/busy/);
  await sessionHeartbeat(b.session,b.csrf,true,upstream);assert.equal(stops,1);assert.equal(streams.size,0);
});
test('unknown start is persisted, never replayed, and drained after the upstream startup window; unknown STOP is retried',async()=>{
  const s=await enter();startUnknown=true;const oldStarts=starts;
  await assert.rejects(startSdRecordingView(s.session,s.csrf,rid,upstream,clock),/unknown start/);
  await assert.rejects(startSdRecordingView(s.session,s.csrf,rid,upstream,clock),/busy/);assert.equal(starts,oldStarts+1);
  await reconcileSdPlaybacks(upstream);assert.equal(streams.size,1);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_camera_sd_playbacks set created_at=now()-interval '46 seconds' where binding_id=${bid} and state='starting'`));
  stopFailure=true;await reconcileSdPlaybacks(upstream);assert.equal(streams.size,1);
  const p=await withTenantTransaction(eid,tx=>one(tx,sql`select * from app.construction_camera_sd_playbacks where binding_id=${bid} order by id desc limit 1`));assert.notEqual(p!.state,'stopped');assert.ok(p!.last_error);
  startUnknown=false;stopFailure=false;await reconcileSdPlaybacks(upstream);assert.equal(streams.size,0);
});
test('membership revocation reaps the final SD viewer and stops only its owned stream',async()=>{
  const s=await enter(),view=await startSdRecordingView(s.session,s.csrf,rid,upstream,clock);
  streams.add('foreign-playback');
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_members set active=false where project_id=${pid} and admin_id=${member.adminId}`));
  await assert.rejects(authorizeCameraMedia(s.session,view.generation),/unavailable/);await reconcileSdPlaybacks(upstream);
  assert.deepEqual([...streams],['foreign-playback']);streams.clear();
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_members set active=true where project_id=${pid} and admin_id=${member.adminId}`));
  await assert.rejects(authorizeCameraMedia(s.session,view.generation),/expired/);
});
test('clock gaps and jumps never widen a prior window to claim unverified history',async()=>{
  const b=await withTenantTransaction(eid,tx=>one(tx,sql`select b.*,p.sd_activated_at,c.device_id,c.channel_id from app.construction_camera_bindings b join app.construction_cameras c on c.id=b.camera_id join app.construction_camera_recording_policies p on p.binding_id=b.id where b.id=${bid}`));
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_camera_sd_windows set checked_at=now()-interval '121 seconds' where binding_id=${bid}`));
  await withTenantTransaction(eid,tx=>refreshSdWindow(tx,b!,clock));
  const afterGap=await withTenantTransaction(eid,tx=>rows(tx,sql`select * from app.construction_camera_sd_windows where binding_id=${bid} order by id`));assert.equal(afterGap.length,2);
  await withTenantTransaction(eid,tx=>refreshSdWindow(tx,b!,async()=>({source:new Date(Date.now()+20000),serialHash:'a'.repeat(64)})));
  assert.equal((await withTenantTransaction(eid,tx=>rows(tx,sql`select id from app.construction_camera_sd_windows where binding_id=${bid}`))).length,3);
});
test('moving a device rejects old SD indexes and never reassigns their source ownership',async()=>{
  const s=await enter();const c=(await service().list(pid)).items[0];
  await service().bind(pid,{cameraId:cid,expectedVersion:Number(c.version),bind:false});
  const next=await service().bind(otherPid,{cameraId:cid,expectedVersion:Number(c.version)+1,bind:true});assert.notEqual(String(next.bindingId),bid);
  await assert.rejects(startSdRecordingView(s.session,s.csrf,rid,upstream,clock),/unavailable/);
  const original=await withTenantTransaction(eid,tx=>one(tx,sql`select project_id,binding_id from app.construction_camera_sd_recordings where id=${rid}`));assert.equal(String(original!.project_id),pid);assert.equal(String(original!.binding_id),bid);
});
