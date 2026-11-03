import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { customerCameraActor, customerCameraProjects, type CameraCustomerIdentity } from '@/lib/construction/camera/access';
import { saveCameraCustomerGrant } from '@/lib/construction/camera/customer-grants';
import { CameraService, createCameraEntry, exchangeCameraEntry, listCameraProject, sessionState, startCameraView, authorizeCameraMedia, captureCamera, cameraSnapshots, sessionHeartbeat } from '@/lib/construction/camera/service';
import { customerCameraHttp, sessionCameraHttp } from '@/lib/construction/camera/http';
import { cameraPtz } from '@/lib/construction/camera/ptz';
import { saveRecordingPolicy, startRecordingView, authorizeRecordingMedia } from '@/lib/construction/camera/recordings';
import { listSdRecordings, startSdRecordingView, reconcileSdPlaybacks } from '@/lib/construction/camera/sd';
import { WvpClient, sdPlaybackStream } from '@/lib/construction/camera/wvp';
import { wvpTime } from '@/lib/construction/camera/recording-contract';

const prefix = 'camera-customer-' + randomUUID(), device = '92020000001320000005', channel = '92020000001320000006';
const uids: string[] = [], aids: string[] = [], streams = new Set<string>(), commands: string[] = [];
let eid = '', otherEid = '', pid = '', foreignPid = '', leadId = '', bid = '', cid = '', jpeg: Buffer, captures = 0, stops = 0;
let owner: ConstructionActor, manager: ConstructionActor, identity: CameraCustomerIdentity;
let snapshotWait: (() => Promise<Buffer>) | null = null;
class Upstream extends WvpClient {
  constructor() { super({ origin: 'http://wvp.test', mediaOrigin: 'http://media.test', username: 'fixture', password: 'fixture' }); }
  async channels() { return [{ deviceId: device, channelId: channel, name: '私有视频隔离验收', online: true, ptzType: 1 }]; }
  async play() { return { app: 'rtp', stream: 'customer-fixture' }; }
  async snapshot() { captures++; return snapshotWait ? snapshotWait() : jpeg; }
  async ptz(_d: string, _c: string, command: string) { commands.push(command); }
  async recordingPlan() { return null; }
  async recordingChannel() { return { id: 1, planId: null }; }
  async isRecording() { return false; }
  async sdRecordings(_d: string, _c: string, from: Date, to: Date) { return [{ deviceId: device, startTime: wvpTime(from), endTime: wvpTime(to) }]; }
  async startSdPlayback(d: string, c: string, from: Date, to: Date) { const s = sdPlaybackStream(d, c, from, to); streams.add(s.stream); return s; }
  async stopSdPlayback(_d: string, _c: string, stream: string) { stops++; streams.delete(stream); }
  async mediaExists(s: { app: string; stream: string }) { return streams.has(s.stream); }
}
const upstream = new Upstream(), service = () => new CameraService(owner, upstream);
async function grant(enabled: boolean, captureEnabled = false, ptzEnabled = false) {
  const current = (await service().list(pid)).customerGrant!;
  return saveCameraCustomerGrant(owner, pid, { userId: identity.userId, expectedVersion: current.version, enabled, captureEnabled, ptzEnabled });
}
async function enter() { const actor = await customerCameraActor(identity, pid), e = await createCameraEntry(actor, pid); return exchangeCameraEntry(e.url.split('#entry=')[1]); }
async function ageSnapshots() { await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_camera_snapshots set created_at=now()-interval '4 seconds' where project_id=${pid}`)); }
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.match(url.pathname, /^\/cloud_camera_unit_eval_/);
  jpeg = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#168650' } }).jpeg().toBuffer();
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      const e = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + n},${prefix + n},'active') returning id`))!.id);
      if (!n) eid = e; else otherEid = e;
      const u = String((await one(tx, sql`insert into app.users(nickname) values(${prefix + n}) returning id`))!.id); uids.push(u);
      const l = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${e},${u},'视频授权隔离客户','13800000000','natural') returning id`))!.id);
      const p = String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name,customer_access) values(${e},${l},'视频授权隔离工地',true) returning id`))!.id);
      if (!n) { pid = p; leadId = l; } else foreignPid = p;
    }
    for (const role of ['enterprise_admin', 'admin', 'super_admin', 'construction_staff']) aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
      values(${eid},${prefix + role},'synthetic-only',${role},'active',false) returning id`))!.id));
    await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${aids[3]},'manager')`);
  });
  identity = { userId: uids[0], contextVersion: 1 }; owner = { enterpriseId: eid, adminId: aids[0] }; manager = { enterpriseId: eid, adminId: aids[3] };
  const camera = await new CameraService({ enterpriseId: eid, adminId: aids[1] }, upstream).register({ deviceId: device, channelId: channel, name: '业主授权验收摄像头' }); cid = String(camera.id);
  bid = String((await service().bind(pid, { cameraId: cid, expectedVersion: 1, bind: true })).bindingId);
  await service().configure(pid, { cameraId: cid, expectedVersion: 2, ptzEnabled: true });
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const e of [eid, otherEid]) {
      for (const table of ['construction_camera_controls', 'construction_camera_snapshots', 'construction_camera_sessions', 'construction_camera_entries', 'construction_camera_sd_playbacks', 'construction_camera_sd_recordings', 'construction_camera_sd_windows', 'construction_recordings', 'construction_camera_recording_periods', 'construction_camera_recording_policies', 'construction_camera_customer_grants', 'construction_camera_bindings', 'construction_cameras', 'construction_audits', 'construction_members', 'construction_projects', 'leads', 'admin_users'])
        await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${e}`);
      await tx.execute(sql`delete from app.enterprises where id=${e}`);
    }
    for (const u of uids) await tx.execute(sql`delete from app.users where id=${u}`);
  }); } finally { await closePostgresPool(); }
});

test('report access never enables private video; an ungranted owner sees no camera entry', async () => {
  assert.deepEqual((await customerCameraProjects(identity, leadId)).items, []);
  await assert.rejects(customerCameraActor(identity, pid), /unavailable/);
  const current = (await service().list(pid)).customerGrant!;
  assert.equal(current.enabled, false); assert.equal(current.version, 0);
  assert.equal((await new CameraService(manager, upstream).list(pid)).customerGrant, null);
});
test('three management roles save grants; manager, foreign customer, stale writes and tenant RLS are enforced', async () => {
  const input = { userId: identity.userId, expectedVersion: 0, enabled: true, captureEnabled: false, ptzEnabled: false };
  await assert.rejects(saveCameraCustomerGrant(manager, pid, input), /forbidden/);
  await assert.rejects(saveCameraCustomerGrant(owner, pid, { ...input, userId: uids[1] }), /customer_unavailable/);
  for (const aid of aids.slice(0, 3)) {
    const current = (await service().list(pid)).customerGrant!;
    await saveCameraCustomerGrant({ enterpriseId: eid, adminId: aid }, pid, { ...input, expectedVersion: current.version, enabled: !current.enabled });
  }
  const repeated = await saveCameraCustomerGrant(owner, pid, input); assert.equal(repeated.version, 3);
  await assert.rejects(saveCameraCustomerGrant(owner, pid, { ...input, enabled: false }), /version_conflict/);
  assert.equal((await withTenantTransaction(otherEid, tx => rows(tx, sql`select project_id from app.construction_camera_customer_grants where project_id=${pid}`))).length, 0);
  await assert.rejects(saveCameraCustomerGrant({ enterpriseId: otherEid, adminId: aids[0] }, foreignPid, input), /forbidden/);
});
test('own-project entry exchanges once, reenters and exposes no management authority', async () => {
  const actor = await customerCameraActor(identity, pid), e = await createCameraEntry(actor, pid), token = e.url.split('#entry=')[1];
  const s = await exchangeCameraEntry(token); await assert.rejects(exchangeCameraEntry(token), /expired/);
  const state = await sessionState(s.session); assert.equal(state.canManage, false); assert.equal(state.canConfigure, false);
  assert.equal(state.retentionDefault, null); assert.equal(state.serviceOrder, null); assert.equal(state.storage, null);
  assert.equal((await customerCameraProjects(identity, leadId)).items.length, 1);
  assert.equal((await sessionState((await enter()).session)).project.name, '视频授权隔离工地');
  await assert.rejects(customerCameraActor(identity, foreignPid), /unavailable/);
  await assert.rejects(listCameraProject({ ...actor, enterpriseId: otherEid }, pid), /unavailable/);
  await assert.rejects(customerCameraHttp(new Request('http://localhost/video', { method: 'POST', body: '{}' }), identity, ['projects', pid, 'recording']), /not_found/);
});
test('capture, history and PTZ default off independently of live viewing', async () => {
  const s = await enter(), live = await startCameraView(s.session, s.csrf, bid, upstream);
  assert.equal((await authorizeCameraMedia(s.session, live.generation)).stream, 'customer-fixture');
  assert.equal((await sessionState(s.session)).canViewSnapshots, false);
  await assert.rejects(captureCamera(s.session, s.csrf, bid, randomUUID(), upstream), /forbidden/);
  await assert.rejects(cameraSnapshots(s.session), /forbidden/);
  await assert.rejects(cameraPtz(s.session, s.csrf, bid, 'right', 1, upstream), /forbidden/);
  assert.equal(captures, 0); assert.deepEqual(commands, []);
});
test('explicit capture persists a user principal and supports idempotency and decoded reentry', async () => {
  await grant(true, true); const s = await enter(), key = randomUUID();
  const a = await captureCamera(s.session, s.csrf, bid, key, upstream), b = await captureCamera(s.session, s.csrf, bid, key, upstream);
  assert.equal(String(a.id), String(b.id)); assert.equal(captures, 1);
  const stored = await withTenantTransaction(eid, tx => one(tx, sql`select actor_id,actor_user_id from app.construction_camera_snapshots where id=${String(a.id)}`));
  assert.equal(stored!.actor_id, null); assert.equal(String(stored!.actor_user_id), identity.userId);
  const back = await enter(), image = await cameraSnapshots(back.session, String(a.id)); assert.equal((await sharp(image.data as Buffer).metadata()).width, 80);
  await assert.rejects(cameraPtz(s.session, s.csrf, bid, 'right', 1, upstream), /forbidden/);
  const noCsrf = await sessionCameraHttp(new Request('http://localhost:3017/api/construction-camera/snapshots', { method: 'POST', headers: { origin: 'http://localhost:3017', cookie: 'construction_camera_session=' + s.session }, body: JSON.stringify({ bindingId: bid }) }), ['snapshots']);
  assert.equal(noCsrf.status, 401);
});
test('PTZ may be granted without capture and always sends its stop pulse', async () => {
  await grant(true, false, true); const s = await enter();
  await cameraPtz(s.session, s.csrf, bid, 'right', 1, upstream); assert.deepEqual(commands.slice(-2), ['right', 'stop']);
  await assert.rejects(captureCamera(s.session, s.csrf, bid, randomUUID(), upstream), /forbidden/);
  await assert.rejects(cameraSnapshots(s.session), /forbidden/);
});
test('revocation fences pending entries and active generations; reenabling never revives them or affects staff', async () => {
  const actor = await customerCameraActor(identity, pid), pending = await createCameraEntry(actor, pid), s = await enter();
  const live = await startCameraView(s.session, s.csrf, bid, upstream);
  const staffEntry = await service().entry(pid), staff = await exchangeCameraEntry(staffEntry.url.split('#entry=')[1]);
  const staffLive = await startCameraView(staff.session, staff.csrf, bid, upstream);
  await grant(false); await assert.rejects(authorizeCameraMedia(s.session, live.generation), /unavailable/);
  await assert.rejects(exchangeCameraEntry(pending.url.split('#entry=')[1]), /unavailable/);
  await grant(true); await assert.rejects(sessionState(s.session), /unavailable/);
  await assert.rejects(exchangeCameraEntry(pending.url.split('#entry=')[1]), /unavailable/);
  assert.equal((await authorizeCameraMedia(staff.session, staffLive.generation)).stream, 'customer-fixture');
  assert.equal((await sessionState((await enter()).session)).canCapture, false);
});
test('revocation while snapshot bytes are in flight prevents a ready image or success receipt', async () => {
  await grant(true, true); await ageSnapshots(); const s = await enter();
  let release!: (b: Buffer) => void, reached!: () => void;
  const ready = new Promise<void>(r => { reached = r; }); snapshotWait = () => { reached(); return new Promise(r => { release = r; }); };
  const operation = captureCamera(s.session, s.csrf, bid, randomUUID(), upstream);
  await ready; await grant(false); release(jpeg); await assert.rejects(operation, /unavailable/); snapshotWait = null;
  const failed = await withTenantTransaction(eid, tx => one(tx, sql`select state,data from app.construction_camera_snapshots where project_id=${pid} order by id desc limit 1`));
  assert.equal(failed!.state, 'failed'); assert.equal(failed!.data, null); await grant(true);
});
test('identity revocation and ownership round trips cannot reuse a prior customer session', async () => {
  const old = await enter();
  await withPlatformTransaction(tx => tx.execute(sql`update app.users set context_version=context_version+1 where id=${identity.userId}`));
  await assert.rejects(sessionState(old.session), /expired/); identity.contextVersion++;
  const priorOwner = await enter();
  await withPlatformTransaction(tx => tx.execute(sql`update app.leads set customer_user_id=${uids[1]} where id=${leadId}`));
  await assert.rejects(sessionState(priorOwner.session), /unavailable/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.leads set customer_user_id=${uids[0]} where id=${leadId}`));
  await assert.rejects(customerCameraActor(identity, pid), /unavailable/); await grant(true);
  await assert.rejects(sessionState(priorOwner.session), /unavailable/);
});
test('pausing and restoring the project requires renewed explicit video access', async () => {
  const old = await enter();
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_projects set status='paused' where id=${pid}`));
  await assert.rejects(sessionState(old.session), /unavailable/);
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_projects set status='active' where id=${pid}`));
  assert.equal((await service().list(pid)).customerGrant!.enabled, false); await grant(true);
  await assert.rejects(sessionState(old.session), /unavailable/);
});
test('private cloud recording media is granted and revoked with the same customer session', async () => {
  await saveRecordingPolicy(owner, pid, { bindingId: bid, expectedVersion: 0, enabled: false, retentionDays: 3 });
  const record = await withTenantTransaction(eid, tx => one(tx, sql`insert into app.construction_recordings
    (enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,clock_offset_min_ms,clock_offset_max_ms)
    values(${eid},${pid},${bid},620001,'customer-fixture','rtp','customer-fixture','/opt/media/www/record/rtp/customer-fixture/2026-11-03/test.mp4',now()-interval '2 minutes',now()-interval '1 minute',1024,-3000,3000) returning id`));
  const s = await enter(), rid = String(record!.id), view = await startRecordingView(s.session, s.csrf, rid);
  assert.equal((await authorizeRecordingMedia(s.session, view.generation, rid)).id, rid);
  await grant(false); await assert.rejects(authorizeRecordingMedia(s.session, view.generation, rid), /unavailable/);
  await grant(true); await assert.rejects(authorizeRecordingMedia(s.session, view.generation, rid), /unavailable/);
});
test('SD revocation preserves another authorized viewer, then stops the final owned upload', async () => {
  await saveRecordingPolicy(owner, pid, { bindingId: bid, expectedVersion: 1, enabled: false, retentionDays: 3, recordingMode: 'sd' });
  await withTenantTransaction(eid, async tx => {
    await tx.execute(sql`update app.construction_camera_bindings set started_at=now()-interval '20 minutes' where id=${bid}`);
    await tx.execute(sql`update app.construction_camera_recording_policies set state='stopped',sd_activated_at=now()-interval '19 minutes' where binding_id=${bid}`);
    await tx.execute(sql`insert into app.construction_camera_sd_windows(enterprise_id,project_id,binding_id,serial_hash,business_from,checked_at,source_from,source_to,clock_min_ms,clock_max_ms)
      values(${eid},${pid},${bid},${'b'.repeat(64)},now()-interval '18 minutes',now(),date_trunc('second',now()-interval '18 minutes'),date_trunc('second',now()-interval '30 seconds'),-3000,3000)`);
  });
  const customer = await enter(), day = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
  const list = await listSdRecordings(customer.session, customer.csrf, day, bid, undefined, upstream, async () => ({ source: new Date(), serialHash: 'b'.repeat(64) }));
  assert.ok(list.items.length); const rid = String(list.items[0].id);
  const entry = await service().entry(pid), staff = await exchangeCameraEntry(entry.url.split('#entry=')[1]);
  const first = await startSdRecordingView(customer.session, customer.csrf, rid, upstream);
  await startSdRecordingView(staff.session, staff.csrf, rid, upstream); await grant(false); await reconcileSdPlaybacks(upstream);
  await assert.rejects(authorizeCameraMedia(customer.session, first.generation), /unavailable/); assert.equal(streams.size, 1); assert.equal(stops, 0);
  await sessionHeartbeat(staff.session, staff.csrf, true, upstream); assert.equal(streams.size, 0); assert.equal(stops, 1);
  await grant(true); const only = await enter(); await startSdRecordingView(only.session, only.csrf, rid, upstream);
  streams.add('foreign-stream'); await grant(false); await reconcileSdPlaybacks(upstream);
  assert.deepEqual([...streams], ['foreign-stream']); assert.equal(stops, 2); streams.clear(); await grant(true);
});
