import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, id } from '@/lib/assistant/contracts';
import { cameraAccess, cameraSession, parseCameraToken } from './service';
import { cameraWvp, sdPlaybackStream } from './wvp';
import { shanghaiDay, wvpTime } from './recording-contract';
import { readSdClock, type SdClockReader } from './sd-clock';

const stamp = (v: unknown) => v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
const code = (e: unknown) => e instanceof AssistantError ? e.code : 'camera_service_unavailable';
export function sdTime(v: unknown) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v)) fail('camera_invalid_recording', 502);
  const d = new Date(v.replace(' ', 'T') + '+08:00');
  if (!Number.isFinite(d.getTime()) || wvpTime(d) !== v.replace('T', ' ')) fail('camera_invalid_recording', 502);
  return d;
}
async function sdBinding(tx: PostgresTransaction, eid: string, pid: string, bid: string) {
  const b = await one(tx, sql`select b.*,c.device_id,c.channel_id,c.name,p.sd_activated_at,p.state,p.recording_mode
    from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    join app.construction_camera_recording_policies p on p.enterprise_id=b.enterprise_id and p.binding_id=b.id
    where b.enterprise_id=${eid} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled
    and p.recording_mode='sd' and not p.enabled and p.sd_activated_at is not null for share of b,c`);
  if (!b) fail('camera_binding_unavailable', 404);
  if (b.state !== 'stopped') fail('camera_recording_busy', 409);
  return b;
}
export async function refreshSdWindow(tx: PostgresTransaction, b: Row, reader: SdClockReader = readSdClock) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-sd-clock:${b.id}`},0))`);
  const began = performance.now(), sample = await reader(String(b.device_id), String(b.channel_id));
  const now = stamp((await one(tx, sql`select clock_timestamp() t`))!.t), elapsed = Math.ceil(performance.now() - began);
  // Device seconds plus bounded request time and a two-second drift envelope.
  const min = now - sample.source.getTime() - elapsed - 3000, max = now - sample.source.getTime() + 2000;
  if (elapsed > 15000 || !Number.isFinite(min) || min < -60000 || max > 60000) fail('camera_sd_clock_unavailable', 503);
  const eid = String(b.enterprise_id), bid = String(b.id);
  const old = await one(tx, sql`select * from app.construction_camera_sd_windows where enterprise_id=${eid} and binding_id=${bid} and business_from>=${b.sd_activated_at as Date} order by id desc limit 1 for update`);
  const continuing = old && old.serial_hash === sample.serialHash && now - stamp(old.checked_at) <= 120000
    && Math.max(Number(old.clock_max_ms), max) - Math.min(Number(old.clock_min_ms), min) <= 10000;
  const low = continuing ? Math.min(Number(old.clock_min_ms), min) : min, high = continuing ? Math.max(Number(old.clock_max_ms), max) : max;
  const end = Math.floor((now - high) / 1000) * 1000;
  if (continuing) {
    const start=Math.max(stamp(old.source_from),Math.ceil((stamp(old.business_from)-low)/1000)*1000);
    await tx.execute(sql`update app.construction_camera_sd_windows set source_from=${new Date(start)},source_to=${new Date(Math.max(start,end))},checked_at=${new Date(now)},clock_min_ms=${low},clock_max_ms=${high} where id=${String(old.id)}`);
  } else {
    const start = Math.ceil((Math.max(now, stamp(b.started_at), stamp(b.sd_activated_at)) - low) / 1000) * 1000;
    await tx.execute(sql`insert into app.construction_camera_sd_windows(enterprise_id,project_id,binding_id,serial_hash,business_from,checked_at,source_from,source_to,clock_min_ms,clock_max_ms)
      values(${eid},${String(b.project_id)},${bid},${sample.serialHash},${new Date(now)},${new Date(now)},${new Date(start)},${new Date(Math.max(start,end))},${low},${high})`);
  }
  await tx.execute(sql`update app.construction_camera_recording_policies set sd_checked_at=now(),sd_last_error=null where binding_id=${bid}`);
  return { serialHash: sample.serialHash, clockMin: min, clockMax: max };
}
export async function refreshSdWindows(reader: SdClockReader = readSdClock) {
  const due = await withPlatformTransaction(tx => rows(tx, sql`select p.enterprise_id,p.project_id,p.binding_id from app.construction_camera_recording_policies p
    join app.construction_camera_bindings b on b.enterprise_id=p.enterprise_id and b.id=p.binding_id
    join app.construction_projects j on j.enterprise_id=p.enterprise_id and j.id=p.project_id
    join app.enterprises e on e.id=p.enterprise_id join app.leads l on l.enterprise_id=j.enterprise_id and l.id=j.lead_id
    where p.recording_mode='sd' and p.state='stopped' and b.ended_at is null and j.status='active' and e.status='active' and l.archived_at is null
    and (p.sd_checked_at is null or p.sd_checked_at<now()-interval '30 seconds') order by p.sd_checked_at nulls first limit 20`));
  for (const p of due) {
    const eid = String(p.enterprise_id), bid = String(p.binding_id);
    try {
      await withTenantTransaction(eid, async tx => {
        const b = await sdBinding(tx,eid,String(p.project_id),bid);
        const available = await one(tx,sql`select p.id from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id join app.enterprises e on e.id=p.enterprise_id where p.id=${String(p.project_id)} and p.enterprise_id=${eid} and p.status='active' and l.archived_at is null and e.status='active'`);
        if (!available) return;
        await refreshSdWindow(tx,b,reader);
      });
    } catch (e) { await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_camera_recording_policies set sd_last_error=${code(e)},sd_checked_at=now() where binding_id=${bid}`)); }
  }
}
export async function listSdRecordings(token: string, csrf: string | undefined, day: unknown, bindingId: string, before?: unknown, upstream = cameraWvp(), reader: SdClockReader = readSdClock) {
  const { eid } = parseCameraToken(token), bid = id(bindingId), { from, to } = shanghaiDay(day);
  const cursor = before === undefined ? to.getTime() : typeof before === 'string' ? Date.parse(before) : NaN;
  if (!Number.isFinite(cursor) || cursor <= from.getTime() || cursor > to.getTime()) fail('camera_invalid_date',422);
  const context = await withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx,token,csrf), b = await sdBinding(tx,eid,s.pid,bid);
    const sample=await refreshSdWindow(tx,b,reader);
    const windows = await rows(tx,sql`select * from app.construction_camera_sd_windows where enterprise_id=${eid} and binding_id=${bid}
      and business_from>=${b.sd_activated_at as Date} and serial_hash=${sample.serialHash} and source_to>source_from and source_from<${new Date(cursor)} and source_to>${from} order by source_to desc limit 1000`);
    const end = Math.min(cursor,...(windows.length ? [stamp(windows[0].source_to)] : [cursor]));
    const start = Math.max(from.getTime(),end-3600000);
    return { b, windows, pid:s.pid, start, end };
  });
  const { b, windows, start, end } = context;
  if (!windows.length || end<=start) return { items:[], source:'sd', sdAvailable:true, nextBefore:null, limit:300,recordingNotice:null };
  const source = await upstream.sdRecordings(String(b.device_id),String(b.channel_id),new Date(start),new Date(end));
  const segments: {start:number;end:number;window:Row}[] = [];
  for (const raw of source) {
    if (raw.deviceId !== String(b.device_id)) fail('camera_invalid_recording',502);
    const a = sdTime(raw.startTime).getTime(), z = sdTime(raw.endTime).getTime();
    if (z<=a) fail('camera_invalid_recording',502);
    for (const w of windows) {
      const low = Math.max(a,start,stamp(w.source_from)), high = Math.min(z,end,stamp(w.source_to));
      for (let s=low;s<high;) {
        if (segments.length>=300) fail('camera_sd_query_too_large',503);
        const next=Math.min(high,(Math.floor(s/300000)+1)*300000);
        if (next-s>=1000) segments.push({start:s,end:next,window:w});
        s=next;
      }
    }
  }
  const items = await withTenantTransaction(eid,async tx=>{
    const s = await cameraSession(tx,token,csrf); await sdBinding(tx,eid,s.pid,bid);
    const result:Row[] = [];
    for (const clip of segments) {
      const saved = await one(tx,sql`insert into app.construction_camera_sd_recordings(enterprise_id,project_id,binding_id,window_id,started_at,ended_at,expires_at)
        values(${eid},${s.pid},${bid},${String(clip.window.id)},${new Date(clip.start)},${new Date(clip.end)},now()+interval '2 minutes')
        on conflict(window_id,started_at,ended_at) do update set expires_at=excluded.expires_at returning id,binding_id,started_at,ended_at`);
      if (!result.some(r=>r.id===saved!.id)) result.push({...saved,name:b.name,source:'sd'});
    }
    return result.sort((a,b)=>stamp(a.started_at)-stamp(b.started_at));
  });
  return { items, source:'sd', sdAvailable:true, limit:300,recordingNotice:null, queriedFrom:new Date(start).toISOString(),queriedTo:new Date(end).toISOString(),
    nextBefore:windows.some(w=>stamp(w.source_from)<start&&stamp(w.source_to)>from.getTime())?new Date(start).toISOString():null };
}
async function sdRecord(tx:PostgresTransaction,eid:string,pid:string,rid:string,fresh=false) {
   const r = await one(tx,sql`select r.*,c.device_id,c.channel_id,w.serial_hash,w.clock_min_ms,w.clock_max_ms from app.construction_camera_sd_recordings r
    join app.construction_camera_sd_windows w on w.enterprise_id=r.enterprise_id and w.id=r.window_id
    join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id
    join app.construction_camera_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    where r.enterprise_id=${eid} and r.project_id=${pid} and r.id=${rid} and b.ended_at is null and c.enabled
    and p.recording_mode='sd' and p.state='stopped' and not p.enabled and w.business_from>=p.sd_activated_at
    and r.started_at>=w.source_from and r.ended_at<=w.source_to ${fresh?sql`and r.expires_at>now()`:sql``} for share of b,c,p,r,w`);
  if (!r) fail('camera_recording_unavailable',404);return r;
}
export async function startSdRecordingView(token:string,csrf:string,recordingId:string,upstream=cameraWvp(),reader:SdClockReader=readSdClock) {
  const {eid,hash}=parseCameraToken(token),rid=id(recordingId);
  const r = await withTenantTransaction(eid,async tx=>{
    const s=await cameraSession(tx,token,csrf),record=await sdRecord(tx,eid,s.pid,rid,true);
    const sample=await refreshSdWindow(tx,await sdBinding(tx,eid,s.pid,String(record.binding_id)),reader);
    if(record.serial_hash!==sample.serialHash||Math.max(Number(record.clock_max_ms),sample.clockMax)-Math.min(Number(record.clock_min_ms),sample.clockMin)>10000)fail('camera_recording_unavailable',404);
    return record;
  });
  // A cached SD index can already have been overwritten. No start on an empty,
  // partial, failed or mismatched re-query, and never a second unknown start.
  const actual = await upstream.sdRecordings(String(r.device_id),String(r.channel_id),new Date(stamp(r.started_at)),new Date(stamp(r.ended_at)));
  if (!actual.some(a=>a.deviceId===r.device_id&&sdTime(a.startTime).getTime()<=stamp(r.started_at)&&sdTime(a.endTime).getTime()>=stamp(r.ended_at))) fail('camera_recording_unavailable',404);
  const stream=sdPlaybackStream(String(r.device_id),String(r.channel_id),new Date(stamp(r.started_at)),new Date(stamp(r.ended_at)));
  const claim = await withTenantTransaction(eid,async tx=>{
    const s=await cameraSession(tx,token,csrf);await sdRecord(tx,eid,s.pid,rid,true);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-sd-stream:${stream.stream}`},0))`);
    const old=await one(tx,sql`select *,stop_after>clock_timestamp() shared_live from app.construction_camera_sd_playbacks where stream_id=${stream.stream} for update`);
    if (old && (String(old.binding_id)!==String(r.binding_id)||!['active','stopped'].includes(String(old.state)))) fail('camera_playback_busy',409);
    const shared=old?.state==='active'&&old.shared_live===true;
    if (!shared && await upstream.mediaExists(stream)) fail('camera_playback_busy',409);
    if (old?.state==='active'&&!shared) fail('camera_playback_busy',409);
    const playback = shared?old:await one(tx,sql`insert into app.construction_camera_sd_playbacks(enterprise_id,project_id,binding_id,recording_id,device_id,channel_id,stream_app,stream_id,stop_after)
      values(${eid},${s.pid},${String(r.binding_id)},${rid},${String(r.device_id)},${String(r.channel_id)},${stream.app},${stream.stream},now()+(${Math.ceil((stamp(r.ended_at)-stamp(r.started_at))/1000)+45})*interval '1 second')
      on conflict(stream_id) do update set state='starting',created_at=now(),stop_after=excluded.stop_after,stopped_at=null,last_error=null returning *`);
    const n=await one(tx,sql`update app.construction_camera_sessions set recording_id=null,sd_playback_id=${String(playback!.id)},binding_id=${String(r.binding_id)},
      stream_app=${shared?stream.app:null},stream_id=${shared?stream.stream:null},view_expires_at=${shared?sql`least(now()+interval '60 seconds',${playback!.stop_after as Date})`:sql`null`},play_version=play_version+1 where token_hash=${hash} returning play_version`);
    return {id:String(playback!.id),generation:Number(n!.play_version),shared};
  });
  if (!claim.shared) {
    try {
      await upstream.startSdPlayback(String(r.device_id),String(r.channel_id),new Date(stamp(r.started_at)),new Date(stamp(r.ended_at)));
      await withTenantTransaction(eid,async tx=>{
        const s=await cameraSession(tx,token,csrf);await sdRecord(tx,eid,s.pid,rid);
        if(Number(s.play_version)!==claim.generation||String(s.sd_playback_id)!==claim.id)fail('camera_play_superseded',409);
        const p=await one(tx,sql`update app.construction_camera_sd_playbacks set state='active' where id=${claim.id} and state='starting' returning stop_after`);
        if(!p)fail('camera_play_superseded',409);
        await tx.execute(sql`update app.construction_camera_sessions set stream_app=${stream.app},stream_id=${stream.stream},view_expires_at=least(now()+interval '60 seconds',${p.stop_after as Date}) where token_hash=${hash}`);
      });
    } catch(e) {
      await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_camera_sd_playbacks set last_error=${code(e)} where id=${claim.id}`));
      throw e;
    }
  }
  return {source:'sd',generation:claim.generation,flv:`/camera-media/${claim.generation}/live.flv`,hls:`/camera-media/${claim.generation}/hls.m3u8`,startedAt:r.started_at,endedAt:r.ended_at};
}
export async function authorizeSdMedia(tx:PostgresTransaction,s:Row) {
  const p=await one(tx,sql`select * from app.construction_camera_sd_playbacks where enterprise_id=${s.eid as string} and project_id=${s.pid as string} and id=${String(s.sd_playback_id)} and state='active' and stop_after>now()`);
  if(!p||p.stream_id!==s.stream_id||p.stream_app!==s.stream_app)fail('camera_view_expired',401);
  await sdRecord(tx,String(s.eid),String(s.pid),String(p.recording_id));
  return {app:String(p.stream_app),stream:String(p.stream_id)};
}
export async function reconcileSdPlaybacks(upstream=cameraWvp(),playbackId?:string) {
  const due=await withPlatformTransaction(tx=>rows(tx,sql`select id,enterprise_id,stream_id from app.construction_camera_sd_playbacks where state<>'stopped' ${playbackId?sql`and id=${id(playbackId)}`:sql``} order by created_at limit 100`));
  for(const candidate of due){
    const eid=String(candidate.enterprise_id);
    try {
      const obligation=await withTenantTransaction(eid,async tx=>{
        if(!(await one(tx,sql`select pg_try_advisory_xact_lock(hashtextextended(${`camera-sd-stream:${candidate.stream_id}`},0)) ok`))?.ok)return null;
        const p=await one(tx,sql`select *,created_at>clock_timestamp()-interval '45 seconds' startup_pending,stop_after>clock_timestamp() lease_live from app.construction_camera_sd_playbacks where id=${String(candidate.id)} and state<>'stopped' for update`);if(!p)return null;
        if(p.state==='starting'&&p.startup_pending)return null;
        const viewers=await rows(tx,sql`select * from app.construction_camera_sessions where enterprise_id=${eid} and sd_playback_id=${String(p.id)} and closed_at is null
          and expires_at>now() and absolute_expires_at>now() and view_expires_at>now()`);
        let valid=false;
        if(p.state==='active'&&p.lease_live)for(const s of viewers){
          try { await cameraAccess(tx,s.actor as Parameters<typeof cameraAccess>[1],String(s.project_id));await sdRecord(tx,eid,String(s.project_id),String(p.recording_id));valid=true; }
          catch(e){
            if(!(e instanceof AssistantError)||![401,403,404,409].includes(e.status))throw e;
            await tx.execute(sql`update app.construction_camera_sessions set sd_playback_id=null,stream_id=null,view_expires_at=null,play_version=play_version+1 where token_hash=${String(s.token_hash)}`);
          }
        }
        if(valid)return null;
        // Commit revocation and STOP intent before the provider operation. An
        // unknown STOP must never restore a viewer or become a shareable start.
        await tx.execute(sql`update app.construction_camera_sd_playbacks set state='stopping' where id=${String(p.id)}`);
        await tx.execute(sql`update app.construction_camera_sessions set sd_playback_id=null,stream_id=null,view_expires_at=null,play_version=play_version+1 where enterprise_id=${eid} and sd_playback_id=${String(p.id)}`);
        return p;
      });
      if(!obligation)continue;
      await withTenantTransaction(eid,async tx=>{
        if(!(await one(tx,sql`select pg_try_advisory_xact_lock(hashtextextended(${`camera-sd-stream:${candidate.stream_id}`},0)) ok`))?.ok)return;
        const p=await one(tx,sql`select * from app.construction_camera_sd_playbacks where id=${String(candidate.id)} and state='stopping' for update`);if(!p)return;
        await upstream.stopSdPlayback(String(p.device_id),String(p.channel_id),String(p.stream_id));
        if(await upstream.mediaExists({app:String(p.stream_app),stream:String(p.stream_id)}))fail('camera_playback_stop_unconfirmed',503);
        await tx.execute(sql`update app.construction_camera_sd_playbacks set state='stopped',stopped_at=now(),last_error=null where id=${String(p.id)}`);
      });
    } catch(e){await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_camera_sd_playbacks set last_error=${code(e)} where id=${String(candidate.id)}`));}
  }
}
