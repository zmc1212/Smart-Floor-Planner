import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { cameraActivity } from '@/lib/construction/camera-activity';

const prefix = 'activity-only-test-' + randomUUID(), enterprises: string[] = [], users: string[] = [], projects: string[] = [], bindings: string[] = [], actors: ConstructionActor[][] = [], auditIds: string[] = [];
let oldBinding = '';
before(async () => {
  const database = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(database.port, '55432'); assert.equal(database.pathname, '/cloud_camera_activity_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); enterprises.push(eid); actors.push([]);
      const uid = String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id); users.push(uid);
      const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'运行记录隔离客户','13800000000','natural') returning id`))!.id);
      const pid = String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${lead},'运行记录隔离工地') returning id`))!.id); projects.push(pid);
      for (const role of ['enterprise_admin', 'admin', 'super_admin', 'construction_staff', 'construction_staff']) {
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eid},${prefix+n+role+actors[n].length},'synthetic-only',${role},'active',false) returning id`))!.id);
        actors[n].push({ enterpriseId: eid, adminId: aid });
      }
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${actors[n][3].adminId},'manager'),(${eid},${pid},${actors[n][4].adminId},'worker')`);
      const cid = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name) values(${eid},${String(91000000000000000000n+BigInt(n))},${String(91000000000000000100n+BigInt(n))},'无真实设备的运行记录fixture') returning id`))!.id);
      if (!n) oldBinding = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at,ended_at) values(${eid},${pid},${cid},now()-interval '3 days',now()-interval '2 days') returning id`))!.id);
      const bid = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at) values(${eid},${pid},${cid},now()-interval '1 day') returning id`))!.id); bindings.push(bid);
      await tx.execute(sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,state) values(${eid},${pid},${bid},${cid},'stopped')`);
    }
    const actions = ['camera.recording.configure', 'camera.storage.ok', 'camera.storage.warning', 'camera.storage.critical', 'camera.storage.blocked', 'camera.storage.unavailable'];
    for (let i = 0; i < 25; i++) {
      const action = actions[i % actions.length], snapshot = { bindingId: bindings[0], enabled: i % 2 === 0, retentionDays: 3, reason: i % 6 === 4 ? 'camera_storage_low' : null, usedPercent: i % 6 === 4 ? 96.1 : 40, secret: 'never-return-this' };
      auditIds.push(String((await one(tx, sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot,created_at) values(${enterprises[0]},${projects[0]},${JSON.stringify({kind: action.endsWith('configure') ? 'admin' : 'system', id: 'never-return-actor'})}::jsonb,${action},${JSON.stringify(snapshot)}::jsonb,'2026-10-23T09:00:00.123Z') returning id`))!.id));
    }
    for (const [eid, pid, bid, action] of [[enterprises[0], projects[0], oldBinding, 'camera.recording.configure'], [enterprises[0], projects[0], bindings[0], 'camera.snapshot'], [enterprises[1], projects[1], bindings[0], 'camera.storage.blocked']]) {
      await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot) values(${eid},${pid},'{"kind":"system"}'::jsonb,${action},${JSON.stringify({bindingId:bid,secret:'do-not-leak'})}::jsonb)`);
    }
  });
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of enterprises) {
      for (const table of ['construction_audits', 'construction_camera_recording_policies', 'construction_camera_bindings', 'construction_cameras', 'construction_members', 'construction_projects', 'leads', 'admin_users']) await tx.execute(sql`delete from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.enterprises where id=${eid}`);
    }
    for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { await closePostgresPool(); }
});
test('owner, admin and super_admin read persisted records without employment or membership', async () => {
  for (const actor of actors[0].slice(0, 3)) {
    const result = await cameraActivity(actor, projects[0], bindings[0]);
    assert.equal(result.items.length, 20); assert.equal(result.items[0].id, auditIds.at(-1)); assert.equal(result.nextCursor, auditIds[5]);
    assert.equal(JSON.stringify(result).includes('never-return'), false); assert.equal(JSON.stringify(result).includes('do-not-leak'), false);
  }
});
test('ID cursor covers equal-timestamp records exactly once and persists on reentry', async () => {
  const first = await cameraActivity(actors[0][0], projects[0], bindings[0]);
  const second = await cameraActivity(actors[0][0], projects[0], bindings[0], first.nextCursor!);
  assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map(item => item.id), [...auditIds].reverse());
  assert.deepEqual(await cameraActivity(actors[0][0], projects[0], bindings[0]), first);
});
test('manager/member and foreign project/binding or retired binding cannot read owner history', async () => {
  for (const actor of actors[0].slice(3)) await assert.rejects(cameraActivity(actor, projects[0], bindings[0]), { code: 'camera_forbidden' });
  await assert.rejects(cameraActivity(actors[0][0], projects[1], bindings[1]), { code: 'camera_project_unavailable' });
  await assert.rejects(cameraActivity(actors[0][0], projects[0], bindings[1]), { code: 'camera_binding_unavailable' });
  await assert.rejects(cameraActivity(actors[0][0], projects[0], oldBinding), { code: 'camera_binding_unavailable' });
});
test('malformed cursors fail validation and an unused binding has a real empty state', async () => {
  for (const cursor of ['', '0', '-1', '1.5', '1e3', '9223372036854775808']) await assert.rejects(cameraActivity(actors[0][0], projects[0], bindings[0], cursor), { status: 422 });
  assert.deepEqual(await cameraActivity(actors[1][0], projects[1], bindings[1]), { items: [], nextCursor: null });
});
test('reading history changes neither policy nor persisted audits', async () => {
  const snapshot = () => withTenantTransaction(enterprises[0], async tx => ({ policy: await one(tx, sql`select * from app.construction_camera_recording_policies where binding_id=${bindings[0]}`), audits: await one(tx, sql`select count(*)::integer count,max(id)::text newest from app.construction_audits where project_id=${projects[0]}`) }));
  const prior = await snapshot(); await cameraActivity(actors[0][0], projects[0], bindings[0]); assert.deepEqual(await snapshot(), prior);
});
