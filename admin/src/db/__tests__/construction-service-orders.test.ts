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
import { CameraService, authorizeCameraMedia, exchangeCameraEntry, sessionState, startCameraView } from '@/lib/construction/camera/service';
import { WvpClient } from '@/lib/construction/camera/wvp';
import { GET, POST } from '@/app/api/construction/[[...path]]/route';

const prefix = 'service-order-' + randomUUID(), eids: string[] = [], uids: string[] = [];
let ownerAid: string, managerAid: string, workerAid: string, outsiderAid: string, platformAid: string, otherOwnerAid: string, project: string, roomA: string, roomB: string;
const owner = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: ownerAid });
const manager = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: managerAid });
const worker = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: workerAid });
const outsider = () => new ServiceOrderService({ enterpriseId: eids[0], adminId: outsiderAid });
const foreign = () => new ServiceOrderService({ enterpriseId: eids[1], adminId: otherOwnerAid });
const deviceId = '90020000001320000003', channelIds = Array.from({ length: 6 }, (_, n) => '9002000000132000000' + (4 + n));
const cameraOrigin = process.env.CAMERA_PUBLIC_ORIGIN;
const wvp = new WvpClient({ origin: 'http://wvp.test', mediaOrigin: 'http://media.test', username: 'fixture', password: 'fixture' }, (async (input: URL) => {
  const u = new URL(String(input));
  if (u.pathname === '/api/user/login') return Response.json({ code: 0, data: { accessToken: 'fixture' } });
  if (u.pathname.endsWith('/channels')) return Response.json({ code: 0, data: { list: channelIds.map(channelId => ({ deviceId: channelId, status: 'ON' })) } });
  if (u.pathname.startsWith('/api/play/start/')) return Response.json({ code: 0, data: { app: 'rtp', stream: 'fixture' } });
  throw Error('unexpected upstream route');
}) as typeof fetch);
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
    platformAid = await staff(eids[0], '平台管理员', 'admin');
    otherOwnerAid = await staff(eids[1], '另一企业负责人', 'enterprise_admin');
  });
  const lead = String((await withPlatformTransaction(tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eids[0]},${uids[0]},'隔离云工地业主','13980000021','natural') returning id`)))!.id);
  const construction = new ConstructionService({ enterpriseId: eids[0], adminId: ownerAid });
  project = String((await construction.execute('create', { leadId: lead, name: '云工地托管验收项目', managerId: managerAid, rooms: ['客厅', '主卧'] }, randomUUID())).id);
  const rooms = (await construction.execute('detail', { projectId: project })).rooms as Array<{ id: string; name: string }>;
  roomA = rooms.find(room => room.name === '客厅')!.id; roomB = rooms.find(room => room.name === '主卧')!.id;
  await construction.execute('member', { projectId: project, expectedVersion: 1, adminId: workerAid, role: 'worker', active: true, workLabel: '安装' }, randomUUID());
  process.env.CAMERA_PUBLIC_ORIGIN = 'https://camera.test';
});
after(async () => {
  try {
    if (cameraOrigin === undefined) delete process.env.CAMERA_PUBLIC_ORIGIN; else process.env.CAMERA_PUBLIC_ORIGIN = cameraOrigin;
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

test('binding follows the confirmed managed order, and live viewing ends with project membership', async () => {
  const order = await latest();
  assert.equal(order.status, 'pending_quote');
  const ownerCameras = new CameraService({ enterpriseId: eids[0], adminId: ownerAid }, wvp);
  const platformCameras = new CameraService({ enterpriseId: eids[0], adminId: platformAid }, wvp);
  const cameras: Array<{ id: string; version: number }> = [];
  for (const [index, channelId] of channelIds.entries()) {
    const camera = await platformCameras.register({ deviceId, channelId, name: '托管验收摄像头' + (index + 1) });
    cameras.push({ id: String(camera.id), version: Number(camera.version) });
  }
  await assert.rejects(ownerCameras.bind(project, { cameraId: cameras[0].id, expectedVersion: cameras[0].version, bind: true }), /service_order_not_confirmed/);
  const quoted = await owner().quote(project, order.id, { expectedVersion: order.version, lines: [{ label: '云工地视频托管服务', amountCents: 200000 }], depositCents: 0, note: '按订单路数开通' }, randomUUID());
  await owner().confirm(project, order.id, { expectedVersion: quoted.version, quoteVersion: quoted.quoteVersion }, randomUUID());
  assert.equal((await latest()).status, 'confirmed');
  const bound = [];
  for (const camera of cameras.slice(0, 5)) bound.push(await ownerCameras.bind(project, { cameraId: camera.id, expectedVersion: camera.version, bind: true }));
  assert.deepEqual(bound.map(receipt => receipt.version), [2, 2, 2, 2, 2]);
  const retry = await ownerCameras.bind(project, { cameraId: cameras[0].id, expectedVersion: cameras[0].version, bind: true });
  assert.equal(String(retry.bindingId), String(bound[0].bindingId));
  await assert.rejects(ownerCameras.bind(project, { cameraId: cameras[5].id, expectedVersion: cameras[5].version, bind: true }), /service_order_camera_limit/);

  const workerCameras = new CameraService({ enterpriseId: eids[0], adminId: workerAid }, wvp);
  const inventory = await workerCameras.list(project);
  assert.equal(inventory.items.length, 5);
  assert.equal(inventory.serviceOrder, null);
  assert.deepEqual((await ownerCameras.list(project)).serviceOrder, { id: order.id, status: 'confirmed', cameraCount: 5, boundCount: 5 });
  const viewing = await exchangeCameraEntry((await workerCameras.entry(project)).url.split('#entry=')[1]);
  const live = await startCameraView(viewing.session, viewing.csrf, String(bound[0].bindingId), wvp);
  assert.deepEqual(await authorizeCameraMedia(viewing.session, live.generation), { app: 'rtp', stream: 'fixture' });

  await withPlatformTransaction(tx => tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eids[0]} and project_id=${project} and admin_id=${workerAid}`));
  await assert.rejects(workerCameras.list(project), /camera_project_unavailable/);
  await assert.rejects(workerCameras.entry(project), /camera_project_unavailable/);
  await assert.rejects(sessionState(viewing.session), /camera_project_unavailable/);
  await assert.rejects(authorizeCameraMedia(viewing.session, live.generation), /camera_project_unavailable/);

  await withPlatformTransaction(tx => tx.execute(sql`update app.construction_members set active=true where enterprise_id=${eids[0]} and project_id=${project} and admin_id=${workerAid}`));
  const revived = await exchangeCameraEntry((await workerCameras.entry(project)).url.split('#entry=')[1]);
  const again = await startCameraView(revived.session, revived.csrf, String(bound[0].bindingId), wvp);
  assert.equal((await authorizeCameraMedia(revived.session, again.generation)).stream, 'fixture');

  await ownerCameras.bind(project, { cameraId: cameras[0].id, expectedVersion: bound[0].version, bind: false });
  const replaced = await ownerCameras.bind(project, { cameraId: cameras[5].id, expectedVersion: cameras[5].version, bind: true });
  assert.ok(replaced.bindingId);
  assert.equal((await ownerCameras.list(project)).serviceOrder?.boundCount, 5);
});

