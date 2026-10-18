import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { ReferrerNetworkRepository, TenantEnterpriseResetRepository } from '@/db/repositories';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { ConstructionService } from '@/lib/construction/service';
import { currentConstructionContact } from '@/lib/construction/customer';
import { buildMiniProgramBootstrap } from '@/lib/miniprogram-bootstrap';
import { MiniProgramIdentityRepository } from '@/db/repositories';
import { POST as join } from '@/app/api/miniprogram/onboarding/staff/route';
import { GET, POST } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { PUT as updateStaff } from '@/app/api/staff/[id]/route';
import { GET as readProfile } from '@/app/api/miniprogram/profile/route';
import { POST as uploadAvatar } from '@/app/api/miniprogram/profile/avatar/route';
import { PUT as updatePassword } from '@/app/api/miniprogram/account/password/route';
import { proxy } from '@/proxy';
import type { ActorContext } from '@/lib/assistant/contracts';

const prefix = 'construction-staff-' + randomUUID(), tenants: string[] = [], userIds: string[] = [], owners: string[] = [], tokens: string[] = [];
let employee: string, employeeUser: string, employeeToken: string, worker: string, workerUser: string, designer: string, designerUser: string;
let project: string, lead: string;
const uid = async (phone: string) => {
  const row = await withPlatformTransaction(tx => one(tx, sql`insert into app.users(nickname,phone,context_version) values(${prefix},${phone},1) returning id`));
  userIds.push(String(row!.id)); return String(row!.id);
};
async function miniToken(user: string, staff?: string, role = 'construction_staff', source: 'phone' | 'password' = 'phone', contextVersion = 1) {
  return signMiniProgramToken({ sub: user, id: user, mode: staff ? 'staff' : 'customer', role: staff ? role as 'construction_staff' : 'user',
    staffRole: staff ? role : undefined, staffId: staff, enterpriseId: staff ? tenants[0] : undefined, contextVersion, source });
}
async function cookie(adminId: string) {
  return new SignJWT({ id: adminId, role: 'enterprise_admin', enterpriseId: tenants[0], permissions: ['staff','construction-projects'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
const ownerService = () => new ConstructionService({ enterpriseId: tenants[0], adminId: owners[0] });
const employeeService = () => new ConstructionService({ enterpriseId: tenants[0], adminId: employee, miniProgramUserId: employeeUser, miniProgramContextVersion: 2 });
const act = (action: string, input: Row = {}) => ownerService().execute(action, input, randomUUID());
const detail = () => act('detail', { projectId: project });
const version = async () => Number(((await detail()).project as Row).version);
const member = async (aid: string, role: string, active = true) => act('member', { projectId: project, expectedVersion: await version(), adminId: aid, role, active, workLabel: '水电施工' });
const assign = async (staffIds: string[], primaryStaffId: string | null = null) => act('contact', { projectId: project, expectedVersion: await version(), stageKey: 'utilities', staffIds, primaryStaffId });
const customer = (): ActorContext => ({ enterpriseId: tenants[0], principal: { kind: 'user', userId: userIds[0] }, contextVersion: 1, capabilities: [] });
const phone = () => withTenantTransaction(tenants[0], tx => currentConstructionContact(tx, customer(), project));
async function http(path: string[], token: string, input?: Row, requestKey = randomUUID()) {
  const request = new NextRequest('http://localhost:3006/api/miniprogram/construction/' + path.join('/'), {
    method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': requestKey }, ...(input ? { body: JSON.stringify(input) } : {}),
  });
  return (input ? POST : GET)(request, { params: Promise.resolve({ path }) });
}
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  const customerUser = await uid('13980000001');
  for (let i = 0; i < 2; i++) {
    await withPlatformTransaction(async tx => {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!; tenants.push(String(e.id));
      const a = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,display_name,status) values(${String(e.id)},${prefix+i},'test-only','enterprise_admin','隔离负责人','active') returning id`))!; owners.push(String(a.id));
      tokens.push((await new ReferrerNetworkRepository(tx).rotateEnterpriseJoinCode({ enterpriseId: BigInt(String(e.id)), codeType: 'staff', actorStaffId: BigInt(String(a.id)) })).token);
    });
  }
  lead = String((await withPlatformTransaction(tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${tenants[0]},${customerUser},'隔离业主','13980000001','natural') returning id`)))!.id);
  employeeUser = await uid('13980000002'); workerUser = await uid('13980000003'); designerUser = await uid('13980000004');
  await withPlatformTransaction(async tx => {
    for (const [u, role, name] of [[workerUser,'construction_staff','油漆师傅'],[designerUser,'designer','项目设计师']]) {
      const a = (await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,display_name,phone,status,must_change_password)
        values(${tenants[0]},${u},${prefix+u},'test-only',${role},${name},${u === workerUser ? '13980000003' : '13980000004'},'active',true) returning id`))!;
      if (role === 'designer') designer = String(a.id); else worker = String(a.id);
    }
  });
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const eid of tenants) await new TenantEnterpriseResetRepository(tx).purge(BigInt(eid));
      for (const user of userIds) await tx.execute(sql`delete from app.users where id=${user}`);
    });
  } finally { await closePostgresPool(); }
});

test('phone-authorized employee joining persists trades, reenters the construction identity and rejects role/enterprise replacement', async () => {
  const initial = await miniToken(employeeUser), input = { token: tokens[0], role: 'construction_staff', displayName: '水电王师傅', constructionTrades: ['水电','项目管理'] };
  const request = (token: string, data: Row) => new Request('http://localhost:3006/api/miniprogram/onboarding/staff', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(data) });
  const response = await join(request(initial, input)); assert.equal(response.status, 200);
  const joined = await response.json(); assert.equal(joined.success, true, JSON.stringify(joined));
  employee = joined.context.staffId; employeeToken = joined.token;
  assert.equal(joined.context.staffRole, 'construction_staff'); assert.deepEqual(joined.data.constructionTrades, ['水电','项目管理']); assert.equal(joined.data.mustChangePassword, true);
  const duplicate = await (await join(request(employeeToken, input))).json(); assert.equal(duplicate.idempotent, true); assert.equal(duplicate.context.staffId, employee);
  const conflicting = await (await join(request(employeeToken, { ...input, token: tokens[1] }))).json(); assert.equal(conflicting.code, 'staff_enterprise_conflict');
  const escalation = await (await join(request(employeeToken, { ...input, role: 'designer' }))).json(); assert.equal(escalation.code, 'staff_enterprise_conflict');
  const contexts = await withPlatformTransaction(tx => new MiniProgramIdentityRepository(tx).listContexts(BigInt(employeeUser)));
  const current = contexts.find(c => String(c.staffId) === employee)!; const bootstrap = buildMiniProgramBootstrap({ current, contexts });
  assert.equal(bootstrap.current.landingPath, '/packages/construction/projects/projects'); assert.deepEqual(bootstrap.current.capabilities, ['construction.projects','account']);
  const empty = await http(['projects'], employeeToken); assert.equal(empty.status, 200); assert.deepEqual((await empty.json()).data.items, []);
});

test('the owner designates a manager; construction staff and designers share the route with independent project rights', async () => {
  project = String((await act('create', { leadId: lead, name: '三端共享工地', managerId: employee, rooms: [] })).id);
  await member(worker, 'worker'); await member(designer, 'designer');
  const manager = await http(['projects',project], employeeToken); assert.equal(manager.status, 200); const m = (await manager.json()).data;
  assert.equal(m.manage, true); assert.equal(m.owner, false); assert.equal(m.myRole, 'manager');
  assert.equal('stage_contacts' in m.project, false); assert.equal('lead_id' in m.project, false);
  const token = await miniToken(designerUser, designer, 'designer');
  const view = await http(['projects',project], token); assert.equal(view.status, 200); assert.equal((await view.json()).data.manage, false);
  const denied = await http(['projects',project,'progress'], token, { expectedVersion: await version(), stageKey: 'utilities', note: '', sendReminder: false }); assert.equal(denied.status, 403);
  await assert.rejects(new ConstructionService({ enterpriseId: tenants[0], adminId: employee }).execute('list'), /forbidden/);
  const password = await http(['projects'], await miniToken(employeeUser, employee, 'construction_staff', 'password', 2)); assert.equal(password.status, 403);
});

test('managers can allocate ordinary members, but cannot appoint or remove managers or escape their assigned tenant', async () => {
  await assert.rejects(employeeService().execute('member', { projectId: project, expectedVersion: await version(), adminId: worker, role: 'manager', active: true }, randomUUID()), /forbidden/);
  await assert.rejects(employeeService().execute('member', { projectId: project, expectedVersion: await version(), adminId: employee, role: 'worker', active: false }, randomUUID()), /forbidden/);
  await assert.rejects(member(owners[1], 'worker'), /staff_unavailable/);
  const hidden = await new ConstructionService({ enterpriseId: tenants[1], adminId: owners[1] }).execute('list'); assert.deepEqual(hidden.items, []);
  await assert.rejects(new ConstructionService({ enterpriseId: tenants[0], adminId: worker, miniProgramUserId: employeeUser, miniProgramContextVersion: 2 }).execute('list'), /forbidden/);
  await assert.rejects(new ConstructionService({ enterpriseId: tenants[0], adminId: employee, miniProgramUserId: employeeUser, miniProgramContextVersion: 1 }).execute('list'), /forbidden/);
});

test('stage assignments select one current employee, require explicit primary for multiple staff and never fall back to legacy phone data', async () => {
  await employeeService().execute('progress', { projectId: project, expectedVersion: await version(), stageKey: 'utilities', note: '现场确认水电施工', sendReminder: false }, randomUUID());
  await withPlatformTransaction(tx => tx.execute(sql`update app.construction_projects set stage_contacts='{"utilities":{"name":"旧联系人","phone":"13980000999"}}'::jsonb where id=${project}`));
  await assert.rejects(phone(), /contact_unavailable/);
  await assign([employee]); assert.equal((await phone()).phone, '13980000002');
  await assign([employee,worker]); await assert.rejects(phone(), /contact_unavailable/);
  await assign([employee,worker], worker); assert.equal((await phone()).phone, '13980000003');
  const foreign = await withTenantTransaction(tenants[1], tx => rows(tx, sql`select * from app.construction_stage_assignments where project_id=${project}`)); assert.equal(foreign.length, 0);
  const legacy = await withPlatformTransaction(tx => one(tx, sql`select stage_contacts from app.construction_projects where id=${project}`)); assert.match(JSON.stringify(legacy), /13980000999/);
  await assert.rejects(act('contact', { projectId: project, expectedVersion: await version(), stageKey: 'utilities', contactName: '绕过关联', contactPhone: '13980000999' }), /invalid_construction/);
});

test('staff profile phone changes apply immediately; disabling, removing or unassigning the employee revokes the phone', async () => {
  const response = await updateStaff(new Request('http://localhost:3006/api/staff/'+worker, { method: 'PUT', headers: { cookie: 'auth_token='+await cookie(owners[0]) }, body: JSON.stringify({ phone: '13980000005' }) }), { params: Promise.resolve({ id: worker }) });
  assert.equal(response.status, 200, await response.text()); assert.equal((await phone()).phone, '13980000005');
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${worker}`)); await assert.rejects(phone(), /contact_unavailable/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${worker}`)); assert.equal((await phone()).phone, '13980000005');
  await member(worker, 'worker', false); await assert.rejects(phone(), /contact_unavailable/);
  assert.ok(!((await detail()).assignments as Row[]).some(a => a.admin_id === worker));
  await member(worker, 'worker'); await assert.rejects(phone(), /contact_unavailable/);
  await assign([worker]); assert.equal((await phone()).phone, '13980000005');
  await assign([]); await assert.rejects(phone(), /contact_unavailable/);
});

test('Mini Program writes retain idempotency, project versions, no-booking boundaries and current authorization on reentry', async () => {
  const body = { expectedVersion: await version(), stageKey: 'utilities', staffIds: [employee], primaryStaffId: null }, requestKey = randomUUID();
  const [a,b] = await Promise.all([http(['projects',project,'contact'], employeeToken, body, requestKey), http(['projects',project,'contact'], employeeToken, body, requestKey)]);
  assert.equal(a.status,200); assert.equal(b.status,200); assert.deepEqual(await a.json(), await b.json());
  const stale = await http(['projects',project,'contact'], employeeToken, body); assert.equal(stale.status,409);
  for (const table of ['measurement_appointments','construction_visits']) assert.equal(Number((await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from ${sql.raw('app.'+table)} where enterprise_id=${tenants[0]}`)))!.n),0);
  await member(designer,'designer',false);
  assert.equal((await http(['projects',project], await miniToken(designerUser,designer,'designer'))).status,404);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${employee}`));
  assert.equal((await http(['projects'],employeeToken)).status,401);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${employee}`));
});

