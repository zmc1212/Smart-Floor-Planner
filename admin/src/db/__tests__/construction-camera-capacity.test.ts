import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { cameraCapacity } from '@/lib/construction/camera-capacity';

const prefix = 'capacity-only-test-' + randomUUID(), enterprises: string[] = [], users: string[] = [], projects: string[] = [], bindings: string[] = [], actors: ConstructionActor[][] = [];
let active = '', oldBinding = '', sourceId = 1;
async function addRecord(tx: Parameters<Parameters<typeof withPlatformTransaction>[0]>[0], eid: string, pid: string, bid: string, startMinutes: number, seconds: number, bytes: number, state = 'ready', error: string | null = null) {
  await tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,state,last_error)
    values(${eid},${pid},${bid},${sourceId++},${prefix},'synthetic','capacity-only','/opt/media/www/record/synthetic-only.mp4',
    now()+${startMinutes}*interval '1 minute',now()+${startMinutes}*interval '1 minute'+${seconds}*interval '1 second',${bytes},${state},${error})`);
}
before(async () => {
  const database = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(database.port, '55432'); assert.equal(database.pathname, '/cloud_camera_capacity_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); enterprises.push(eid); actors.push([]);
      const uid = String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id); users.push(uid);
      const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'容量只读验收客户','13800000000','natural') returning id`))!.id);
      const pid = String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${lead},'容量只读隔离工地') returning id`))!.id); projects.push(pid);
      for (const role of ['enterprise_admin', 'admin', 'super_admin', 'construction_staff', 'construction_staff']) {
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eid},${prefix+n+role+actors[n].length},'synthetic-only',${role},'active',false) returning id`))!.id);
        actors[n].push({ enterpriseId: eid, adminId: aid });
      }
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${actors[n][3].adminId},'manager'),(${eid},${pid},${actors[n][4].adminId},'worker')`);
      const cid = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name) values(${eid},${String(90000000000000000000n+BigInt(n))},${String(90000000000000000100n+BigInt(n))},'无真实设备的容量fixture') returning id`))!.id);
      if (n === 0) {
        oldBinding = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at,ended_at) values(${eid},${pid},${cid},now()-interval '3 days',now()-interval '2 days') returning id`))!.id);
        await tx.execute(sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,state) values(${eid},${pid},${oldBinding},${cid},'stopped')`);
        await addRecord(tx, eid, pid, oldBinding, -60, 60, 999999999);
      }
      const bid = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at) values(${eid},${pid},${cid},now()-interval '2 days') returning id`))!.id); bindings.push(bid);
      await tx.execute(sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,state) values(${eid},${pid},${bid},${cid},'stopped')`);
    }
    active = bindings[0];
    await addRecord(tx, enterprises[0], projects[0], active, -20, 120, 15000000);
    await addRecord(tx, enterprises[0], projects[0], active, -10, 60, 7500000);
    await addRecord(tx, enterprises[0], projects[0], active, -1500, 60, 999999999);
    await addRecord(tx, enterprises[0], projects[0], active, 1500, 60, 999999999);
    await addRecord(tx, enterprises[0], projects[0], active, -40, 60, 1000000, 'deleting');
    await addRecord(tx, enterprises[0], projects[0], active, -50, 60, 2000000, 'deleting', 'synthetic_delete_failure');
    await addRecord(tx, enterprises[0], projects[0], active, -60, 60, 900000000, 'deleted');
    await addRecord(tx, enterprises[0], projects[0], active, -70, 60, 900000000, 'missing');
  });
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of enterprises) {
      for (const table of ['construction_recordings', 'construction_camera_recording_policies', 'construction_camera_bindings', 'construction_cameras', 'construction_members', 'construction_projects', 'leads', 'admin_users']) await tx.execute(sql`delete from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.enterprises where id=${eid}`);
    }
    for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { await closePostgresPool(); }
});
test('all three owner-management roles read estimates without employment or project membership', async () => {
  for (const actor of actors[0].slice(0, 3)) {
    const result = await cameraCapacity(actor, projects[0], active);
    assert.equal(result.averageMbps, 1); assert.equal(result.bytesPerDay, '10800000000');
    assert.equal(result.sample.segments, 2); assert.equal(result.sample.seconds, 180);
    assert.equal(result.indexed.pendingDeletion, 2); assert.equal(result.indexed.failedDeletion, 1);
    assert.equal(result.indexed.segments, 6); assert.equal(result.indexed.bytes, '2025499998');
    assert.equal(JSON.stringify(result).includes('file_path'), false); assert.equal(JSON.stringify(result).includes('synthetic_delete_failure'), false);
  }
});
test('manager and ordinary member cannot read owner capacity or cleanup metadata', async () => {
  for (const actor of actors[0].slice(3)) await assert.rejects(cameraCapacity(actor, projects[0], active), { code: 'camera_forbidden' });
});
test('foreign project/binding and retired binding remain inaccessible', async () => {
  await assert.rejects(cameraCapacity(actors[0][0], projects[1], bindings[1]), { code: 'camera_project_unavailable' });
  await assert.rejects(cameraCapacity(actors[0][0], projects[0], bindings[1]), { code: 'camera_binding_unavailable' });
  await assert.rejects(cameraCapacity(actors[0][0], projects[0], oldBinding), { code: 'camera_binding_unavailable' });
});
test('fresh reentry with no usable sealed media stays unknown and reads do not change policies', async () => {
  const policy = () => withTenantTransaction(enterprises[0], tx => one(tx, sql`select enabled,retention_days,version,state from app.construction_camera_recording_policies where binding_id=${active}`));
  const before = await policy(); await cameraCapacity(actors[0][0], projects[0], active); assert.deepEqual(await policy(), before);
  for (let n = 0; n < 2; n++) { const result = await cameraCapacity(actors[1][0], projects[1], bindings[1]); assert.equal(result.bytesPerDay, null); assert.equal(result.averageMbps, null); }
});
