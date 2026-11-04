import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, id, type ActorContext } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '../contracts';
import { liveDto, liveSource, staffLiveAccess } from './store';
import { liveKey, liveResource } from './contract';
import { publicLiveUpstream, type LiveUpstream } from './upstream';
import { liveMediaCorsHeaders } from './media-cors';
import { liveMediaDiagnostics } from './media-diagnostics';

export type LiveViewer={kind:'public'}|{kind:'owner';actor:ActorContext;conversationId:string;previewRevision?:number}|{kind:'staff';actor:ConstructionActor;projectId:string};
type Source=NonNullable<Awaited<ReturnType<typeof liveSource>>>;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function playbackUrl(path:string){
  const configured=process.env.PUBLIC_LIVE_PUBLIC_ORIGIN;if(!configured)return path;
  let u:URL;try{u=new URL(configured);}catch{fail('public_live_not_configured',503);}
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))fail('public_live_not_configured',503);
  return u.origin+path;
}
const lock=(tx:PostgresTransaction,eid:string,lid:string)=>tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`public-live-media:${eid}:${lid}`},0))`);
async function authorize(tx:PostgresTransaction,eid:string,lid:string,vid:string,viewer:LiveViewer,ownerLock:'update'|'share'='update'):Promise<Source> {
  // Match the policy -> consultation -> grant order of the write paths.
  // Only an existing owner session's read checks opt into shared locks.
  if(viewer.kind==='staff'){
    if(viewer.actor.enterpriseId!==eid)fail('public_live_unavailable',404);
    await staffLiveAccess(tx,viewer.actor,viewer.projectId);
  }else if(viewer.kind==='owner'){
    if(viewer.actor.enterpriseId!==eid||viewer.actor.principal.kind!=='user')fail('public_live_unavailable',404);
    const r=new AssistantRepository(tx,viewer.actor);await r.settings(false,ownerLock);const c=await r.conversation(viewer.conversationId,ownerLock);
    if(c.purpose!=='customer_consultation'||viewer.previewRevision!==undefined&&c.status!=='open')fail('public_live_unavailable',404);
  }
  const s=await liveSource(tx,eid,lid,vid);
  if(!s||['withdrawn','rejected','declined'].includes(String(s.live.status)))fail('public_live_unavailable',404);
  const l=s.live;
  if(viewer.kind==='public'){
    if(l.status!=='published'||!l.reviewed_by||String(l.consented_version_id)!==vid||String(l.consented_by)!==String(l.customer_id))fail('public_live_unavailable',404);
  }else if(viewer.kind==='staff'){
    if(viewer.projectId!==String(l.project_id))fail('public_live_unavailable',404);
  }else{
    if(viewer.actor.principal.kind!=='user'||viewer.actor.principal.userId!==String(l.customer_id)||viewer.conversationId!==String(l.conversation_id)||l.status==='draft')fail('public_live_unavailable',404);
    if(viewer.previewRevision!==undefined&&(l.status!=='pending_owner'||Number(l.revision)!==viewer.previewRevision||String(l.previewed_version_id)!==vid))fail('public_live_unavailable',404);
  }
  return s;
}
async function ensureProxy(eid:string,lid:string,vid:string,viewer:LiveViewer,upstream:LiveUpstream) {
  const intent=await withTenantTransaction(eid,async tx=>{
    await lock(tx,eid,lid);const source=await authorize(tx,eid,lid,vid,viewer);
    const prior=await one(tx,sql`select * from app.construction_public_live_proxies where enterprise_id=${eid} and live_id=${lid} and version_id=${vid} and state not in('failed','stopped') for update`);
    if(prior)return {proxy:prior,source,owned:false};
    const stream=randomBytes(24).toString('hex'),app='sfp_public_live';
    const p=(await one(tx,sql`insert into app.construction_public_live_proxies(enterprise_id,project_id,live_id,version_id,app,stream,ownership_key,state,expires_at)
      values(${eid},${String(source.live.project_id)},${lid},${vid},${app},${stream},${'__defaultVhost__/'+app+'/'+stream},'starting',now()+interval '6 minutes') returning *`))!;
    return {proxy:p,source,owned:true};
  });
  const p=intent.proxy;
  if(!intent.owned&&p.state!=='ready')fail(p.state==='unknown'?'public_live_media_unknown':'public_live_connecting',503);
  if(intent.owned){
    try{
      const source=await upstream.source(eid,String(intent.source.version.binding_id),String(intent.source.source.device_id),String(intent.source.source.channel_id));
      await withTenantTransaction(eid,async tx=>{
        await lock(tx,eid,lid);await authorize(tx,eid,lid,vid,viewer);
        const current=await one(tx,sql`select state from app.construction_public_live_proxies where enterprise_id=${eid} and id=${String(p.id)} for update`);
        if(current?.state!=='starting')fail('public_live_unavailable',404);
        // Keep the same grant/frame locks through the one provider create. A
        // concurrent stop cannot confirm absence before a delayed create ends.
        await upstream.create(String(p.app),String(p.stream),source);
        let ready=false;
        for(let n=0;n<24;n++){
          await tx.execute(sql`select 1`);
          const observed=await upstream.inspect(String(p.app),String(p.stream));
          if(observed.silent){ready=true;break;}
          await delay(250);
        }
        if(!ready)fail('public_live_tracks_unverified',503);
        await tx.execute(sql`update app.construction_public_live_proxies set state='ready',start_finished_at=now(),updated_at=now() where enterprise_id=${eid} and id=${String(p.id)}`);
      });
    }catch(error){
      await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_public_live_proxies set state=case when state='starting' then 'unknown' else state end,
        error_code=${error instanceof AssistantError?error.code:'public_live_media_unknown'},start_finished_at=now(),updated_at=now() where enterprise_id=${eid} and id=${String(p.id)}`));
      throw error;
    }
  }else{
    const observed=await upstream.inspect(String(p.app),String(p.stream));
    if(!observed.silent)fail('public_live_tracks_unverified',503);
  }
  return p;
}
export async function openLiveSession(eid:string,lid:string,vid:string,viewer:LiveViewer,upstream=publicLiveUpstream()) {
  [eid,lid,vid].forEach(id);
  const p=await ensureProxy(eid,lid,vid,viewer,upstream);
  return withTenantTransaction(eid,async tx=>{
    await lock(tx,eid,lid);const s=await authorize(tx,eid,lid,vid,viewer);
    const current=await one(tx,sql`select id from app.construction_public_live_proxies where enterprise_id=${eid} and id=${String(p.id)} and state='ready' and expires_at>now() for update`);
    if(!current)fail('public_live_media_unavailable',503);
    if(viewer.kind==='owner'&&viewer.previewRevision!==undefined)await tx.execute(sql`delete from app.construction_public_live_sessions
      where enterprise_id=${eid} and live_id=${lid} and audience='owner' and actor ? 'previewRevision'`);
    const count=await one(tx,sql`select count(*) as n from app.construction_public_live_sessions where enterprise_id=${eid} and live_id=${lid} and expires_at>now()`);
    if(Number(count?.n)>=200)fail('public_live_busy',429);
    const token=randomBytes(32).toString('base64url');
    await tx.execute(sql`insert into app.construction_public_live_sessions(token_hash,enterprise_id,project_id,live_id,version_id,revision,proxy_id,audience,actor,expires_at)
      values(${hash(token)},${eid},${String(s.live.project_id)},${lid},${vid},${Number(s.live.revision)},${String(p.id)},${viewer.kind},${JSON.stringify(viewer)}::jsonb,now()+interval '2 minutes')`);
    await tx.execute(sql`update app.construction_public_live_proxies set expires_at=now()+interval '6 minutes' where enterprise_id=${eid} and id=${String(p.id)}`);
    return {key:String(s.live.public_key),versionId:vid,revision:Number(s.live.revision),expiresInSeconds:120,
      url:playbackUrl(`/api/public/construction-live/${eid}/${String(s.live.public_key)}/media/${token}/hls.m3u8`)};
  });
}
async function session(eid:string,key:string,token:string,update?:'segment'|'played') {
  id(eid);liveKey(key);if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('public_live_unavailable',404);
  return withTenantTransaction(eid,async tx=>{
    const row=await one(tx,sql`select s.*,p.app,p.stream from app.construction_public_live_sessions s
      join app.construction_public_live l on l.enterprise_id=s.enterprise_id and l.id=s.live_id and l.public_key=${key}
      join app.construction_public_live_proxies p on p.enterprise_id=s.enterprise_id and p.id=s.proxy_id and p.state='ready' and p.expires_at>now()
      where s.enterprise_id=${eid} and s.token_hash=${hash(token)} and s.expires_at>now()`);
    if(!row)fail('public_live_unavailable',404);
    const s=await authorize(tx,eid,String(row.live_id),String(row.version_id),row.actor as LiveViewer,'share');
    if(Number(s.live.revision)!==Number(row.revision))fail('public_live_unavailable',404);
    const viewer=row.actor as LiveViewer|null;
    if(update==='played'){
      if(viewer?.kind!=='owner'||viewer.previewRevision===undefined||!row.first_segment_at)fail('public_live_preview_required',422);
      if(!await one(tx,sql`update app.construction_public_live_sessions set played_at=coalesce(played_at,clock_timestamp())
        where enterprise_id=${eid} and token_hash=${hash(token)} returning token_hash`))fail('public_live_unavailable',404);
    }else if(update==='segment'&&viewer?.kind==='owner'&&viewer.previewRevision!==undefined&&!row.first_segment_at){
      await tx.execute(sql`update app.construction_public_live_sessions set first_segment_at=now()
        where enterprise_id=${eid} and token_hash=${hash(token)} and first_segment_at is null`);
    }
    return row;
  });
}
export async function recordOwnerPlayback(eid:string,key:string,token:string) {
  await session(eid,key,token,'played');
  return {played:true};
}
export function rewriteLivePlaylist(text:string,source:URL,app:string,stream:string,prefix:string) {
  if(!text.startsWith('#EXTM3U')||text.length>262144||/#EXT-X-(?:KEY|MAP):/.test(text))fail('public_live_invalid_playlist',502);
  const base=`/${app}/${stream}/`;
  const rewrite=(value:string)=>{
    const u=new URL(value,source);
    if(u.origin!==source.origin||!u.pathname.startsWith(base)||u.search||u.hash)fail('public_live_invalid_playlist',502);
    return prefix+'/'+liveResource(u.pathname.slice(base.length));
  };
  return text.split(/\r?\n/).map(line=>!line||line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,value)=>`URI="${rewrite(value)}"`):rewrite(line.trim())).join('\n');
}
const mediaHeaders={...liveMediaCorsHeaders,'Cache-Control':'no-store, private, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const SEGMENT_OUTPUT_BYTES = 128 * 1024;
/** Every bounded playlist/segment and each response chunk rechecks the live grant. */
export async function publicLiveMedia(request:Request,eid:string,key:string,token:string,resource:string,upstream=publicLiveUpstream()) {
  liveResource(resource);
  // Keep the existing transport deadline after initial authorization, while
  // distinguishing an authorization/DB failure before an upstream call too.
  const abort=new AbortController(),signals={combined:request.signal,caller:request.signal,timeout:abort.signal};
  const diagnostic=liveMediaDiagnostics(resource,signals);
  let s:Awaited<ReturnType<typeof session>>;
  try{s=await session(eid,key,token);}
  catch(error){diagnostic.failure('authorization',error instanceof AssistantError?'authorization_denied':'authorization_error');throw error;}
  // HLS clients may send Range even for a playlist. Return the same bounded
  // live resource in full; Range never bypasses grant or source checks.
  signals.timeout=AbortSignal.timeout(15000);
  const signal=signals.combined=AbortSignal.any([abort.signal,request.signal,signals.timeout]);
  let response:Response;
  try{response=await upstream.media(String(s.app),String(s.stream),resource,signal);}
  catch(error){diagnostic.failure('headers');throw error;}
  diagnostic.headers(response);
  if(!response.ok||!response.body)fail('public_live_media_unavailable',503);
  if(resource.endsWith('.m3u8')){
    let phase:'body'|'authorization'|'validation'='body';
    try{
      const text=await response.text();diagnostic.addBytes(Buffer.byteLength(text));
      phase='authorization';await session(eid,key,token);
      phase='validation';
      const source=new URL(response.url||`http://media.invalid/${s.app}/${s.stream}/${resource}`);
      const prefix=`/api/public/construction-live/${eid}/${key}/media/${token}`;
      const playlist=rewriteLivePlaylist(text,source,String(s.app),String(s.stream),prefix);
      diagnostic.complete();
      return new Response(playlist,{headers:{...mediaHeaders,'Content-Type':'application/vnd.apple.mpegurl'}});
    }catch(error){
      diagnostic.failure(phase,phase==='authorization'?(error instanceof AssistantError?'authorization_denied':'authorization_error'):phase==='validation'?'invalid_media':'transport_error');
      throw error;
    }
  }
  const reader = response.body.getReader();
  let bytes = 0;
  let remainder: Uint8Array | undefined;
  let ended = false;

  // Transport chunk sizes can vary with the relay or network. Use a bounded
  // output size so a split upstream packet does not add a database round trip.
  async function readBlock() {
    if (ended) return null;
    const block = new Uint8Array(SEGMENT_OUTPUT_BYTES);
    let written = 0;
    while (written < block.length) {
      signal.throwIfAborted();
      if (!remainder?.length) {
        const part = await reader.read();
        if (part.done) {
          ended = true;
          break;
        }
        remainder = part.value;
      }
      const count = Math.min(remainder.length, block.length - written);
      block.set(remainder.subarray(0, count), written);
      written += count;
      remainder = count < remainder.length ? remainder.subarray(count) : undefined;
    }
    return written ? block.subarray(0, written) : null;
  }

  const body=new ReadableStream<Uint8Array>({
    async pull(controller){
      let phase:'authorization'|'body'|'validation'='body';
      try{
        signal.throwIfAborted();
        const block = await readBlock();
        signal.throwIfAborted();
        // The request was authorized before opening upstream. Check again at
        // the output boundary, including after a stalled upstream read.
        phase='authorization';
        await session(eid,key,token,!block&&bytes>0?'segment':undefined);
        phase='body';
        signal.throwIfAborted();
        if(!block){diagnostic.complete();controller.close();return;}
        phase='validation';
        bytes+=block.byteLength;if(bytes>16*1024*1024)fail('public_live_invalid_media',502);
        diagnostic.addBytes(block.byteLength);
        controller.enqueue(block);
      }catch(error){
        diagnostic.failure(phase,phase==='authorization'?(error instanceof AssistantError?'authorization_denied':'authorization_error'):phase==='validation'?'invalid_media':'transport_error');
        abort.abort();await reader.cancel().catch(()=>undefined);controller.error(error);
      }
    },async cancel(){diagnostic.cancel();abort.abort();await reader.cancel().catch(()=>undefined);},
  });
  return new Response(body,{headers:{...mediaHeaders,'Content-Type':resource.endsWith('.ts')?'video/mp2t':'video/mp4'}});
}
export async function stopLiveProxies(eid:string,lid:string,upstream=publicLiveUpstream()) {
  const proxies=await withTenantTransaction(eid,async tx=>{
    await lock(tx,eid,lid);
    await tx.execute(sql`delete from app.construction_public_live_sessions where enterprise_id=${eid} and live_id=${lid}`);
    return rows(tx,sql`update app.construction_public_live_proxies set state='stopping',updated_at=now() where enterprise_id=${eid} and live_id=${lid} and state not in('failed','stopped') returning *`);
  });
  for(const p of proxies){
    // A lost starter may still have an in-flight provider call. Keep its stop
    // obligation (and camera guard) until its bounded request window closes.
    if(!p.start_finished_at&&new Date(String(p.created_at)).getTime()>Date.now()-45000)return {stopped:false};
    try{
      await upstream.remove(String(p.app),String(p.stream),String(p.ownership_key));
      await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_public_live_proxies set state='stopped',error_code='',updated_at=now() where enterprise_id=${eid} and id=${String(p.id)}`));
    }catch{
      await withTenantTransaction(eid,tx=>tx.execute(sql`update app.construction_public_live_proxies set error_code='public_live_stop_unconfirmed',updated_at=now() where enterprise_id=${eid} and id=${String(p.id)}`));
      return {stopped:false};
    }
  }
  return {stopped:true};
}
/** Owned background duty only; safe after restart, never replays a create. */
export async function reconcileLiveProxies(upstream=publicLiveUpstream()) {
  const due=await withPlatformTransaction(tx=>rows(tx,sql`select p.*,l.current_version_id,l.status from app.construction_public_live_proxies p
    join app.construction_public_live l on l.enterprise_id=p.enterprise_id and l.id=p.live_id
    where p.state not in('stopped','failed') order by p.updated_at limit 50`));
  let stopped=0;
  for(const p of due){
    const eid=String(p.enterprise_id),lid=String(p.live_id);
    const valid=await withTenantTransaction(eid,tx=>liveSource(tx,eid,lid,String(p.version_id)));
    if(!valid||['withdrawn','declined','rejected'].includes(String(p.status))||new Date(String(p.expires_at)).getTime()<=Date.now()||['unknown','stopping'].includes(String(p.state))){
      if((await stopLiveProxies(eid,lid,upstream)).stopped)stopped++;
    }else if(p.state==='starting'&&new Date(String(p.updated_at)).getTime()<Date.now()-30000){
      // A dead starter's relay is closed by exact ownership, not recreated.
      if((await stopLiveProxies(eid,lid,upstream)).stopped)stopped++;
    }
  }
  return {stopped};
}
export async function publicLiveDetail(eid:string,key:string) {
  id(eid);liveKey(key);
  return withTenantTransaction(eid,async tx=>{
    const l=await one(tx,sql`select id,current_version_id from app.construction_public_live where enterprise_id=${eid} and public_key=${key}`);
    if(!l)fail('public_live_unavailable',404);
    const s=await authorize(tx,eid,String(l.id),String(l.current_version_id),{kind:'public'});
    const dto=liveDto(s.live,s.version);
    return {key:dto.key,versionId:dto.versionId,revision:dto.revision,name:dto.name,alias:dto.alias,audience:dto.audience,scope:dto.scope,status:'approved'};
  });
}
