import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { TenantEnterpriseResetRepository } from '@/db/repositories';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { GET, POST } from '@/app/api/construction/[[...path]]/route';

const prefix = 'construction-entry-' + randomUUID();
const tenants: string[] = [], owners: string[] = [], users: string[] = [], leads: string[] = [];
const platformAdmins = new Map<string, 'admin' | 'super_admin'>();
let manager: string;
async function cookie(adminId: string) {
  return new SignJWT({ id: adminId, role: platformAdmins.get(adminId) || 'enterprise_admin', enterpriseId: platformAdmins.has(adminId) ? null : tenants[0], permissions: ['leads', 'construction-projects'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
async function http(path: string[], adminId = owners[0], body?: object, requestKey = randomUUID(), query = '', selectedEnterprise: string | null = tenants[0]) {
  const request = new NextRequest('http://localhost:3006/api/construction/' + path.join('/') + query, {
    method: body ? 'POST' : 'GET', headers: { cookie: 'auth_token=' + await cookie(adminId) + (platformAdmins.has(adminId) && selectedEnterprise ? '; global_tenant_id=' + selectedEnterprise : ''), 'Idempotency-Key': requestKey },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (body ? POST : GET)(request, { params: Promise.resolve({ path }) });
}
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;
      const eid = String(enterprise.id); tenants.push(eid);
      const owner = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
        values(${eid},${prefix+i},'test-only','enterprise_admin','active',false) returning id`))!;
      owners.push(String(owner.id));
      const user = (await one(tx, sql`insert into app.users(nickname) values(${prefix+i}) returning id`))!; users.push(String(user.id));
      const lead = (await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${eid},${String(user.id)},${'较早客户'+i},'13981000000','natural') returning id`))!;
      leads.push(String(lead.id));
    }
    manager = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
      values(${tenants[0]},${prefix+'manager'},'test-only','designer','active',false) returning id`))!.id);
    for (const role of ['admin', 'super_admin'] as const) {
      const admin = (await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password)
        values(${prefix+role},'test-only',${role},'active',false) returning id`))!;
      platformAdmins.set(String(admin.id), role);
    }
    const extra = await rows(tx, sql`insert into app.users(nickname) select ${prefix+'window'} || i::text from generate_series(1,201) i returning id`);
    users.push(...extra.map(u => String(u.id)));
    await tx.execute(sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      select ${tenants[0]}, value::bigint,'较新客户','13981' || lpad(ordinality::text,6,'0'),'natural'
      from jsonb_array_elements_text(${JSON.stringify(extra.map(u => String(u.id)))}::jsonb) with ordinality`);
  });
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const eid of tenants) await new TenantEnterpriseResetRepository(tx).purge(BigInt(eid));
      for (const adminId of platformAdmins.keys()) await tx.execute(sql`delete from app.admin_users where id=${adminId}`);
      await tx.execute(sql`delete from app.users where id in (select value::bigint from jsonb_array_elements_text(${JSON.stringify(users)}::jsonb))`);
    });
  } finally { await closePostgresPool(); }
});

test('an exact customer outside the option window resolves without writes and uses the same idempotent project creation', async () => {
  const options = await (await http(['options'])).json();
  assert.equal(options.data.leads.length, 200); assert.ok(!options.data.leads.some((l: { id: string }) => l.id === leads[0]));
  const entry = await http(['leads', leads[0]]); assert.equal(entry.status, 200);
  const customer = (await entry.json()).data;
  assert.equal(customer.id, leads[0]); assert.deepEqual(Object.keys(customer).sort(), ['community_name', 'id', 'name']);
  const count = async () => Number((await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from app.construction_projects where enterprise_id=${tenants[0]}`)))!.n);
  assert.equal(await count(), 0);
  const body = { leadId: customer.id, managerId: manager, name: '从客户建立的工地', rooms: [] }, requestKey = randomUUID();
  const first = await http(['projects'], owners[0], body, requestKey); assert.equal(first.status, 200);
  const created = await first.json();
  const repeat = await http(['projects'], owners[0], body, requestKey); assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), created); assert.equal(await count(), 1);
  const detail = await (await http(['projects', created.data.id])).json();
  assert.equal(detail.data.project.lead_id, leads[0]); assert.ok(detail.data.members.some((m: { admin_id: string; role: string }) => m.admin_id === manager && m.role === 'manager'));
  assert.equal((await withTenantTransaction(tenants[1], tx => rows(tx, sql`select id from app.construction_projects where id=${created.data.id}`))).length, 0);
});

