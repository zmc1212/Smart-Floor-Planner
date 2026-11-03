import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { customerCameraActor } from '@/lib/construction/camera/access';
import { CameraService, createCameraEntry, exchangeCameraEntry, captureCamera, cameraSnapshots } from '@/lib/construction/camera/service';
import { saveRecordingPolicy, saveRetentionDefault } from '@/lib/construction/camera/recordings';
import { saveCameraCustomerGrant } from '@/lib/construction/camera/customer-grants';
import { lockRetentionDefault } from '@/lib/construction/camera/retention-defaults';
import { purgeCameraSnapshots } from '@/lib/construction/camera/snapshot-retention';
import { WvpClient } from '@/lib/construction/camera/wvp';
import { sessionCameraHttp } from '@/lib/construction/camera/http';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';

const prefix = 'snapshot-retention-' + randomUUID(), eids: string[] = [], uids: string[] = [], aids: string[] = [], pids: string[] = [], bids: string[][] = [];
let owner: ConstructionActor, jpeg: Buffer, captures = 0, snapshotWait: (() => Promise<Buffer>) | null = null;
class Upstream extends WvpClient {
  constructor() { super({ origin: 'http://wvp.test', mediaOrigin: 'http://media.test', username: 'fixture', password: 'fixture' }); }
  async snapshot() { captures++; return snapshotWait ? snapshotWait() : jpeg; }
}
const upstream = new Upstream();
async function staff(n = 0) { return exchangeCameraEntry((await new CameraService({ enterpriseId: eids[n], adminId: aids[n] }).entry(pids[n])).url.split('#entry=')[1]); }
async function customer() { return exchangeCameraEntry((await createCameraEntry(await customerCameraActor({ userId: uids[0], contextVersion: 1 }, pids[0]), pids[0])).url.split('#entry=')[1]); }
async function grant(enabled: boolean, captureEnabled = enabled) {
  const g = (await new CameraService(owner).list(pids[0])).customerGrant!;
  return saveCameraCustomerGrant(owner, pids[0], { userId: uids[0], enabled, captureEnabled, ptzEnabled: false, expectedVersion: g.version });
}
async function policy(i: number, days: number, source = 'camera', mode = 'cloud') {
  const p = await withTenantTransaction(eids[0], tx => one(tx, sql`select version from app.construction_camera_recording_policies where binding_id=${bids[0][i]}`));
  return saveRecordingPolicy(owner, pids[0], { bindingId: bids[0][i], enabled: false, retentionDays: days, retentionSource: source, recordingMode: mode, expectedVersion: Number(p?.version || 0) });
}
async function defaults(days: number) {
  const d = (await new CameraService(owner).list(pids[0])).retentionDefault!;
  return saveRetentionDefault(owner, pids[0], { retentionDays: days, expectedVersion: d.version });
}
async function seed(i: number, age: number, n = 0, state = 'ready') {
  const key = randomUUID();
  const r = await withTenantTransaction(eids[n], tx => one(tx, sql`insert into app.construction_camera_snapshots(enterprise_id,project_id,binding_id,actor_id,request_key,state,data,width,height,captured_at,created_at)
    values(${eids[n]},${pids[n]},${bids[n][i]},${aids[n]},${key},${state},${state === 'ready' ? jpeg : null},64,48,
    ${state === 'ready' ? sql`now()-${age}*interval '1 day'` : sql`null`},now()-${age}*interval '1 day') returning id`));
  return { id: String(r!.id), key };
}
const stored = (id: string, n = 0) => withTenantTransaction(eids[n], tx => one(tx, sql`select state,data,captured_at,actor_id,request_key from app.construction_camera_snapshots where id=${id}`));
async function contains(session: string, id: string) { return ((await cameraSnapshots(session)).items as Row[]).some(r => String(r.id) === id); }

before(async () => {
  const u = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(u.port, '55432'); assert.match(u.pathname, /^\/cloud_camera_unit_eval_/);
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#168650' } }).jpeg().toBuffer();
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      eids.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
      uids.push(String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id));
      aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
        values(${eids[n]},${prefix+n},'synthetic-only','enterprise_admin','active',false) returning id`))!.id));
      const lid = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[n]},${uids[n]},'合成抓拍留存客户','13800000000','natural') returning id`))!.id);
      pids.push(String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eids[n]},${lid},'合成抓拍留存工地') returning id`))!.id));
      bids.push([]);
      for (let i = 0; i < 7; i++) {
        const cid = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name)
          values(${eids[n]},${'93020000001320000'+n+i+'1'},${'93020000001320000'+n+i+'2'},${'合成抓拍摄像头'+i}) returning id`))!.id);
        bids[n].push(String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at)
          values(${eids[n]},${pids[n]},${cid},now()-interval '10 days') returning id`))!.id));
      }
    }
    assert.deepEqual(await one(tx, sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`), { rolsuper: false, rolbypassrls: false });
  });
  owner = { enterpriseId: eids[0], adminId: aids[0] };
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

