/** I7.5.10 four-end HTTP acceptance. Creates a synthetic enterprise in the
 *  shared development database, calls the real Mini Program API endpoints, and
 *  removes only the rows it created. Enterprise 1454 is never referenced. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

loadEnvConfig(process.cwd(), true);
const target = process.env.DATABASE_URL?.trim() || '';
if (new URL(target).pathname !== '/smart_floor_planner') throw new Error('Shared development database only');
process.env.DATABASE_URL = target;
const origin = process.env.XIAOK_I7510_API_ORIGIN?.trim() || 'http://127.0.0.1:3006';

type Status = 'passed' | 'failed' | 'limited' | 'not_run';
const checks: Array<{ id: string; status: Status; detail: string; evidence?: unknown }> = [];
const check = (id: string, status: Status, detail: string, evidence?: unknown) => {
  checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    try { const r = await fetch(origin + '/api/health'); if (r.status < 500) return true; } catch { /* keep polling */ }
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

  const suffix = String(Date.now());
  const prefix = 'I7.5.10四端HTTP-' + suffix;
  const password = 'I7510-Pass-' + suffix;
  const passwordHash = await bcrypt.hash(password, 10);
  const created: { enterpriseIds: string[]; adminIds: string[]; userIds: string[] } = { enterpriseIds: [], adminIds: [], userIds: [] };

  try {
    const identity = await withPlatformTransaction(tx => one(tx, sql`select current_user as db_user,current_database() as db_name`));
    assert.equal(identity?.db_user, 'sfp_app');
    assert.equal(identity?.db_name, 'smart_floor_planner');

    const enterprise = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
        values(${prefix},${'i7510-http-' + suffix},'active','manual') returning id::text`);
      const eid = String(row!.id); created.enterpriseIds.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
        values(${eid},true,365,100000,1000000000,1000000000)`);
      return eid;
    });
    const otherEnterprise = await withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
        values(${prefix + '-外部'},${'i7510-http-out-' + suffix},'active','manual') returning id::text`);
      const eid = String(row!.id); created.enterpriseIds.push(eid); return eid;
    });
    const makeUser = (eid: string, phone: string, nickname: string) => withPlatformTransaction(async tx => {
      const row = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${eid},${phone},${nickname},'user') returning id::text`);
      const uid = String(row!.id); created.userIds.push(uid); return uid;
    });
    const makeAdmin = (eid: string, role: string, name: string, phone: string, index: number) => withPlatformTransaction(async tx => {
      const linked = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${eid},${phone},${name},'user') returning id::text`);
      created.userIds.push(String(linked!.id));
      const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,phone,menu_permissions,construction_trades)
        values(${eid},${String(linked!.id)},${'i7510_http_' + suffix + '_' + index},${passwordHash},${name},${role},'active',false,${phone},
        ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
      const adminId = String(row!.id); created.adminIds.push(adminId); return { adminId, username: 'i7510_http_' + suffix + '_' + index };
    });

    const ownerUserId = await makeUser(enterprise, '19975110001', 'HTTP联调业主');
    const boss = await makeAdmin(enterprise, 'enterprise_admin', 'HTTP联调老板', '19975110011', 1);
    const manager = await makeAdmin(enterprise, 'construction_staff', 'HTTP联调项目经理', '19975110012', 2);
    const designer = await makeAdmin(enterprise, 'designer', 'HTTP联调设计师', '19975110013', 3);
    const worker = await makeAdmin(enterprise, 'construction_staff', 'HTTP联调施工师傅', '19975110014', 4);
    const outsider = await makeAdmin(otherEnterprise, 'enterprise_admin', 'HTTP外部老板', '19975110015', 5);

    const owner = new ConstructionService({ enterpriseId: enterprise, adminId: boss.adminId });
    const leadId = await withTenantTransaction(enterprise, async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterprise},${ownerUserId},${'HTTP联调客户'},${'199751' + suffix.slice(-5)},'natural') returning id::text`))!.id));
    const project = await owner.execute('create', { leadId, name: 'I7.5.10 HTTP 联调项目', managerId: manager.adminId, rooms: ['客厅', '书房'] }, randomUUID());
    const pid = String(project.id);
    for (const [role, aid] of [['designer', designer.adminId], ['worker', worker.adminId]] as const) {
      const detail = await owner.execute('detail', { projectId: pid });
      await owner.execute('member', { projectId: pid, expectedVersion: (detail.project as { version: number }).version, adminId: aid, role, active: true,
        workLabel: role === 'designer' ? '设计核对' : '现场施工' }, randomUUID());
    }

    const login = async (username: string) => {
      const response = await fetch(origin + '/api/auth/miniprogram', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'password', username, password }) });
      const payload = await response.json() as { success?: boolean; token?: string };
      if (!payload.success || !payload.token) throw new Error('login failed for ' + username + ': ' + JSON.stringify(payload));
      return payload.token;
    };
    const bossToken = await login(boss.username), designerToken = await login(designer.username),
      workerToken = await login(worker.username), outsiderToken = await login(outsider.username);
    check('http.login.staff', 'passed', '老板、设计师、施工人员使用真实密码登录取得会话', { roles: ['enterprise_admin', 'designer', 'construction_staff'] });

    const call = async (token: string, path: string, init: RequestInit = {}) => {
      const response = await fetch(origin + '/api' + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* media or empty */ }
      return { status: response.status, body: body as { success?: boolean; data?: Record<string, unknown>; error?: string } };
    };

    const bossList = await call(bossToken, '/miniprogram/construction/projects');
    const designerList = await call(designerToken, '/miniprogram/construction/projects');
    const workerList = await call(workerToken, '/miniprogram/construction/projects');
    const outsiderList = await call(outsiderToken, '/miniprogram/construction/projects');
    check('http.projects.owner', bossList.status === 200 && (bossList.body.data?.items as Array<{ id: string }> | undefined)?.some(p => p.id === pid) ? 'passed' : 'failed',
      '老板 API 读取本项目列表', { status: bossList.status });
    check('http.projects.designer', designerList.status === 200 && (designerList.body.data?.items as Array<{ id: string }> | undefined)?.some(p => p.id === pid) ? 'passed' : 'failed',
      '设计师 API 读取本人项目列表', { status: designerList.status });
    check('http.projects.worker', workerList.status === 200 && (workerList.body.data?.items as Array<{ id: string }> | undefined)?.some(p => p.id === pid) ? 'passed' : 'failed',
      '施工人员 API 读取本人项目列表', { status: workerList.status });
    check('http.projects.cross_tenant', outsiderList.status === 200 && (outsiderList.body.data?.items as unknown[] | undefined)?.length === 0 ? 'passed' : 'failed',
      '其他企业 API 列表为空，不跨企业返回项目', { status: outsiderList.status });

    const designerDetail = await call(designerToken, '/miniprogram/construction/projects/' + pid);
    const workerDetail = await call(workerToken, '/miniprogram/construction/projects/' + pid);
    check('http.detail.designer', designerDetail.status === 200 && designerDetail.body.data?.myRole === 'designer' ? 'passed' : 'failed',
      '设计师 API 读取需求、点位/方案和现场事实', { status: designerDetail.status, myRole: designerDetail.body.data?.myRole });
    check('http.detail.worker', workerDetail.status === 200 && workerDetail.body.data?.myRole === 'worker' ? 'passed' : 'failed',
      '施工人员 API 读取当前任务与现场记录', { status: workerDetail.status, myRole: workerDetail.body.data?.myRole });

    const bossBrief = await call(bossToken, '/miniprogram/construction/brief');
    const briefItems = (bossBrief.body.data?.items || []) as Array<{ projectId: string; issues?: unknown[]; progress?: { available: boolean } }>;
    check('http.brief.boss', bossBrief.status === 200 && briefItems.some(p => p.projectId === pid) ? 'passed' : 'failed',
      '老板 API 主动简报读取真实项目、进度和事项事实', { status: bossBrief.status, item: briefItems.find(p => p.projectId === pid) || null });

    const workerProgressPath = '/miniprogram/construction/projects/' + pid + '/progress';
    const workerWrite = await call(workerToken, workerProgressPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ expectedVersion: (workerDetail.body.data?.project as { version: number }).version, stageKey: 'masonry_carpentry', note: '', sendReminder: false }) });
    check('http.permission.worker_stage', workerWrite.status === 403 ? 'passed' : 'failed', '施工人员不能通过 API 修改施工阶段', { status: workerWrite.status, error: workerWrite.body.error });

    const designerMember = await call(designerToken, '/miniprogram/construction/projects/' + pid + '/member', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ expectedVersion: (designerDetail.body.data?.project as { version: number }).version, adminId: worker.adminId, role: 'observer', active: true, workLabel: '' }) });
    check('http.permission.designer_member', designerMember.status === 403 ? 'passed' : 'failed', '设计师不能通过 API 修改工地成员', { status: designerMember.status, error: designerMember.body.error });

    const bossDetail = await call(bossToken, '/miniprogram/construction/projects/' + pid);
    const stageKey = randomUUID();
    const body = JSON.stringify({ expectedVersion: (bossDetail.body.data?.project as { version: number }).version, stageKey: 'utilities', note: 'HTTP联调进入水电', sendReminder: false });
    const first = await call(bossToken, workerProgressPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stageKey }, body });
    const replay = await call(bossToken, workerProgressPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stageKey }, body });
    check('http.write.receipt_idempotent', first.status === 200 && replay.status === 200 && first.body.data?.id === replay.body.data?.id
      && first.body.data?.version === replay.body.data?.version ? 'passed' : 'failed', '老板更新阶段有真实回执，同一次操作重复提交不重复生效',
      { first: first.status, replay: replay.status, version: first.body.data?.version });

    const after = await call(bossToken, '/miniprogram/construction/projects/' + pid);
    check('http.state.refresh', after.status === 200 && (after.body.data?.project as { current_stage_key?: string })?.current_stage_key === 'utilities' ? 'passed' : 'failed',
      '写入后重新读取状态已刷新', { stage: (after.body.data?.project as { current_stage_key?: string })?.current_stage_key });

    check('http.database.target', 'passed', '仅使用共享开发库合成企业，未读写企业 1454', { database: 'smart_floor_planner', enterpriseIds: created.enterpriseIds });
  } finally {
    try {
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
      check('http.cleanup', 'passed', '仅删除本轮合成企业数据', { enterpriseIds: created.enterpriseIds });
    } catch (error) {
      check('http.cleanup', 'failed', '合成数据清理失败，需要人工核对', { message: (error as Error).message, enterpriseIds: created.enterpriseIds });
    }
    await closePostgresPool();
  }
  console.log(JSON.stringify({ finishedAt: new Date().toISOString(), origin, checks }, null, 2));
  if (checks.some(c => c.status === 'failed')) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