test('an accepted service records repairs and extensions, and exit needs devices cleared and deposits within the confirmed quote', async () => {
  const ownerCameras = new CameraService({ enterpriseId: eids[0], adminId: ownerAid }, wvp);
  let order = await latest();
  assert.equal(order.status, 'confirmed');
  await owner().schedule(project, order.id, { expectedVersion: order.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: managerAid,
    points: [{ name: '客厅东墙', roomId: roomA, positionNote: '' }, { name: '主卧门侧', roomId: roomB, positionNote: '' }] }, randomUUID());
  order = await latest();
  for (const point of order.points) {
    await manager().point(project, order.id, point.id, { expectedVersion: order.version, action: 'install' }, randomUUID());
    order = await latest();
    await manager().point(project, order.id, point.id, { expectedVersion: order.version, action: 'accept' }, randomUUID());
    order = await latest();
  }
  assert.equal(order.status, 'accepted');

  const exitBody = { reason: '业主结束服务', depositReturnedCents: 0, depositDeductedCents: 0, depositNote: '' };
  await assert.rejects(owner().exit(project, order.id, { expectedVersion: order.version, ...exitBody }, randomUUID()), /service_order_devices_active/);
  for (const camera of (await ownerCameras.list(project)).items) await ownerCameras.bind(project, { cameraId: camera.id, expectedVersion: camera.version, bind: false });
  assert.equal((await ownerCameras.list(project)).items.length, 0);

  const opened = await manager().repair(project, order.id, { pointId: order.points[0].id, issue: '客厅画面偏暗' }, randomUUID());
  assert.equal(opened.status, 'open');
  await assert.rejects(worker().repair(project, order.id, { issue: '工人无权登记' }, randomUUID()), /service_order_project_unavailable/);
  assert.equal((await manager().repairAction(project, order.id, String(opened.id), { expectedVersion: opened.version, action: 'resolve', resolution: '已调整曝光并回访' }, randomUUID())).status, 'resolved');
  const second = await owner().repair(project, order.id, { issue: '主卧摄像头离线' }, randomUUID());
  await assert.rejects(manager().repairAction(project, order.id, String(second.id), { expectedVersion: second.version, action: 'cancel', resolution: '' }, randomUUID()), /service_order_forbidden/);
  await assert.rejects(owner().exit(project, order.id, { expectedVersion: (await latest()).version, ...exitBody }, randomUUID()), /service_order_repairs_open/);
  await owner().repairAction(project, order.id, String(second.id), { expectedVersion: second.version, action: 'cancel', resolution: '' }, randomUUID());

  order = await latest();
  await assert.rejects(manager().extend(project, order.id, { expectedVersion: order.version, days: 30, note: '' }, randomUUID()), /service_order_forbidden/);
  await assert.rejects(owner().extend(project, order.id, { expectedVersion: order.version, days: 3650, note: '' }, randomUUID()), /service_order_extension_limit/);
  assert.equal((await owner().extend(project, order.id, { expectedVersion: order.version, days: 30, note: '业主续期一个月' }, randomUUID())).extensionDays, 30);
  order = await latest();
  assert.equal(order.serviceEndsAt, new Date(new Date(order.acceptedAt!).getTime() + (90 + 30) * 86400000).toISOString());
  assert.equal(order.repairs.length, 2);

  assert.equal((await owner().exit(project, order.id, { expectedVersion: order.version, ...exitBody }, randomUUID())).status, 'exited');
  order = await latest();
  assert.equal(order.status, 'exited'); assert.ok(order.exitedAt); assert.equal(order.exitReason, '业主结束服务');
  await assert.rejects(owner().repair(project, order.id, { issue: '退场后新报修' }, randomUUID()), /service_order_conflict/);
  await assert.rejects(owner().extend(project, order.id, { expectedVersion: order.version, days: 1, note: '' }, randomUUID()), /service_order_conflict/);
  const free = (await ownerCameras.inventory(project)).items.find(camera => !camera.project_id)!;
  await assert.rejects(ownerCameras.bind(project, { cameraId: free.id, expectedVersion: free.version, bind: true }), /service_order_ended/);

  await owner().create(project, { cameraCount: 2, retentionDays: 3, serviceDays: 30, note: '二次开通' }, randomUUID());
  let next = await latest();
  const quote = await owner().quote(project, next.id, { expectedVersion: next.version, lines: [{ label: '云工地视频托管服务', amountCents: 300000 }], depositCents: 50000, note: '' }, randomUUID());
  await owner().confirm(project, next.id, { expectedVersion: quote.version, quoteVersion: quote.quoteVersion }, randomUUID());
  next = await latest();
  await owner().schedule(project, next.id, { expectedVersion: next.version, scheduledFor: new Date(Date.now() + 86400000).toISOString(), installerId: managerAid,
    points: [{ name: '客厅', roomId: roomA, positionNote: '' }] }, randomUUID());
  next = await latest();
  await owner().point(project, next.id, next.points[0].id, { expectedVersion: next.version, action: 'install' }, randomUUID());
  next = await latest();
  await owner().point(project, next.id, next.points[0].id, { expectedVersion: next.version, action: 'accept' }, randomUUID());
  next = await latest();
  assert.equal(next.status, 'accepted');
  await assert.rejects(owner().exit(project, next.id, { expectedVersion: next.version, reason: '业主更换方案', depositReturnedCents: 40000, depositDeductedCents: 20000, depositNote: '' }, randomUUID()), /service_order_deposit_exceeds/);
  await owner().exit(project, next.id, { expectedVersion: next.version, reason: '业主更换方案', depositReturnedCents: 40000, depositDeductedCents: 10000, depositNote: '线下已结算' }, randomUUID());
  next = await latest();
  assert.equal(next.status, 'exited'); assert.equal(next.depositReturnedCents, 40000); assert.equal(next.depositDeductedCents, 10000); assert.equal(next.depositNote, '线下已结算');
  const replay = await owner().exit(project, next.id, { expectedVersion: next.version, reason: '业主更换方案', depositReturnedCents: 40000, depositDeductedCents: 10000, depositNote: '线下已结算' }, randomUUID());
  assert.equal(replay.version, next.version);
});