test('unbound platform administrators inherit owner preview, creation and manager rights within the selected enterprise', async () => {
  for (const [adminId, role] of platformAdmins) {
    assert.equal((await http(['leads', leads[0]], adminId, undefined, randomUUID(), '', null)).status, 400, role+' requires an enterprise');
    const preview = await http(['leads', leads[0]], adminId); assert.equal(preview.status, 200, role);
    assert.equal((await preview.json()).data.id, leads[0]);
    const options = await (await http(['options'], adminId)).json(); assert.equal(options.data.owner, true);
    const body = { leadId: leads[0], managerId: manager, name: role+'代建工地', rooms: [] }, requestKey = randomUUID();
    const created = await http(['projects'], adminId, body, requestKey); assert.equal(created.status, 200, role);
    const result = await created.json();
    assert.deepEqual(await (await http(['projects'], adminId, body, requestKey)).json(), result);
    const detail = await (await http(['projects', result.data.id], adminId)).json();
    assert.equal(detail.data.owner, true); assert.equal(detail.data.manage, true);
    assert.ok(!detail.data.members.some((m: { admin_id: string }) => m.admin_id === adminId));
    const appoint = await http(['projects', result.data.id, 'member'], adminId, { expectedVersion: 1, adminId: owners[0], role: 'manager', active: true, workLabel: '项目统筹' });
    assert.equal(appoint.status, 200, role+' appoints a manager');
    assert.equal((await http(['leads', leads[1]], adminId)).status, 422, 'selected tenant is not bypassed');
    assert.equal((await http(['leads', leads[1]], adminId, undefined, randomUUID(), '', tenants[1])).status, 200);
    assert.equal((await http(['leads', leads[0]], adminId, undefined, randomUUID(), '', tenants[1])).status, 422);
    const switched = await http(['projects'], adminId, { leadId: leads[1], managerId: owners[1], name: role+'切换企业建工地', rooms: [] }, randomUUID(), '', tenants[1]);
    assert.equal(switched.status, 200);
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${adminId}`));
    try { assert.equal((await http(['leads', leads[0]], adminId)).status, 403, 'disabled actual account is denied'); }
    finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${adminId}`)); }
  }
});

test('preview and submission both reject foreign, unbound, archived and closed customers and ordinary managers', async () => {
  assert.equal((await http(['leads', leads[0]], manager)).status, 403);
  assert.equal((await http(['leads', leads[1]])).status, 422);
  assert.equal((await http(['leads', leads[0]], owners[0], undefined, randomUUID(), '?enterpriseId='+tenants[1])).status, 422);
  const unbound = await withPlatformTransaction(tx => one(tx, sql`insert into app.leads(enterprise_id,name,phone,source) values(${tenants[0]},'未绑定客户','13981999999','manual_entry') returning id`));
  const body = (leadId: string) => ({ leadId, managerId: manager, name: '禁止创建', rooms: [] });
  for (const [leadId, code, status] of [[String(unbound!.id), 'construction_customer_required', 422], [leads[1], 'construction_lead_unavailable', 422]] as const) {
    for (const response of [await http(['leads', leadId]), await http(['projects'], owners[0], body(leadId))]) {
      assert.equal(response.status, status); assert.equal((await response.json()).error, code);
    }
  }
  for (const archived of [true, false]) {
    await withPlatformTransaction(tx => tx.execute(archived
      ? sql`update app.leads set archived_at=now() where id=${leads[0]}`
      : sql`update app.leads set archived_at=null,status='closed' where id=${leads[0]}`));
    for (const response of [await http(['leads', leads[0]]), await http(['projects'], owners[0], body(leads[0]))]) {
      assert.equal(response.status, 409); assert.equal((await response.json()).error, 'construction_lead_inactive');
    }
  }
  const count = await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from app.construction_projects where name='禁止创建'`));
  assert.equal(Number(count!.n), 0);
});
