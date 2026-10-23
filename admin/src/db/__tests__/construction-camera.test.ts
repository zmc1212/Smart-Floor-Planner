import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { CameraService, authorizeCameraMedia, captureCamera, cameraSnapshots, digest, exchangeCameraEntry, sessionHeartbeat, sessionState, startCameraView } from '@/lib/construction/camera/service';
import { cameraPtz, cameraWatchdog } from '@/lib/construction/camera/ptz';
import { sessionCameraHttp } from '@/lib/construction/camera/http';
import { WvpClient } from '@/lib/construction/camera/wvp';
import type { ConstructionActor } from '@/lib/construction/contracts';

const prefix = 'camera-test-' + randomUUID(), eids: string[] = [], uids: string[] = [], pids: string[] = [], admins: string[][] = [];
let cameraId = '', bindingId = '', manager: ConstructionActor, owner: ConstructionActor, platform: ConstructionActor;
let viewing: Awaited<ReturnType<typeof exchangeCameraEntry>>, jpeg: Buffer, snapshots = 0, failStop = false;
const commands: string[] = [];
const wvp = new WvpClient({ origin: 'http://wvp.test', mediaOrigin: 'http://media.test', username: 'fixture', password: 'fixture' }, (async (input: URL) => {
  const u = new URL(String(input));
  if (u.pathname === '/api/user/login') return Response.json({ code: 0, data: { accessToken: 'fixture' } });
  if (u.pathname.endsWith('/channels')) return Response.json({ code: 0, data: { list: [{ deviceId: '90020000001320000004', status: 'ON' }] } });
  if (u.pathname.includes('/play/start')) return Response.json({ code: 0, data: { app: 'rtp', stream: 'fixture' } });
  if (u.pathname.includes('/play/snap')) { snapshots++; return Response.json({ code: 0, data: '/opt/wvp/snap/90020000001320000003_90020000001320000004_20261022170000.jpg' }); }
  if (u.pathname.startsWith('/api/device/query/snap/')) return new Response(new Uint8Array(jpeg));
  if (u.pathname.includes('/ptz/')) { const cmd = u.searchParams.get('command')!; commands.push(cmd); if (cmd === 'stop' && failStop) return new Response(null, { status: 503 }); return new Response(null, { status: 200 }); }
  throw Error('unexpected upstream route');
}) as typeof fetch);
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/cloud_camera_unit_eval');
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#00b879' } }).jpeg().toBuffer();
  await withPlatformTransaction(async tx => {
    const role = await one(tx, sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`); assert.equal(role?.rolsuper, false); assert.equal(role?.rolbypassrls, false);
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); eids.push(eid); admins.push([]);
      const uid = String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id); uids.push(uid);
      const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'摄像头隔离验收客户','13800000000','natural') returning id`))!.id);
      const pid = String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${lead},'摄像头隔离验收工地') returning id`))!.id); pids.push(pid);
      for (const role of ['enterprise_admin','construction_staff','construction_staff','admin','super_admin']) {
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
          values(${eid},${prefix+n+role+admins[n].length},'synthetic-only',${role},'active',false) returning id`))!.id); admins[n].push(aid);
      }
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${admins[n][1]},'manager'),(${eid},${pid},${admins[n][2]},'worker')`);
    }
  });
  owner = { enterpriseId: eids[0], adminId: admins[0][0] }; manager = { enterpriseId: eids[0], adminId: admins[0][1] }; platform = { enterpriseId: eids[0], adminId: admins[0][3] };
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) {
      for (const table of ['construction_camera_controls','construction_camera_snapshots','construction_camera_sessions','construction_camera_entries','construction_camera_bindings','construction_cameras','construction_audits','construction_members','construction_projects','leads','admin_users','enterprises']) await tx.execute(sql`delete from ${sql.raw('app.'+table)} where ${sql.raw(table === 'enterprises' ? 'id' : 'enterprise_id')}=${eid}`);
    }
    for (const uid of uids) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { await closePostgresPool(); }
});
async function enter(actor = manager) { const e = await new CameraService(actor,wvp).entry(pids[0]); return exchangeCameraEntry(e.url.split('#entry=')[1]); }
test('only platform administrators allocate verified channels; owner/admin/super_admin inherit project management', async () => {
  const input = { deviceId: '90020000001320000003', channelId: '90020000001320000004', name: '验收摄像头' };
  await assert.rejects(new CameraService(owner,wvp).register(input), /forbidden/);
  const camera = await new CameraService(platform,wvp).register(input); cameraId = String(camera.id);
  assert.equal(String((await new CameraService(platform,wvp).register(input)).id), cameraId);
  for (const aid of [admins[0][0],admins[0][3],admins[0][4]]) assert.equal((await new CameraService({ enterpriseId:eids[0],adminId:aid },wvp).list(pids[0])).canManage, true);
  const b = await new CameraService(owner,wvp).bind(pids[0], { cameraId, expectedVersion:1, bind:true }); bindingId = String(b.bindingId);
  assert.equal(String((await new CameraService(owner,wvp).bind(pids[0], { cameraId, expectedVersion:1, bind:true })).bindingId),bindingId);
  await assert.rejects(new CameraService({ enterpriseId:eids[1],adminId:admins[1][0] },wvp).bind(pids[1], { cameraId, expectedVersion:2, bind:true }), /unavailable/);
  assert.equal((await withTenantTransaction(eids[1],tx=>rows(tx,sql`select * from app.construction_cameras where id=${cameraId}`))).length,0);
});
test('one-time entry redemption is atomic; unknown projects and replay fail', async () => {
  const entry = await new CameraService(manager,wvp).entry(pids[0]), token = entry.url.split('#entry=')[1];
  const attempts = await Promise.allSettled([exchangeCameraEntry(token),exchangeCameraEntry(token)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1); viewing = (attempts.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<typeof viewing>).value;
  await assert.rejects(new CameraService(manager,wvp).entry(pids[1]), /unavailable/);
  assert.equal((await sessionState(viewing.session)).project.name,'摄像头隔离验收工地');
});
test('live leases isolate viewers, reject old generations, and recheck membership and session expiry', async () => {
  const other = await enter();
  const a = await startCameraView(viewing.session,viewing.csrf,bindingId,wvp), b = await startCameraView(other.session,other.csrf,bindingId,wvp);
  assert.deepEqual(await authorizeCameraMedia(viewing.session,a.generation),{app:'rtp',stream:'fixture'});
  await sessionHeartbeat(viewing.session,viewing.csrf,true);
  await assert.rejects(authorizeCameraMedia(viewing.session,a.generation),/expired/);
  assert.equal((await authorizeCameraMedia(other.session,b.generation)).stream,'fixture');
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eids[0]} and project_id=${pids[0]} and admin_id=${manager.adminId}`));
  await assert.rejects(authorizeCameraMedia(other.session,b.generation),/unavailable/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_members set active=true where enterprise_id=${eids[0]} and project_id=${pids[0]} and admin_id=${manager.adminId}`));
  await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_camera_sessions set expires_at=now()-interval '1 second' where token_hash=${digest(other.session)}`));
  await assert.rejects(sessionState(other.session),/expired/);
});
test('capture persists decoded private images; retries do not capture twice; members cannot capture', async () => {
  const key = randomUUID();
  const first = await captureCamera(viewing.session,viewing.csrf,bindingId,key,wvp);
  assert.equal(first.state,'ready'); const repeated = await captureCamera(viewing.session,viewing.csrf,bindingId,key,wvp);
  assert.equal(String(first.id),String(repeated.id)); assert.equal(snapshots,1);
  const reentry = await enter(), history = await cameraSnapshots(reentry.session); assert.equal((history.items as Row[]).length,1);
  const image = await cameraSnapshots(reentry.session,String(first.id)); assert.equal((await sharp(image.data as Buffer).metadata()).width,64);
  const worker = await enter({ enterpriseId:eids[0],adminId:admins[0][2] });
  await assert.rejects(captureCamera(worker.session,worker.csrf,bindingId,randomUUID(),wvp),/forbidden/);
});
test('unsafe origins/CSRF fail before any write', async () => {
  const request = (origin: string, csrf: string) => new Request('http://localhost:3017/api/construction-camera/heartbeat',{ method:'POST',headers:{origin,cookie:'construction_camera_session='+viewing.session,'x-camera-csrf':csrf},body:'{}' });
  assert.equal((await sessionCameraHttp(request('https://attacker.test',viewing.csrf),['heartbeat'])).status,403);
  assert.equal((await sessionCameraHttp(request('http://localhost:3017','wrong'),['heartbeat'])).status,401);
  assert.equal((await sessionCameraHttp(request('http://localhost:3017',viewing.csrf),['heartbeat'])).status,200);
});
test('PTZ pulses always stop, reject replays, and recover durable unknown STOP after failure', async () => {
  await assert.rejects(cameraPtz(viewing.session,viewing.csrf,bindingId,'left',1,wvp),/unavailable/);
  await assert.rejects(new CameraService(manager,wvp).configure(pids[0],{cameraId,expectedVersion:2,ptzEnabled:true}),/forbidden/);
  await new CameraService(owner,wvp).configure(pids[0],{cameraId,expectedVersion:2,ptzEnabled:true});
  await cameraPtz(viewing.session,viewing.csrf,bindingId,'left',1,wvp); assert.deepEqual(commands.slice(-2),['left','stop']);
  await assert.rejects(cameraPtz(viewing.session,viewing.csrf,bindingId,'left',1,wvp),/expired/);
  failStop=true; await assert.rejects(cameraPtz(viewing.session,viewing.csrf,bindingId,'right',2,wvp),/unavailable/);
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select stop_required from app.construction_camera_controls where camera_id=${cameraId}`)))?.stop_required,true);
  await assert.rejects(cameraPtz(viewing.session,viewing.csrf,bindingId,'left',3,wvp),/busy/);
  failStop=false; await withPlatformTransaction(tx=>tx.execute(sql`update app.construction_camera_controls set expires_at=now()-interval '1 second' where camera_id=${cameraId}`));
  await cameraWatchdog(wvp); assert.equal(commands.at(-1),'stop');
  assert.equal((await withTenantTransaction(eids[0],tx=>one(tx,sql`select stop_required from app.construction_camera_controls where camera_id=${cameraId}`)))?.stop_required,false);
  const nextViewer=await enter();
  await cameraPtz(nextViewer.session,nextViewer.csrf,bindingId,'left',1,wvp);
  await cameraPtz(nextViewer.session,nextViewer.csrf,bindingId,'right',2,wvp);
  assert.deepEqual(commands.slice(-4),['left','stop','right','stop']);
});
test('unbind revokes active media and rebind never resurrects its old generation; snapshots remain with original project', async () => {
  const view = await startCameraView(viewing.session,viewing.csrf,bindingId,wvp);
  await new CameraService(owner,wvp).bind(pids[0],{ cameraId,expectedVersion:3,bind:false });
  await assert.rejects(authorizeCameraMedia(viewing.session,view.generation),/expired|unavailable/);
  const next = await new CameraService(owner,wvp).bind(pids[0],{ cameraId,expectedVersion:4,bind:true }); assert.notEqual(String(next.bindingId),bindingId);
  await assert.rejects(startCameraView(viewing.session,viewing.csrf,bindingId,wvp),/unavailable/);
  assert.equal(((await cameraSnapshots(viewing.session)).items as Row[]).length,1);
});
test('platform administrator without enterprise membership retains registration and configuration access',async()=>{
  const aid=admins[0][3];
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set enterprise_id=null where id=${aid}`));
  try {
    assert.equal((await new CameraService(platform,wvp).inventory(pids[0])).canRegister,true);
    assert.equal((await new CameraService(platform,wvp).list(pids[0])).canConfigure,true);
    assert.equal(String((await new CameraService(platform,wvp).register({deviceId:'90020000001320000003',channelId:'90020000001320000004',name:'验收摄像头'})).id),cameraId);
  }finally{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set enterprise_id=${eids[0]} where id=${aid}`));}
});
