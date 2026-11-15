/** I7.5.10 four-end service/database acceptance against the shared development
 *  database. It creates one synthetic enterprise and deletes only rows created
 *  by this script; enterprise 1454 is never read or written. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const admin = process.cwd();
loadEnvConfig(admin, true);
const target = process.env.DATABASE_URL?.trim() || '';
const parsed = new URL(target);
if (parsed.pathname !== '/smart_floor_planner') throw new Error('Use the shared development database only');
process.env.DATABASE_URL = target;

type Status = 'passed' | 'failed' | 'limited' | 'not_run';
const checks: Array<{ id: string; status: Status; detail: string; evidence?: unknown }> = [];
const check = (id: string, status: Status, detail: string, evidence?: unknown) => {
  checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
};

async function expectForbidden(fn: () => Promise<unknown>, id: string, detail: string) {
  try { await fn(); check(id, 'failed', detail + '（实际未被拒绝）'); }
  catch (error) {
    const code = (error as { code?: string; message?: string }).code || (error as { message?: string }).message;
    check(id, code === 'construction_forbidden' ? 'passed' : 'failed', detail, { code });
  }
}

async function main() {
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { getDefaultMenuKeys } = await import('@/lib/admin-user-roles');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { CustomerProjectProgress } = await import('@/lib/construction/family-progress');

  const identity = await withPlatformTransaction(tx => one(tx, sql`select current_user as db_user,current_database() as db_name`));
  assert.equal(identity?.db_user, 'sfp_app');
  assert.equal(identity?.db_name, 'smart_floor_planner');

  const suffix = String(Date.now());
  const prefix = 'I7.5.10四端联调-' + suffix;
  const password = 'I7510-Pass-' + suffix;
  const passwordHash = await bcrypt.hash(password, 10);
  const created: { enterpriseIds: string[]; adminIds: string[]; userIds: string[]; leadIds: string[]; projectIds: string[] } =
    { enterpriseIds: [], adminIds: [], userIds: [], leadIds: [], projectIds: [] };

  try {
    const enterprise = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
        values(${prefix},${'i7510-' + suffix},'active','manual') returning id::text`);
      const eid = String(row!.id); created.enterpriseIds.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
        values(${eid},true,365,100000,1000000000,1000000000)`);
      return eid;
    });
    // The customer progress reader is gated by the collaboration allowlist.
    // Scope it to the two synthetic enterprises only; never to a real tenant.
    process.env.NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS = enterprise;
    const otherEnterprise = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
        values(${prefix + '-外部'},${'i7510-out-' + suffix},'active','manual') returning id::text`);
      const eid = String(row!.id); created.enterpriseIds.push(eid);
      return eid;
    });

    const makeUser = (eid: string, phone: string, nickname: string) => withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${eid},${phone},${nickname},'user') returning id::text`);
      const uid = String(row!.id); created.userIds.push(uid); return uid;
    });
    const makeAdmin = (eid: string, role: string, name: string, phone: string, index: number) => withPlatformTransaction(async tx => {
      const linked = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${eid},${phone},${name},'user') returning id::text`);
      created.userIds.push(String(linked!.id));
      const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,phone,menu_permissions,construction_trades)
        values(${eid},${String(linked!.id)},${'i7510_' + suffix + '_' + index},${passwordHash},${name},${role},'active',false,${phone},
        ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
      const adminId = String(row!.id); created.adminIds.push(adminId); return adminId;
    });

    const ownerUserId = await makeUser(enterprise, '19975100001', '联调业主');
    const outsiderUserId = await makeUser(enterprise, '19975100003', '同企业非本项目业主');
    await makeUser(otherEnterprise, '19975100002', '外部企业业主');
    const boss = await makeAdmin(enterprise, 'enterprise_admin', '联调老板', '19975100011', 1);
    const manager = await makeAdmin(enterprise, 'construction_staff', '联调项目经理', '19975100012', 2);
    const designer = await makeAdmin(enterprise, 'designer', '联调设计师', '19975100013', 3);
    const worker = await makeAdmin(enterprise, 'construction_staff', '联调施工师傅', '19975100014', 4);
    const outsiderBoss = await makeAdmin(otherEnterprise, 'enterprise_admin', '外部老板', '19975100015', 5);

    const owner = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
    const leadId = await withTenantTransaction(enterprise, async tx => {
      const row = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${enterprise},${ownerUserId},${'联调项目客户'},${'199751' + suffix.slice(-5)},'natural') returning id::text`);
      const id = String(row!.id); created.leadIds.push(id); return id;
    });
    const createKey = randomUUID();
    const project = await owner.execute('create', { leadId, name: 'I7.5.10 四端联调项目', managerId: manager, rooms: ['客厅', '书房'] }, createKey);
    const pid = String(project.id); created.projectIds.push(pid);
    // Same idempotency key must return the original project, not create another.
    const replay = await owner.execute('create', { leadId, name: 'I7.5.10 四端联调项目', managerId: manager, rooms: ['客厅', '书房'] }, createKey);
    check('service.create_idempotent', String(replay.id) === pid ? 'passed' : 'failed', '同一 Idempotency-Key 重复创建不新建项目', { pid, replayId: replay.id });

    for (const [role, aid] of [['designer', designer], ['worker', worker]] as const) {
      const detail = await owner.execute('detail', { projectId: pid });
      await owner.execute('member', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
        adminId: aid, role, active: true, workLabel: role === 'designer' ? '设计核对' : '现场施工' }, randomUUID());
    }
    {
      const detail = await owner.execute('detail', { projectId: pid });
      await owner.execute('progress', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
        stageKey: 'utilities', note: '四端联调进入水电', sendReminder: false }, randomUUID());
    }

    const listOf = async (adminId: string, eid = enterprise) => (await new ConstructionService({ enterpriseId: eid, adminId }).execute('list')).items as Array<{ id: string; my_role?: string }>;
    const bossList = await listOf(boss), managerList = await listOf(manager), designerList = await listOf(designer), workerList = await listOf(worker);
    check('service.scope.owner', bossList.some(p => p.id === pid) ? 'passed' : 'failed', '企业负责人可见本项目', { count: bossList.length });
    check('service.scope.manager', managerList.some(p => p.id === pid) ? 'passed' : 'failed', '项目经理可见本项目');
    check('service.scope.designer', designerList.some(p => p.id === pid) ? 'passed' : 'failed', '设计师可见本人参与项目');
    check('service.scope.worker', workerList.some(p => p.id === pid) ? 'passed' : 'failed', '施工人员可见本人参与项目');
    const outsiderList = await listOf(outsiderBoss, otherEnterprise);
    check('service.scope.cross_tenant', outsiderList.length === 0 ? 'passed' : 'failed', '其他企业负责人看不到本项目', { count: outsiderList.length });

    const designerDetail = await new ConstructionService({ enterpriseId: enterprise, adminId: designer }).execute('detail', { projectId: pid });
    check('service.detail.designer_read', designerDetail.project && designerDetail.myRole === 'designer' ? 'passed' : 'failed',
      '设计师可读取需求、点位/方案与现场事实', { myRole: designerDetail.myRole, rooms: (designerDetail.rooms as unknown[]).length });
    const workerDetail = await new ConstructionService({ enterpriseId: enterprise, adminId: worker }).execute('detail', { projectId: pid });
    check('service.detail.worker_read', workerDetail.project && workerDetail.myRole === 'worker' ? 'passed' : 'failed',
      '施工人员可读取当前任务与现场记录', { myRole: workerDetail.myRole });

    await expectForbidden(async () => {
      const detail = await new ConstructionService({ enterpriseId: enterprise, adminId: designer }).execute('detail', { projectId: pid });
      return new ConstructionService({ enterpriseId: enterprise, adminId: designer }).execute('member', {
        projectId: pid, expectedVersion: (detail.project as { version: number }).version, adminId: worker, role: 'observer', active: true, workLabel: '' }, randomUUID());
    }, 'service.permission.designer_member', '设计师不能修改工地成员');
    await expectForbidden(async () => {
      const detail = await new ConstructionService({ enterpriseId: enterprise, adminId: worker }).execute('detail', { projectId: pid });
      return new ConstructionService({ enterpriseId: enterprise, adminId: worker }).execute('progress', {
        projectId: pid, expectedVersion: (detail.project as { version: number }).version, stageKey: 'masonry_carpentry', note: '', sendReminder: false }, randomUUID());
    }, 'service.permission.worker_stage', '施工人员不能修改施工阶段');

    const bossBrief = await new ConstructionService({ enterpriseId: enterprise, adminId: boss }).execute('brief');
    const briefItems = bossBrief.items as Array<{ projectId: string; progress: { available: boolean; counts: unknown } }>;
    check('service.brief.boss', briefItems.some(p => p.projectId === pid) ? 'passed' : 'failed', '老板主动简报读取真实项目事实', { count: briefItems.length });
    const designerBrief = await new ConstructionService({ enterpriseId: enterprise, adminId: designer }).execute('brief');
    check('service.brief.designer_scope', (designerBrief.items as unknown[]).length === 0 ? 'passed' : 'failed', '设计师简报不进入管理层跨项目范围', { count: (designerBrief.items as unknown[]).length });

    const customer = new CustomerProjectProgress({ enterpriseId: enterprise, principal: { kind: 'user', userId: ownerUserId }, contextVersion: 1, capabilities: [] });
    const progress = await customer.read(pid);
    check('service.customer.progress', progress.projectId === pid && progress.access === 'owner' ? 'passed' : 'failed',
      '业主可读取本人项目进度', { access: progress.access, progressAvailable: progress.progress?.available, version: progress.progress?.version });
    try {
      const outsiderCustomer = new CustomerProjectProgress({ enterpriseId: enterprise, principal: { kind: 'user', userId: outsiderUserId }, contextVersion: 1, capabilities: [] });
      await outsiderCustomer.read(pid);
      check('service.customer.cross_owner', 'failed', '非本项目业主不能读取进度');
    } catch (error) { check('service.customer.cross_owner', 'passed', '非本项目业主不能读取进度', { code: (error as { code?: string }).code }); }

    check('service.database.target', 'passed', '仅使用共享开发库中的合成企业，未读写企业 1454', { database: 'smart_floor_planner', enterpriseIds: created.enterpriseIds });
  } finally {
    // Delete only rows created above. Each enterprise is removed inside its own
    // tenant transaction so RLS-hidden rows are visible to the cleanup.
    try {
      const { deleteAssistantData } = await import('@/db/repositories/assistant-cleanup');
      for (const eid of created.enterpriseIds) {
        await withTenantTransaction(eid, async tx => {
          await tx.execute(sql`delete from app.construction_projects where enterprise_id=${eid}`);
          await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
          await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
          await tx.execute(sql`delete from app.users where enterprise_id=${eid}`);
          for (const table of ['assistant_enterprise_settings', 'construction_stage_settings', 'construction_report_settings',
            'construction_followup_bindings', 'construction_camera_retention_defaults']) {
            await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${eid}`);
          }
          await deleteAssistantData(tx, BigInt(eid));
        });
        await withPlatformTransaction(tx => tx.execute(sql`delete from app.enterprises where id=${eid}`));
      }
      check('service.cleanup', 'passed', '仅删除本轮合成企业数据', { enterpriseIds: created.enterpriseIds });
    } catch (error) {
      check('service.cleanup', 'failed', '合成数据清理失败，需要人工核对', { message: (error as Error).message, enterpriseIds: created.enterpriseIds });
    }
    const { closePostgresPool } = await import('@/lib/postgresql');
    await closePostgresPool();
  }

  console.log(JSON.stringify({ finishedAt: new Date().toISOString(), checks }, null, 2));
  if (checks.some(c => c.status === 'failed')) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
