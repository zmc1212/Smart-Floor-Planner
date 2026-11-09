import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { withTenantTransaction, withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key } from '@/lib/assistant/contracts';
import { constructionAccess } from '../service';
import { object, text, version, type ConstructionActor } from '../contracts';
import { cameraWvp, gbId, type WvpClient } from './wvp';
import {currentStorageHealth} from './storage';
import {guardLiveWriter} from './writer-policy';
import {authorizeSdMedia,reconcileSdPlaybacks} from './sd';
import {retentionDefault,nodeRetentionDays} from './retention-defaults';
import { cameraAccess, cameraActorRef, isCameraCustomer, type CameraActor } from './access';
import { currentCameraCustomerGrant } from './customer-grants';
import { privateSnapshot, retainedSnapshot, snapshotRetentionJoins } from './snapshot-retention';
export { cameraAccess } from './access';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export const cameraCookie = 'construction_camera_session';
export function parseCameraToken(value: string) {
  const m = /^([1-9]\d{0,18})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) fail('camera_session_expired', 401);
  return { eid: m[1], hash: digest(value) };
}
export function cameraPublicOrigin() {
  let u: URL;
  try { u = new URL(process.env.CAMERA_PUBLIC_ORIGIN || ''); } catch { fail('camera_not_configured', 503); }
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash ||
    (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(u.hostname)))) fail('camera_not_configured', 503);
  return u.origin;
}
async function activeOrder(tx: PostgresTransaction, eid: string, pid: string) {
  return await one(tx, sql`select o.id,o.status,o.camera_count,
    (select count(*) from app.construction_camera_bindings b
      where b.enterprise_id=o.enterprise_id and b.project_id=o.project_id and b.ended_at is null) bound
    from app.construction_service_orders o
    where o.enterprise_id=${eid} and o.project_id=${pid} and o.status<>'cancelled' order by o.id desc limit 1`);
}
async function binding(tx: PostgresTransaction, eid: string, pid: string, bindingId: string) {
  const r = await one(tx, sql`select b.id as binding_id,c.* from app.construction_camera_bindings b
    join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    where b.enterprise_id=${eid} and b.project_id=${pid} and b.id=${id(bindingId)} and b.ended_at is null and c.enabled for share of b,c`);
  if (!r) fail('camera_binding_unavailable', 404);
  return r;
}
async function audit(tx: PostgresTransaction, actor: CameraActor, pid: string, action: string, snapshot: Row) {
  await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
    values(${actor.enterpriseId},${pid},${JSON.stringify(cameraActorRef(actor))}::jsonb,${'camera.' + action},${JSON.stringify(snapshot)}::jsonb)`);
}
export class CameraService {
  constructor(readonly actor: ConstructionActor, private readonly upstream?: WvpClient) {}
  private wvp() { return this.upstream || cameraWvp(); }
  async inventory(projectId?: string) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const owner = await constructionAccess(tx, this.actor);
      if (!owner && (!projectId || !(await cameraAccess(tx, this.actor, projectId)).manage)) fail('camera_forbidden', 403);
      const platform = await withPlatformTransaction(p => one(p, sql`select id from app.admin_users where id=${this.actor.adminId} and status='active' and role in ('admin','super_admin')`));
      return { canRegister: !!platform, items: await rows(tx, sql`select c.id,c.name,c.version,c.ptz_enabled,b.project_id,b.id as binding_id
        from app.construction_cameras c left join app.construction_camera_bindings b on b.camera_id=c.id and b.ended_at is null
        where c.enterprise_id=${this.actor.enterpriseId} and c.enabled ${owner ? sql`` : sql`and (b.project_id is null or b.project_id=${projectId!})`} order by c.id limit 300`) };
    });
  }
  async register(input: Row) {
    object(input, ['deviceId', 'channelId', 'name']);
    const deviceId = gbId(input.deviceId), channelId = gbId(input.channelId), name = text(input.name, 80);
    // Platform identities may have no enterprise_id. Resolve only their identity
    // under the shared platform scope; all camera data stays in tenant scope.
    return withPlatformTransaction(async permissionTx => {
    await constructionAccess(permissionTx, this.actor);
    if (!await one(permissionTx, sql`select id from app.admin_users where id=${this.actor.adminId} and role in ('admin','super_admin') and status='active' for share`)) fail('camera_forbidden', 403);
    if (!(await this.wvp().channels(deviceId)).some(c => c.channelId === channelId)) fail('camera_invalid_channel', 422);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      await constructionAccess(tx, this.actor);
      const existing = await one(tx, sql`select id,name,version from app.construction_cameras where enterprise_id=${this.actor.enterpriseId} and device_id=${deviceId} and channel_id=${channelId}`);
      if (existing) return existing;
      return (await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name)
        values(${this.actor.enterpriseId},${deviceId},${channelId},${name}) on conflict(node_key,device_id,channel_id) do nothing returning id,name,version`)) || fail('camera_already_assigned', 409);
    });
    });
  }
  async list(pid: string) {
    return listCameraProject(this.actor, pid);
  }
  async bind(pid: string, input: Row) {
    object(input, ['cameraId', 'expectedVersion', 'bind']);
    const cameraId = id(input.cameraId), expected = version(input.expectedVersion);
    if (typeof input.bind !== 'boolean') fail('invalid_construction', 422);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, access = await cameraAccess(tx, this.actor, pid);
      if (!access.manage) fail('camera_forbidden', 403);
      const c = await one(tx, sql`select id,version from app.construction_cameras where enterprise_id=${eid} and id=${cameraId} and enabled for update`);
      if (!c) fail('camera_unavailable', 404);
      const b = await one(tx, sql`select id,project_id from app.construction_camera_bindings where enterprise_id=${eid} and camera_id=${cameraId} and ended_at is null for update`);
      if (b && String(b.project_id) !== pid) fail('camera_already_bound', 409);
      // Matching state is a truthful retry receipt, even if the first reply was lost.
      if ((input.bind && b) || (!input.bind && !b)) return { id: cameraId, version: Number(c.version), bindingId: b?.id || null };
      if (Number(c.version) !== expected) fail('version_conflict', 409);
      if (input.bind) {
        // Serialize capacity checks and inserts so concurrent binds cannot both take the last ordered slot.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`service-order-camera:${eid}:${pid}`},0))`);
        const order = await activeOrder(tx, eid, pid);
        if (order && String(order.status) === 'exited') fail('service_order_ended', 409);
        if (order && !['confirmed', 'scheduled', 'accepted'].includes(String(order.status))) fail('service_order_not_confirmed', 409);
        if (order && Number(order.bound) >= Number(order.camera_count)) fail('service_order_camera_limit', 409);
      }
      if (b) {
        const recording=await one(tx,sql`select binding_id from app.construction_camera_recording_policies where enterprise_id=${eid} and binding_id=${String(b.id)} and (enabled or state<>'stopped')`);
        if(recording)fail('camera_recording_busy',409);
        if(await one(tx,sql`select id from app.construction_camera_sd_playbacks where enterprise_id=${eid} and binding_id=${String(b.id)} and state<>'stopped' limit 1`))fail('camera_playback_busy',409);
        const control = await one(tx, sql`select camera_id from app.construction_camera_controls where enterprise_id=${eid} and camera_id=${cameraId} and stop_required`);
        if (control) fail('camera_control_busy', 409);
        await tx.execute(sql`update app.construction_camera_bindings set ended_at=now() where enterprise_id=${eid} and id=${String(b.id)}`);
        await tx.execute(sql`update app.construction_camera_sessions set stream_app=null,stream_id=null,view_expires_at=null,play_version=play_version+1 where enterprise_id=${eid} and binding_id=${String(b.id)}`);
      }
      const created = input.bind ? await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id) values(${eid},${pid},${cameraId}) returning id`) : null;
      await tx.execute(sql`update app.construction_cameras set version=version+1 where enterprise_id=${eid} and id=${cameraId}`);
      await audit(tx, this.actor, pid, input.bind ? 'bind' : 'unbind', { cameraId, bindingId: created?.id || b?.id });
      return { id: cameraId, version: Number(c.version) + 1, bindingId: created?.id || null };
    });
  }
  async configure(pid: string, input: Row) {
    object(input, ['cameraId', 'expectedVersion', 'ptzEnabled']);
    const cid = id(input.cameraId), expected = version(input.expectedVersion);
    if (typeof input.ptzEnabled !== 'boolean') fail('invalid_construction', 422);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, access = await cameraAccess(tx, this.actor, pid);
      if (!access.owner) fail('camera_forbidden', 403);
      const c = await one(tx, sql`select c.* from app.construction_cameras c join app.construction_camera_bindings b on b.enterprise_id=c.enterprise_id and b.camera_id=c.id
        where c.enterprise_id=${eid} and c.id=${cid} and b.project_id=${pid} and b.ended_at is null and c.enabled for update of c`);
      if (!c) fail('camera_unavailable', 404);
      if (c.ptz_enabled === input.ptzEnabled) return { id:cid, version:Number(c.version) };
      if (Number(c.version) !== expected) fail('version_conflict', 409);
      await tx.execute(sql`update app.construction_cameras set ptz_enabled=${input.ptzEnabled},version=version+1 where enterprise_id=${eid} and id=${cid}`);
      if (!input.ptzEnabled) await tx.execute(sql`update app.construction_camera_controls set expires_at=now() where enterprise_id=${eid} and camera_id=${cid} and stop_required`);
      await audit(tx,this.actor,pid,'ptz.configure',{cameraId:cid,enabled:input.ptzEnabled});
      return {id:cid,version:Number(c.version)+1};
    });
  }
  async entry(pid: string) {
    return createCameraEntry(this.actor, pid);
  }
}
export async function listCameraProject(actor: CameraActor, pid: string) {
  const eid = actor.enterpriseId;
  const result = await withTenantTransaction(eid, async tx => {
    const access = await cameraAccess(tx, actor, pid), defaults = await retentionDefault(tx, eid);
    const items = await rows(tx, sql`select b.id as binding_id,c.id,c.name,c.version,c.ptz_enabled,r.enabled recording_enabled,coalesce(r.retention_days,${defaults.retentionDays}) retention_days,r.retention_override_days,r.version recording_version,r.state recording_state,r.last_error recording_error,r.last_segment_at,r.recording_mode,r.sd_last_error,r.sd_checked_at from app.construction_camera_bindings b
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      left join app.construction_camera_recording_policies r on r.enterprise_id=b.enterprise_id and r.binding_id=b.id
      where b.enterprise_id=${eid} and b.project_id=${pid} and b.ended_at is null and c.enabled order by c.id`);
    const order = access.manage ? await activeOrder(tx, eid, pid) : null;
    const affected = access.owner ? await one(tx, sql`select count(*) n from app.construction_camera_recording_policies p join app.construction_camera_bindings b on b.enterprise_id=p.enterprise_id and b.id=p.binding_id where p.enterprise_id=${eid} and p.retention_override_days is null and p.recording_mode='cloud' and b.ended_at is null`) : null;
    return { project: access.project, canManage: access.manage, canConfigure: access.owner, canCapture: access.canCapture, canControl: access.canControl,
      canViewSnapshots: !isCameraCustomer(actor) || access.canCapture, maxRetentionDays: nodeRetentionDays(), items,
      customerGrant: access.owner ? await currentCameraCustomerGrant(tx, eid, pid) : null,
      retentionDefault: access.owner ? { ...defaults, affectedCount: Number(affected!.n) } : null,
      serviceOrder: order ? { id: String(order.id), status: String(order.status), cameraCount: Number(order.camera_count), boundCount: Number(order.bound) } : null };
  });
  return { ...result, storage: result.canConfigure && result.items.length ? await currentStorageHealth() : null };
}
export async function createCameraEntry(actor: CameraActor, pid: string) {
  const token = actor.enterpriseId + '.' + secret(), origin = cameraPublicOrigin();
  await withTenantTransaction(actor.enterpriseId, async tx => {
    await cameraAccess(tx, actor, pid);
    await tx.execute(sql`insert into app.construction_camera_entries(enterprise_id,token_hash,project_id,actor,expires_at)
      values(${actor.enterpriseId},${digest(token)},${pid},${JSON.stringify(actor)}::jsonb,now()+interval '30 seconds')`);
  });
  return { url: origin + '/construction-camera#entry=' + token, expiresIn: 30 };
}
export async function exchangeCameraEntry(token: string) {
  const { eid, hash } = parseCameraToken(token), session = eid + '.' + secret(), csrf = secret();
  await withTenantTransaction(eid, async tx => {
    const e = await one(tx, sql`select * from app.construction_camera_entries where enterprise_id=${eid} and token_hash=${hash} and consumed_at is null and expires_at>now() for update`);
    if (!e) fail('camera_entry_expired', 401);
    await cameraAccess(tx, e.actor as CameraActor, String(e.project_id));
    await tx.execute(sql`update app.construction_camera_entries set consumed_at=now() where token_hash=${hash}`);
    await tx.execute(sql`insert into app.construction_camera_sessions(enterprise_id,token_hash,project_id,actor,csrf_hash,expires_at,absolute_expires_at)
      values(${eid},${digest(session)},${String(e.project_id)},${JSON.stringify(e.actor)}::jsonb,${digest(csrf)},now()+interval '60 seconds',now()+interval '4 hours')`);
  });
  return { session, csrf };
}
export async function cameraSession(tx: PostgresTransaction, token: string, csrf?: string) {
  const { eid, hash } = parseCameraToken(token);
  const s = await one(tx, sql`select * from app.construction_camera_sessions where enterprise_id=${eid} and token_hash=${hash}
    and closed_at is null and expires_at>now() and absolute_expires_at>now() for update`);
  if (!s || (csrf !== undefined && digest(csrf) !== s.csrf_hash)) fail('camera_session_expired', 401);
  const access = await cameraAccess(tx, s.actor as CameraActor, String(s.project_id));
  return { ...s, recording_id:s.recording_id, sd_playback_id:s.sd_playback_id, binding_id: s.binding_id, stream_id: s.stream_id, stream_app: s.stream_app,
    play_version: s.play_version, view_expires_at: s.view_expires_at,
    access, actor: s.actor as CameraActor, eid, hash, pid: String(s.project_id) };
}
export async function sessionState(token: string) {
  const { eid } = parseCameraToken(token);
  const s = await withTenantTransaction(eid, tx => cameraSession(tx, token));
  return listCameraProject(s.actor, s.pid);
}
export async function sessionHeartbeat(token: string, csrf: string, stop = false, upstream?:WvpClient) {
  const { eid, hash } = parseCameraToken(token);
  const result=await withTenantTransaction(eid, async tx => {
    const s=await cameraSession(tx, token, csrf);
    await tx.execute(sql`update app.construction_camera_sessions set expires_at=least(absolute_expires_at,now()+interval '60 seconds'),
      view_expires_at=${stop ? sql`null` : sql`case when stream_id is not null then now()+interval '60 seconds' else null end`},
      play_version=play_version+${stop ? 1 : 0},stream_id=${stop ? sql`null` : sql`stream_id`} where token_hash=${hash}`);
    return { stopped: stop,playbackId:s.sd_playback_id?String(s.sd_playback_id):null };
  });
  if(stop&&result.playbackId)await reconcileSdPlaybacks(upstream,result.playbackId);
  return {stopped:stop};
}
export async function startCameraView(token: string, csrf: string, bindingId: string, upstream = cameraWvp()) {
  const { eid, hash } = parseCameraToken(token);
  const intent = await withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx, token, csrf), c = await binding(tx, eid, s.pid, bindingId);
    const n = await one(tx, sql`update app.construction_camera_sessions set binding_id=${bindingId},recording_id=null,sd_playback_id=null,play_version=play_version+1,stream_id=null,view_expires_at=null where token_hash=${hash} returning play_version`);
    return { c, generation: Number(n!.play_version) };
  });
  const stream = await upstream.play(String(intent.c.device_id), String(intent.c.channel_id));
  await guardLiveWriter(eid,bindingId,stream,upstream);
  await withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx, token, csrf); await binding(tx, eid, s.pid, bindingId);
    if (Number(s.play_version) !== intent.generation) fail('camera_play_superseded', 409);
    await tx.execute(sql`update app.construction_camera_sessions set stream_app=${stream.app},stream_id=${stream.stream},view_expires_at=now()+interval '60 seconds' where token_hash=${hash}`);
  });
  return { generation: intent.generation, flv: `/camera-media/${intent.generation}/live.flv`, hls: `/camera-media/${intent.generation}/hls.m3u8` };
}
export async function authorizeCameraMedia(token: string, generation: number) {
  const { eid } = parseCameraToken(token);
  return withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx, token);
    if (s.recording_id || !s.binding_id || !s.stream_id || Number(s.play_version) !== generation || new Date(String(s.view_expires_at)).getTime() <= Date.now()) fail('camera_view_expired', 401);
    if(s.sd_playback_id)return authorizeSdMedia(tx,s);
    await binding(tx, eid, s.pid, String(s.binding_id));
    return { app: String(s.stream_app), stream: String(s.stream_id) };
  });
}
export async function normalizeCameraSnapshot(image: Buffer) {
  const normalized = await sharp(image, { limitInputPixels: 32000000 }).rotate().jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  if (normalized.data.length > 4194304) fail('camera_snapshot_too_large', 502);
  return normalized;
}

export async function captureCamera(token: string, csrf: string, bindingId: string, requestKey: string, upstream = cameraWvp()) {
  key(requestKey); const { eid } = parseCameraToken(token);
  const claim = await withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx, token, csrf); if (!s.access.canCapture) fail('camera_forbidden', 403);
    const c = await binding(tx, eid, s.pid, bindingId);
    const principal = cameraActorRef(s.actor), customer = isCameraCustomer(s.actor);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-snapshot:${eid}:${s.pid}:${principal.kind}:${principal.id}:${requestKey}`},0))`);
    const old = await one(tx, sql`select s.id,s.state,s.binding_id,(${retainedSnapshot()}) retained
      from app.construction_camera_snapshots s ${snapshotRetentionJoins} where s.enterprise_id=${eid} and s.project_id=${s.pid}
      and ${customer ? sql`s.actor_user_id` : sql`s.actor_id`}=${principal.id} and s.request_key=${requestKey}`);
    if (old) {
      if (String(old.binding_id) !== bindingId) fail('idempotency_conflict', 409);
      if (old.state === 'expired' || (old.state === 'ready' && !old.retained)) fail('camera_snapshot_unavailable', 404);
      return { existing: { id: old.id, state: old.state, binding_id: old.binding_id } };
    }
    const recent = await one(tx, sql`select id from app.construction_camera_snapshots where enterprise_id=${eid} and binding_id=${bindingId} and created_at>now()-interval '3 seconds'`);
    if (recent) fail('camera_capture_busy', 429);
    const created = (await one(tx, sql`insert into app.construction_camera_snapshots(enterprise_id,project_id,binding_id,actor_id,actor_user_id,request_key)
      values(${eid},${s.pid},${bindingId},${customer ? null : principal.id},${customer ? principal.id : null},${requestKey}) returning id`))!;
    return { id: String(created.id), c, actor: s.actor, pid: s.pid };
  });
  if (claim.existing) return claim.existing;
  try {
    const image = await upstream.snapshot(String(claim.c!.device_id), String(claim.c!.channel_id));
    const normalized = await normalizeCameraSnapshot(image);
    await withTenantTransaction(eid, async tx => {
      const s = await cameraSession(tx, token, csrf); if (!s.access.canCapture) fail('camera_forbidden', 403);
      await binding(tx, eid, s.pid, bindingId);
      const saved = await one(tx, sql`update app.construction_camera_snapshots set state='ready',data=${normalized.data},width=${normalized.info.width},height=${normalized.info.height},captured_at=now()
        where enterprise_id=${eid} and id=${claim.id!} and state='pending' returning id`);
      if (!saved) fail('camera_snapshot_unavailable', 404);
      await audit(tx, claim.actor!, claim.pid!, 'snapshot', { id: claim.id, bindingId });
    });
    return { id: claim.id, state: 'ready' };
  } catch (error) {
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_camera_snapshots set state='failed' where enterprise_id=${eid} and id=${claim.id!} and state='pending'`));
    throw error;
  }
}
export async function cameraSnapshots(token: string, imageId?: string) {
  const { eid } = parseCameraToken(token);
  return withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx, token);
    if (isCameraCustomer(s.actor) && !s.access.canCapture) fail('camera_forbidden', 403);
    if (imageId) {
      const image = await one(tx, sql`select s.data from app.construction_camera_snapshots s ${snapshotRetentionJoins}
        where s.enterprise_id=${eid} and s.project_id=${s.pid} and s.id=${id(imageId)} and ${privateSnapshot()} and s.state='ready' and ${retainedSnapshot()}`);
      if (!image) fail('camera_snapshot_unavailable', 404); return image;
    }
    return { items: await rows(tx, sql`select s.id,s.state,s.captured_at,s.created_at,c.name from app.construction_camera_snapshots s
      ${snapshotRetentionJoins}
      join app.construction_camera_bindings b on b.enterprise_id=s.enterprise_id and b.id=s.binding_id
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where s.enterprise_id=${eid} and s.project_id=${s.pid} and ${privateSnapshot()} and ${retainedSnapshot()} order by s.id desc limit 30`) };
  });
}
