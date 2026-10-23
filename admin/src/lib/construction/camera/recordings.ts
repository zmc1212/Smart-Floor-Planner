import {sql} from 'drizzle-orm';
import {withTenantTransaction,withPlatformTransaction,type PostgresTransaction} from '@/db/transaction';
import {one,rows,type Row} from '@/db/repositories/assistant-repository';
import {fail,id,AssistantError} from '@/lib/assistant/contracts';
import {object,version,type ConstructionActor} from '../contracts';
import {cameraAccess,cameraSession,parseCameraToken} from './service';
import {cameraWvp,type WvpClient} from './wvp';
import {recordingFilePath,shanghaiDay} from './recording-contract';
import {openRecordingPeriod,closeRecordingPeriod,reconcileRecordingIndex} from './recording-index';
import {sampleRecordingClock} from './recording-clock';

const nodeDays=()=>{const n=Number(process.env.CAMERA_NODE_RETENTION_DAYS||7);if(!Number.isSafeInteger(n)||n<1||n>30)fail('camera_recording_not_configured',503);return n;};
const errorCode=(e:unknown)=>e instanceof AssistantError?e.code:'camera_service_unavailable';
export async function saveRecordingPolicy(actor:ConstructionActor,pid:string,input:Row) {
  object(input,['bindingId','enabled','retentionDays','expectedVersion']);
  const bid=id(input.bindingId),expected=input.expectedVersion===0?0:version(input.expectedVersion);
  if(typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.retentionDays)||Number(input.retentionDays)<1||Number(input.retentionDays)>nodeDays())fail('camera_invalid_retention',422);
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    const access=await cameraAccess(tx,actor,pid);if(!access.owner)fail('camera_forbidden',403);
    // Use the worker's lock before binding/camera row locks. Provider indexing
    // also touches policy FKs; opposite row-lock order can otherwise deadlock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-recording:${bid}`},0))`);
    const binding=await one(tx,sql`select b.id,b.camera_id from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id where b.enterprise_id=${actor.enterpriseId} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled for update of b,c`);
    if(!binding)fail('camera_binding_unavailable',404);
    const old=await one(tx,sql`select * from app.construction_camera_recording_policies where enterprise_id=${actor.enterpriseId} and binding_id=${bid} for update`);
    if(old&&old.enabled===input.enabled&&Number(old.retention_days)===input.retentionDays)return {version:Number(old.version),state:old.state};
    if((old?Number(old.version):0)!==expected)fail('version_conflict',409);
    const saved=await one(tx,sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,enabled,retention_days,started_at)
      values(${actor.enterpriseId},${pid},${bid},${String(binding.camera_id)},${input.enabled},${Number(input.retentionDays)},${input.enabled?sql`now()`:sql`null`})
      on conflict(binding_id) do update set enabled=excluded.enabled,retention_days=excluded.retention_days,version=construction_camera_recording_policies.version+1,state='pending',last_error=null,
      started_at=case when excluded.enabled and not construction_camera_recording_policies.enabled then now() else construction_camera_recording_policies.started_at end,
      stopped_at=case when excluded.enabled then null else construction_camera_recording_policies.stopped_at end,updated_at=now() returning version,state`);
    await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot) values(${actor.enterpriseId},${pid},${JSON.stringify({kind:'admin',id:actor.adminId})}::jsonb,'camera.recording.configure',${JSON.stringify({bindingId:bid,enabled:input.enabled,retentionDays:input.retentionDays})}::jsonb)`);
    return saved;
  });
}
async function reconcilePolicy(eid:string,bid:string,upstream:WvpClient) {
  await withTenantTransaction(eid,async tx=>{
    if(!(await one(tx,sql`select pg_try_advisory_xact_lock(hashtextextended(${`camera-recording:${bid}`},0)) ok`))?.ok)return;
    const p=await one(tx,sql`select r.*,c.device_id,c.channel_id,c.enabled camera_enabled,b.started_at binding_start,b.ended_at binding_end,p.status project_status,l.archived_at,e.status enterprise_status
      from app.construction_camera_recording_policies r join app.construction_camera_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      join app.construction_cameras c on c.enterprise_id=r.enterprise_id and c.id=r.camera_id
      join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.enterprises e on e.id=r.enterprise_id where r.enterprise_id=${eid} and r.binding_id=${bid} for update of r`);
    if(!p)return;
    const enabled=p.enabled&&p.camera_enabled&&!p.binding_end&&p.project_status==='active'&&!p.archived_at&&p.enterprise_status==='active';
    // A retired binding already confirmed its writer stopped before unbinding.
    // The camera may now record for a different project; do not inspect or
    // unlink that new writer while importing this binding's sealed history.
    const retired=!!p.binding_end&&p.state==='stopped';
    const planId=retired?null:await upstream.recordingPlan('SFP-'+p.source_key,!!enabled);
    if(!retired&&p.plan_id&&Number(p.plan_id)!==planId)fail('camera_recording_conflict',409);
    const channel=retired?{id:0,planId:null}:await upstream.recordingChannel(String(p.device_id),String(p.channel_id),planId);
    if(planId&&!p.plan_id)await tx.execute(sql`update app.construction_camera_recording_policies set plan_id=${planId} where enterprise_id=${eid} and binding_id=${bid}`);
    if(channel.planId&&channel.planId!==planId)fail('camera_recording_conflict',409);
    // Time/index diagnostics must never prevent removing our disabled writer.
    if(!enabled&&planId&&channel.planId===planId)await upstream.linkRecording(channel.id,null);
    let clock=await sampleRecordingClock(tx,upstream);
    if(enabled)await openRecordingPeriod(tx,p,clock);
    if(enabled&&channel.planId!==planId)await upstream.linkRecording(channel.id,planId);
    const stream=enabled?await upstream.play(String(p.device_id),String(p.channel_id)):{app:String(p.stream_app||'rtp'),stream:String(p.stream_id||`${p.device_id}_${p.channel_id}`)};
    const actual=retired?false:await upstream.isRecording(stream);
    // An acknowledged link is not proof that recording has started/stopped.
    const state=enabled?(actual?'recording':'pending'):(actual?'pending':'stopped');
    if(state==='stopped')clock=await closeRecordingPeriod(tx,p,clock,upstream);
    await tx.execute(sql`update app.construction_camera_recording_policies set state=${state},stream_app=${stream.app},stream_id=${stream.stream},
      started_at=case when ${!!enabled} and started_at is null then now() else started_at end,
      stopped_at=case when ${state==='stopped'} then coalesce(stopped_at,now()) when ${!!enabled} then null else stopped_at end,
      last_error=null,checked_at=now() where enterprise_id=${eid} and binding_id=${bid}`);
    await reconcileRecordingIndex(tx,p,stream,upstream,nodeDays(),clock);
  });
}
export async function reconcileRecordings(upstream=cameraWvp()) {
  const due=await withPlatformTransaction(tx=>rows(tx,sql`select enterprise_id,binding_id from app.construction_camera_recording_policies order by checked_at nulls first,binding_id limit 100`));
  for(const p of due){
    try{await reconcilePolicy(String(p.enterprise_id),String(p.binding_id),upstream);}
    catch(e){await withTenantTransaction(String(p.enterprise_id),tx=>tx.execute(sql`update app.construction_camera_recording_policies set state='error',last_error=${errorCode(e)},checked_at=now() where binding_id=${String(p.binding_id)}`));}
  }
}
export async function listCameraRecordings(token:string,day:unknown,csrf?:string) {
  const {eid}=parseCameraToken(token),{from,to}=shanghaiDay(day);
  return withTenantTransaction(eid,async tx=>{
    const s=await cameraSession(tx,token,csrf);
    const items=await rows(tx,sql`select r.id,r.binding_id,c.name,r.started_at,r.ended_at,r.bytes from app.construction_recordings r
      join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
      join app.construction_camera_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where r.enterprise_id=${eid} and r.project_id=${s.pid} and r.state='ready' and r.started_at>=${from} and r.started_at<${to}
      and r.started_at+r.clock_offset_min_ms*interval '1 millisecond'>=now()-p.retention_days*interval '1 day' order by r.started_at limit 300`);
    return {items,source:'cloud',sdAvailable:false,limit:300};
  });
}
async function authorizedRecording(tx:PostgresTransaction,eid:string,pid:string,rid:string) {
  const r=await one(tx,sql`select r.* from app.construction_recordings r join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
    where r.enterprise_id=${eid} and r.project_id=${pid} and r.id=${rid} and r.state='ready' and r.started_at+r.clock_offset_min_ms*interval '1 millisecond'>=now()-p.retention_days*interval '1 day' for share of r,p`);
  if(!r)fail('camera_recording_unavailable',404);return r;
}
export async function startRecordingView(token:string,csrf:string,recordingId:string) {
  const {eid,hash}=parseCameraToken(token),rid=id(recordingId);
  return withTenantTransaction(eid,async tx=>{
    const s=await cameraSession(tx,token,csrf),r=await authorizedRecording(tx,eid,s.pid,rid);
    const row=await one(tx,sql`update app.construction_camera_sessions set recording_id=${rid},binding_id=${String(r.binding_id)},stream_id='recording',stream_app=null,view_expires_at=now()+interval '60 seconds',play_version=play_version+1 where token_hash=${hash} returning play_version`);
    return {generation:Number(row!.play_version),url:`/camera-recording/${row!.play_version}/${rid}.mp4`,startedAt:r.started_at,endedAt:r.ended_at};
  });
}
export async function authorizeRecordingMedia(token:string,generation:number,recordingId:string) {
  const {eid}=parseCameraToken(token);
  return withTenantTransaction(eid,async tx=>{
    const s=await cameraSession(tx,token);
    if(String(s.recording_id)!==recordingId||s.stream_id!=='recording'||Number(s.play_version)!==generation||new Date(String(s.view_expires_at)).getTime()<=Date.now())fail('camera_view_expired',401);
    const r=await authorizedRecording(tx,eid,s.pid,id(recordingId));return {id:String(r.id),filePath:recordingFilePath(r.file_path)};
  });
}
export async function purgeCameraRecordings(upstream=cameraWvp()) {
  const candidates=await withPlatformTransaction(tx=>rows(tx,sql`select r.id,r.enterprise_id from app.construction_recordings r join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
    where r.state in ('ready','deleting') and r.ended_at+r.clock_offset_max_ms*interval '1 millisecond'<now()-p.retention_days*interval '1 day' order by r.ended_at limit 30`));
  for(const candidate of candidates){
    const eid=String(candidate.enterprise_id),rid=String(candidate.id);
    const record=await withTenantTransaction(eid,async tx=>{
      const r=await one(tx,sql`select * from app.construction_recordings where id=${rid} and state in ('ready','deleting') for update`);if(!r)return null;
      if(await one(tx,sql`select token_hash from app.construction_camera_sessions where enterprise_id=${eid} and recording_id=${rid} and view_expires_at>now() and expires_at>now() and closed_at is null limit 1`))return null;
      await tx.execute(sql`update app.construction_recordings set state='deleting' where id=${rid}`);return r;
    });
    if(!record)continue;
    try{
      let status=await upstream.recordingFileStatus(recordingFilePath(record.file_path));
      const indexedPath=await upstream.cloudPath(Number(record.source_id));
      if(indexedPath!==null){
        if(indexedPath!==record.file_path)fail('camera_recording_conflict',409);
        await upstream.deleteCloudRecording(Number(record.source_id));status=await upstream.recordingFileStatus(record.file_path as string);
        if(await upstream.cloudPath(Number(record.source_id))!==null)fail('camera_recording_delete_unconfirmed',503);
      }
      if(![404,410].includes(status))fail('camera_recording_delete_unconfirmed',503);
      await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_recordings set state='deleted',deleted_at=now(),last_error=null where id=${rid} and state='deleting'`));
    }catch(e){await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_recordings set last_error=${errorCode(e)} where id=${rid} and state='deleting'`));}
  }
}
