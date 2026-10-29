import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { one, rows } from '@/db/repositories/assistant-repository';
import { TenantEnterpriseResetRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { ServiceOrderService } from '@/lib/construction/service-order';
import { GET, POST } from '@/app/api/construction/[[...path]]/route';

const prefix = 'service-order-' + randomUUID(), eids: string[] = [], uids: string[] = [];
let ownerAid: string, managerAid: string, workerAid: string, outsiderAid: string, otherOwnerAid: string, project: string, roomA: string, roomB: string;
const owner = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: ownerAid });
const manager = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: managerAid });
const worker = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: workerAid });
const outsider = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: outsiderAid });
const foreign = () => new ServiceOrderService({ enterpriseId: eids[1], adminId: otherOwnerAid });
async function cookie(aid: string, role = 'enterprise_admin') {
  return 'auth_token=' + await new SignJWT({ id: aid, role, enterpriseId: eids[0], permissions: ['construction-projects'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
async function http(method: 'GET' | 'POST', path: string[], headers: Record<string, string>, body?: unknown) {
  const request = new NextRequest('http://localhost:3006/api/construction/' + path.join('/'), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const response = await (method === 'GET' ? GET : POST)(request, { params: Promise.resolve({ path }) });
  return { status: response.status, body: await response.json() };
}
const latest = async (service = owner()) => (await service.list(project)).items[0];
const orderBody = { cameraCount: 5, retentionDays: 3, serviceDays: 90, note: '前台与客厅各两路，主卧一路' };

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      eids.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
      uids.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+'user'+n},1) returning id`))!.id));
    }
    const staff = async (eid: string, name: string, role: string) => String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix+name},'test-only',${role},'active',false,${name}) returning id`))!.id);
    ownerAid = await staff(eids[0], '隔离负责人', 'enterprise_admin');
    managerAid = await staff(eids[0], '项目经理', 'construction_staff');
    workerAid = await staff(eids[0], '安装师傅', 'construction_staff');
    outsiderAid = await staff(eids[0], '未入项目员工', 'construction_staff');
    otherOwnerAid = await staff(eids[1], '另一企业负责人', 'enterprise_admin');
  });
  const lead = String((await withPlatformTransaction(tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eids[0]},${uids[0]},'隔离云工地业主','13980000021','natural') returning id`)))!.id);
  const construction = new ConstructionService({ enterpriseId: eids[0], adminId: ownerAid });
  project = String((await construction.execute('create', { leadId: lead, name: '云工地托管验收项目', managerId: managerAid, rooms: ['客厅', '主卧'] }, randomUUID())).id);
  const rooms = (await construction.execute('detail', { projectId: project })).rooms as Array<{ id: string; name: string }>;
  roomA = rooms.find(room => room.name === '客厅')!.id; roomB = rooms.find(room => room.name === '主卧')!.id;
  await construction.execute('member', { projectId: project, expectedVersion: 1, adminId: workerAid, role: 'worker', active: true, workLabel: '安装' }, randomUUID());
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const eid of eids) await new TenantEnterpriseResetRepository(tx).purge(BigInt(eid));
      for (const user of uids) await tx.execute(sql`delete from app.users where id=${user}`);
    });
  } finally { await closePostgresPool(); }
});

test('commercial records are visible to the owner and project manager only, never to other team members or tenants', async () => {
  const view = await manager().list(project);
  assert.equal(view.owner, false); assert.deepEqual(view.items, []);
  await assert.rejects(manager().create(project, orderBody, randomUUID()), /service_order_forbidden/);
  await assert.rejects(worker().list(project), /service_order_project_unavailable/);
  await assert.rejects(outsider().list(project), /service_order_project_unavailable/);
  await assert.rejects(foreign().list(project), /service_order_project_unavailable/);
});

test('an order records camera count, retention and service period; a second open order is rejected and a replay returns the same receipt', async () => {
  const requestKey = randomUUID(), created = await owner().create(project, orderBody, requestKey);
  assert.equal(created.version, 1);
  const replay = await owner().create(project, orderBody, requestKey);
  assert.deepEqual(replay, created);
  await assert.rejects(owner().create(project, { ...orderBody, cameraCount: 3 }, randomUUID()), /service_order_open_exists/);
  const order = await latest();
  assert.equal(order.id, created.id); assert.equal(order.status, 'pending_quote');
  assert.equal(order.cameraCount, 5); assert.equal(order.retentionDays, 3); assert.equal(order.serviceDays, 90); assert.equal(order.requestNote, orderBody.note);
  assert.equal(order.quote, null);
});

test('each quote version records whole cents; a newer version withdraws the earlier confirmation and stale consent is refused', async () => {
  const order = await latest(), first = await owner().quote(project, order.id, { expectedVersion: order.version, lines: [{ label: '云工地视频托管服务', amountCents: 120000 }, { label: '安装调试', amountCents: 30000 }], depositCents: 50000, note: '含三年录像保留' }, randomUUID());
  assert.equal(first.quoteVersion, 1);
  await assert.rejects(owner().confirm(project, order.id, { expectedVersion: order.version, quoteVersion: 1 }, randomUUID()), /version_conflict/);
  const confirmed = await owner().confirm(project, order.id, { expectedVersion: first.version, quoteVersion: 1 }, randomUUID());
  assert.equal((await latest()).status, 'confirmed');
  assert.equal((await latest()).confirmedQuoteVersion, 1);
  const quote = (await latest()).quote!;
  assert.equal(quote.version, 1); assert.equal(quote.totalCents, 150000); assert.equal(quote.depositCents, 50000); assert.deepEqual(quote.lines, [{ label: '云工地视频托管服务', amountCents: 120000 }, { label: '安装调试', amountCents: 30000 }]);
  await assert.rejects(manager().quote(project, order.id, { expectedVersion: confirmed.version, lines: [{ label: '篡改', amountCents: 1 }], depositCents: 0, note: '' }, randomUUID()), /service_order_forbidden/);
  const second = await owner().quote(project, order.id, { expectedVersion: confirmed.version, lines: [{ label: '云工地视频托管服务（含押金）', amountCents: 160000 }], depositCents: 0, note: '' }, randomUUID());
  assert.equal(second.quoteVersion, 2);
  const withdrawn = await latest();
  assert.equal(withdrawn.status, 'quoted'); assert.equal(withdrawn.confirmedQuoteVersion, null);
  await assert.rejects(owner().confirm(project, order.id, { expectedVersion: withdrawn.version, quoteVersion: 1 }, randomUUID()), /service_order_quote_changed/);
  await owner().confirm(project, order.id, { expectedVersion: withdrawn.version, quoteVersion: 2 }, randomUUID());
  assert.equal((await latest()).confirmedQuoteVersion, 2);
});

test('scheduling requires an active project installer and this project rooms before any point exists', async () => {
  const order = await latest();
  const points = [{ name: '客厅东墙', roomId: roomA, positionNote: '吊顶下 2.2 米' }, { name: '主卧门侧', roomId: roomB, positionNote: '' }];
  await assert.rejects(owner().schedule(project, order.id, { expectedVersion: order.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: outsiderAid, points }, randomUUID()), /service_order_installer_unavailable/);
  await assert.rejects(owner().schedule(project, order.id, { expectedVersion: order.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: workerAid, points }, randomUUID()), /service_order_installer_unavailable/);
  await assert.rejects(owner().schedule(project, order.id, { expectedVersion: order.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: managerAid,
    points: [{ ...points[0], roomId: '999999999' }] }, randomUUID()), /service_order_room_unavailable/);
  const scheduled = await owner().schedule(project, order.id, { expectedVersion: order.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: managerAid, points }, randomUUID());
  assert.equal(scheduled.points, 2);
  const view = await latest();
  assert.equal(view.status, 'scheduled'); assert.deepEqual(view.points.map(point => [point.seq, point.name, point.status]), [[1, '客厅东墙', 'pending'], [2, '主卧门侧', 'pending']]);
  assert.equal(view.points[0].roomName, '客厅'); assert.equal(view.points[0].positionNote, '吊顶下 2.2 米');
});

test('points need installation before acceptance, honour the assigned installer, and completing every point closes the order', async () => {
  let order = await latest(); const first = order.points[0], second = order.points[1];
  await assert.rejects(worker().point(project, order.id, first.id, { expectedVersion: order.version, action: 'install' }, randomUUID()), /service_order_project_unavailable/);
  order = await latest();
  await owner().point(project, order.id, first.id, { expectedVersion: order.version, action: 'install' }, randomUUID());
  order = await latest();
  assert.equal(order.points.find(point => point.id === first.id)!.status, 'installed');
  await assert.rejects(owner().point(project, order.id, second.id, { expectedVersion: order.version, action: 'accept' }, randomUUID()), /service_order_point_not_installed/);
  await manager().point(project, order.id, first.id, { expectedVersion: order.version, action: 'accept' }, randomUUID());
  order = await latest();
  assert.equal(order.points.find(point => point.id === first.id)!.status, 'accepted'); assert.equal(order.status, 'scheduled');
  await manager().point(project, order.id, second.id, { expectedVersion: order.version, action: 'install' }, randomUUID());
  order = await latest();
  const done = await manager().point(project, order.id, second.id, { expectedVersion: order.version, action: 'accept' }, randomUUID());
  assert.equal(done.orderStatus, 'accepted');
  order = await latest();
  assert.equal(order.status, 'accepted'); assert.ok(order.acceptedAt);
  await assert.rejects(owner().cancel(project, order.id, { expectedVersion: order.version, reason: '已验收后反悔' }, randomUUID()), /service_order_conflict/);
  await assert.rejects(owner().schedule(project, order.id, { expectedVersion: order.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: managerAid, points: [{ name: '新增', roomId: null, positionNote: '' }] }, randomUUID()), /service_order_conflict/);
});

test('a closed order keeps history while a new order can be opened and cancelled with a recorded reason', async () => {
  const opened = await owner().create(project, { ...orderBody, cameraCount: 2, note: '续期' }, randomUUID());
  const second = await latest();
  assert.equal(second.id, opened.id); assert.equal(second.status, 'pending_quote');
  assert.equal((await owner().list(project)).items.length, 2);
  const cancelled = await owner().cancel(project, second.id, { expectedVersion: second.version, reason: '业主暂缓安装' }, randomUUID());
  assert.equal(cancelled.version, second.version + 1);
  const replay = await owner().cancel(project, second.id, { expectedVersion: second.version, reason: '业主暂缓安装' }, randomUUID());
  assert.equal(replay.version, cancelled.version);
  await assert.rejects(owner().cancel(project, second.id, { expectedVersion: cancelled.version, reason: '另一个原因' }, randomUUID()), /service_order_conflict/);
  const view = (await owner().list(project)).items.find(order => order.id === second.id)!;
  assert.equal(view.status, 'cancelled'); assert.equal(view.cancelReason, '业主暂缓安装'); assert.ok(view.cancelledAt);
  await owner().create(project, orderBody, randomUUID());
});

test('the cookie API exposes the same records and rejects a write without an idempotency key', async () => {
  const headers = { cookie: await cookie(ownerAid), 'Idempotency-Key': randomUUID() }, path = ['projects', project, 'service-orders'];
  const listed = await http('GET', path, headers);
  assert.equal(listed.status, 200, JSON.stringify(listed.body)); assert.equal(listed.body.data.items.length, 3);
  const missingKey = await http('POST', path, { cookie: await cookie(ownerAid) }, orderBody);
  assert.equal(missingKey.status, 422); assert.equal(missingKey.body.error, 'invalid_service_order');
  const queried = await http('GET', [...path, 'extra'], headers);
  assert.equal(queried.status, 404);
  const staff = await http('GET', path, { cookie: await cookie(workerAid, 'construction_staff') });
  assert.equal(staff.status, 404); assert.equal(staff.body.error, 'service_order_project_unavailable');
});

test('the record stores no payment, collection or refund state because settlement stays offline', async () => {
  const columns = await withPlatformTransaction(tx => rows(tx, sql`select table_name,column_name from information_schema.columns
    where table_schema='app' and table_name in ('construction_service_orders','construction_service_order_quotes','construction_service_order_points')`));
  assert.equal(columns.length > 0, true);
  assert.deepEqual(columns.filter(column => /pay|paid|refund|collect|settle|transaction|channel/i.test(String(column.column_name))), []);
});