test('construction identity cannot use legacy staff Bearer fallthrough to read customers, drawings, chats, commissions or acquire leads', async () => {
  for (const path of ['/api/leads','/api/floorplans','/api/lead-commissions','/api/miniprogram/staff-earnings','/api/miniprogram/lead-claim-pool','/api/miniprogram/assistant/handoffs','/api/miniprogram/enterprise-staff']) {
    const response = await proxy(new NextRequest('http://localhost:3006'+path, { headers: { Authorization: 'Bearer '+employeeToken } })); assert.equal(response.status,403,path);
  }
  const preview = await withPlatformTransaction(tx => new TenantEnterpriseResetRepository(tx).preview(BigInt(tenants[0]),BigInt(owners[0])));
  assert.ok(preview.counts.some(c => c.table === 'construction_stage_assignments' && c.count > 0));
});

test('construction identity retains its own profile, avatar and password account flows', async () => {
  const accountRequest = (path: string, method = 'GET', body?: BodyInit) => new NextRequest('http://localhost:3006/api/miniprogram/'+path, {
    method, headers: { Authorization: 'Bearer '+employeeToken }, ...(body ? { body } : {}),
  });
  for (const path of ['profile', 'profile/avatar', 'account/password']) {
    assert.equal((await proxy(accountRequest(path))).headers.get('x-middleware-next'), '1', path);
  }
  assert.equal((await readProfile(accountRequest('profile'))).status, 200);
  const avatar = await uploadAvatar(accountRequest('profile/avatar', 'POST', new FormData()));
  assert.equal(avatar.status, 400); assert.equal((await avatar.json()).error, '请选择头像图片');
  const password = await updatePassword(accountRequest('account/password', 'PUT', JSON.stringify({ currentPassword: 'incorrect-password', newPassword: 'new-password' })));
  assert.equal(password.status, 400); assert.equal((await password.json()).error, '当前密码不正确');
});
