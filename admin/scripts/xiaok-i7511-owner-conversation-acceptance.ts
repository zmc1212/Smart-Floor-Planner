/** I7.5.11 owner identity and C01 conversation HTTP acceptance. Creates one
 *  synthetic enterprise in the shared development database, uses its signed
 *  customer token, and deletes only rows created here. Enterprise 1454 is never
 *  read or written. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

loadEnvConfig(process.cwd(), true);
const target = process.env.DATABASE_URL?.trim() || '';
if (new URL(target).pathname !== '/smart_floor_planner') throw new Error('Shared development database only');
process.env.DATABASE_URL = target;
const origin = process.env.XIAOK_I7511_API_ORIGIN?.trim() || 'http://127.0.0.1:3006';

type Status = 'passed' | 'failed' | 'limited' | 'not_run';
const checks: Array<{ id: string; status: Status; detail: string; evidence?: unknown }> = [];
const check = (id: string, status: Status, detail: string, evidence?: unknown) => {
  checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    try { const r = await fetch(origin + '/api/health'); if (r.status < 500) return; } catch { /* keep polling */ }
    await sleep(2000);
  }
  throw new Error('local API server did not start');
}

async function main() {
  await waitForServer();
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { deleteAssistantData } = await import('@/db/repositories/assistant-cleanup');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { getDefaultMenuKeys } = await import('@/lib/admin-user-roles');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');

  const suffix = String(Date.now());
  const prefix = 'I7.5.11业主会话-' + suffix;
  const password = 'I7511-Pass-' + suffix;
  const passwordHash = await bcrypt.hash(password, 10);
  const created = { enterpriseIds: [] as string[], adminIds: [] as string[], userIds: [] as string[] };

  try {
    const enterprise = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
        values(${prefix},${'i7511-' + suffix},'active','manual') returning id::text`);
      const eid = String(row!.id); created.enterpriseIds.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
        values(${eid},true,365,100000,1000000000,1000000000)`);
      return eid;
    });

    const ownerId = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${enterprise},${'1997512' + suffix.slice(-5)},'I7.5.11业主','user') returning id::text`);
      const uid = String(row!.id); created.userIds.push(uid);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'i7511-openid-' + suffix})`);
      return uid;
    });
    const makeAdmin = (role: string, name: string, phone: string, username: string) => withPlatformTransaction(async tx => {
      const linked = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${enterprise},${phone},${name},'user') returning id::text`);
      created.userIds.push(String(linked!.id));
      const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,phone,menu_permissions,construction_trades)
        values(${enterprise},${String(linked!.id)},${username},${passwordHash},${name},${role},'active',false,${phone},
        ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
      const aid = String(row!.id); created.adminIds.push(aid); return aid;
    });
    const boss = await makeAdmin('enterprise_admin', 'I7.5.11老板', '1997512' + suffix.slice(-5), 'i7511_boss_' + suffix);
    const manager = await makeAdmin('construction_staff', 'I7.5.11经理', '1997513' + suffix.slice(-5), 'i7511_manager_' + suffix);

    const owner = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
    const leadId = await withTenantTransaction(enterprise, async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterprise},${ownerId},'I7.5.11业主项目','19975140000','natural') returning id::text`))!.id));
    const project = await owner.execute('create', { leadId, name: 'I7.5.11 四端会话项目', managerId: manager, rooms: ['客厅', '书房'] }, randomUUID());
    const pid = String(project.id);
    const detail = await owner.execute('detail', { projectId: pid });
    await owner.execute('progress', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
      stageKey: 'utilities', note: 'I7.5.11 进入水电', sendReminder: false }, randomUUID());

    const cid = await withTenantTransaction(enterprise, async tx => {
      const conversation = await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
        values(${enterprise},'customer_consultation',${JSON.stringify({ kind: 'construction_project', id: pid })}::jsonb,1) returning id::text`);
      const id = String(conversation!.id);
      await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,participant_role,grant_basis)
        values(${enterprise},${id},'user',${ownerId},'owner',${JSON.stringify({ kind: 'owner' })}::jsonb)`);
      await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id)
        values(${enterprise},${pid},${id}) on conflict do nothing`);
      return id;
    });
    const context = await withTenantTransaction(enterprise, tx => one(tx, sql`select context_version from app.users where id=${ownerId}`));
    const token = await signMiniProgramToken({ sub: ownerId, id: ownerId, mode: 'customer', role: 'user', enterpriseId: enterprise,
      contextVersion: Number(context?.context_version || 1), source: 'wechat' });

    const entryResponse = await fetch(origin + '/api/miniprogram/assistant/entry-context', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: cid }) });
    const entry = await entryResponse.json() as { success?: boolean; data?: { entryToken?: string; enterprise?: { id?: string }; canSend?: boolean } };
    check('owner.entry_context', entryResponse.status === 200 && entry.success && entry.data?.entryToken ? 'passed' : 'failed',
      '业主真实客户令牌可读取本人会话入口', { status: entryResponse.status, enterprise: entry.data?.enterprise?.id, canSend: entry.data?.canSend });

    const read = async () => {
      const response = await fetch(origin + '/api/miniprogram/assistant/conversations/' + cid, {
        headers: { Authorization: 'Bearer ' + token, 'X-Assistant-Entry': entry.data?.entryToken || '' } });
      return { status: response.status, body: await response.json() as { success?: boolean; data?: { id?: string; status?: string } } };
    };
    const messages = async () => {
      const response = await fetch(origin + '/api/miniprogram/assistant/conversations/' + cid + '/messages?limit=20', {
        headers: { Authorization: 'Bearer ' + token, 'X-Assistant-Entry': entry.data?.entryToken || '' } });
      return { status: response.status, body: await response.json() as { success?: boolean; data?: { items?: unknown[] } } };
    };
    const first = await read(), second = await read(), firstMessages = await messages();
    const firstId = first.body.data?.id;
    check('owner.conversation_read', first.status === 200 && String(firstId) === cid ? 'passed' : 'failed',
      '业主读取本人 C01 连续对话', { status: first.status, conversationId: firstId, conversationStatus: first.body.data?.status });
    check('owner.conversation_messages', firstMessages.status === 200 && Array.isArray(firstMessages.body.data?.items) ? 'passed' : 'failed',
      '业主读取本人会话消息列表', { status: firstMessages.status, messages: firstMessages.body.data?.items?.length || 0 });
    check('owner.conversation_reentry', second.status === 200 && String(second.body.data?.id) === cid ? 'passed' : 'failed',
      '重新进入读取同一会话，不新建会话', { status: second.status, conversationId: second.body.data?.id });

    const designerDetail = await owner.execute('detail', { projectId: pid });
    const rooms = designerDetail.rooms as Array<{ id: string; name: string }>;
    const plans = designerDetail.plans as unknown[];
    const issueGroups = designerDetail.issueGroups as Record<string, unknown>;
    check('designer.point_data', rooms.length === 2 && Array.isArray(plans) && issueGroups && typeof issueGroups === 'object' ? 'passed' : 'failed',
      '设计师点位图与差异入口具备真实房间、方案与事项分组数据', { rooms: rooms.map(r => r.name), planCount: plans.length, groups: Object.keys(issueGroups || {}) });

    const outsider = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${enterprise},${'1997515' + suffix.slice(-5)},'I7.5.11非本项目业主','user') returning id::text`);
      const uid = String(row!.id); created.userIds.push(uid); return uid;
    });
    const outsiderToken = await signMiniProgramToken({ sub: outsider, id: outsider, mode: 'customer', role: 'user', enterpriseId: enterprise,
      contextVersion: 1, source: 'wechat' });
    const outsiderRead = await fetch(origin + '/api/miniprogram/assistant/conversations/' + cid, {
      headers: { Authorization: 'Bearer ' + outsiderToken, 'X-Assistant-Entry': entry.data?.entryToken || '' } });
    check('owner.conversation_cross_customer', outsiderRead.status === 401 || outsiderRead.status === 403 || outsiderRead.status === 404 ? 'passed' : 'failed',
      '非本项目业主不能读取本人会话', { status: outsiderRead.status });

    check('owner.database_target', 'passed', '仅使用共享开发库合成企业，未读写企业 1454', { database: 'smart_floor_planner', enterpriseIds: created.enterpriseIds });
  } finally {
    try {
      for (const eid of created.enterpriseIds) {
        await withTenantTransaction(eid, async tx => {
          await tx.execute(sql`delete from app.construction_projects where enterprise_id=${eid}`);
          await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
          await deleteAssistantData(tx, BigInt(eid));
          await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
          await tx.execute(sql`delete from app.users where enterprise_id=${eid}`);
          for (const table of ['assistant_enterprise_settings', 'construction_stage_settings', 'construction_report_settings',
            'construction_followup_bindings', 'construction_camera_retention_defaults']) {
            await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${eid}`);
          }
        });
        await withPlatformTransaction(tx => tx.execute(sql`delete from app.enterprises where id=${eid}`));
      }
      check('owner.cleanup', 'passed', '仅删除本轮合成企业数据', { enterpriseIds: created.enterpriseIds });
    } catch (error) {
      check('owner.cleanup', 'failed', '合成数据清理失败，需要人工核对', { message: (error as Error).message, enterpriseIds: created.enterpriseIds });
    }
    await closePostgresPool();
  }
  console.log(JSON.stringify({ finishedAt: new Date().toISOString(), origin, checks }, null, 2));
  if (checks.some(c => c.status === 'failed')) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