test('unconfigured cameras use enterprise fallback; expired private reads fail before cleanup and reentry keeps fresh JPEGs', async () => {
  const old = await seed(0, 4), fresh = await seed(0, 2), s = await staff();
  assert.equal(await contains(s.session, old.id), false); assert.equal(await contains(s.session, fresh.id), true);
  await assert.rejects(cameraSnapshots(s.session, old.id), /snapshot_unavailable/);
  assert.equal((await stored(old.id))!.state, 'ready'); assert.ok((await stored(old.id))!.data);
  const image = await cameraSnapshots((await staff()).session, fresh.id);
  assert.equal((await sharp(image.data as Buffer).metadata()).width, 64);
  const before = captures; await assert.rejects(captureCamera(s.session, s.csrf, bids[0][0], old.key, upstream), /snapshot_unavailable/); assert.equal(captures, before);
});

test('captures persist actual normalized bytes, same-request retries and author-scoped idempotency across reentry', async () => {
  await grant(true); const s = await staff(), c = await customer(), key = randomUUID();
  const a = await captureCamera(s.session, s.csrf, bids[0][1], key, upstream);
  assert.equal(a.state, 'ready'); assert.equal(String((await captureCamera(s.session, s.csrf, bids[0][1], key, upstream)).id), String(a.id));
  const reentry = await staff(); assert.equal(String((await captureCamera(reentry.session, reentry.csrf, bids[0][1], key, upstream)).id), String(a.id));
  await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.construction_camera_snapshots set created_at=now()-interval '4 seconds' where id=${String(a.id)}`));
  const b = await captureCamera(c.session, c.csrf, bids[0][1], key, upstream); assert.notEqual(String(a.id), String(b.id));
  assert.ok(await contains((await customer()).session, String(b.id)));
});

test('shortening saved retention rejects images immediately, then cleanup clears bytes once and preserves the original receipt', async () => {
  await policy(1, 1); const image = await seed(1, 2), s = await staff();
  await assert.rejects(cameraSnapshots(s.session, image.id), /snapshot_unavailable/); assert.ok((await stored(image.id))!.data);
  await purgeCameraSnapshots(); const result = (await stored(image.id))!;
  assert.equal(result.state, 'expired'); assert.equal(result.data, null); assert.equal(result.request_key, image.key); assert.equal(String(result.actor_id), aids[0]);
  const audits = await withTenantTransaction(eids[0], tx => rows(tx, sql`select actor_ref,snapshot from app.construction_audits where action='camera.snapshot.expire' and snapshot->>'id'=${image.id}`));
  assert.equal(audits.length, 1); assert.deepEqual(audits[0].actor_ref, { kind: 'system' });
  await policy(1, 7); await purgeCameraSnapshots();
  await assert.rejects(cameraSnapshots(s.session, image.id), /snapshot_unavailable/);
  const before = captures; await assert.rejects(captureCamera(s.session, s.csrf, bids[0][1], image.key, upstream), /snapshot_unavailable/); assert.equal(captures, before);
});

test('enterprise changes update inherited cloud snapshots and no-policy cameras while explicit, SD and retired histories keep saved days', async () => {
  await policy(2, 3, 'enterprise'); await policy(3, 6); await policy(4, 3, 'enterprise', 'sd'); await policy(5, 3, 'enterprise');
  await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.construction_camera_bindings set ended_at=now() where id=${bids[0][5]}`));
  const images = await Promise.all([0,2,3,4,5].map(i => seed(i, 2))); await defaults(1); const s = await staff();
  for (let n = 0; n < images.length; n++) assert.equal(await contains(s.session, images[n].id), n >= 2);
  await purgeCameraSnapshots();
  for (let n = 0; n < images.length; n++) assert.equal((await stored(images[n].id))!.state, n < 2 ? 'expired' : 'ready');
  const p = await withTenantTransaction(eids[0], tx => one(tx, sql`select enabled,recording_mode,retention_days from app.construction_camera_recording_policies where binding_id=${bids[0][4]}`));
  assert.deepEqual(p, { enabled: false, recording_mode: 'sd', retention_days: 3 });
});

