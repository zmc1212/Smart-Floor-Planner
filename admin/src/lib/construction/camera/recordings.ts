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
import {refreshStorageHealth,requireStorageReady,type StorageHealth} from './storage';
import {listSdRecordings} from './sd';
import {nodeRetentionDays,retentionDefault,lockRetentionDefault} from './retention-defaults';

const nodeDays=nodeRetentionDays;
const errorCode=(e:unknown)=>e instanceof AssistantError?e.code:'camera_service_unavailable';
export async function saveRetentionDefault(actor:ConstructionActor,pid:string,input:Row) {
  object(input,['retentionDays','expectedVersion']);
  const expected=input.expectedVersion===0?0:version(input.expectedVersion),days=Number(input.retentionDays);
  if(!Number.isSafeInteger(input.retentionDays)||days<1||days>nodeDays())fail('camera_invalid_retention',422);
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    if(!(await cameraAccess(tx,actor,pid)).owner)fail('camera_forbidden',403);
    await lockRetentionDefault(tx,actor.enterpriseId);
    const old=await retentionDefault(tx,actor.enterpriseId);
    if(old.version>0&&old.retentionDays===days)return old;
    if(old.version!==expected)fail('version_conflict',409);
    const affected=await rows(tx,sql`select p.binding_id,p.enabled,p.retention_days from app.construction_camera_recording_policies p
      join app.construction_camera_bindings b on b.enterprise_id=p.enterprise_id and b.id=p.binding_id
      where p.enterprise_id=${actor.enterpriseId} and p.retention_override_days is null and p.recording_mode='cloud' and b.ended_at is null order by p.binding_id`);
    if(affected.some(p=>p.enabled&&days>Number(p.retention_days)))await requireStorageReady();
    for(const p of affected)await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-recording:${p.binding_id}`},0))`);
    const saved=await one(tx,sql`insert into app.construction_camera_retention_defaults(enterprise_id,retention_days)
      values(${actor.enterpriseId},${days}) on conflict(enterprise_id) do update set retention_days=excluded.retention_days,
      version=construction_camera_retention_defaults.version+1,updated_at=now() returning retention_days,version`);
    // Keep retired bindings, SD cloud history, explicit off and every override intact.
    await tx.execute(sql`update app.construction_camera_recording_policies p set retention_days=${days},version=p.version+1,updated_at=now()
      from app.construction_camera_bindings b where p.enterprise_id=${actor.enterpriseId} and b.enterprise_id=p.enterprise_id and b.id=p.binding_id
      and b.ended_at is null and p.recording_mode='cloud' and p.retention_override_days is null and p.retention_days<>${days}`);
    await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
      values(${actor.enterpriseId},${pid},${JSON.stringify({kind:'admin',id:actor.adminId})}::jsonb,'camera.retention.default',${JSON.stringify({retentionDays:days,version:Number(saved!.version),affected:affected.length})}::jsonb)`);
    return {retentionDays:days,version:Number(saved!.version)};
  });
}
export async function saveRecordingPolicy(actor:ConstructionActor,pid:string,input:Row) {
  object(input,['bindingId','enabled','retentionDays','expectedVersion','recordingMode','retentionSource']);
  const mode=input.recordingMode??'cloud';
  const inherited=input.retentionSource==='enterprise';
  if(input.retentionSource!==undefined&&!['enterprise','camera'].includes(String(input.retentionSource)))fail('camera_invalid_request',422);
  if(!['cloud','sd'].includes(String(mode))||(mode==='sd'&&input.enabled!==false))fail('camera_invalid_request',422);
  const bid=id(input.bindingId),expected=input.expectedVersion===0?0:version(input.expectedVersion);
  if(typeof input.enabled!=='boolean'||(!inherited&&(!Number.isSafeInteger(input.retentionDays)||Number(input.retentionDays)<1||Number(input.retentionDays)>nodeDays())))fail('camera_invalid_retention',422);
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    const access=await cameraAccess(tx,actor,pid);if(!access.owner)fail('camera_forbidden',403);
    await lockRetentionDefault(tx,actor.enterpriseId);
    // Use the worker's lock before binding/camera row locks. Provider indexing
    // also touches policy FKs; opposite row-lock order can otherwise deadlock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-recording:${bid}`},0))`);
    const binding=await one(tx,sql`select b.id,b.camera_id from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id where b.enterprise_id=${actor.enterpriseId} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled for update of b,c`);
    if(!binding)fail('camera_binding_unavailable',404);
    const old=await one(tx,sql`select * from app.construction_camera_recording_policies where enterprise_id=${actor.enterpriseId} and binding_id=${bid} for update`);
    const override=mode==='sd'&&old?old.retention_override_days:inherited?null:Number(input.retentionDays);
    const days=mode==='sd'&&old?Number(old.retention_days):override===null?(await retentionDefault(tx,actor.enterpriseId)).retentionDays:Number(override);
    if(days<1||days>nodeDays())fail('camera_invalid_retention',422);
    if(old&&old.enabled===input.enabled&&Number(old.retention_days)===days&&old.recording_mode===mode&&old.retention_override_days===override)return {version:Number(old.version),state:old.state};
    if((old?Number(old.version):0)!==expected)fail('version_conflict',409);
    if(old?.recording_mode==='sd'&&mode!=='sd'&&await one(tx,sql`select id from app.construction_camera_sd_playbacks where enterprise_id=${actor.enterpriseId} and binding_id=${bid} and state<>'stopped' limit 1`))fail('camera_playback_busy',409);
    // Always allow disabling/reducing retention, even while storage is blocked.
    if(input.enabled&&(!old?.enabled||days>Number(old.retention_days)))await requireStorageReady();
    const saved=await one(tx,sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,enabled,retention_days,retention_override_days,started_at,recording_mode,sd_activated_at)
      values(${actor.enterpriseId},${pid},${bid},${String(binding.camera_id)},${input.enabled},${days},${override},${input.enabled?sql`now()`:sql`null`},${String(mode)},${mode==='sd'?sql`now()`:sql`null`})
      on conflict(binding_id) do update set enabled=excluded.enabled,retention_days=excluded.retention_days,retention_override_days=excluded.retention_override_days,version=construction_camera_recording_policies.version+1,state='pending',last_error=null,
      recording_mode=excluded.recording_mode,sd_activated_at=case when excluded.recording_mode='sd' and construction_camera_recording_policies.recording_mode<>'sd' then now() else construction_camera_recording_policies.sd_activated_at end,
      started_at=case when excluded.enabled and not construction_camera_recording_policies.enabled then now() else construction_camera_recording_policies.started_at end,
      stopped_at=case when excluded.enabled then null else construction_camera_recording_policies.stopped_at end,updated_at=now() returning version,state`);
    await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot) values(${actor.enterpriseId},${pid},${JSON.stringify({kind:'admin',id:actor.adminId})}::jsonb,'camera.recording.configure',${JSON.stringify({bindingId:bid,enabled:input.enabled,retentionDays:days,retentionSource:override===null?'enterprise':'camera',recordingMode:mode})}::jsonb)`);
    return saved;
  });
}
async function reconcilePolicy(eid:string,bid:string,upstream:WvpClient,storage:StorageHealth) {
  await withTenantTransaction(eid,async tx=>{
    if(!(await one(tx,sql`select pg_try_advisory_xact_lock(hashtextextended(${`camera-recording:${bid}`},0)) ok`))?.ok)return;
    const p=await one(tx,sql`select r.*,c.device_id,c.channel_id,c.enabled camera_enabled,b.started_at binding_start,b.ended_at binding_end,p.status project_status,l.archived_at,e.status enterprise_status
      from app.construction_camera_recording_policies r join app.construction_camera_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      join app.construction_cameras c on c.enterprise_id=r.enterprise_id and c.id=r.camera_id
      join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.enterprises e on e.id=r.enterprise_id where r.enterprise_id=${eid} and r.binding_id=${bid} for update of r`);
    if(!p)return;
    const desired=p.enabled&&p.camera_enabled&&!p.binding_end&&p.project_status==='active'&&!p.archived_at&&p.enterprise_status==='active';
    const storageBlocked=!!desired&&storage.blocked,enabled=desired&&!storageBlocked;
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
    // Unlinking WVP does not stop MP4 when the same stream still has readers.
    // Stop only this binding's known plan, without closing its live stream.
    if(!enabled&&!retired&&planId&&Number(p.plan_id)===planId){
      const previous={app:String(p.stream_app||'rtp'),stream:String(p.stream_id||`${p.device_id}_${p.channel_id}`)};
      if(await upstream.isRecording(previous)){
        const confirmed=await upstream.recordingChannel(String(p.device_id),String(p.channel_id),planId);
        if(confirmed.planId&&confirmed.planId!==planId)fail('camera_recording_conflict',409);
        await upstream.stopRecording(previous);
      }
    }
    let clock=await sampleRecordingClock(tx,upstream);
    if(enabled)await openRecordingPeriod(tx,p,clock);
    if(enabled&&channel.planId!==planId)await upstream.linkRecording(channel.id,planId);
    const stream=enabled?await upstream.play(String(p.device_id),String(p.channel_id)):{app:String(p.stream_app||'rtp'),stream:String(p.stream_id||`${p.device_id}_${p.channel_id}`)};
    let actual=retired?false:await upstream.isRecording(stream);
    if(enabled&&!actual){
      // Reattaching a plan may leave an already-live stream's MP4 writer off.
      // Confirm ownership again before restoring only that stream's recorder.
      const confirmed=await upstream.recordingChannel(String(p.device_id),String(p.channel_id),planId);
      if(confirmed.planId&&confirmed.planId!==planId)fail('camera_recording_conflict',409);
      if(confirmed.planId===planId){await upstream.startRecording(stream);actual=await upstream.isRecording(stream);}
    }
    // An acknowledged link is not proof that recording has started/stopped.
    const actualStopped=!enabled&&!actual;
    const state=enabled?(actual?'recording':'pending'):(actual?'pending':storageBlocked?'error':'stopped');
    if(actualStopped)clock=await closeRecordingPeriod(tx,p,clock,upstream);
    await tx.execute(sql`update app.construction_camera_recording_policies set state=${state},stream_app=${stream.app},stream_id=${stream.stream},
      started_at=case when ${!!enabled} and started_at is null then now() else started_at end,
      stopped_at=case when ${actualStopped} then coalesce(stopped_at,now()) when ${!!enabled} then null else stopped_at end,
      last_error=${storageBlocked?storage.reason:null},storage_level=${storage.level},storage_checked_at=now(),checked_at=now() where enterprise_id=${eid} and binding_id=${bid}`);
    if(p.storage_level!==storage.level)await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
      values(${eid},${String(p.project_id)},'{"kind":"system"}'::jsonb,${'camera.storage.'+storage.level},${JSON.stringify({bindingId:bid,level:storage.level,reason:storage.reason,usedPercent:storage.usedPercent})}::jsonb)`);
    await reconcileRecordingIndex(tx,p,stream,upstream,nodeDays(),clock);
  });
}
export async function reconcileRecordings(upstream=cameraWvp()) {
  const due=await withPlatformTransaction(tx=>rows(tx,sql`select enterprise_id,binding_id from app.construction_camera_recording_policies order by checked_at nulls first,binding_id limit 100`));
  const storage=await refreshStorageHealth();
  for(const p of due){
    try{await reconcilePolicy(String(p.enterprise_id),String(p.binding_id),upstream,storage);}
    catch(e){await withTenantTransaction(String(p.enterprise_id),tx=>tx.execute(sql`update app.construction_camera_recording_policies set state='error',last_error=${errorCode(e)},checked_at=now() where binding_id=${String(p.binding_id)}`));}
  }
}
export async function listCameraRecordings(token:string,day:unknown,csrf?:string,bindingId?:string,before?:unknown) {
  const {eid}=parseCameraToken(token),{from,to}=shanghaiDay(day);
  if(bindingId){
    const mode=await withTenantTransaction(eid,async tx=>{const s=await cameraSession(tx,token,csrf);return one(tx,sql`select recording_mode from app.construction_camera_recording_policies where enterprise_id=${eid} and project_id=${s.pid} and binding_id=${id(bindingId)}`);});
    if(mode?.recording_mode==='sd')return listSdRecordings(token,csrf,day,bindingId,before);
  }
  return withTenantTransaction(eid,async tx=>{
    const s=await cameraSession(tx,token,csrf);
    const items=await rows(tx,sql`select r.id,r.binding_id,c.name,r.started_at,r.ended_at,r.bytes from app.construction_recordings r
      join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
      join app.construction_camera_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where r.enterprise_id=${eid} and r.project_id=${s.pid} and r.state='ready' and r.started_at>=${from} and r.started_at<${to}
      ${bindingId?sql`and r.binding_id=${id(bindingId)}`:sql``}
      and r.started_at+r.clock_offset_min_ms*interval '1 millisecond'>=now()-p.retention_days*interval '1 day' order by r.started_at limit 300`);
    const paused=await one(tx,sql`select p.last_error from app.construction_camera_recording_policies p
      join app.construction_camera_bindings b on b.enterprise_id=p.enterprise_id and b.id=p.binding_id
      where p.enterprise_id=${eid} and p.project_id=${s.pid} and b.ended_at is null and p.enabled and p.state='error'
      and p.last_error in ('camera_storage_low','camera_storage_unavailable') order by p.binding_id limit 1`);
    return {items,source:'cloud',sdAvailable:false,limit:300,recordingNotice:paused?.last_error??null};
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
    const row=await one(tx,sql`update app.construction_camera_sessions set recording_id=${rid},sd_playback_id=null,binding_id=${String(r.binding_id)},stream_id='recording',stream_app=null,view_expires_at=now()+interval '60 seconds',play_version=play_version+1 where token_hash=${hash} returning play_version`);
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
  const candidates=await withPlatformTransaction(tx=>rows(tx,sql`select r.id,r.enterprise_id,r.binding_id from app.construction_recordings r join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
    where r.state='deleting' or (r.state='ready' and r.ended_at+r.clock_offset_max_ms*interval '1 millisecond'<now()-p.retention_days*interval '1 day') order by r.ended_at limit 30`));
  for(const candidate of candidates){
    const eid=String(candidate.enterprise_id),rid=String(candidate.id);
    const record=await withTenantTransaction(eid,async tx=>{
      await lockRetentionDefault(tx,eid);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-recording:${candidate.binding_id}`},0))`);
      // Recheck the current effective policy after candidate selection. A default
      // extension must protect files that have not yet entered durable deletion.
      const r=await one(tx,sql`select r.* from app.construction_recordings r join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
        where r.id=${rid} and (r.state='deleting' or (r.state='ready' and r.ended_at+r.clock_offset_max_ms*interval '1 millisecond'<now()-p.retention_days*interval '1 day')) for update of r,p`);if(!r)return null;
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