test('the cookie API exposes the same records and rejects a write without an idempotency key', async () => {
  const headers = { cookie: await cookie(ownerAid), 'Idempotency-Key': randomUUID() }, path = ['projects', project, 'service-orders'];
  const listed = await http('GET', path, headers);
  assert.equal(listed.status, 200, JSON.stringify(listed.body)); assert.equal(listed.body.data.items.length, 4);
  const missingKey = await http('POST', path, { cookie: await cookie(ownerAid) }, orderBody);
  assert.equal(missingKey.status, 422); assert.equal(missingKey.body.error, 'invalid_service_order');
  const queried = await http('GET', [...path, 'extra'], headers);
  assert.equal(queried.status, 404);
  const staff = await http('GET', path, { cookie: await cookie(workerAid, 'construction_staff') });
  assert.equal(staff.status, 404); assert.equal(staff.body.error, 'service_order_project_unavailable');
});

test('the record stores no payment, collection or refund state because settlement stays offline', async () => {
  const columns = await withPlatformTransaction(tx => rows(tx, sql`select table_name,column_name from information_schema.columns
    where table_schema='app' and table_name in ('construction_service_orders','construction_service_order_quotes','construction_service_order_points','construction_service_order_repairs','construction_service_order_extensions')`));
  assert.equal(columns.length > 0, true);
  assert.deepEqual(columns.filter(column => /pay|paid|refund|collect|settle|transaction|channel/i.test(String(column.column_name))), []);
});
