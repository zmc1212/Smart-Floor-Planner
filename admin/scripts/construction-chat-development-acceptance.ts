/** Explicit development-only native PPT22/23/33/38 fixture. Never seeds production or persists credentials. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const root = path.resolve('..'), output = path.join(root, 'tmp/xiaok-followup-batch');
fs.mkdirSync(output, { recursive: true });
async function main() {
  loadEnvConfig(process.cwd(), true);
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  const [{ ConstructionService }, { SiteChatService }, { signMiniProgramToken }] = await Promise.all([
    import('@/lib/construction/service'), import('@/lib/construction/site-chat'), import('@/lib/miniprogram-jwt')]);
  const roles = ['enterprise_admin','designer','construction_staff'] as const;
  const prefix = 'synthetic-shared-followup-' + randomUUID(), staff: { userId: string; adminId: string; role: typeof roles[number] }[] = [];
  const report: Row = { prefix, started: new Date().toISOString(), checks: [], passed: false, scope: 'PPT22/23/33/38 bounded shared query and issue follow-up; no formal approval/closure' };
  const save = () => fs.writeFileSync(path.join(output,'native-driver.json'), JSON.stringify(report,null,2));
  let eid = '', customerId = '', projectId = '', ownerId = '', leadId = '';
  try {
    await withPlatformTransaction(async tx => {
      const template = await one(tx, sql`select s.agent_config,e.name,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404 and s.enabled`);
      assert.ok(template && String(template.code).startsWith('p4b-development-'));
      const config = template.agent_config as Row; assert.equal(config.providerKey,'deepseek'); assert.equal(config.model,'deepseek-flash');
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 共享事项接续',${prefix},'active') returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,100,1000000,10000000,30,${JSON.stringify({ ...config, imageInput: false })}::jsonb)`);
      for (const [i, role] of roles.entries()) {
        const uid = String((await one(tx, sql`insert into app.users(nickname,phone,context_version) values(${prefix+role},${'139'+String(Date.now()).slice(-6)+String(i).padStart(2,'0')},1) returning id`))!.id);
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,display_name)
          values(${eid},${uid},${prefix+role},${'unusable:'+randomUUID()},${role},'active',false,${['合成负责人','合成设计师','合成师傅'][i]}) returning id`))!.id);
        staff.push({ userId: uid, adminId: aid, role }); if (!i) ownerId = aid;
      }
      customerId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+'customer'},1) returning id`))!.id);
    });
    report.fixture = { enterpriseId:eid, customerId, staff }; save();
    leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${customerId},'合成共享事项业主','13800000000','natural') returning id`)))!.id);
    const service = new ConstructionService({ enterpriseId:eid, adminId:ownerId });
    projectId = String((await service.execute('create',{leadId,name:'合成书房持续跟进工地',managerId:ownerId,rooms:['书房','客厅']},randomUUID())).id);
    const version = async () => Number(((await service.execute('detail',{projectId})).project as Row).version);
    for (const member of staff.slice(1)) await service.execute('member',{projectId,expectedVersion:await version(),adminId:member.adminId,role:member.role==='designer'?'designer':'worker',active:true,workLabel:''},randomUUID());
    report.fixture = { ...(report.fixture as Row),leadId,projectId }; save();
    const identities = [];
    for (const s of staff) identities.push({ ...s, enterpriseId:eid, token: await signMiniProgramToken({sub:s.userId,id:s.userId,mode:'staff',role:s.role,staffRole:s.role,staffId:s.adminId,enterpriseId:eid,contextVersion:1,source:'phone'}) });
    for (const s of identities) {
      const probe = await fetch(`http://localhost:3006/api/miniprogram/construction/projects/${projectId}/chat`,{headers:{Authorization:'Bearer '+s.token},signal:AbortSignal.timeout(60000)});
      assert.equal(probe.status,200,JSON.stringify(await probe.json()));
    }
    (report.checks as Row[]).push({name:'three signed synthetic staff identities pass the real HTTP project gate',passed:true}); save();
    const ownerChat = new SiteChatService({enterpriseId:eid,adminId:ownerId});
    const native = await import('./construction-chat-native.mjs');
    report.native = await native.run({root,output,projectId,identities,
      verify: async () => {
        const data = await ownerChat.read(projectId);
        const events = await withTenantTransaction(eid,tx=>rows(tx,sql`select id::text,type,aggregate_id::text,aggregate_version,payload from app.domain_event_outbox
          where enterprise_id=${eid} and type in ('construction.site.issue.opened.v1','construction.site.issue.progress.v1') order by id`));
        return {data,events};
      },
      revoke: async () => service.execute('member',{projectId,expectedVersion:await version(),adminId:staff[1].adminId,role:'designer',active:false,workLabel:''},randomUUID()),
    });
    const runs = await withTenantTransaction(eid,tx=>rows(tx,sql`select r.id::text,r.status,r.purpose,r.created_at,r.completed_at,r.policy_snapshot->'agent' as model,
      s.input_summary,s.private_checkpoint from app.assistant_runs r left join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id and s.step_seq=1100
      where r.enterprise_id=${eid} order by r.id`));
    report.runs = runs; assert.equal(runs.length,2); assert.ok(runs.every(r=>r.status==='succeeded' && r.purpose==='site.record'));
    report.usage = await withTenantTransaction(eid,tx=>rows(tx,sql`select run_id::text,measurement_kind,input_tokens,output_tokens from app.assistant_usage_records where enterprise_id=${eid} order by run_id`));
    report.passed = true; save();
  } finally {
    if (eid) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and username like ${prefix+'%'}`);
      for (const uid of [...staff.map(s=>String(s.userId)),customerId].filter(Boolean)) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
      report.finalState = await one(tx,sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,
        (select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs`);
    });
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
