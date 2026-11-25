/** I7.5.9 isolated PostgreSQL 17 acceptance for the Worker side-effect audit.
 * It creates two synthetic enterprises, exercises the scoped notification,
 * portfolio and assistant job entries and verifies the out-of-scope enterprise
 * receives no message, delivery receipt or business write. It never connects to
 * the development/production database and cleans up every synthetic row. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';

const admin = path.resolve(process.cwd());
loadEnvConfig(admin, true);
const connectionFile = path.resolve(admin, '..', 'tmp/xiaok-i745-f2/connection.private.json');
if (!fs.existsSync(connectionFile)) throw new Error('Missing tmp/xiaok-i745-f2/connection.private.json');
const connections = JSON.parse(fs.readFileSync(connectionFile, 'utf8')) as { DATABASE_URL: string; MIGRATION_URL: string };
const target = new URL(connections.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/i745_f1_accept'
  || target.username !== 'sfp_app') {
  throw new Error('Reuse only 127.0.0.1:55432/i745_f1_accept as sfp_app');
}
process.env.DATABASE_URL = connections.DATABASE_URL;

type CheckStatus = 'passed' | 'failed' | 'limited' | 'not_run';
const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9)
  || '../tmp/xiaok-i759/run-' + Date.now());
assert.ok(!fs.existsSync(path.join(output, 'result.json')), 'Preserve every original outcome');
fs.mkdirSync(output, { recursive: true });
const result: {
  startedAt: string; finishedAt?: string; database: string; user: string; runId: string;
  checks: Array<{ id: string; status: CheckStatus; detail: string; evidence?: unknown }>;
  ids: Record<string, unknown>; error?: string;
} = { startedAt: new Date().toISOString(), database: 'i745_f1_accept', user: 'sfp_app',
  runId: randomUUID(), checks: [], ids: {} };
const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
const check = (id: string, status: CheckStatus, detail: string, evidence?: unknown) => {
  result.checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
  console.log(id + ': ' + status);
  save();
};

async function main() {
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one, rows } = await import('@/db/repositories/assistant-repository');
  const { deleteAssistantData } = await import('@/db/repositories/assistant-cleanup');
  const { deleteConstructionData } = await import('@/db/repositories/construction-cleanup');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { ConversationService, appendMessage } = await import('@/lib/assistant/core/conversation');
  const { processAssistantJob, failRun } = await import('@/lib/assistant/infrastructure/job-queue');
  const { assistantWorkerPreflight } = await import('@/lib/assistant/infrastructure/worker-preflight');
  const { previewWorkerSideEffects } = await import('@/lib/assistant/infrastructure/worker-side-effects');
  const { runAssistantJobsTick } = await import('@/lib/assistant/infrastructure/jobs-tick');
  const { deliverSiteNotifications } = await import('@/lib/construction/site-publications');
  const { deliverPublicConsents } = await import('@/lib/construction/public-projections');
  const { processPortfolioCopy } = await import('@/lib/portfolio/copy-service');
  const { advanceKnowledgeBatches } = await import('@/lib/assistant/knowledge/batch-worker');

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept'); assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('assistant_jobs','assistant_messages','assistant_model_tasks','domain_event_deliveries',
      'construction_site_records','construction_public_sites','construction_watches','construction_projects')
    order by 1`));
  check('env.pg17_rls', rls.length === 8 && rls.every(row => row.rls === true && row.forced === true)
    ? 'passed' : 'failed', '复用 F1/F2 PG17 隔离库，sfp_app 非超级用户且相关表强制 RLS', { identity, rls });

  const prefix = 'I7.5.9 Worker 副作用审计合成企业-' + Date.now() + '-' + randomUUID().slice(0, 8);
  const tenantIds: string[] = [];
  const adminIds: string[] = [];
  const userIds: string[] = [];

  async function createTenant(label: string) {
    const created = await withPlatformTransaction(async tx => {
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status)
        values(${label},${label},'active') returning id`))!;
      const eid = String(enterprise.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,100,1200000,100000000,90)`);
      const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${label},1) returning id`))!;
      const uid = String(user.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${label + '-openid'})`);
      const admin = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${eid},${label},'unusable-synthetic','enterprise_admin','active',ARRAY['construction-projects'],false) returning id`))!;
      return { eid, uid, adminId: String(admin.id) };
    });
    tenantIds.push(created.eid); userIds.push(created.uid); adminIds.push(created.adminId);
    return created;
  }

  async function createConversationFixture(eid: string, uid: string) {
    const actor = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1,
      capabilities: ['assistant.chat.self'] };
    const service = new ConversationService(actor as never);
    const conversation = await service.create('i759-conv-' + randomUUID());
    const cid = String(conversation.id);
    const message = await withTenantTransaction(eid, tx => appendMessage(tx, actor as never, cid, {
      author: 'user', clientMessageId: randomUUID(),
      content: { version: 1, blocks: [{ type: 'text', text: 'I7.5.9 合成业主消息' }] },
    }));
    return { actor, conversationId: cid, messageId: String(message.id) };
  }

  async function createConstructionFixture(eid: string, uid: string, adminId: string, cid: string, messageId: string,
    label: string, withPortfolioTask: boolean) {
    return withTenantTransaction(eid, async tx => {
      const lead = (await one(tx, sql`insert into app.leads(enterprise_id,name,phone,source,status,customer_user_id)
        values(${eid},${label},'13800000000','test','new',${uid}) returning id`))!;
      const project = (await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name,status,customer_access)
        values(${eid},${String(lead.id)},${label},'active',true) returning id`))!;
      await tx.execute(sql`insert into app.construction_chats(enterprise_id,project_id,conversation_id)
        values(${eid},${String(project.id)},${cid})`);
      const draft = { title: 'I7.5.9 合成进展', roomId: null, completed: '完成水电测试', pending: '', coordination: '', note: '' };
      const record = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot,version,review_requirements,audience,approved_by,published_version,published_customer_id,published_at,withdrawal_reason)
        values(${eid},${String(project.id)},${cid},${messageId},${adminId},'published',${JSON.stringify(draft)}::jsonb,null,'',1,'','customer',${adminId},1,${uid},now(),'')
        returning id`))!;
      await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,event_version,aggregate_type,aggregate_id,aggregate_version,
        actor_ref,occurred_at,correlation_id,payload) values(${eid},'construction.record.publish.v1',1,'construction_site_record',
        ${String(record.id)},1,'{"kind":"system"}'::jsonb,now(),${randomUUID()},'{}'::jsonb)`);
      await tx.execute(sql`insert into app.construction_watches(enterprise_id,project_id,customer_id,room_id,room_name_snapshot,
        active,photos_only,source_message_id,started_at) values(${eid},${String(project.id)},${uid},null,'',true,false,${messageId},now()-interval '1 second')`);
      const content = { name: label, cityCode: '420500', cityName: '宜昌市', district: '西陵区', stageName: '水电',
        sourceCount: 1, photoCount: 0, excerpts: [{ role: '业主（匿名）', text: 'I7.5.9 合成公开摘要', date: new Date().toISOString() }] };
      const contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      const site = (await one(tx, sql`insert into app.construction_public_sites(enterprise_id,project_id,prepared_by,customer_id)
        values(${eid},${String(project.id)},${adminId},${uid}) returning id`))!;
      const version = (await one(tx, sql`insert into app.construction_public_versions(enterprise_id,project_id,site_id,ordinal,
        content,content_hash,prepared_by) values(${eid},${String(project.id)},${String(site.id)},1,
        ${JSON.stringify(content)}::jsonb,${contentHash},${adminId}) returning id`))!;
      await tx.execute(sql`update app.construction_public_sites set current_version_id=${String(version.id)},revision=2,
        status='published',consented_version_id=${String(version.id)},consented_by=${uid},reviewed_by=${adminId},updated_at=now()
        where enterprise_id=${eid} and id=${String(site.id)}`);
      await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,event_version,aggregate_type,aggregate_id,aggregate_version,
        actor_ref,occurred_at,correlation_id,payload) values(${eid},'construction.public.consent.v1',1,'construction_public_site',
        ${String(site.id)},2,'{"kind":"system"}'::jsonb,now(),${randomUUID()},
        ${JSON.stringify({ siteId: String(site.id), versionId: String(version.id), customerId: uid })}::jsonb)`);
      const task = withPortfolioTask ? (await one(tx, sql`insert into app.assistant_model_tasks(enterprise_id,created_by,operation_key,kind,state,
        binding,request,request_hash,reserved_tokens,reserved_cost_micros) values(${eid},${adminId},${'i759-' + randomUUID()},
        'portfolio_copy','prepared','{}'::jsonb,'{}'::jsonb,${createHash('sha256').update('i759').digest('hex')},16000,1000000)
        returning id`))! : null;
      return { leadId: String(lead.id), projectId: String(project.id), recordId: String(record.id),
        siteId: String(site.id), versionId: String(version.id), taskId: task ? String(task.id) : null };
    });
  }

  async function snapshot(eid: string) {
    return withTenantTransaction(eid, tx => one(tx, sql`select
      (select count(*)::int from app.assistant_jobs where enterprise_id=${eid}) jobs,
      (select count(*)::int from app.assistant_runs where enterprise_id=${eid}) runs,
      (select count(*)::int from app.assistant_messages where enterprise_id=${eid}) messages,
      (select count(*)::int from app.domain_event_outbox where enterprise_id=${eid}) outbox,
      (select count(*)::int from app.domain_event_deliveries where enterprise_id=${eid}) deliveries,
      (select count(*)::int from app.construction_site_records where enterprise_id=${eid}) records,
      (select count(*)::int from app.construction_public_sites where enterprise_id=${eid}) public_sites,
      (select count(*)::int from app.assistant_model_tasks where enterprise_id=${eid}) model_tasks,
      (select count(*)::int from app.assistant_knowledge_batches where enterprise_id=${eid}) batches,
      (select md5(coalesce(string_agg(id::text||':'||status,',' order by id),'')) from app.assistant_jobs where enterprise_id=${eid}) job_hash,
      (select md5(coalesce(string_agg(id::text||':'||state,',' order by id),'')) from app.assistant_model_tasks where enterprise_id=${eid}) task_hash`));
  }

  async function waitUntilDue(eid: string, runId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const due = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.assistant_jobs
        where enterprise_id=${eid} and run_id=${runId} and status='queued' and available_at<=now()`));
      if (due) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('fixture job did not become due');
  }

  try {
    const pilot = await createTenant(prefix + '-试点');
    const outside = await createTenant(prefix + '-范围外');
    result.ids.pilot = pilot; result.ids.outside = outside;
    const pilotConversation = await createConversationFixture(pilot.eid, pilot.uid);
    const outsideConversation = await createConversationFixture(outside.eid, outside.uid);
    const pilotFixture = await createConstructionFixture(pilot.eid, pilot.uid, pilot.adminId,
      pilotConversation.conversationId, pilotConversation.messageId, prefix + '-试点项目', false);
    const outsideFixture = await createConstructionFixture(outside.eid, outside.uid, outside.adminId,
      outsideConversation.conversationId, outsideConversation.messageId, prefix + '-范围外项目', true);
    result.ids.fixtures = { pilot: pilotFixture, outside: outsideFixture };

    const pilotService = new ConversationService(pilotConversation.actor as never);
    const outsideService = new ConversationService(outsideConversation.actor as never);
    const content = () => ({ version: 1 as const, blocks: [{ type: 'text' as const, text: 'I7.5.9 队列合成消息' }] });
    const pilotRun = await pilotService.send(pilotConversation.conversationId, randomUUID(), content());
    const outsideRun = await outsideService.send(outsideConversation.conversationId, randomUUID(), content());
    result.ids.runs = { pilot: String(pilotRun.runId), outside: String(outsideRun.runId) };

    const pilotEnv = {
      XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: pilot.eid,
      XIAOK_STAGE_REMINDER_PILOT_ID: 'i759-pilot',
      XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: pilot.eid,
      XIAOK_WEEKLY_REPORT_PILOT_ID: 'i759-pilot',
    };
    const outsideEnv = { ...pilotEnv,
      XIAOK_STAGE_REMINDER_ENTERPRISE_ID: outside.eid, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: outside.eid,
      XIAOK_STAGE_REMINDER_PILOT_ID: 'i759-outside', XIAOK_WEEKLY_REPORT_PILOT_ID: 'i759-outside' };

    // ------------------------------------------------------------ dry-run
    const beforePreflight = { pilot: await snapshot(pilot.eid), outside: await snapshot(outside.eid) };
    const preflight = await assistantWorkerPreflight({ env: pilotEnv, now: new Date() });
    const preflightAgain = await assistantWorkerPreflight({ env: pilotEnv, now: new Date() });
    const afterPreflight = { pilot: await snapshot(pilot.eid), outside: await snapshot(outside.eid) };
    check('dryrun.no_state_change', JSON.stringify(beforePreflight) === JSON.stringify(afterPreflight)
      ? 'passed' : 'failed', 'preflight/dry-run 前后两家企业全部计数与 job/task 哈希一致',
    { beforePreflight, afterPreflight });
    const scopedQueue = preflight.scopedQueue;
    const globalQueue = preflight.queue;
    const globalEnterpriseIds = new Set(globalQueue.items.map(item => item.enterpriseId));
    check('dryrun.scope_preview', preflight.safetyGate.status === 'open'
      && preflight.sideEffects.scope.enterpriseId === pilot.eid
      && scopedQueue?.scope.mode === 'pilot_and_shared_consultations'
      && scopedQueue.counts.queued === 2 && globalQueue.counts.queued >= 2
      && scopedQueue.items.some(item => item.enterpriseId === pilot.eid)
      && scopedQueue.items.some(item => item.enterpriseId === outside.eid)
      && globalEnterpriseIds.has(pilot.eid) && globalEnterpriseIds.has(outside.eid)
      ? 'passed' : 'failed', 'dry-run 显示全局积压，以及 Worker 可领取的试点任务与两家企业的业主咨询',
    { gate: preflight.safetyGate, scoped: scopedQueue?.counts, global: globalQueue.counts,
      globalEnterpriseIds: [...globalEnterpriseIds] });
    const taskOf = (name: string) => preflight.sideEffects.tasks.find(task => task.task === name)!;
    check('dryrun.side_effect_counts', taskOf('assistant_jobs').pending === 2
      && taskOf('site_publications').pending === 1 && taskOf('public_consents').pending === 1
      && taskOf('portfolio_copy').pending === 0 && taskOf('knowledge_batches').pending === 0
      && taskOf('assistant_jobs').scope === 'pilot_and_shared_consultations'
      ? 'passed' : 'failed', 'dry-run 逐项显示试点范围、候选数量与副作用；范围外 Portfolio 任务不计入',
    { tasks: preflight.sideEffects.tasks, second: preflightAgain.sideEffects.scope });

    // ------------------------------------------------------------ scoped assistant jobs
    await waitUntilDue(pilot.eid, String(pilotRun.runId));
    await waitUntilDue(outside.eid, String(outsideRun.runId));
    const outsideBeforeClaim = await snapshot(outside.eid);
    const claimed: string[] = [];
    const jobResult = await processAssistantJob(async lease => {
      claimed.push(lease.enterpriseId);
      await failRun(lease, 'i759_synthetic_fixture');
    }, 4, { enterpriseId: pilot.eid });
    const outsideAfterClaim = await snapshot(outside.eid);
    const outsideJob = await withTenantTransaction(outside.eid, tx => one(tx, sql`select status from app.assistant_jobs
      where enterprise_id=${outside.eid} and run_id=${String(outsideRun.runId)}`));
    check('scope.assistant_jobs', jobResult.claimed === true && claimed.length === 1 && claimed[0] === pilot.eid
      && outsideJob?.status === 'queued'
      && JSON.stringify(outsideBeforeClaim) === JSON.stringify(outsideAfterClaim)
      ? 'passed' : 'failed', 'scoped processAssistantJob 只领取试点企业任务，范围外 queued 任务与哈希不变',
    { claimed, outsideJob, outsideBefore: outsideBeforeClaim, outsideAfter: outsideAfterClaim });

    // ------------------------------------------------------------ scoped site notifications
    const outsideBeforeSite = await snapshot(outside.eid);
    const pilotSiteDelivered = await deliverSiteNotifications({ enterpriseId: pilot.eid });
    const outsideAfterSite = await snapshot(outside.eid);
    check('scope.site_notifications', pilotSiteDelivered >= 1
      && JSON.stringify(outsideBeforeSite) === JSON.stringify(outsideAfterSite)
      ? 'passed' : 'failed', '试点范围投递只写试点企业的站内进展，不触碰范围外企业',
    { pilotSiteDelivered, outsideBefore: outsideBeforeSite, outsideAfter: outsideAfterSite });
    const outsideSiteDelivered = await deliverSiteNotifications({ enterpriseId: outside.eid });
    check('scope.site_fixture_valid', outsideSiteDelivered >= 1
      ? 'passed' : 'failed', '范围外夹具本身有效，显式指向该企业时才会投递', { outsideSiteDelivered });

    // ------------------------------------------------------------ scoped public consents
    const outsideBeforeConsent = await snapshot(outside.eid);
    const pilotConsentDelivered = await deliverPublicConsents(pilot.eid);
    const outsideAfterConsent = await snapshot(outside.eid);
    check('scope.public_consents', pilotConsentDelivered >= 1
      && JSON.stringify(outsideBeforeConsent) === JSON.stringify(outsideAfterConsent)
      ? 'passed' : 'failed', '试点范围公开材料确认只写试点企业，不触碰范围外企业',
    { pilotConsentDelivered, outsideBefore: outsideBeforeConsent, outsideAfter: outsideAfterConsent });
    const outsideConsentDelivered = await deliverPublicConsents(outside.eid);
    check('scope.public_consent_fixture_valid', outsideConsentDelivered >= 1
      ? 'passed' : 'failed', '范围外公开材料夹具本身有效，显式指向该企业时才会投递', { outsideConsentDelivered });

    // ------------------------------------------------------------ scoped portfolio copy
    const pilotCopy = await processPortfolioCopy({ enterpriseId: pilot.eid });
    const outsideTask = await withTenantTransaction(outside.eid, tx => one(tx, sql`select state from app.assistant_model_tasks
      where enterprise_id=${outside.eid} and id=${outsideFixture.taskId}`));
    const outsideEffects = await previewWorkerSideEffects({ env: outsideEnv, now: new Date() });
    const outsideCopyTask = outsideEffects.tasks.find(task => task.task === 'portfolio_copy')!;
    const pilotCopyTask = preflight.sideEffects.tasks.find(task => task.task === 'portfolio_copy')!;
    check('scope.portfolio_copy', pilotCopy === false && outsideTask?.state === 'prepared'
      && pilotCopyTask.pending === 0 && outsideCopyTask.pending === 1
      ? 'passed' : 'failed', 'scoped Portfolio 只认领本企业；范围外 prepared 任务保持原状且只在自身范围预览中计数',
    { pilotCopy, outsideTask, pilotCopyTask, outsideCopyTask });

    // ------------------------------------------------------------ knowledge batches
    const pilotBatches = await advanceKnowledgeBatches({ enterpriseId: pilot.eid });
    const outsideBatches = await withTenantTransaction(outside.eid, tx => one(tx, sql`select count(*)::int as n
      from app.assistant_knowledge_batches where enterprise_id=${outside.eid}`));
    check('scope.knowledge_batches', pilotBatches === 0 && Number(outsideBatches?.n) === 0
      ? 'limited' : 'failed', '知识批次入口接受企业范围并返回 0；本轮未伪造有效批次候选，范围过滤由源码与单测覆盖',
    { pilotBatches, outsideBatches });

    // ------------------------------------------------------------ gate closed
    const closedPreflight = await assistantWorkerPreflight({ env: {}, now: new Date() });
    const closedTasks = closedPreflight.sideEffects.tasks;
    check('gate.closed_all_tasks_stopped', closedPreflight.safetyGate.status === 'closed'
      && closedPreflight.sideEffects.scope.mode === 'none'
      && closedTasks.every(task => !task.wouldRun)
      ? 'passed' : 'failed', '门禁关闭时 dry-run 中所有副作用任务均为 wouldRun=false，范围 none',
    { gate: closedPreflight.safetyGate, tasks: closedTasks });
    const counters = { knowledge: 0, assistant: 0, site: 0, consents: 0, copy: 0, schedule: 0 };
    const blockedTick = await runAssistantJobsTick({
      env: {},
      advanceKnowledgeBatches: async () => { counters.knowledge += 1; return 0; },
      processAssistantJob: async () => { counters.assistant += 1; return { claimed: false }; },
      deliverSiteNotifications: async () => { counters.site += 1; return 0; },
      deliverPublicConsents: async () => { counters.consents += 1; return 0; },
      processPortfolioCopy: async () => { counters.copy += 1; return false; },
      runNativeWorkflowScheduleTick: async () => { counters.schedule += 1; return null; },
      advanceConfiguredConstructionReports: async () => ({ mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
        scopeStatus: null, scopedProjects: null, queued: 0, errors: [] }),
      deliverConfiguredConstructionReports: async () => ({ mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
        scopeStatus: null, scopedProjects: null, delivered: 0, errors: [] }),
      advanceConfiguredStageReminders: async () => ({ mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
        scopeStatus: null, scannedProjects: null, skippedProjects: null, candidates: 0, created: 0, errors: [] }),
      deliverConfiguredStageReminders: async () => ({ mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
        scopeStatus: null, scannedProjects: null, skippedProjects: null, delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [] }),
    });
    check('gate.closed_tick_zero_calls', blockedTick.workerExecution.businessTasksEnabled === false
      && Object.values(counters).every(value => value === 0)
      ? 'passed' : 'failed', '门禁关闭时直接调用 tick 也不会启动任何需要授权的业务任务',
    { execution: blockedTick.workerExecution, counters });
  } finally {
    if (tenantIds.length) {
      try {
        await withPlatformTransaction(async tx => {
          for (const eid of tenantIds) {
            await deleteConstructionData(tx, BigInt(eid));
            await deleteAssistantData(tx, BigInt(eid));
            await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
            await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
          }
        });
        for (const uid of userIds) await withPlatformTransaction(tx => tx.execute(sql`delete from app.users where id=${uid}`));
        await withPlatformTransaction(async tx => {
          for (const eid of tenantIds) await tx.execute(sql`delete from app.enterprises where id=${eid}`);
        });
        check('fixture.cleanup', 'passed', '已删除本轮两家合成企业、用户、管理员及全部业务行', { tenantIds, adminIds, userIds });
      } catch (error) {
        check('fixture.cleanup', 'failed', '合成数据清理失败', { message: (error as Error).message });
      }
    }
    await closePostgresPool();
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    result.error = (error as Error).stack || (error as Error).message;
    check('run.unexpected_error', 'failed', '验收脚本异常终止', { message: (error as Error).message });
  } finally {
    result.finishedAt = new Date().toISOString();
    save();
  }
  const failed = result.checks.filter(entry => entry.status === 'failed');
  console.log(JSON.stringify({ output, checks: result.checks.length, failed: failed.length }, null, 2));
  if (failed.length) process.exitCode = 1;
}

void run();
