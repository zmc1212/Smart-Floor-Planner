import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { cameraCoverage } from '@/lib/construction/camera-coverage';

const prefix = 'coverage-only-test-' + randomUUID(), enterprises: string[] = [], users: string[] = [], projects: string[] = [], bindings: string[] = [], cameras: string[] = [], actors: ConstructionActor[][] = [];
let day = '', start = 0, oldBinding = '';
before(async () => {
  const database = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(database.port, '55432'); assert.equal(database.pathname, '/cloud_camera_coverage_eval');
  await withPlatformTransaction(async tx => {
    const clock = await one(tx, sql`select now() clock`);
    day = new Date(new Date(String(clock!.clock)).getTime() - 16 * 3600000).toISOString().slice(0, 10);
    start = new Date(day + 'T00:00:00+08:00').getTime();
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); enterprises.push(eid); actors.push([]);
      const uid = String((await one(tx, sql`insert into app.users(nickname) values(${prefix+n}) returning id`))!.id); users.push(uid);
      const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'录像覆盖隔离客户','13800000000','natural') returning id`))!.id);
      const pid = String((await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${lead},'录像覆盖隔离工地') returning id`))!.id); projects.push(pid);
      for (const role of ['enterprise_admin', 'admin', 'super_admin', 'construction_staff', 'construction_staff']) {
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eid},${prefix+n+role+actors[n].length},'synthetic-only',${role},'active',false) returning id`))!.id);
        actors[n].push({ enterpriseId: eid, adminId: aid });
      }
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${actors[n][3].adminId},'manager'),(${eid},${pid},${actors[n][4].adminId},'worker')`);
      const cid = String((await one(tx, sql`insert into app.construction_cameras(enterprise_id,device_id,channel_id,name) values(${eid},${String(92000000000000000000n+BigInt(n))},${String(92000000000000000100n+BigInt(n))},'无真实设备的录像覆盖fixture') returning id`))!.id); cameras.push(cid);
      if (!n) oldBinding = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at,ended_at) values(${eid},${pid},${cid},now()-interval '6 days',now()-interval '5 days') returning id`))!.id);
      const bid = String((await one(tx, sql`insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id,started_at) values(${eid},${pid},${cid},now()-interval '4 days') returning id`))!.id); bindings.push(bid);
      await tx.execute(sql`insert into app.construction_camera_recording_policies(enterprise_id,project_id,binding_id,camera_id,state) values(${eid},${pid},${bid},${cid},'stopped')`);
    }
    const minute = 60000;
    const ranges = [[-10, 10, 'ready'], [600, 660, 'ready'], [630, 690, 'ready'], [720, 750, 'ready'], [1430, 1450, 'ready'], [690, 720, 'deleting'], [690, 720, 'deleted'], [690, 720, 'missing']] as const;
    for (let i = 0; i < ranges.length; i++) {
      const [a, b, state] = ranges[i];
      await tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,state)
        values(${enterprises[0]},${projects[0]},${bindings[0]},${i+1},${prefix},'rtp','synthetic','/opt/media/www/record/never-request-this-private-file.mp4',${new Date(start+a*minute)},${new Date(start+b*minute)},100,${state})`);
    }
    await tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes)
      values(${enterprises[1]},${projects[1]},${bindings[1]},100,${prefix},'rtp','foreign-synthetic','/opt/media/www/record/other-tenant.mp4',${new Date(start+13*3600000)},${new Date(start+13*3600000+30000)},100)`);
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

test('all three owner roles read persisted union coverage and exact gaps without employment or membership', async () => {
  for (const actor of actors[0].slice(0, 3)) {
    const result = await cameraCoverage(actor, projects[0], bindings[0], day);
    assert.equal(result.segments, 5); assert.equal(result.ranges.length, 4); assert.equal(result.coveredMilliseconds, 140 * 60000);
    assert.deepEqual(result.gaps.map(item => item.milliseconds), [590, 30, 680].map(value => value * 60000));
    assert.equal(result.truncated, false); assert.equal(JSON.stringify(result).includes('never-request'), false); assert.equal(JSON.stringify(result).includes('file_path'), false);
  }
});
test('readback/reentry is stable; populated tenant isolation and empty dates do not fabricate gaps', async () => {
  const prior = await cameraCoverage(actors[0][0], projects[0], bindings[0], day);
  const current = await cameraCoverage(actors[0][0], projects[0], bindings[0], day);
  assert.deepEqual({ ...current, sampledAt: null }, { ...prior, sampledAt: null });
  const other = await cameraCoverage(actors[1][0], projects[1], bindings[1], day);
  assert.equal(other.segments, 1); assert.equal(other.coveredMilliseconds, 30000); assert.deepEqual(other.gaps, []);
  const empty = await cameraCoverage(actors[0][0], projects[0], bindings[0], '2020-01-01');
  assert.deepEqual(empty.ranges, []); assert.deepEqual(empty.gaps, []); assert.equal(empty.coveredMilliseconds, 0);
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::integer count from app.construction_recordings where enterprise_id=${enterprises[1]}`)))!.count, 1);
  assert.equal((await withTenantTransaction(enterprises[0], tx => one(tx, sql`select count(*)::integer count from app.construction_recordings where enterprise_id=${enterprises[1]}`)))!.count, 0);
});
test('manager/member, foreign project/binding and retired binding are denied; disabled camera revokes reads', async () => {
  for (const actor of actors[0].slice(3)) await assert.rejects(cameraCoverage(actor, projects[0], bindings[0], day), { code: 'camera_forbidden' });
  await assert.rejects(cameraCoverage(actors[0][0], projects[1], bindings[1], day), { code: 'camera_project_unavailable' });
  await assert.rejects(cameraCoverage(actors[0][0], projects[0], bindings[1], day), { code: 'camera_binding_unavailable' });
  await assert.rejects(cameraCoverage(actors[0][0], projects[0], oldBinding, day), { code: 'camera_binding_unavailable' });
  try {
    await withTenantTransaction(enterprises[0], tx => tx.execute(sql`update app.construction_cameras set enabled=false where id=${cameras[0]}`));
    await assert.rejects(cameraCoverage(actors[0][0], projects[0], bindings[0], day), { code: 'camera_binding_unavailable' });
  } finally { await withTenantTransaction(enterprises[0], tx => tx.execute(sql`update app.construction_cameras set enabled=true where id=${cameras[0]}`)); }
});
test('strict dates and IDs reject malformed inputs', async () => {
  for (const value of ['', '2026-02-30', '2026-1-01', '2026-10-23T00:00:00Z', null]) await assert.rejects(cameraCoverage(actors[0][0], projects[0], bindings[0], value), { status: 422 });
  for (const value of ['0', '-1', '1.1', '9223372036854775808']) await assert.rejects(cameraCoverage(actors[0][0], projects[0], value, day), { status: 422 });
});
test('conservative clock/retention boundary excludes an otherwise ready expired file', async () => {
  await withTenantTransaction(enterprises[0], async tx => {
    await tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes,clock_offset_min_ms,clock_offset_max_ms)
      values(${enterprises[0]},${projects[0]},${bindings[0]},90,${prefix},'rtp','synthetic','/opt/media/www/record/expired.mp4',now()-interval '3 days'+interval '30 seconds',now()-interval '3 days'+interval '90 seconds',1,-60000,0)`);
  });
  const r = await withTenantTransaction(enterprises[0], tx => one(tx, sql`select started_at from app.construction_recordings where media_server_id=${prefix} and source_id=90`));
  const expiredDay = new Date(new Date(String(r!.started_at)).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  assert.equal((await cameraCoverage(actors[0][0], projects[0], bindings[0], expiredDay)).segments, 0);
});
test('read-only summary preserves complete recording and policy rows', async () => {
  const snapshot = () => withTenantTransaction(enterprises[0], async tx => ({ policy: await one(tx, sql`select to_jsonb(p)::text value from app.construction_camera_recording_policies p where binding_id=${bindings[0]}`), records: await one(tx, sql`select jsonb_agg(to_jsonb(r) order by r.id)::text value from app.construction_recordings r where binding_id=${bindings[0]}`) }));
  const prior = await snapshot(); await cameraCoverage(actors[0][0], projects[0], bindings[0], day); assert.deepEqual(await snapshot(), prior);
});
test('large days are bounded and explicitly partial, with one-row lookahead', async () => {
  try {
    await withTenantTransaction(enterprises[0], tx => tx.execute(sql`insert into app.construction_recordings(enterprise_id,project_id,binding_id,source_id,media_server_id,stream_app,stream_id,file_path,started_at,ended_at,bytes)
      select ${enterprises[0]}::bigint,${projects[0]}::bigint,${bindings[0]}::bigint,1000+i,${prefix},'rtp','synthetic','/opt/media/www/record/partial.mp4',${new Date(start+13*3600000)}::timestamptz+i*interval '1 millisecond',${new Date(start+13*3600000)}::timestamptz+(i+1)*interval '1 millisecond',1 from generate_series(1,1001) i`));
    const result = await cameraCoverage(actors[0][0], projects[0], bindings[0], day);
    assert.equal(result.segments, 1000); assert.equal(result.limit, 1000); assert.equal(result.truncated, true);
  } finally { await withTenantTransaction(enterprises[0], tx => tx.execute(sql`delete from app.construction_recordings where media_server_id=${prefix} and source_id>1000`)); }
});
