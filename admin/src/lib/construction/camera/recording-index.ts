import {sql} from 'drizzle-orm';
import type {PostgresTransaction} from '@/db/transaction';
import {one,type Row} from '@/db/repositories/assistant-repository';
import {fail} from '@/lib/assistant/contracts';
import {cloudRecording} from './recording-contract';
import type {CameraStream,WvpClient} from './wvp';
import {recordingDate,sampleRecordingClock,recordingSourceNow,type RecordingClock} from './recording-clock';

// Called under the binding's existing transaction/advisory lock. Open before
// starting media so the first file is covered; close only after confirmed stop.
export async function openRecordingPeriod(tx:PostgresTransaction,p:Row,clock:RecordingClock) {
  const existing=await one(tx,sql`select source_started_at from app.construction_camera_recording_periods where enterprise_id=${String(p.enterprise_id)} and binding_id=${String(p.binding_id)} and ended_at is null`);
  if(existing){if(!existing.source_started_at)fail('camera_recording_clock_unavailable',503);return;}
  const last=await one(tx,sql`select max(ended_at) last_end from app.construction_camera_recording_periods where enterprise_id=${String(p.enterprise_id)} and binding_id=${String(p.binding_id)}`);
  const requested=p.started_at?recordingDate(p.started_at):clock.business;
  const start=last?.last_end&&requested<=recordingDate(last.last_end)?clock.business:requested;
  await tx.execute(sql`insert into app.construction_camera_recording_periods(enterprise_id,project_id,binding_id,started_at,source_started_at,clock_offset_min_ms,clock_offset_max_ms)
    values(${String(p.enterprise_id)},${String(p.project_id)},${String(p.binding_id)},${start},${clock.source},${clock.min},${clock.max}) on conflict do nothing`);
}
export async function closeRecordingPeriod(tx:PostgresTransaction,p:Row,clock:RecordingClock,upstream:WvpClient) {
  if(!await one(tx,sql`select id from app.construction_camera_recording_periods where enterprise_id=${String(p.enterprise_id)} and binding_id=${String(p.binding_id)} and ended_at is null`))return clock;
  const end=await sampleRecordingClock(tx,upstream);
  await tx.execute(sql`update app.construction_camera_recording_periods set ended_at=greatest(started_at,${end.business}),source_ended_at=${recordingSourceNow(end)},
    clock_offset_min_ms=case when source_started_at is null then null else least(clock_offset_min_ms,${end.min}) end,
    clock_offset_max_ms=case when source_started_at is null then null else greatest(clock_offset_max_ms,${end.max}) end
    where enterprise_id=${String(p.enterprise_id)} and binding_id=${String(p.binding_id)} and ended_at is null`);
  return end;
}

export async function reconcileRecordingIndex(tx:PostgresTransaction,p:Row,stream:CameraStream,upstream:WvpClient,nodeDays:number,clock:RecordingClock) {
  const eid=String(p.enterprise_id),bid=String(p.binding_id),now=recordingSourceNow(clock);
  const first=await one(tx,sql`select min(source_started_at) first_start from app.construction_camera_recording_periods where enterprise_id=${eid} and binding_id=${bid}`);
  if(!first?.first_start)return;
  // Include one boundary segment beyond the node window for safe expiry cleanup.
  const floor=new Date(Math.max(recordingDate(first.first_start).getTime(),now.getTime()-nodeDays*86400000-3600000));
  const continuing=!!p.scan_to&&recordingDate(p.scan_to)>=floor;
  const sweep=continuing||!p.index_swept_at||clock.business.getTime()-recordingDate(p.index_swept_at).getTime()>=600000;
  const from=sweep?(continuing?new Date(Math.max(floor.getTime(),recordingDate(p.scan_from).getTime())):floor):new Date(Math.max(floor.getTime(),recordingDate(p.imported_until||floor).getTime()-1000));
  const to=sweep&&continuing?recordingDate(p.scan_to):now;
  let page=sweep&&continuing?Number(p.scan_page):1;
  let cursor=recordingDate(p.imported_until||floor),latest=p.last_segment_at?recordingDate(p.last_segment_at):null,done=false;
  // Bound provider/DB work per tick. Sweep snapshots resume after process loss;
  // a later full sweep heals records inserted behind an earlier offset page.
  for(let n=0;n<2;n++,page++){
    const batch=await upstream.cloudRecordings(stream,from,to,page);
    for(const value of batch.items){
      const r=cloudRecording(value,stream,now.getTime());
      if(r.mediaServerId!==(process.env.CAMERA_MEDIA_SERVER_ID||'wvp-zlm-01'))continue;
      if(r.start>cursor)cursor=r.start;
      // A media clock correction can overlap two periods in the same binding.
      // Keep the full possible offset range for conservative access/expiry.
      const owned=await one(tx,sql`select min(clock_offset_min_ms) clock_offset_min_ms,max(clock_offset_max_ms) clock_offset_max_ms from app.construction_camera_recording_periods where enterprise_id=${eid} and binding_id=${bid}
        and source_started_at<=${r.start} and (ended_at is null or source_ended_at>=${r.end})
        and ${r.start}::timestamptz+clock_offset_min_ms*interval '1 millisecond'>=${recordingDate(p.binding_start)}
        ${p.binding_end?sql`and ${r.end}::timestamptz+clock_offset_max_ms*interval '1 millisecond'<=${recordingDate(p.binding_end)}`:sql``}`);
      if(owned?.clock_offset_min_ms==null)continue;
      const collision=await one(tx,sql`select binding_id,file_path from app.construction_recordings where media_server_id=${r.mediaServerId} and source_id=${r.sourceId}`);
      if(collision&&(String(collision.binding_id)!==bid||collision.file_path!==r.filePath))fail('camera_recording_conflict',409);
      await tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,clock_offset_min_ms,clock_offset_max_ms)
        values(${eid},${String(p.project_id)},${bid},${r.sourceId},${r.mediaServerId},${r.app},${r.stream},${r.filePath},${r.start},${r.end},${r.bytes},${Number(owned.clock_offset_min_ms)},${Number(owned.clock_offset_max_ms)}) on conflict(media_server_id,source_id) do nothing`);
      if(!latest||r.end>latest)latest=r.end;
    }
    if(batch.items.length<100){done=true;break;}
  }
  await tx.execute(sql`update app.construction_camera_recording_policies set imported_until=${cursor},last_segment_at=${latest},
    scan_from=${sweep&&!done?from:null},scan_to=${sweep&&!done?to:null},scan_page=${sweep&&!done?page:1},
    index_swept_at=case when ${sweep&&done} then now() else index_swept_at end where enterprise_id=${eid} and binding_id=${bid}`);
}