test('candidate cleanup rechecks policy after waiting; concurrent extension retains valid bytes', async () => {
  await policy(6, 1); const image = await seed(6, 2); let cleaner: Promise<{ expired: number }> | undefined;
  await withTenantTransaction(eids[0], async tx => {
    await lockRetentionDefault(tx, eids[0]); cleaner = purgeCameraSnapshots();
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      waiting = !!(await one(tx, sql`select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database()) limit 1`));
      if (waiting) break; await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(waiting, true, 'cleaner must have selected its candidate and reached the policy fence');
    await tx.execute(sql`update app.construction_camera_recording_policies set retention_days=7,retention_override_days=7,version=version+1 where binding_id=${bids[0][6]}`);
  });
  await cleaner; assert.equal((await stored(image.id))!.state, 'ready'); assert.ok((await stored(image.id))!.data);
  assert.ok(await cameraSnapshots((await staff()).session, image.id));
});

test('two cleanup workers produce one terminal state and audit without erasing fresh bytes', async () => {
  await policy(6, 1); const old = await seed(6, 2), fresh = await seed(6, 0);
  await Promise.all([purgeCameraSnapshots(), purgeCameraSnapshots()]);
  assert.equal((await stored(old.id))!.state, 'expired'); assert.ok((await stored(fresh.id))!.data);
  assert.equal((await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*) n from app.construction_audits where action='camera.snapshot.expire' and snapshot->>'id'=${old.id}`)))!.n, '1');
});

test('an abandoned pending capture cannot be resurrected by a late provider response or falsely audited as saved', async () => {
  const s = await staff(), key = randomUUID(); let started!: () => void, finish!: (value: Buffer) => void;
  const entered = new Promise<void>(r => started = r), response = new Promise<Buffer>(r => finish = r);
  snapshotWait = async () => { started(); return response; };
  const request = captureCamera(s.session, s.csrf, bids[0][0], key, upstream);
  try {
    await entered;
    await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.construction_camera_snapshots set state='failed',created_at=now()-interval '3 minutes' where request_key=${key}`));
    finish(jpeg); await assert.rejects(request, /snapshot_unavailable/);
    const r = await withTenantTransaction(eids[0], tx => one(tx, sql`select id,state,data from app.construction_camera_snapshots where request_key=${key}`));
    assert.equal(r!.state, 'failed'); assert.equal(r!.data, null);
    assert.equal((await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*) n from app.construction_audits where action='camera.snapshot' and snapshot->>'id'=${String(r!.id)}`)))!.n, '0');
    assert.equal((await captureCamera(s.session, s.csrf, bids[0][0], key, upstream)).state, 'failed');
  } finally { snapshotWait = null; finish(jpeg); }
});

test('customer capture grants still fence fresh and expired history, reentry and receipt retries', async () => {
  await grant(true); const c = await customer(), image = await seed(3, 0), old = await seed(3, 7);
  assert.ok(await cameraSnapshots(c.session, image.id)); await assert.rejects(cameraSnapshots(c.session, old.id), /snapshot_unavailable/);
  await grant(true, false); const restricted = await customer();
  for (const fn of [() => cameraSnapshots(restricted.session), () => cameraSnapshots(restricted.session, image.id), () => captureCamera(restricted.session, restricted.csrf, bids[0][3], image.key, upstream)]) await assert.rejects(fn(), /forbidden/);
  await assert.rejects(cameraSnapshots(c.session, image.id), /unavailable/);
  await grant(true); assert.ok(await cameraSnapshots((await customer()).session, image.id));
  await assert.rejects(cameraSnapshots(c.session, image.id), /unavailable/);
});

test('populated control tenant stays invisible; cleanup uses each tenant policy and private HTTP denies anonymous or expired bytes', async () => {
  const foreign = await seed(0, 2, 1), ours = await seed(0, 2), s = await staff(), other = await staff(1);
  assert.equal((await withTenantTransaction(eids[0], tx => rows(tx, sql`select id from app.construction_camera_snapshots where id=${foreign.id}`))).length, 0);
  await assert.rejects(cameraSnapshots(s.session, foreign.id), /snapshot_unavailable/);
  await purgeCameraSnapshots(); assert.ok((await stored(foreign.id, 1))!.data); assert.equal((await stored(ours.id))!.data, null);
  const request = (session = '') => new Request('http://localhost:3017/api/construction-camera/snapshots/'+foreign.id, { headers: session ? { cookie: 'construction_camera_session='+session } : {} });
  assert.equal((await sessionCameraHttp(request(), ['snapshots', foreign.id])).status, 401);
  const ok = await sessionCameraHttp(request(other.session), ['snapshots', foreign.id]); assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await sessionCameraHttp(request(s.session), ['snapshots', foreign.id])).status, 404);
  const expired = await sessionCameraHttp(new Request('http://localhost:3017/api/construction-camera/snapshots/'+ours.id, { headers: { cookie: 'construction_camera_session='+s.session } }), ['snapshots', ours.id]);
  assert.equal(expired.status, 404); assert.match(await expired.text(), /snapshot_unavailable/);
});
