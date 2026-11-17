import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { CameraService } from '@/lib/construction/camera/service';
import { saveCameraCustomerGrant } from '@/lib/construction/camera/customer-grants';
import { coverIntervalHours, saveCoverInterval } from '@/lib/construction/camera/cover-defaults';
import { captureDueOwnerCovers, ownerSiteCover } from '@/lib/construction/camera/owner-cover';
import { staffCameraHttp } from '@/lib/construction/camera/http';
import { WvpClient } from '@/lib/construction/camera/wvp';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';

const prefix = 'cover-' + randomUUID(), eids: string[] = [], uids: string[] = [], aids: string[] = [], pids: string[] = [], bids: string[] = [], devices: string[] = [];
let owner: ConstructionActor, manager: ConstructionActor, member: ConstructionActor, jpeg: Buffer;
let calls: string[] = [], failDevice = '';
class Upstream extends WvpClient {
  constructor() { super({ origin: 'http://wvp.test', mediaOrigin: 'http://media.test', username: 'fixture', password: 'fixture' }); }
  async snapshot(deviceId: string) { calls.push(deviceId); if (deviceId === failDevice) throw Error('offline'); return jpeg; }
}
const upstream = new Upstream();
const actor = (n: number) => ({ enterpriseId: eids[0], adminId: aids[n] });
const stored = (bid: string) => withTenantTransaction(eids[0], tx => one(tx, sql`select state,data,width,height,captured_at,scheduled_at,request_key
  from app.construction_camera_snapshots where binding_id=${bid}`));
const identity = () => ({ userId: uids[0], contextVersion: 1 });
const cameraHttp = (actor: ConstructionActor, method: string, tail: string, body?: unknown) => staffCameraHttp(
  new Request('http://localhost/api/construction/video/projects/' + pids[0] + '/' + tail, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), actor, ['projects', pids[0], tail]);
/** The Next route converts thrown AssistantErrors into `{success:false,error}` JSON. */
async function callHttp(actor: ConstructionActor, method: string, tail: string, body?: unknown) {
  try {
    const response = await cameraHttp(actor, method, tail, body);
    return { status: response.status, body: await response.json() as { data?: Record<string, unknown>; error?: string } };
  } catch (e) {
    const error = e as { status?: number; code?: string };
    return { status: error.status || 503, body: { error: error.code } };
  }
}

before(async () => {
  const u = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(u.port, '55432'); assert.match(u.pathname, /^\/cloud_camera_unit_eval_/);
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#168650' } }).jpeg().toBuffer();
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      eids.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
      uids.push(String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id));
      const lid = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${eids[n]},${uids[n]},'合成封面客户','13800000000','natural') returning id`))!.id);
      pids.push(String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name)
        values(${eids[n]},${lid},'合成封面工地') returning id`))!.id));
    }
    for (const role of ['enterprise_admin', 'construction_staff', 'construction_staff'])
      aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
        values(${eids[0]},${prefix+aids.length},'synthetic-only',${role},'active',false) returning id`))!.id));
    await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eids[0]},${pids[0]},${aids[1]},'manager')`);
    await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eids[0]},${pids[0]},${aids[2]},'worker')`);
    for (let i = 0; i < 2; i++) {
      const device = '94020000001320000' + '0' + i + '1';
      const channel = '94020000001320000' + '0' + i + '2';
      devices.push(device);
      const cid = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name)
        values(${eids[0]},${device},${channel},${'合成封面摄像头'+i}) returning id`))!.id);
      bids.push(String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at)
        values(${eids[0]},${pids[0]},${cid},now()-interval '3 days') returning id`))!.id));
    }
  });
  [owner, manager, member] = [0, 1, 2].map(actor);
  await saveCameraCustomerGrant(owner, pids[0], { userId: uids[0], enabled: true, captureEnabled: true, ptzEnabled: false, expectedVersion: 0 });
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) {
      await tx.execute(sql`update app.construction_camera_recording_policies set enabled=false,state='stopped' where enterprise_id=${eid}`);
      await deleteConstructionData(tx, BigInt(eid));
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.enterprises where id=${eid}`);
    }
    for (const uid of uids) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { await closePostgresPool(); }
});

