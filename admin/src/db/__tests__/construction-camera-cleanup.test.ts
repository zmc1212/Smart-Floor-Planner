import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { cameraCleanup } from '@/lib/construction/camera-cleanup';

const prefix = 'cleanup-only-test-' + randomUUID(), enterprises: string[] = [], users: string[] = [], projects: string[] = [], bindings: string[] = [], cameras: string[] = [], actors: ConstructionActor[][] = [], recordIds: string[] = [];
let oldBinding = '', emptyBinding = '';
before(async () => {
  const database = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(database.port, '55432'); assert.equal(database.pathname, '/cloud_camera_cleanup_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); enterprises.push(eid); actors.push([]);
      const uid = String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id); users.push(uid);
      const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'清理记录隔离客户','13800000000','natural') returning id`))!.id);
      const pid = String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${lead},'清理记录隔离工地') returning id`))!.id); projects.push(pid);
      for (const role of ['enterprise_admin', 'admin', 'super_admin', 'construction_staff', 'construction_staff']) {
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eid},${prefix+n+role+actors[n].length},'synthetic-only',${role},'active',false) returning id`))!.id);
        actors[n].push({ enterpriseId: eid, adminId: aid });
      }
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${actors[n][3].adminId},'manager'),(${eid},${pid},${actors[n][4].adminId},'worker')`);
      const cid = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name) values(${eid},${String(92000000000000000000n+BigInt(n))},${String(92000000000000000100n+BigInt(n))},'无真实设备的清理记录fixture') returning id`))!.id); cameras.push(cid);
      if (!n) oldBinding = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at,ended_at) values(${eid},${pid},${cid},now()-interval '4 days',now()-interval '3 days') returning id`))!.id);
      const bid = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at) values(${eid},${pid},${cid},now()-interval '2 days') returning id`))!.id); bindings.push(bid);
      await tx.execute(sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,state) values(${eid},${pid},${bid},${cid},'stopped')`);
      for (let i = 0; i < (n ? 1 : 25); i++) {
        const state = ['deleting', 'deleting', 'deleting', 'deleted', 'missing'][i % 5];
        const error = [null, 'camera_recording_conflict', 'camera_recording_delete_unconfirmed', 'old-private-error', 'old-private-error'][i % 5];
        const rid = String((await one(tx, sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,state,deleted_at,last_error)
          values(${eid},${pid},${bid},${i+1},${prefix+n},'rtp','private-stream','/opt/media/private.mp4','2026-10-22T23:55:00.123Z','2026-10-23T00:05:00.456Z',1024,${state},${state==='deleted' ? '2026-10-23T01:00:00.123Z' : null},${error}) returning id`))!.id);
        if (!n) recordIds.push(rid);
      }
      await tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,state)
        values(${eid},${pid},${bid},100,${prefix+n},'rtp','private-stream','/opt/media/ready.mp4','2026-10-23T02:00:00Z','2026-10-23T02:10:00Z',2048,'ready')`);
      if (n) {
        const emptyCamera = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name) values(${eid},'92000000000000000002','92000000000000000102','空记录fixture') returning id`))!.id);
        emptyBinding = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id) values(${eid},${pid},${emptyCamera}) returning id`))!.id);
      }
    }
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
test('all three management roles read durable cleanup rows without employment or membership', async () => {
  for (const actor of actors[0].slice(0, 3)) {
    const result = await cameraCleanup(actor, projects[0], bindings[0]);
    assert.equal(result.items.length, 20); assert.equal(result.items[0].id, recordIds.at(-1));
    assert.equal(result.nextCursor, recordIds[5]);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(result.items.filter(item => item.failure !== null).length, 8);
    assert.ok(result.items.some(item => item.state === 'deleted' && item.deletedAt === '2026-10-23T01:00:00.123Z'));
  }
});
test('stable ID pages cover equal source timestamps once and restore on reentry', async () => {
  const first = await cameraCleanup(actors[0][0], projects[0], bindings[0]);
  const second = await cameraCleanup(actors[0][0], projects[0], bindings[0], first.nextCursor!);
  assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map(item => item.id), [...recordIds].reverse());
  assert.deepEqual(await cameraCleanup(actors[0][0], projects[0], bindings[0]), first);
});
test('manager/member, foreign project/binding and retired binding are denied', async () => {
  for (const actor of actors[0].slice(3)) await assert.rejects(cameraCleanup(actor, projects[0], bindings[0]), { code: 'camera_forbidden' });
  await assert.rejects(cameraCleanup(actors[0][0], projects[1], bindings[1]), { code: 'camera_project_unavailable' });
  await assert.rejects(cameraCleanup(actors[0][0], projects[0], bindings[1]), { code: 'camera_binding_unavailable' });
  await assert.rejects(cameraCleanup(actors[0][0], projects[0], oldBinding), { code: 'camera_binding_unavailable' });
});
test('disabled cameras revoke cleanup reads immediately', async () => {
  await withTenantTransaction(enterprises[0], tx => tx.execute(sql`update app.construction_cameras set enabled=false where id=${cameras[0]}`));
  try { await assert.rejects(cameraCleanup(actors[0][0], projects[0], bindings[0]), { code: 'camera_binding_unavailable' }); }
  finally { await withTenantTransaction(enterprises[0], tx => tx.execute(sql`update app.construction_cameras set enabled=true where id=${cameras[0]}`)); }
});
test('foreign persisted records exist but remain invisible through tenant RLS', async () => {
  await withPlatformTransaction(async tx => assert.equal((await one(tx, sql`select count(*)::integer count from app.construction_recordings where enterprise_id=${enterprises[1]}`))?.count, 2));
  await withTenantTransaction(enterprises[0], async tx => assert.deepEqual(await rows(tx, sql`select id from app.construction_recordings where enterprise_id=${enterprises[1]}`), []));
  assert.equal((await cameraCleanup(actors[1][0], projects[1], bindings[1])).items.length, 1);
});
test('invalid IDs/cursors fail and a real unused binding returns an empty page', async () => {
  for (const cursor of ['', '0', '-1', '1.5', '1e3', '9223372036854775808']) await assert.rejects(cameraCleanup(actors[0][0], projects[0], bindings[0], cursor), { status: 422 });
  await assert.rejects(cameraCleanup(actors[0][0], '0', bindings[0]), { status: 422 });
  await assert.rejects(cameraCleanup(actors[0][0], projects[0], '-1'), { status: 422 });
  assert.deepEqual(await cameraCleanup(actors[1][0], projects[1], emptyBinding), { items: [], nextCursor: null });
});
test('reads never mutate policy, records or audits and ready footage is excluded', async () => {
  const snapshot = () => withTenantTransaction(enterprises[0], async tx => ({ policy: await one(tx, sql`select * from app.construction_camera_recording_policies where binding_id=${bindings[0]}`), records: await rows(tx, sql`select * from app.construction_recordings where binding_id=${bindings[0]} order by id`), audits: await rows(tx, sql`select * from app.construction_audits where project_id=${projects[0]}`) }));
  const prior = await snapshot(); await cameraCleanup(actors[0][0], projects[0], bindings[0]); assert.deepEqual(await snapshot(), prior);
  assert.equal(prior.records.length, 26);
});
