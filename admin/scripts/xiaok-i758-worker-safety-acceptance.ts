/** I7.5.8 isolated PostgreSQL 17 acceptance for the Worker safe-startup gate and
 * the read-only queue dry-run. Reuses the F1/F2 compact database only; it never
 * connects to the development or production database and never sends a real
 * notification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  || '../tmp/xiaok-i758/run-' + Date.now());
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
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { ConversationService } = await import('@/lib/assistant/core/conversation');
  const { claimJob, completeRun, failRun, heartbeat, markProviderStarted } = await import('@/lib/assistant/infrastructure/job-queue');
  const { previewAssistantQueue } = await import('@/lib/assistant/infrastructure/job-preview');
  const { assistantWorkerPreflight } = await import('@/lib/assistant/infrastructure/worker-preflight');
  const { runAssistantJobsTick } = await import('@/lib/assistant/infrastructure/jobs-tick');
  const { advanceStageReminders, deliverStageReminders } = await import('@/lib/xiaok-v1/reminder-service');

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept'); assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('assistant_jobs','assistant_runs','assistant_run_steps','assistant_messages',
      'assistant_quota_reservations','xiaok_pilot_project_scopes') order by 1`));
  check('env.pg17_rls', rls.length === 6 && rls.every(row => row.rls === true && row.forced === true)
    ? 'passed' : 'failed', '复用 F1/F2 PG17 隔离库，sfp_app 非超级用户且相关表强制 RLS', { identity, rls });

  const prefix = 'I7.5.8 Worker 安全启动合成企业-' + Date.now() + '-' + randomUUID().slice(0, 8);
  let enterpriseId: string | null = null;
  let userId: string | null = null;
  let actor: Record<string, unknown> | null = null;

  try {
    const created = await withPlatformTransaction(async tx => {
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status)
        values(${prefix},${prefix},'active') returning id`))!;
      const eid = String(enterprise.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,100,1200000,100000000,90)`);
      const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;
      const uid = String(user.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + '-openid'})`);
      return { eid, uid };
    });
    enterpriseId = created.eid; userId = created.uid;
    actor = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1,
      capabilities: ['assistant.chat.self'] };
    result.ids.fixture = { enterpriseId, userId };

    const service = new ConversationService(actor as never);
    const content = () => ({ version: 1 as const, blocks: [{ type: 'text' as const, text: 'I7.5.8 队列预览合成消息' }] });
    const newRun = async () => {
      const conversation = await service.create('i758-' + randomUUID());
      const sent = await service.send(String(conversation.id), randomUUID(), content());
      return { conversationId: String(conversation.id), runId: String(sent.runId) };
    };

    // Three fixture jobs: unknown provider outcome, terminal failure and a safe
    // expired reclaim that completes normally.
    const unknown = await newRun();
    const failed = await newRun();
    const reclaim = await newRun();
    result.ids.runs = [unknown.runId, failed.runId, reclaim.runId];

    const jobFingerprint = () => withTenantTransaction(enterpriseId!, tx => one(tx, sql`select
      (select count(*)::int from app.assistant_jobs where enterprise_id=${enterpriseId}) jobs,
      (select count(*)::int from app.assistant_runs where enterprise_id=${enterpriseId}) runs,
      (select count(*)::int from app.assistant_messages where enterprise_id=${enterpriseId}) messages,
      (select count(*)::int from app.assistant_run_steps where enterprise_id=${enterpriseId}) steps,
      (select count(*)::int from app.assistant_quota_reservations where enterprise_id=${enterpriseId}) reservations,
      (select md5(coalesce(string_agg(row_to_json(x)::text,'|' order by x.id),'')) from (
        select id,status,attempts,lease_token,lease_expires_at,provider_started_at,updated_at,version
        from app.assistant_jobs where enterprise_id=${enterpriseId}) x) job_hash`));

    const beforePreview = await jobFingerprint();
    // The preview clock is intentionally a minute ahead so every fixture job is
    // already due even when the queue sets a short availability delay.
    const previewNow = new Date(Date.now() + 60_000);
    const previewOne = await previewAssistantQueue({ enterpriseId, now: previewNow });
    const previewTwo = await previewAssistantQueue({ enterpriseId, now: previewNow });
    const afterPreview = await jobFingerprint();
    check('dryrun.no_state_change', JSON.stringify(beforePreview) === JSON.stringify(afterPreview)
      ? 'passed' : 'failed', '只读 dry-run 前后 job/run/message/step/reservation 计数与 job 哈希完全一致',
    { beforePreview, afterPreview });
    check('dryrun.duplicate_preview', JSON.stringify(previewOne.counts) === JSON.stringify(previewTwo.counts)
      ? 'passed' : 'failed', '重复 dry-run 返回同一分类计数', { first: previewOne.counts, second: previewTwo.counts });
    const queuedItems = previewOne.items.filter(item => item.status === 'queued');
    check('dryrun.queued_classified', previewOne.counts.queued === 3 && queuedItems.length === 3
      && queuedItems.every(item => item.reclaimable && item.reason === 'queued_ready')
      ? 'passed' : 'failed', '3 条 queued 夹具均被识别为可安全领取，且未处理',
    { counts: previewOne.counts, queuedItems });

    // ------------------------------------------------------------ safety gate
    const pilotEnv = {
      XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: enterpriseId,
      XIAOK_STAGE_REMINDER_PILOT_ID: 'i758-pilot',
      XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: enterpriseId,
      XIAOK_WEEKLY_REPORT_PILOT_ID: 'i758-pilot',
    };
    const closedPreflight = await assistantWorkerPreflight({ env: {}, now: new Date() });
    check('gate.unconfigured_closed', closedPreflight.safetyGate.status === 'closed'
      && closedPreflight.safetyGate.reason === 'pilot_scope_missing'
      ? 'passed' : 'failed', '未配置试点范围时 Worker 启动门禁关闭，不回退企业全量',
    { safetyGate: closedPreflight.safetyGate });
    const mismatchPreflight = await assistantWorkerPreflight({
      env: { ...pilotEnv, XIAOK_WEEKLY_REPORT_MODE: 'enterprise' }, now: new Date(),
    });
    check('gate.mismatch_closed', mismatchPreflight.safetyGate.status === 'closed'
      && mismatchPreflight.safetyGate.reason === 'pilot_worker_alignment'
      ? 'passed' : 'failed', '提醒与周报模式不一致时门禁关闭',
    { safetyGate: mismatchPreflight.safetyGate });
    const openPreflight = await assistantWorkerPreflight({ env: pilotEnv, now: new Date() });
    check('gate.pilot_open', openPreflight.safetyGate.status === 'open'
      && openPreflight.safetyGate.deliveryScope === 'pilot'
      && openPreflight.safetyGate.enterpriseId === enterpriseId
      ? 'passed' : 'failed', '提醒与周报一致指向同一试点时门禁开放',
    { safetyGate: openPreflight.safetyGate, pilotScope: openPreflight.pilotScope });
    check('gate.pilot_scope_required', openPreflight.pilotScope?.status === 'not_found'
      ? 'passed' : 'failed', '门禁开放但未保存试点范围时，preflight 如实报告 not_found',
    { pilotScope: openPreflight.pilotScope });

    const duplicate = await Promise.all([
      assistantWorkerPreflight({ env: pilotEnv, now: new Date() }),
      assistantWorkerPreflight({ env: pilotEnv, now: new Date() }),
    ]);
    check('startup.duplicate_idempotent', duplicate[0].safetyGate.status === duplicate[1].safetyGate.status
      && JSON.stringify(duplicate[0].queue.counts) === JSON.stringify(duplicate[1].queue.counts)
      && duplicate[0].queue.counts.queued >= 3
      ? 'passed' : 'failed', '两个并发 Worker 启动预检得到同一门禁与同一全局队列，不领取任务',
    { first: duplicate[0].queue.counts, second: duplicate[1].queue.counts });

    // ------------------------------------------------------------ multi-instance claim
    const waitUntilDue = async (runId: string) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const due = await withTenantTransaction(enterpriseId!, tx => one(tx, sql`select id from app.assistant_jobs
          where enterprise_id=${enterpriseId} and run_id=${runId} and status='queued' and available_at<=now()`));
        if (due) return;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('fixture job did not become due');
    };
    await waitUntilDue(unknown.runId);
    const scope = { enterpriseId: enterpriseId!, runId: unknown.runId };
    const claims = await Promise.all([claimJob(scope), claimJob(scope)]);
    const leases = claims.filter((lease): lease is NonNullable<typeof lease> => lease !== null);
    check('lease.single_holder', leases.length === 1 && leases[0].runId === unknown.runId
      ? 'passed' : 'failed', '两个 Worker 实例并发领取同一任务只有一个持有者',
    { holders: leases.map(lease => ({ runId: lease.runId, tokenPresent: Boolean(lease.token) })) });
    const lease = leases[0];
    await heartbeat(lease);
    const heartbeatRow = await withTenantTransaction(enterpriseId!, tx => one(tx, sql`select heartbeat_at,lease_expires_at
      from app.assistant_jobs where enterprise_id=${enterpriseId} and id=${lease.jobId}`));
    await assert.rejects(heartbeat({ ...lease, token: randomUUID() }), /context_changed/);
    check('lease.heartbeat_fenced', Boolean(heartbeatRow?.heartbeat_at)
      ? 'passed' : 'failed', '心跳延长自身租约，伪造 token 无法心跳', { heartbeatRow });

    await markProviderStarted(lease);
    await assert.rejects(markProviderStarted(lease), /context_changed/);
    check('idempotency.provider_start_once', 'passed',
      '同一租约重复 provider start 被拒绝，不会重复调用供应商');

    // Expire the lease with an unknown provider outcome. Recovery must mark it
    // indeterminate and never replay it.
    await withTenantTransaction(enterpriseId!, tx => tx.execute(sql`update app.assistant_jobs
      set lease_expires_at=now()-interval '1 second' where enterprise_id=${enterpriseId} and id=${lease.jobId}`));
    const unknownRetry = await claimJob(scope);
    const unknownJob = await withTenantTransaction(enterpriseId!, tx => one(tx, sql`select status,last_error
      from app.assistant_jobs where enterprise_id=${enterpriseId} and id=${lease.jobId}`));
    check('recovery.provider_unknown_indeterminate', unknownRetry === null
      && unknownJob?.status === 'indeterminate' && unknownJob?.last_error === 'provider_outcome_unknown'
      ? 'passed' : 'failed', 'provider 已开始但结果未知的任务标记 indeterminate 且不重放',
    { unknownRetry, unknownJob });
    check('recovery.indeterminate_not_retried', await claimJob(scope) === null
      ? 'passed' : 'failed', 'indeterminate 为终态，后续领取不再返回该任务');

    // Failed is terminal and is never retried automatically.
    await waitUntilDue(failed.runId);
    const failedLease = await claimJob({ enterpriseId: enterpriseId!, runId: failed.runId });
    assert.ok(failedLease);
    await failRun(failedLease, 'i758_synthetic_failure');
    const failedJob = await withTenantTransaction(enterpriseId!, tx => one(tx, sql`select status,last_error
      from app.assistant_jobs where enterprise_id=${enterpriseId} and id=${failedLease.jobId}`));
    check('terminal.failed_not_retried', failedJob?.status === 'failed'
      && await claimJob({ enterpriseId: enterpriseId!, runId: failed.runId }) === null
      ? 'passed' : 'failed', 'failed 为终态，未自动重试',
    { failedJob });

    // An expired lease that never dispatched the provider is safe to reclaim.
    await waitUntilDue(reclaim.runId);
    const reclaimLease = await claimJob({ enterpriseId: enterpriseId!, runId: reclaim.runId });
    assert.ok(reclaimLease);
    await withTenantTransaction(enterpriseId!, tx => tx.execute(sql`update app.assistant_jobs
      set lease_expires_at=now()-interval '1 second' where enterprise_id=${enterpriseId} and id=${reclaimLease.jobId}`));
    const reclaimed = await claimJob({ enterpriseId: enterpriseId!, runId: reclaim.runId });
    check('recovery.expired_safe_reclaim', reclaimed !== null && reclaimed.token !== reclaimLease.token
      ? 'passed' : 'failed', 'provider 未开始的过期租约可安全重新领取并更换 token',
    { oldTokenPresent: Boolean(reclaimLease.token), newTokenPresent: Boolean(reclaimed?.token) });
    assert.ok(reclaimed);
    await completeRun(reclaimed, { content: content(), usage: null });

    const finalPreview = await previewAssistantQueue({ enterpriseId, now: new Date() });
    check('dryrun.final_counts', finalPreview.counts.queued === 0 && finalPreview.counts.running === 0
      && finalPreview.counts.failed === 1 && finalPreview.counts.indeterminate === 1
      && finalPreview.reclaimable.total === 0
      ? 'passed' : 'failed', '预览最终显示 queued=0、running=0、failed=1、indeterminate=1，可领取=0',
    { counts: finalPreview.counts, reclaimable: finalPreview.reclaimable });

    // ------------------------------------------------------------ tick gate
    const counts = { reports: 0, reportDeliveries: 0, reminders: 0, reminderDeliveries: 0 };
    const tickDependencies = {
      now: new Date('2026-11-16T20:00:00+08:00'),
      advanceKnowledgeBatches: async () => 0,
      processAssistantJob: async () => ({ claimed: false }),
      processAssistantRun: async () => undefined,
      deliverSiteNotifications: async () => 0,
      deliverPublicConsents: async () => 0,
      processPortfolioCopy: async () => false,
      advanceConfiguredConstructionReports: async () => {
        counts.reports += 1; return { mode: 'enterprise' as const, pilotId: null, scopeVersion: null, scopeStatus: null,
          scopedProjects: null, queued: 0, errors: [] };
      },
      deliverConfiguredConstructionReports: async () => {
        counts.reportDeliveries += 1; return { mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
          scopeStatus: null, scopedProjects: null, delivered: 0, errors: [] };
      },
      advanceConfiguredStageReminders: async () => {
        counts.reminders += 1; return { mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
          scopeStatus: null, scannedProjects: null, skippedProjects: null, candidates: 0, created: 0, errors: [] };
      },
      deliverConfiguredStageReminders: async () => {
        counts.reminderDeliveries += 1; return { mode: 'enterprise' as const, pilotId: null, scopeVersion: null,
          scopeStatus: null, scannedProjects: null, skippedProjects: null, delivered: 0, no_inbox: 0, paused: 0,
          cancelled: 0, failed: 0, errors: [] };
      },
    };
    const enterpriseEnv = {
      XIAOK_STAGE_REMINDER_MODE: 'enterprise', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: enterpriseId,
      XIAOK_WEEKLY_REPORT_MODE: 'enterprise', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: enterpriseId,
    };
    const blocked = await runAssistantJobsTick({ ...tickDependencies, env: enterpriseEnv });
    const blockedCounts = { ...counts };
    check('tick.enterprise_blocked', blocked.workerSafetyGate.status === 'closed'
      && blocked.workerSafetyGate.reason === 'enterprise_scope_not_allowed'
      && blockedCounts.reports === 0 && blockedCounts.reportDeliveries === 0
      && blockedCounts.reminders === 0 && blockedCounts.reminderDeliveries === 0
      ? 'passed' : 'failed', '显式企业模式没有试点范围时四项业务 Worker 均零调用',
    { gate: blocked.workerSafetyGate, counts: blockedCounts });

    // ------------------------------------------------------------ removed pilot scope
    // The real reminder service resolves the saved scope before listing or
    // touching any project. With no saved scope it must return not_found and
    // zero work instead of scanning the enterprise.
    const advanceChecks = await advanceStageReminders(new Date(), enterpriseId!, 'i758-pilot');
    const deliverChecks = await deliverStageReminders(new Date(), enterpriseId!, 'i758-pilot');
    check('scope.missing_pilot_zero', advanceChecks.scopeStatus === 'not_found'
      && deliverChecks.scopeStatus === 'not_found' && advanceChecks.created === 0
      && deliverChecks.delivered === 0 && (advanceChecks.scannedProjects ?? 0) === 0
      && (deliverChecks.scannedProjects ?? 0) === 0
      ? 'passed' : 'failed', '退出/未保存试点范围后提醒生成与投递均为零且不扫描企业',
    { advanceChecks, deliverChecks });
  } finally {
    if (enterpriseId) {
      try {
        await withPlatformTransaction(async tx => {
          await deleteAssistantData(tx, BigInt(enterpriseId!));
          await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
        });
        if (userId) await withPlatformTransaction(tx => tx.execute(sql`delete from app.users where id=${userId}`));
        check('fixture.cleanup', 'passed', '已删除本轮合成企业、用户及助手数据', { enterpriseId, userId });
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