test('owner saves a bounded interval; other roles, stale versions and foreign tenants are denied', async () => {
  assert.deepEqual(await withTenantTransaction(eids[0], tx => coverIntervalHours(tx, eids[0])), { intervalHours: 1, version: 0 });
  assert.deepEqual((await new CameraService(owner).list(pids[0])).coverDefault, { intervalHours: 1, version: 0 });
  const saved = await saveCoverInterval(owner, pids[0], { intervalHours: 2, expectedVersion: 0 });
  assert.deepEqual(saved, { intervalHours: 2, version: 1 });
  assert.deepEqual(await saveCoverInterval(owner, pids[0], { intervalHours: 2, expectedVersion: 0 }), saved);
  for (const a of [manager, member]) await assert.rejects(saveCoverInterval(a, pids[0], { intervalHours: 3, expectedVersion: 1 }), /camera_forbidden/);
  for (const hours of [0, 25, 1.5, '2']) await assert.rejects(saveCoverInterval(owner, pids[0], { intervalHours: hours, expectedVersion: 1 }), /camera_invalid_cover_interval/);
  await assert.rejects(saveCoverInterval(owner, pids[0], { intervalHours: 3, expectedVersion: 0 }), /version_conflict/);
  await assert.rejects(saveCoverInterval({ ...owner, enterpriseId: eids[1] }, pids[0], { intervalHours: 3, expectedVersion: 1 }));
  assert.equal((await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*) n from app.construction_audits where action='camera.cover.default'`)))!.n, '1');
  assert.deepEqual((await new CameraService(owner).list(pids[0])).coverDefault, { intervalHours: 2, version: 1 });
});

test('the displayed camera claims one interval slot and no other binding is woken', async () => {
  failDevice = ''; calls = [];
  assert.equal((await captureDueOwnerCovers(upstream)).captured, 1);
  assert.deepEqual(calls, [devices[0]]);
  const good = (await stored(bids[0]))!;
  assert.equal(good.state, 'ready'); assert.equal(await stored(bids[1]), undefined);
  assert.equal(Number(good.width), 64); assert.ok(good.captured_at); assert.equal(good.request_key, 'owner-cover');
  assert.equal((await captureDueOwnerCovers(upstream)).captured, 0);
  assert.equal(calls.length, 1);
});

test('a failed slot is kept until the next interval, and the home falls back only when no frame exists', async () => {
  calls = [];
  const good = await ownerSiteCover(identity(), pids[0], upstream.snapshot.bind(upstream));
  assert.equal(calls.length, 0);
  assert.ok(good.camera && good.camera.cover); assert.ok(good.camera.cover!.jpeg.length > 0);
  assert.equal((await sharp(Buffer.from(good.camera.cover!.jpeg, 'base64')).metadata()).width, 64);
  assert.ok(good.camera.cover!.capturedAt);
  await withTenantTransaction(eids[0], tx => tx.execute(sql`delete from app.construction_camera_snapshots where binding_id=${bids[0]}`));
  failDevice = devices[0];
  assert.equal((await captureDueOwnerCovers(upstream)).captured, 0);
  assert.equal(calls.length, 1);
  assert.equal((await stored(bids[0]))!.state, 'failed');
  assert.equal((await captureDueOwnerCovers(upstream)).captured, 0);
  assert.equal(calls.length, 1);
  let fallbackCalls = 0;
  const fallback = await ownerSiteCover(identity(), pids[0], async () => { fallbackCalls++; return jpeg; });
  assert.equal(fallbackCalls, 1);
  assert.ok(fallback.camera && fallback.camera.cover);
  assert.equal((await stored(bids[0]))!.state, 'failed');
});

test('Admin settings route returns the interval, validates input and enforces the owner boundary', async () => {
  const read = await callHttp(owner, 'GET', 'cameras');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.data!.coverDefault, { intervalHours: 2, version: 1 });
  const saved = await callHttp(owner, 'POST', 'cover-interval', { intervalHours: 4, expectedVersion: 1 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data, { intervalHours: 4, version: 2 });
  assert.deepEqual((await callHttp(owner, 'GET', 'cameras')).body.data!.coverDefault, { intervalHours: 4, version: 2 });
  const invalid = await callHttp(owner, 'POST', 'cover-interval', { intervalHours: 25, expectedVersion: 2 });
  assert.equal(invalid.status, 422); assert.equal(invalid.body.error, 'camera_invalid_cover_interval');
  const stale = await callHttp(owner, 'POST', 'cover-interval', { intervalHours: 3, expectedVersion: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'version_conflict');
  for (const a of [manager, member]) {
    const denied = await callHttp(a, 'POST', 'cover-interval', { intervalHours: 3, expectedVersion: 2 });
    assert.equal(denied.status, 403); assert.equal(denied.body.error, 'camera_forbidden');
  }
  assert.equal((await callHttp(owner, 'POST', 'cover-intervals', { intervalHours: 3, expectedVersion: 2 })).status, 404);
  assert.equal((await callHttp(owner, 'GET', 'cover-interval')).status, 404);
});
