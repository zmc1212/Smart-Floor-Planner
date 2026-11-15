/** I7.5.0 家客来 1.0 第一期产品纵向闭环验收；I7.5.1 复用同一合成夹具补齐
 * `construction.report.compose` 四端周报 AI 正文。
 *
 * 复用已有隔离 PostgreSQL 17（127.0.0.1:55432/i745_f1_accept），创建本轮独立合成企业、
 * 项目、四类角色、十阶段配置、施工计划、房间、现场记录与站内会话，然后使用正式业务实现
 * 验证：主动阶段提醒、阶段知识问答（真实百炼 deepseek-flash）、四端周报生成与投递。
 *
 * 不连接微云 1454 业务库，不发送真实微信/订阅通知，不修改真实企业配置。
 * 真实模型凭据仅在显式传入 --llm-source=development 时从开发库平台配置只读复制，
 * 并在 finally 中恢复隔离库原值；API Key 永不输出。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
const sourceDevelopmentUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = connections.DATABASE_URL;
// Deployment-only model override would fence the enterprise Agent binding.
delete process.env.ASSISTANT_TEXT_MODEL;

type CheckStatus = 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown';
const args = process.argv.slice(2);
const argValue = (name: string) => {
  const prefix = '--' + name + '=';
  return args.find(item => item.startsWith(prefix))?.slice(prefix.length);
};
const liveModelSource = argValue('llm-source');
const model = argValue('model') || 'deepseek-v4.1-flash-1017';
const output = path.resolve(argValue('output') || path.resolve(admin, '..', 'tmp/xiaok-i750-product-acceptance/run-' + Date.now()));
assert.ok(!fs.existsSync(path.join(output, 'result.json')), 'Retain every original outcome');
fs.mkdirSync(output, { recursive: true });

const runId = randomUUID();
const result: {
  runId: string; startedAt: string; finishedAt?: string; database: string; user: string;
  checks: Array<{ id: string; status: CheckStatus; detail: string; evidence?: unknown }>;
  unified: Record<string, CheckStatus>; ids: Record<string, unknown>; error?: string;
  unifiedRoleReads?: Record<string, boolean>;
} = { runId, startedAt: new Date().toISOString(), database: 'i745_f1_accept', user: 'sfp_app',
  checks: [], unified: {}, ids: {} };
const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
const check = (id: string, status: CheckStatus, detail: string, evidence?: unknown) => {
  result.checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
  console.log(id + ': ' + status);
  save();
};
const statusOf = (...ids: string[]): CheckStatus => {
  const statuses = result.checks.filter(item => ids.some(id => item.id === id || item.id.startsWith(id + '.'))).map(item => item.status);
  if (statuses.includes('failed')) return 'failed';
  if (statuses.some(status => status === 'limited' || status === 'not_run' || status === 'unknown')) return 'limited';
  return 'passed';
};

async function main() {
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one, rows } = await import('@/db/repositories/assistant-repository');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { getDefaultMenuKeys } = await import('@/lib/admin-user-roles');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { SiteChatService, recordVersion } = await import('@/lib/construction/site-chat');
  const { currentRecord, openRecordIssue, readSiteIssueBase } = await import('@/lib/construction/site-issues');
  const { ensureFollowupBinding } = await import('@/lib/construction/report-store');
  const { buildRoleWeeklyDigest } = await import('@/lib/xiaok-v1/weekly-report-service');
  const { stageAnswerForProject } = await import('@/lib/xiaok-v1/stage-answer-service');
  const { stageForConstructionKey, stageDefinitions } = await import('@/lib/xiaok-v1/stages');
  const { defaultConstructionStages } = await import('@/lib/construction/stages');
  const { reminderPolicyForStage } = await import('@/lib/xiaok-v1/stage-reminder-policies');
  const { stageKnowledgeRegistry } = await import('@/lib/xiaok-v1/stage-knowledge');
  const { advanceConfiguredStageReminders, deliverConfiguredStageReminders } = await import('@/lib/xiaok-v1/stage-reminder-worker');
  const { advanceConfiguredConstructionReports, deliverConfiguredConstructionReports, processConstructionReport } = await import('@/lib/construction/report-worker');
  const { processReportComposition } = await import('@/lib/construction/report-body-worker');
  const { enqueueReportBody } = await import('@/lib/construction/report-body-store');
  const { FollowupService } = await import('@/lib/construction/followup-service');
  const { reportCompositionProtocol } = await import('@/lib/construction/report-composition');
  const { generalReportAdviceProtocol } = await import('@/lib/construction/report-general-advice');
  const { assertReportBodyCitations, serverSectionText } = await import('@/lib/construction/report-citations');
  const { appendMessage, newRun } = await import('@/lib/assistant/core/conversation');
  const { claimJob } = await import('@/lib/assistant/infrastructure/job-queue');
  const { processAnswer } = await import('@/lib/assistant/infrastructure/answer-worker');
  const { latestReportPeriod } = await import('@/lib/construction/report-calendar');
  const { fingerprint } = await import('@/lib/assistant/contracts');
  const bcrypt = (await import('bcryptjs')).default;
  const pg = (await import('pg')).default;

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super,
    (select rolbypassrls from pg_roles where rolname=current_user) bypass`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept');
  assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('construction_projects','construction_stage_reminders','construction_report_settings','construction_reports',
      'construction_report_versions','construction_report_deliveries','construction_followup_bindings',
      'assistant_conversations','assistant_messages','assistant_runs','xiaok_pilot_project_scopes') order by 1`));
  check('env.pg17_rls', rls.length === 11 && rls.every(row => row.rls === true && row.forced === true) ? 'passed' : 'failed',
    '复用隔离 PG17.10 数据库，业务账号非超级用户且 11 张核心表强制 RLS', { identity, rls });

  const stages = stageDefinitions.length === 10 && defaultConstructionStages.length === 10
    && stageKnowledgeRegistry.list().length === 10
    && defaultConstructionStages.every(stage => {
      const mapped = stageForConstructionKey(stage.key);
      return !!mapped && !!reminderPolicyForStage(mapped.stageId);
    });
  check('stage.ten_stage_config', stages ? 'passed' : 'failed',
    '十阶段定义、默认阶段配置、知识包与提醒策略均为 10 个且一一对应',
    { stageDefinitions: stageDefinitions.length, defaultStages: defaultConstructionStages.length,
      knowledgePacks: stageKnowledgeRegistry.list().length,
      policies: defaultConstructionStages.filter(stage => {
        const mapped = stageForConstructionKey(stage.key);
        return !!mapped && !!reminderPolicyForStage(mapped.stageId);
      }).length });

  // ------------------------------------------------- I7.5.1 report body reuse
  // The first-release fixture already owns a synthetic enterprise, project,
  // four role bindings and five delivered weekly reports. Compose their real
  // `construction.report.compose` bodies on that same snapshot instead of
  // building a second enterprise or repeating reminder/report infrastructure.
  const reusable = await discoverReusableFixture();
  if (reusable) {
    result.ids.reusedFixture = reusable.ids;
    await runReportBodyAcceptance(reusable);
    result.unified = {
      reminderStatus: 'not_run',
      knowledgeAnswerStatus: 'not_run',
      weeklyReportStatus: statusOf('body.compose', 'body.facts', 'body.role_scope', 'body.delivery', 'body.idempotent'),
      reportBodyStatus: statusOf('body.compose', 'body.model', 'body.facts', 'body.role_scope',
        'body.distinct', 'body.delivery', 'body.idempotent', 'body.model_scope'),
      customerDelivery: result.unifiedRoleReads ? (result.unifiedRoleReads.customer ? 'passed' : 'failed') : 'not_run',
      designerDelivery: result.unifiedRoleReads ? (result.unifiedRoleReads.designer ? 'passed' : 'failed') : 'not_run',
      bossDelivery: result.unifiedRoleReads ? (result.unifiedRoleReads.boss ? 'passed' : 'failed') : 'not_run',
      workerDelivery: result.unifiedRoleReads ? (result.unifiedRoleReads.worker ? 'passed' : 'failed') : 'not_run',
      idempotencyStatus: result.unifiedRoleReads ? statusOf('body.idempotent') : 'not_run',
      projectScopeStatus: result.unifiedRoleReads ? statusOf('body.role_scope', 'body.scope_isolation') : 'not_run',
    };
    result.ids.final = { mode: 'reused-i750-fixture', reports: reusable.reports.map(report => ({
      reportId: report.report_id, audience: report.audience, revision: report.revision })), model, runId };
    await closePostgresPool();
    return;
  }

  // ---------------------------------------------------------------- fixture
  const fixtureNow = new Date();
  fixtureNow.setHours(10, 0, 0, 0);
  const now = fixtureNow;
  // The weekly report covers the latest completed Monday-to-Monday week. Put
  // the fixture facts into that period instead of the current partial week.
  const weeklyPeriod = latestReportPeriod('weekly', now, '08:00', 1);
  const factAt = new Date(weeklyPeriod.start.getTime() + 3 * 86400000 + 9 * 3600000);
  const suffix = String(Date.now());
  const passwordHash = await bcrypt.hash('I750-Pass-' + suffix, 10);
  let phoneSeq = 400000;
  const nextPhone = () => '19976' + String(++phoneSeq);
  const createEnterprise = () => withPlatformTransaction(async tx => {
    const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${'I7.5.0 第一期合成企业-' + suffix},${'i750-' + suffix},'active','manual') returning id::text`);
    const eid = String(row!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${eid},true,365,100000,1000000000,1000000000)`);
    return eid;
  });
  const createUser = (eid: string, name: string) => withPlatformTransaction(async tx => String((await one(tx,
    sql`insert into app.users(enterprise_id,phone,nickname,role) values(${eid},${nextPhone()},${name},'user') returning id::text`))!.id));
  const createAdmin = (eid: string, role: string, name: string, index: number) => withPlatformTransaction(async tx => {
    const linked = await one(tx, sql`insert into app.users(enterprise_id,nickname,role) values(${eid},${name},'user') returning id::text`);
    const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,menu_permissions,construction_trades)
      values(${eid},${String(linked!.id)},${'i750_' + suffix + '_' + index},${passwordHash},${name},${role},'active',false,
      ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
    return String(row!.id);
  });
  const createProject = async (eid: string, bossId: string, managerId: string, ownerId: string, name: string, rooms: string[]) => {
    const leadId = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
      (enterprise_id,customer_user_id,name,phone,source) values(${eid},${ownerId},${name},${nextPhone()},'natural') returning id::text`))!.id));
    const service = new ConstructionService({ enterpriseId: eid, adminId: bossId });
    return String((await service.execute('create', { leadId, name, managerId, rooms }, randomUUID())).id);
  };

  // The isolated database was seeded with only the construction_staff system
  // role. The real admin role catalog also grants designers the construction
  // project menu; add that synthetic role configuration for this fixture.
  await withPlatformTransaction(tx => tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys,description)
    values('designer','设计师',ARRAY['construction-projects'],'I7.5.0 第一期合成验收角色配置')
    on conflict (role_key) do nothing`));

  const enterprise = await createEnterprise();
  const owner = await createUser(enterprise, 'I7.5.0 业主');
  const outsideOwner = await createUser(enterprise, 'I7.5.0 范围外业主');
  const boss = await createAdmin(enterprise, 'enterprise_admin', 'I7.5.0 老板', 1);
  const manager = await createAdmin(enterprise, 'construction_staff', 'I7.5.0 项目经理', 2);
  const designer = await createAdmin(enterprise, 'designer', 'I7.5.0 设计师', 3);
  const worker = await createAdmin(enterprise, 'construction_staff', 'I7.5.0 施工人员', 4);
  const projectNameA = 'I7.5.0 第一期合成工地（试点内）';
  const projectNameB = 'I7.5.0 第一期合成工地（范围外）';
  const projectA = await createProject(enterprise, boss, manager, owner, projectNameA, ['卫生间', '客厅', '厨房']);
  const projectB = await createProject(enterprise, boss, manager, outsideOwner, projectNameB, ['阳台']);
  result.ids.fixture = { enterprise, owner, outsideOwner, boss, manager, designer, worker, projectA, projectB };

  const service = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  const detailOf = async (pid: string) => (await service.execute('detail', { projectId: pid })).project as Record<string, unknown>;
  const progress = async (pid: string, stageKey: string, note: string) => {
    const detail = await detailOf(pid);
    await service.execute('progress', { projectId: pid, expectedVersion: Number(detail.version), stageKey, note, sendReminder: false }, randomUUID());
  };
  const member = async (pid: string, adminId: string, role: string, workLabel: string) => {
    const detail = await detailOf(pid);
    await service.execute('member', { projectId: pid, expectedVersion: Number(detail.version), adminId, role, active: true, workLabel }, randomUUID());
  };
  for (const pid of [projectA, projectB]) {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=true
      where enterprise_id=${enterprise} and id=${pid}`));
  }
  await member(projectA, worker, 'worker', '现场施工');
  await member(projectA, designer, 'designer', '设计核对');
  await member(projectB, worker, 'worker', '现场施工');
  await progress(projectA, 'utilities', 'I7.5.0 验收：进入水电');
  await progress(projectA, 'masonry_carpentry', 'I7.5.0 验收：进入泥木');
  await progress(projectB, 'utilities', 'I7.5.0 验收：范围外项目进入水电');
  // The fixed daytime acceptance clock is earlier than the wall-clock creation
  // time. Keep stage events inside the synthetic report week.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.domain_event_outbox
    set created_at=${factAt}, updated_at=${factAt}
    where enterprise_id=${enterprise} and type='construction.stage.updated.v1'`));
  const stageKey = 'masonry_carpentry';
  const stageId = stageForConstructionKey(stageKey)!.stageId;
  const policy = reminderPolicyForStage(stageId)!;


  // ------------------------------------------------------------------ Q&A
  // Run the knowledge Q&A while the synthetic project has a real current stage
  // but no completed/published records yet. The customer answer guard rejects
  // unsupported completion claims, so this is the product's honest state for a
  // stage-knowledge question.
  const exactQuestions = [
    '当前装修阶段是什么？',
    '当前阶段有哪些重点注意事项？',
    '当前阶段下一步应该做什么？',
    '某项施工工作完成后需要检查什么？',
  ];
  const stageAnswers = [];
  const ownerActor = { enterpriseId: enterprise, contextVersion: 1, capabilities: [] as string[],
    principal: { kind: 'user' as const, userId: owner } };
  for (const question of exactQuestions) {
    const answer = await stageAnswerForProject(ownerActor, { projectId: projectA, question });
    stageAnswers.push({ question, stageKey: answer.stageKey, stageName: answer.answer.stageName,
      basis: answer.answer.basis, intent: answer.answer.intent, answer: answer.answer.answer.slice(0, 300) });
  }
  check('qa.stage_answers', stageAnswers.length === 4 && stageAnswers.every(item => item.stageKey === stageKey
    && item.stageName === stageForConstructionKey(stageKey)?.name && item.basis === 'stage_knowledge'
    && String(item.answer).trim().length > 20) ? 'passed' : 'failed',
    '既有小K阶段问答链路按当前项目和当前泥木阶段回答四个固定场景',
    { stageAnswers });

  // Real Bailian model through the existing C01 answer worker. Questions avoid
  // the deterministic ordinary-stage shortcut; the model must still use the
  // project's actual current stage.
  let modelStatus: CheckStatus = 'not_run';
  let modelEvidence: Record<string, unknown> = { reason: 'bailian_credentials_not_configured' };
  const isolatedLlm = await withPlatformTransaction(tx => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
  const llmBefore: unknown = isolatedLlm?.llm_config ?? null;
  let llmConfigured = false;
  try {
    let sourceConfig: Record<string, unknown> | null = null;
    if (liveModelSource === 'development') {
      assert.ok(sourceDevelopmentUrl && new URL(sourceDevelopmentUrl).pathname === '/smart_floor_planner',
        '--llm-source=development requires the development DATABASE_URL');
      const dev = new pg.Client({ connectionString: sourceDevelopmentUrl });
      await dev.connect();
      try {
        await dev.query('begin read only');
        const row = await dev.query("select llm_config from app.platform_configs where key='default'");
        sourceConfig = row.rows[0]?.llm_config ?? null;
        await dev.query('rollback');
      } finally { await dev.end(); }
    } else if (isolatedLlm?.llm_config && typeof isolatedLlm.llm_config === 'object'
      && Object.keys(isolatedLlm.llm_config as object).length) {
      sourceConfig = isolatedLlm.llm_config as Record<string, unknown>;
    }
    const profiles = (sourceConfig?.profiles ?? {}) as Record<string, Record<string, unknown>>;
    const profile = profiles.dashscope
      ?? Object.values(profiles).find(item => item?.apiKeyEncrypted && /dashscope|bailian/iu.test(String(item.baseUrl || '')));
    if (!sourceConfig || !profile?.apiKeyEncrypted) {
      modelStatus = 'not_run';
      modelEvidence = { reason: 'bailian_credentials_not_configured' };
    } else {
      const next = { ...sourceConfig, ...profile, providerKey: 'dashscope', model, enabled: true,
        profiles: { ...profiles, dashscope: { ...profile, model, enabled: true } } };
      await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(next)}::jsonb where key='default'`));
      llmConfigured = true;
      const agent = { runtime: 'langgraph-v1', providerKey: 'dashscope', model, imageInput: false, tools: true,
        probeVersion: 'i750-product-acceptance-v1', enterpriseKnowledgeEnabled: false };
      await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.assistant_enterprise_settings
        set agent_config=${JSON.stringify(agent)}::jsonb where enterprise_id=${enterprise}`));
      const lead = await withTenantTransaction(enterprise, tx => one(tx, sql`select id::text from app.leads where enterprise_id=${enterprise}
        and customer_user_id=${owner} and archived_at is null order by id limit 1`));
      const qaConversation = await withTenantTransaction(enterprise, async tx => {
        const conversation = await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
          values(${enterprise},'customer_consultation',${JSON.stringify({ kind: 'lead', id: String(lead!.id) })}::jsonb,1) returning id::text`);
        await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,grant_basis)
          values(${enterprise},${String(conversation!.id)},'user',${owner},'{"kind":"i750-qa"}'::jsonb)`);
        return String(conversation!.id);
      });
      const qaActor = { enterpriseId: enterprise, contextVersion: 1, capabilities: [] as string[],
        principal: { kind: 'user' as const, userId: owner } };
      const modelQuestions = [
        '我家现在做到哪一步了？',
        '这个项目现在是什么状态？',
        '现在有没有需要我处理的事？',
        '工地现在有照片或记录吗？',
      ];
      const turns = [];
      for (const question of modelQuestions) {
        const turnRunId = await withTenantTransaction(enterprise, async tx => {
          const message = await appendMessage(tx, qaActor, qaConversation, { author: 'user', clientMessageId: randomUUID(), purpose: 'reply',
            content: { version: 1, blocks: [{ type: 'text', text: question }] } });
          const run = await newRun(tx, qaActor,
            (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${enterprise} and id=${qaConversation}`))!,
            (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${enterprise}`))!, String(message.id));
          return String(run.runId);
        });
        const started = Date.now();
        const lease = await claimJob({ enterpriseId: enterprise, runId: turnRunId });
        if (lease) await processAnswer(lease);
        const elapsedMs = Date.now() - started;
        const run = await withTenantTransaction(enterprise, tx => one(tx, sql`select id,status,error_code,output_message_id
          from app.assistant_runs where enterprise_id=${enterprise} and id=${turnRunId}`));
        const answer = run?.output_message_id ? await withTenantTransaction(enterprise, tx => one(tx, sql`select content
          from app.assistant_messages where enterprise_id=${enterprise} and id=${String(run.output_message_id)}`)) : null;
        const attempts = await withPlatformTransaction(tx => rows(tx, sql`select id,provider_key,remote_model,status,duration_ms,metadata
          from app.ai_provider_attempts where assistant_run_id=${turnRunId} order by id`));
        const usage = await withTenantTransaction(enterprise, tx => rows(tx, sql`select category,input_tokens,output_tokens,measurement_kind
          from app.assistant_usage_records where enterprise_id=${enterprise} and run_id=${turnRunId}`));
        const answerText = answer ? (((answer.content as Record<string, unknown>).blocks as Array<{ type?: string; text?: string }>) || [])
          .map(block => block.text || '').join('') : '';
        const inputTokens = usage.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0);
        const outputTokens = usage.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0);
        turns.push({ question, runId: turnRunId, status: run?.status, errorCode: run?.error_code || null,
          modelIds: [...new Set(attempts.map(attempt => String(attempt.remote_model)))],
          attemptStatuses: attempts.map(attempt => String(attempt.status)),
          requestIds: attempts.map(attempt => {
            const metadata = attempt.metadata as Record<string, unknown> | null;
            return metadata?.providerRequestId || (metadata?.requestDiagnostic as Record<string, unknown> | undefined)?.requestId || null;
          }).filter(Boolean),
          inputTokens, outputTokens, elapsedMs, answer: answerText.slice(0, 500),
          mentionsStage: /泥木|阶段|节点/u.test(answerText) });
      }
      result.ids.qa = { conversationId: qaConversation, model, turns };
      const stageFactTurns = turns.filter(turn => turn.status === 'succeeded' && turn.mentionsStage
        && turn.inputTokens > 0 && turn.outputTokens > 0);
      const anyModelAttempts = turns.some(turn => turn.modelIds.length > 0 && turn.inputTokens > 0);
      const allSucceeded = turns.length === 4 && turns.every(turn => turn.status === 'succeeded'
        && turn.modelIds.length > 0 && turn.modelIds.every(id => id === model)
        && turn.inputTokens > 0 && turn.outputTokens > 0);
      const onlyGroundingGuard = turns.every(turn => turn.status === 'succeeded'
        || ['ungrounded_response_scope', 'unsupported_model_commitment'].includes(String(turn.errorCode)));
      modelStatus = allSucceeded ? 'passed'
        : anyModelAttempts && onlyGroundingGuard ? 'limited' : 'failed';
      modelEvidence = { model, turns, stageFactTurns: stageFactTurns.length,
        limitation: allSucceeded ? null : '企业知识来源未配置；百炼真实调用可达且记录用量，但回答被响应范围校验拒绝，未交付有效模型答案' };
    }
  } catch (error) {
    modelStatus = 'failed';
    modelEvidence = { reason: 'real_model_qa_failed', error: (error as Error).message };
  } finally {
    if (llmConfigured) {
      try {
        await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(llmBefore ?? {})}::jsonb where key='default'`));
      } catch (error) {
        check('cleanup.llm_config', 'failed', '隔离库平台模型配置恢复失败', { error: (error as Error).message });
      }
    }
  }
  check('qa.real_bailian_model', modelStatus, modelStatus === 'passed'
    ? '既有小K正式问答链路通过百炼 deepseek-flash 真实调用，答案正确使用当前项目阶段'
    : modelStatus === 'not_run'
      ? '未配置真实百炼凭据，真实模型问答未执行（不使用 Mock 冒充通过）'
      : modelStatus === 'limited'
        ? '百炼真实调用可达并记录模型/用量/耗时，但回答被响应范围校验拒绝；企业知识来源未配置，未交付有效模型答案'
        : '真实百炼模型问答未完全通过，详见证据', modelEvidence);

  const rooms = await withTenantTransaction(enterprise, tx => rows(tx, sql`select id::text,name from app.construction_rooms
    where enterprise_id=${enterprise} and project_id=${projectA} order by id`));
  const bathroom = rooms.find(room => room.name === '卫生间')!;
  assert.ok(bathroom?.id);
  const day = (offset: number) => {
    const value = new Date(now.getTime() + offset * 86400000);
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  };
  await service.execute('saveSchedule', {
    projectId: projectA, expectedVersion: 0, title: 'I7.5.0 第一期施工计划',
    note: '泥木阶段卫生间与客厅施工计划',
    nodes: [
      { key: 'node_bathroom_masonry', stageKey, roomId: bathroom.id,
        plannedStart: day(-2), plannedEnd: day(2) },
      { key: 'node_living_masonry', stageKey, roomId: rooms.find(room => room.name === '客厅')!.id,
        plannedStart: day(1), plannedEnd: day(3) },
    ],
  }, randomUUID());
  const schedule = await service.execute('schedule', { projectId: projectA });
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.domain_event_outbox
    set created_at=${factAt}, updated_at=${factAt}
    where enterprise_id=${enterprise} and type='construction.plan.published.v1' and aggregate_id=${projectA}`));
  check('fixture.stage_and_plan', String((await detailOf(projectA)).current_stage_key) === stageKey
    && schedule.available === true && schedule.valid === true
    && (schedule.nodes as Array<{ stageKey: string }>).some(node => node.stageKey === stageKey)
    ? 'passed' : 'failed', '合成项目具有有效当前阶段和已发布施工计划，计划节点覆盖当前阶段与真实房间',
    { stageKey, stageId, scheduleVersion: schedule.version, nodes: schedule.nodes });

  const workerChat = new SiteChatService({ enterpriseId: enterprise, adminId: worker });
  const publishRecord = async (pid: string, roomName: string, completed: string) => {
    const clientMessageId = randomUUID();
    const draft = await workerChat.withWriteScope(pid, async (tx, conversation) => {
      const room = await one(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise}
        and project_id=${pid} and name=${roomName}`);
      assert.ok(room?.id);
      const message = await appendMessage(tx, workerChat.actor, String(conversation.id), { author: 'admin', clientMessageId,
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: completed }] } });
      const data = { title: 'I7.5.0 合成现场记录', completed, pending: '', coordination: '', roomId: room.id, note: completed };
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot) values(${enterprise},${pid},${String(conversation.id)},${String(message.id)},${worker},
        'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},${roomName}) returning *`))!;
      await recordVersion(tx, enterprise, row, worker, 'organized');
      return { row, messageId: String(message.id) };
    });
    if (draft.row.status === 'draft') await new SiteChatService({ enterpriseId: enterprise, adminId: manager })
      .mutate(pid, String(draft.row.id), 'publish', { expectedVersion: Number(draft.row.version), audience: 'customer' }, randomUUID());
    return { recordId: String(draft.row.id), messageId: draft.messageId };
  };
  const record = await publishRecord(projectA, '卫生间', '泥木阶段完成卫生间墙砖铺贴，防水闭水已记录。');
  const recordA2 = await publishRecord(projectA, '客厅', '泥木阶段客厅吊顶放线完成，待核对排版。');
  const outsideRecord = await publishRecord(projectB, '阳台', '范围外项目完成阳台水电布管。');
  // Keep the report period deterministic: facts cutoff is the fixed weekly period.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_site_records
    set created_at=${factAt}, published_at=${factAt}, updated_at=${factAt}
    where enterprise_id=${enterprise} and id in (${record.recordId},${recordA2.recordId},${outsideRecord.recordId})`));

  const createIssue = async (pid: string, source: { recordId: string; messageId: string }, state: string, options: {
    ownerId: string; title: string; revision: number;
  }) => withTenantTransaction(enterprise, async tx => {
    const current = await currentRecord(tx, enterprise, pid, source.recordId);
    assert.ok(current);
    const request = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterprise} and id=${source.messageId}`);
    assert.ok(request);
    const opened = await openRecordIssue(tx, enterprise, pid, source.recordId, current, {
      openedBy: worker, requestMessageId: source.messageId, requestHash: fingerprint(request.content),
      requestText: options.title, projectReview: false,
    }, { kind: 'admin', adminId: manager }, randomUUID());
    const base = await readSiteIssueBase(tx, enterprise, pid, opened!.issueId);
    assert.ok(base);
    const payload = { ...base, revision: options.revision, state, action: 'i750-acceptance', ownerId: options.ownerId,
      confirmed: true, confirmedAt: now.toISOString(), confirmedBy: manager };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterprise},'construction.site.issue.progress.v1','construction_site_issue',${String(opened!.issueId)},${options.revision},
      '{"kind":"admin"}'::jsonb,${randomUUID()},${JSON.stringify(payload)}::jsonb)`);
    return String(opened!.issueId);
  });
  const workerIssue = await createIssue(projectA, record, 'awaiting_rectification',
    { ownerId: worker, title: '补拍卫生间照片并补充现场记录', revision: 2 });
  const designerIssue = await createIssue(projectA, recordA2, 'awaiting_verification',
    { ownerId: designer, title: '请核对客厅墙砖排版与现场尺寸', revision: 3 });
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.domain_event_outbox
    set created_at=${new Date(factAt.getTime() + 1800000)}, updated_at=${new Date(factAt.getTime() + 1800000)}
    where enterprise_id=${enterprise} and type in ('construction.site.issue.opened.v1','construction.site.issue.progress.v1')`));
  result.ids.records = { record, recordA2, outsideRecord };
  result.ids.issues = { workerIssue, designerIssue };

  const ownerBinding = await withTenantTransaction(enterprise, tx => ensureFollowupBinding(tx, enterprise,
    { kind: 'user', id: owner, audience: 'customer', projectId: projectA }));
  const designerBinding = await withTenantTransaction(enterprise, tx => ensureFollowupBinding(tx, enterprise,
    { kind: 'admin', id: designer, audience: 'designer' }));
  const workerBinding = await withTenantTransaction(enterprise, tx => ensureFollowupBinding(tx, enterprise,
    { kind: 'admin', id: worker, audience: 'worker' }));
  const bossBinding = await withTenantTransaction(enterprise, tx => ensureFollowupBinding(tx, enterprise,
    { kind: 'admin', id: boss, audience: 'boss' }));
  result.ids.bindings = {
    owner: { id: String(ownerBinding.id), conversationId: String(ownerBinding.conversation_id) },
    designer: { id: String(designerBinding.id), conversationId: String(designerBinding.conversation_id) },
    worker: { id: String(workerBinding.id), conversationId: String(workerBinding.conversation_id) },
    boss: { id: String(bossBinding.id), conversationId: String(bossBinding.conversation_id) },
  };

  const maxStageEvent = (await withTenantTransaction(enterprise, tx => one(tx, sql`select coalesce(max(id),0)::text id
    from app.domain_event_outbox where enterprise_id=${enterprise} and type='construction.stage.updated.v1'`)))!;
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_report_settings
    (enterprise_id,enabled,daily_time,weekly_time,weekly_day,project_ids,stage_keys,next_daily_at,next_weekly_at,
      stage_cursor,stage_enabled,audiences,inactive_policy,dispatch_epoch)
    values(${enterprise},true,'20:00','08:00',1,'[]'::jsonb,'[]'::jsonb,
      ${new Date(now.getTime() + 86400000)},${new Date(now.getTime() - 3600000)},
      ${String(maxStageEvent.id)},false,'["customer","designer","boss","worker"]'::jsonb,'pause_inactive',1)`));
  const settings = await withTenantTransaction(enterprise, tx => one(tx, sql`select * from app.construction_report_settings where enterprise_id=${enterprise}`));
  check('fixture.report_settings', settings?.enabled === true
    && JSON.stringify(settings?.audiences) === JSON.stringify(['customer', 'designer', 'boss', 'worker'])
    ? 'passed' : 'failed', '企业周报计划启用并包含业主、设计师、老板、施工人员四类受众',
    { enabled: settings?.enabled, audiences: settings?.audiences, projectIds: settings?.project_ids, stageEnabled: settings?.stage_enabled });

  let scopeVersion = 0;
  const saveScope = async (projectIds: string[], status: 'active' | 'inactive' = 'active') => {
    const version = ++scopeVersion;
    await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
      (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
      values(${enterprise},'i750-pilot',array[${sql.join(projectIds.map(pid => sql`${pid}::bigint`), sql`, `)}],
        ${boss},${version},${status})`));
    return version;
  };
  const pilotEnv = {
    XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: enterprise,
    XIAOK_STAGE_REMINDER_PILOT_ID: 'i750-pilot',
    XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: enterprise,
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'i750-pilot',
  };
  await saveScope([projectA]);

  // ------------------------------------------------------------- reminders
  const reminderRows = (pid: string) => withTenantTransaction(enterprise, tx => rows(tx, sql`select reminder_id,project_id::text,
    stage_id,construction_stage_key,trigger_type,target_role,target_principal_kind,target_principal_id::text,status,
    conversation_id::text,message_id::text,title,body,action_url,trigger_evidence,last_error,scheduled_at
    from app.construction_stage_reminders where enterprise_id=${enterprise} and project_id=${pid} order by reminder_id`));
  const reminderMessageCount = () => withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${enterprise} and purpose='construction.stage_reminder'`));
  const generate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const generated = await reminderRows(projectA);
  check('reminder.stage_identified', String((await detailOf(projectA)).current_stage_key) === stageKey
    && stageForConstructionKey(stageKey)?.stageId === stageId
    ? 'passed' : 'failed', '提醒链路识别到当前装修阶段（泥木）', { stageKey, stageId, stageName: stageForConstructionKey(stageKey)?.name });
  check('reminder.policy_matched', policy.roles.join(',') === 'owner,designer,worker,manager'
    && generated.length > 0 && generated.every(row => String(row.stage_id) === stageId)
    && generated.every(row => ['owner', 'designer', 'worker', 'manager'].includes(String(row.target_role)))
    ? 'passed' : 'failed', '提醒策略匹配泥木阶段，提醒只针对当前阶段和配置角色',
    { policy: { policyId: policy.policyId, roles: policy.roles, dueSoonDays: policy.dueSoonDays, endPreparationDays: policy.endPreparationDays },
      stages: [...new Set(generated.map(row => row.stage_id))], roles: [...new Set(generated.map(row => row.target_role))] });
  const factRows = generated.filter(row => String(row.trigger_type) === 'stage_entered');
  const planRows = generated.filter(row => ['plan_node_due_soon', 'plan_node_overdue', 'stage_ending'].includes(String(row.trigger_type)));
  check('reminder.facts_read', factRows.length > 0 && planRows.length > 0
    && generated.every(row => String(row.title).trim() && String(row.body).trim() && String(row.action_url).trim())
    && factRows.every(row => (row.trigger_evidence as Record<string, unknown>)?.kind === 'stage_event')
    && planRows.some(row => (row.trigger_evidence as Record<string, unknown>)?.kind === 'plan_node')
    ? 'passed' : 'failed', '提醒正确读取阶段事件、施工计划节点和项目事实，生成标题、正文与跳转地址',
    { stageTriggerTypes: [...new Set(factRows.map(row => row.trigger_type))],
      planTriggerTypes: [...new Set(planRows.map(row => row.trigger_type))],
      sample: generated.slice(0, 3).map(row => ({ triggerType: row.trigger_type, role: row.target_role,
        title: row.title, body: String(row.body).slice(0, 120), actionUrl: row.action_url })) });
  check('reminder.generated', generate.mode === 'pilot' && generate.scopeStatus === 'active'
    && Number(generate.scopeVersion) === scopeVersion && generate.created > 0
    && generated.length > 0 && generated.every(row => String(row.status) === 'pending')
    ? 'passed' : 'failed', '试点范围 active 时生成待发送提醒记录', { generate, reminders: generated.length });

  const deliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const afterDeliver = await reminderRows(projectA);
  const delivered = afterDeliver.filter(row => String(row.status) === 'delivered');
  const managerFailed = afterDeliver.filter(row => String(row.target_role) === 'manager'
    && String(row.status) === 'failed' && String(row.last_error) === 'no_inbox');
  const messagesAfterDeliver = await reminderMessageCount();
  const bindingConversation = new Map([
    ['owner', String(ownerBinding.conversation_id)], ['designer', String(designerBinding.conversation_id)],
    ['worker', String(workerBinding.conversation_id)],
  ]);
  const wrongInbox = delivered.filter(row => bindingConversation.has(String(row.target_role))
    && String(row.conversation_id) !== bindingConversation.get(String(row.target_role)));
  check('reminder.delivered', deliver.mode === 'pilot' && deliver.delivered > 0
    && delivered.length > 0 && delivered.every(row => row.message_id && row.conversation_id)
    && wrongInbox.length === 0
    ? 'passed' : 'failed', '提醒投递至正确的站内会话并保存 messageId/conversationId',
    { deliver, delivered: delivered.map(row => ({ reminderId: row.reminder_id, role: row.target_role,
      conversationId: row.conversation_id, messageId: row.message_id })), wrongInbox: wrongInbox.length,
      messages: messagesAfterDeliver?.n });
  check('reminder.manager_no_inbox', managerFailed.length > 0 ? 'limited' : 'passed',
    managerFailed.length > 0
      ? '项目经理没有私人站内会话，按现有合同保持 failed/no_inbox，进入项目工作台待办；未伪造消息'
      : '项目经理提醒没有出现 no_inbox 失败', { managerFailed: managerFailed.length });

  const beforeRepeat = await reminderRows(projectA);
  const repeatGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const repeatDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const afterRepeat = await reminderRows(projectA);
  const messagesAfterRepeat = await reminderMessageCount();
  const newRows = afterRepeat.filter(row => !beforeRepeat.some(old => String(old.reminder_id) === String(row.reminder_id)));
  check('reminder.idempotent', newRows.length === 0 && repeatDeliver.delivered === 0
    && Number(messagesAfterRepeat?.n) === Number(messagesAfterDeliver?.n) ? 'passed' : 'failed',
    '重复执行提醒不重复创建记录、不重复发送站内消息',
    { repeatGenerate, repeatDeliver, newRows: newRows.length, messagesBefore: messagesAfterDeliver?.n,
      messagesAfter: messagesAfterRepeat?.n });

  // Leaving the pilot scope stops both generation and delivery for the project.
  // The outside project is paused so an active scope containing it cannot create
  // its own reminders during this check.
  const pauseOutside = await detailOf(projectB);
  await service.execute('update', { projectId: projectB, expectedVersion: Number(pauseOutside.version),
    name: String(pauseOutside.name), status: 'paused', customerAccess: true }, randomUUID());
  const pendingBeforeScopeExit = (await reminderRows(projectA)).filter(row => ['pending', 'failed'].includes(String(row.status)));
  await saveScope([projectB]);
  const scopeExitGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const scopeExitDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const afterScopeExit = await reminderRows(projectA);
  const pendingAfterScopeExit = afterScopeExit.filter(row => ['pending', 'failed'].includes(String(row.status)));
  check('reminder.scope_exit_stops', scopeExitGenerate.created === 0 && scopeExitDeliver.delivered === 0
    && pendingAfterScopeExit.length === pendingBeforeScopeExit.length
    ? 'passed' : 'failed', '项目退出 Pilot Scope 后停止生成和投递，既有待发提醒保留但不投递',
    { scopeExitGenerate, scopeExitDeliver, pendingBefore: pendingBeforeScopeExit.length,
      pendingAfter: pendingAfterScopeExit.length, scopeVersion });
  await saveScope([projectA]);
  const resumeOutside = await detailOf(projectB);
  await service.execute('update', { projectId: projectB, expectedVersion: Number(resumeOutside.version),
    name: String(resumeOutside.name), status: 'active', customerAccess: true }, randomUUID());

  // Pause the project: no new reminders, pending rows are cancelled.
  const pendingBeforePause = (await reminderRows(projectA)).filter(row => ['pending', 'failed'].includes(String(row.status)));
  const pauseDetail = await detailOf(projectA);
  await service.execute('update', { projectId: projectA, expectedVersion: Number(pauseDetail.version),
    name: String(pauseDetail.name), status: 'paused', customerAccess: true }, randomUUID());
  const pausedGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const pausedDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const afterPause = await reminderRows(projectA);
  const cancelled = afterPause.filter(row => pendingBeforePause.some(old => String(old.reminder_id) === String(row.reminder_id))
    && String(row.status) === 'cancelled');
  const deliveredAfterPause = afterPause.filter(row => String(row.status) === 'delivered').length;
  check('reminder.project_paused_stops', pausedGenerate.created === 0 && pausedDeliver.delivered === 0
    && cancelled.length === pendingBeforePause.length
    && afterPause.filter(row => ['pending', 'failed'].includes(String(row.status))).length === 0
    ? 'passed' : 'failed', '项目暂停后停止生成新提醒，既有待发提醒被取消',
    { pausedGenerate, pausedDeliver, pendingBefore: pendingBeforePause.length, cancelled: cancelled.length,
      deliveredAfterPause, totalAfterPause: afterPause.length });
  const resumeDetail = await detailOf(projectA);
  await service.execute('update', { projectId: projectA, expectedVersion: Number(resumeDetail.version),
    name: String(resumeDetail.name), status: 'active', customerAccess: true }, randomUUID());

  // Restore the deterministic reminder state for the report run.
  const restoreGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const restoreDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });

  // --------------------------------------------------------------- reports
  const reportCounts = () => withTenantTransaction(enterprise, tx => one(tx, sql`select
    (select count(*)::int from app.construction_reports where enterprise_id=${enterprise}) reports,
    (select count(*)::int from app.construction_report_versions where enterprise_id=${enterprise}) versions,
    (select count(*)::int from app.construction_report_deliveries where enterprise_id=${enterprise}) deliveries,
    (select count(*)::int from app.assistant_messages where enterprise_id=${enterprise}) messages`));
  const reportBefore = await reportCounts();
  const reportAdvance = await advanceConfiguredConstructionReports({ now, env: pilotEnv });
  const factsRuns = await withTenantTransaction(enterprise, tx => rows(tx, sql`select id::text run_id
    from app.assistant_runs where enterprise_id=${enterprise} and purpose='construction.report.facts'
    and status in ('queued','running') order by id`));
  for (const run of factsRuns) {
    const lease = await claimJob({ enterpriseId: enterprise, runId: String(run.run_id) });
    if (lease) await processConstructionReport(lease);
  }
  const reports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,r.kind,
    r.binding_id::text,b.audience,b.principal_key,v.revision,v.run_id::text,v.facts,v.facts_hash,v.status,run.policy_snapshot
    from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    where r.enterprise_id=${enterprise} and r.kind='weekly' order by r.id`));
  const projectIds = (facts: unknown) => {
    const projects = (facts as { projects?: Array<{ id?: unknown }> } | null)?.projects;
    return Array.isArray(projects) ? projects.map(project => String(project.id)) : [];
  };
  const policyIds = (snapshot: unknown) => {
    const scope = (snapshot as { scope?: { project_ids?: unknown } } | null)?.scope;
    return Array.isArray(scope?.project_ids) ? scope!.project_ids!.map(String) : [];
  };
  const audiences = [...new Set(reports.map(report => String(report.audience)))];
  check('report.generation', reportAdvance.mode === 'pilot' && reportAdvance.scopeStatus === 'active'
    && Number(reportAdvance.scopeVersion) === scopeVersion && reportAdvance.queued >= 4
    && Number(reportAdvance.scopedProjects) === 1 && reportAdvance.errors.length === 0
    ? 'passed' : 'failed', '试点范围内按企业周报计划为四类受众排入周报',
    { reportAdvance, factsRuns: factsRuns.length, reports: reports.length, audiences });
  check('report.four_audiences', ['customer', 'designer', 'boss', 'worker'].every(audience => audiences.includes(audience))
    && reports.length >= 4 ? 'passed' : 'failed', '同一合成项目分别生成业主、设计师、老板、施工人员周报',
    { audiences, reports: reports.map(report => ({ reportId: report.report_id, audience: report.audience,
      revision: report.revision, status: report.status })) });
  check('report.facts_same_source', reports.length > 0
    && reports.every(report => projectIds(report.facts).length === 1 && projectIds(report.facts)[0] === projectA)
    && reports.every(report => JSON.stringify(policyIds(report.policy_snapshot)) === JSON.stringify([projectA]))
    && reports.every(report => report.status === 'facts_ready' && /^[a-f0-9]{64}$/u.test(String(report.facts_hash)))
    ? 'passed' : 'failed', '四端周报 facts 与 policy snapshot 只包含试点项目，事实来源相同且不跨项目',
    { reports: reports.map(report => ({ reportId: report.report_id, audience: report.audience,
      factsProjectIds: projectIds(report.facts), policyProjectIds: policyIds(report.policy_snapshot),
      factsHash: report.facts_hash, status: report.status })) });

  const digestEntries: Array<{ audience: string; bindingId: string; digest: Record<string, unknown> }> = [];
  for (const report of reports) {
    const binding = await withTenantTransaction(enterprise, tx => one(tx, sql`select * from app.construction_followup_bindings
      where enterprise_id=${enterprise} and id=${report.binding_id}`));
    if (!binding) continue;
    const digest = buildRoleWeeklyDigest({ facts: report.facts as never, binding,
      report: { id: String(report.report_id), revision: Number(report.revision), period_start: new Date(now.getTime() - 6 * 86400000),
        period_end: now, generated_at: now, facts_hash: String(report.facts_hash), delivery_state: 'pending' } });
    if (digest) digestEntries.push({ audience: String(report.audience), bindingId: String(report.binding_id),
      digest: digest as unknown as Record<string, unknown> });
  }
  const digestText = (audience: string) => JSON.stringify(digestEntries
    .filter(entry => entry.audience === audience).map(entry => entry.digest));
  const customerText = digestText('customer');
  const workerText = digestText('worker');
  const designerText = digestText('designer');
  const bossText = digestText('boss');
  check('report.role_digests', digestEntries.length >= 4
    && customerText.includes(projectNameA) && !customerText.includes('补拍卫生间照片')
    && !customerText.includes('请核对客厅墙砖排版') && !customerText.includes('workerTasks')
    && (workerText.includes('补拍卫生间照片') || workerText.includes('卫生间照片'))
    && designerText.includes('请核对客厅墙砖排版')
    && bossText.includes(projectNameA) && !bossText.includes(projectNameB)
    ? 'passed' : 'failed', '四端角色投影符合角色：业主看不到内部事项，施工人员只看本人任务，设计师只看核对项，老板只看获权项目汇总',
    { digests: digestEntries.map(entry => ({ audience: entry.audience, bindingId: entry.bindingId,
      excerpt: JSON.stringify(entry.digest).slice(0, 500) })) });

  // A held delivery must be retried once the designer conversation is back in ai mode.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.assistant_conversations set mode='human'
    where enterprise_id=${enterprise} and id=${String(designerBinding.conversation_id)}`));
  const firstDelivery = await deliverConfiguredConstructionReports({ now, env: pilotEnv });
  const heldDesigner = await withTenantTransaction(enterprise, tx => one(tx, sql`select d.state
    from app.construction_report_deliveries d join app.construction_followup_bindings b
      on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
    where d.enterprise_id=${enterprise} and b.audience='designer' order by d.event_id desc limit 1`));
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.assistant_conversations set mode='ai'
    where enterprise_id=${enterprise} and id=${String(designerBinding.conversation_id)}`));
  const secondDelivery = await deliverConfiguredConstructionReports({ now, env: pilotEnv });
  const deliveries = await withTenantTransaction(enterprise, tx => rows(tx, sql`select d.report_id::text,d.revision,d.state,
    d.message_id::text,m.conversation_id::text,b.audience
    from app.construction_report_deliveries d
    left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
    join app.construction_followup_bindings b on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
    where d.enterprise_id=${enterprise} order by d.event_id`));
  const deliveredDeliveries = deliveries.filter(row => String(row.state) === 'delivered');
  const deliveredAudiences = [...new Set(deliveredDeliveries.map(row => String(row.audience)))];
  check('report.delivery', firstDelivery.delivered > 0 && heldDesigner?.state === 'held'
    && secondDelivery.delivered > 0 && ['customer', 'designer', 'boss', 'worker'].every(audience => deliveredAudiences.includes(audience))
    && deliveredDeliveries.every(row => row.message_id && row.conversation_id)
    ? 'passed' : 'failed', '四端周报投递至各自站内会话；人工接管时 held，恢复后重试 delivered',
    { firstDelivery, heldDesigner: heldDesigner?.state, secondDelivery,
      deliveries: deliveries.map(row => ({ audience: row.audience, state: row.state, messageId: row.message_id,
        conversationId: row.conversation_id })) });

  const beforeReportRepeat = await reportCounts();
  const repeatReportAdvance = await advanceConfiguredConstructionReports({ now, env: pilotEnv });
  const repeatReportDeliver = await deliverConfiguredConstructionReports({ now, env: pilotEnv });
  const afterReportRepeat = await reportCounts();
  check('report.idempotent', Number(repeatReportAdvance.queued) === 0 && repeatReportDeliver.delivered === 0
    && JSON.stringify(beforeReportRepeat) === JSON.stringify(afterReportRepeat) ? 'passed' : 'failed',
    '重复执行周报生成与投递不产生重复报告、版本、投递或消息',
    { repeatReportAdvance, repeatReportDeliver, before: beforeReportRepeat, after: afterReportRepeat });

  const outsideReports = reports.filter(report => projectIds(report.facts).some(id => id === projectB));
  check('report.scope_isolation', outsideReports.length === 0
    && (await reminderRows(projectB)).length === 0 ? 'passed' : 'failed',
    '范围外项目没有提醒，也没有进入任何周报 facts',
    { outsideReports: outsideReports.length, outsideReminders: (await reminderRows(projectB)).length,
      outsideRecord: outsideRecord.recordId });

  // The first release also composes the real model body for every generated
  // report version. The fixture reports keep their existing facts and delivery
  // messages; this only adds the `construction.report.compose` body version.
  const freshBindings: ReuseFixture['bindings'] = {
    customer: { reportId: String(reports.find(row => String(row.audience) === 'customer')!.report_id),
      revision: Number(reports.find(row => String(row.audience) === 'customer')!.revision),
      bindingId: String(ownerBinding.id), conversationId: String(ownerBinding.conversation_id),
      principal: 'user', principalId: owner },
    designer: { reportId: String(reports.find(row => String(row.audience) === 'designer')!.report_id),
      revision: Number(reports.find(row => String(row.audience) === 'designer')!.revision),
      bindingId: String(designerBinding.id), conversationId: String(designerBinding.conversation_id),
      principal: 'admin', principalId: designer },
    boss: { reportId: String(reports.find(row => String(row.audience) === 'boss')!.report_id),
      revision: Number(reports.find(row => String(row.audience) === 'boss')!.revision),
      bindingId: String(bossBinding.id), conversationId: String(bossBinding.conversation_id),
      principal: 'admin', principalId: boss },
    worker: { reportId: String(reports.find(row => String(row.audience) === 'worker'
      && String(row.binding_id) === String(workerBinding.id))!.report_id), revision: Number(reports.find(row =>
      String(row.audience) === 'worker' && String(row.binding_id) === String(workerBinding.id))!.revision),
      bindingId: String(workerBinding.id), conversationId: String(workerBinding.conversation_id),
      principal: 'admin', principalId: worker },
  };
  const ownerContext = await withTenantTransaction(enterprise, tx => one(tx, sql`select context_version
    from app.users where enterprise_id=${enterprise} and id=${owner}`));
  await runReportBodyAcceptance({
    ids: { enterprise, projectA, projectB, owner, boss, manager, designer, worker },
    enterprise, projectA, projectB, projectNameA, projectNameB, stageKey,
    ownerContextVersion: Number(ownerContext?.context_version || 0),
    roleIds: { owner, boss, manager, designer, worker },
    bindings: freshBindings, reports: [],
  });

  // ------------------------------------------------------------- unified
  result.unified = {
    reminderStatus: statusOf('reminder.stage_identified', 'reminder.policy_matched', 'reminder.facts_read',
      'reminder.generated', 'reminder.delivered', 'reminder.manager_no_inbox',
      'reminder.idempotent', 'reminder.project_paused_stops', 'reminder.scope_exit_stops'),
    knowledgeAnswerStatus: statusOf('qa.stage_answers') !== 'passed' ? 'failed'
      : modelStatus === 'passed' ? 'passed' : 'limited',
    weeklyReportStatus: statusOf('report.generation', 'report.four_audiences', 'report.facts_same_source',
      'report.role_digests', 'report.delivery', 'report.idempotent', 'report.scope_isolation',
      'body.compose', 'body.facts', 'body.role_scope', 'body.delivery', 'body.idempotent'),
    reportBodyStatus: statusOf('body.compose', 'body.model', 'body.facts', 'body.role_scope',
      'body.distinct', 'body.delivery', 'body.idempotent', 'body.model_scope'),
    customerDelivery: deliveredAudiences.includes('customer') ? 'passed' : 'failed',
    designerDelivery: deliveredAudiences.includes('designer') ? 'passed' : 'failed',
    bossDelivery: deliveredAudiences.includes('boss') ? 'passed' : 'failed',
    workerDelivery: deliveredAudiences.includes('worker') ? 'passed' : 'failed',
    idempotencyStatus: statusOf('reminder.idempotent', 'report.idempotent'),
    projectScopeStatus: statusOf('reminder.scope_exit_stops', 'report.scope_isolation'),
  };
  result.ids.final = {
    reminders: {
      projectA: (await reminderRows(projectA)).length,
      delivered: (await reminderRows(projectA)).filter(row => String(row.status) === 'delivered').length,
      projectB: (await reminderRows(projectB)).length,
      restoreGenerate, restoreDeliver,
    },
    reports: { before: reportBefore, after: await reportCounts(), weekly: reports.map(report => ({
      reportId: report.report_id, audience: report.audience, revision: report.revision, status: report.status })) },
    deliveries: deliveries.map(row => ({ audience: row.audience, state: row.state, messageId: row.message_id,
      conversationId: row.conversation_id })),
    scopeVersion,
    model,
    llmSource: liveModelSource || (llmBefore ? 'isolated' : null),
  };
  // --------------------------------------------------- I7.5.1 body helpers
  // Reuse the exact I7.5.0 fixture when it is still present. The accepted
  // reports keep their original facts, bindings and delivered messages; this
  // round only composes the real `construction.report.compose` body version.
  type ReuseBinding = { reportId: string; revision: number; bindingId: string; conversationId: string;
    principal: 'user' | 'admin'; principalId: string };
  type ReuseFixture = { ids: Record<string, unknown>; enterprise: string; projectA: string; projectB: string;
    projectNameA: string; projectNameB: string; stageKey: string; ownerContextVersion: number;
    roleIds: { owner: string; boss: string; manager: string; designer: string; worker: string };
    bindings: Record<'customer' | 'designer' | 'boss' | 'worker', ReuseBinding>;
    reports: Array<Record<string, unknown>>; managerReport?: Record<string, unknown> };

  async function discoverReusableFixture(): Promise<ReuseFixture | null> {
    const projectAName = 'I7.5.0 第一期合成工地（试点内）';
    const projectBName = 'I7.5.0 第一期合成工地（范围外）';
    const enterprises = await withPlatformTransaction(tx => rows(tx, sql`select id::text id,name
      from app.enterprises where name like 'I7.5.0 第一期合成企业-%' and status='active' order by id desc limit 5`));
    for (const enterprise of enterprises) {
      const eid = String(enterprise.id);
      const projects = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text id,name,current_stage_key
        from app.construction_projects where enterprise_id=${eid} and name in (${projectAName},${projectBName}) order by id`));
      const projectA = projects.find(row => String(row.name) === projectAName);
      const projectB = projects.find(row => String(row.name) === projectBName);
      if (!projectA || !projectB) continue;
      const admins = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text id,display_name
        from app.admin_users where enterprise_id=${eid}
        and display_name in ('I7.5.0 老板','I7.5.0 项目经理','I7.5.0 设计师','I7.5.0 施工人员')`));
      const owner = await withTenantTransaction(eid, tx => one(tx, sql`select id::text id,context_version
        from app.users where enterprise_id=${eid} and nickname='I7.5.0 业主' order by id limit 1`));
      const boss = admins.find(row => String(row.display_name) === 'I7.5.0 老板');
      const manager = admins.find(row => String(row.display_name) === 'I7.5.0 项目经理');
      const designer = admins.find(row => String(row.display_name) === 'I7.5.0 设计师');
      const worker = admins.find(row => String(row.display_name) === 'I7.5.0 施工人员');
      if (!owner || !boss || !manager || !designer || !worker) continue;
      const reports = await withTenantTransaction(eid, tx => rows(tx, sql`select r.id::text report_id,r.binding_id::text,
        b.audience,b.principal_key,b.conversation_id::text,(r.id::text || ':' || v.revision::text) version_id,v.revision,
        v.knowledge_status,v.body_run_id::text,v.body
        from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id
          and v.report_id=r.id and v.revision=r.latest_revision
        join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
        where r.enterprise_id=${eid} and r.kind='weekly' order by r.id`));
      if (reports.length < 4) continue;
      const bindingOf = (report: Record<string, unknown>): ReuseBinding => ({
        reportId: String(report.report_id), revision: Number(report.revision), bindingId: String(report.binding_id),
        conversationId: String(report.conversation_id),
        principal: String(report.principal_key).startsWith('user:') ? 'user' : 'admin',
        principalId: String(report.principal_key).split(':')[1] });
      const customer = reports.find(row => row.audience === 'customer' && row.principal_key === 'user:' + String(owner.id));
      const designerReport = reports.find(row => row.audience === 'designer' && row.principal_key === 'admin:' + String(designer.id));
      const bossReport = reports.find(row => row.audience === 'boss' && row.principal_key === 'admin:' + String(boss.id));
      const workerReport = reports.find(row => row.audience === 'worker' && row.principal_key === 'admin:' + String(worker.id));
      const managerReport = reports.find(row => row.audience === 'worker' && row.principal_key === 'admin:' + String(manager.id));
      if (!customer || !designerReport || !bossReport || !workerReport) continue;
      return {
        ids: { enterprise: eid, projectA: String(projectA.id), projectB: String(projectB.id),
          owner: String(owner.id), boss: String(boss.id), manager: String(manager.id), designer: String(designer.id),
          worker: String(worker.id), reports: reports.map(row => ({ reportId: row.report_id, audience: row.audience,
            principalKey: row.principal_key, revision: row.revision, conversationId: row.conversation_id })) },
        enterprise: eid, projectA: String(projectA.id), projectB: String(projectB.id),
        projectNameA: projectAName, projectNameB: projectBName, stageKey: String(projectA.current_stage_key),
        ownerContextVersion: Number(owner.context_version || 0),
        roleIds: { owner: String(owner.id), boss: String(boss.id), manager: String(manager.id),
          designer: String(designer.id), worker: String(worker.id) },
        bindings: { customer: bindingOf(customer), designer: bindingOf(designerReport),
          boss: bindingOf(bossReport), worker: bindingOf(workerReport) },
        reports,
        ...(managerReport ? { managerReport } : {}),
      };
    }
    return null;
  }

  type ComposeModelState = { configured: boolean; before: unknown; agentBefore: unknown;
    agentChanged: boolean; reason?: string };
  async function configureComposeModel(eid: string): Promise<ComposeModelState> {
    const isolated = await withPlatformTransaction(tx => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
    const before: unknown = isolated?.llm_config ?? null;
    let source: Record<string, unknown> | null = null;
    if (liveModelSource === 'development') {
      assert.ok(sourceDevelopmentUrl && new URL(sourceDevelopmentUrl).pathname === '/smart_floor_planner',
        '--llm-source=development requires the development DATABASE_URL');
      const dev = new pg.Client({ connectionString: sourceDevelopmentUrl });
      await dev.connect();
      try {
        await dev.query('begin read only');
        const row = await dev.query("select llm_config from app.platform_configs where key='default'");
        source = row.rows[0]?.llm_config ?? null;
        await dev.query('rollback');
      } finally { await dev.end(); }
    } else if (before && typeof before === 'object' && Object.keys(before as object).length) {
      source = before as Record<string, unknown>;
    }
    const profiles = (source?.profiles ?? {}) as Record<string, Record<string, unknown>>;
    const profile = profiles.dashscope
      ?? Object.values(profiles).find(item => item?.apiKeyEncrypted && /dashscope|bailian/iu.test(String(item.baseUrl || '')));
    if (!source || !profile?.apiKeyEncrypted) {
      return { configured: false, before, agentBefore: null, agentChanged: false,
        reason: 'bailian_credentials_not_configured' };
    }
    const next = { ...source, ...profile, providerKey: 'dashscope', model, enabled: true,
      profiles: { ...profiles, dashscope: { ...profile, model, enabled: true } } };
    await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs
      set llm_config=${JSON.stringify(next)}::jsonb where key='default'`));
    const current = await withTenantTransaction(eid, tx => one(tx, sql`select agent_config,enabled
      from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    if (current?.enabled !== true) throw new Error('assistant_enterprise_settings is disabled');
    const agentBefore = current.agent_config ?? null;
    const agent = agentBefore as Record<string, unknown> | null;
    const matches = !!agent && agent.runtime === 'langgraph-v1' && agent.providerKey === 'dashscope'
      && agent.model === model;
    if (!matches) {
      const nextAgent = { runtime: 'langgraph-v1', providerKey: 'dashscope', model, imageInput: false, tools: true,
        probeVersion: 'i751-report-body-acceptance-v1', enterpriseKnowledgeEnabled: false };
      await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings
        set agent_config=${JSON.stringify(nextAgent)}::jsonb where enterprise_id=${eid}`));
    }
    return { configured: true, before, agentBefore, agentChanged: !matches };
  }

  async function restoreComposeModel(state: ComposeModelState, eid: string) {
    if (!state.configured) return;
    let restored = true;
    try {
      await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs
        set llm_config=${JSON.stringify(state.before ?? {})}::jsonb where key='default'`));
      if (state.agentChanged) await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings
        set agent_config=${JSON.stringify(state.agentBefore)}::jsonb where enterprise_id=${eid}`));
      const llmBack = await withPlatformTransaction(tx => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
      if (JSON.stringify(llmBack?.llm_config ?? null) !== JSON.stringify(state.before ?? null)) restored = false;
      if (state.agentChanged) {
        const agentBack = await withTenantTransaction(eid, tx => one(tx, sql`select agent_config
          from app.assistant_enterprise_settings where enterprise_id=${eid}`));
        if (JSON.stringify(agentBack?.agent_config ?? null) !== JSON.stringify(state.agentBefore ?? null)) restored = false;
      }
    } catch (error) {
      restored = false;
      check('body.cleanup', 'failed', '隔离库模型配置恢复失败', { error: (error as Error).message });
    }
    if (restored) check('body.cleanup', 'passed', '隔离库模型配置已恢复为执行前原值；API Key 未输出、未写入日志', {});
    else if (!result.checks.some(item => item.id === 'body.cleanup')) {
      check('body.cleanup', 'failed', '隔离库模型配置未恢复到执行前原值', {});
    }
  }

  type SavedBody = { protocol?: string; generalAdvice?: string; projects?: Array<{
    projectId?: string; selection?: Record<string, unknown>;
    context?: { snapshots?: Array<{ data?: Array<Record<string, unknown>> }>; sources?: Array<{ kind?: string; text?: string }> };
    sections?: Record<string, { segments?: Array<{ basis?: string; text?: string;
      citations?: Array<{ sourceId?: string; quote?: string }> }> }> }> };
  function bodyOf(report: Record<string, unknown>) {
    return (report.body && typeof report.body === 'object' ? report.body : null) as SavedBody | null;
  }
  function adviceOf(body: SavedBody | null) {
    return (body?.projects ?? []).flatMap(project =>
      (project.sections?.standards?.segments ?? []).filter(segment => segment.basis === 'advice')
        .map(segment => String(segment.text || '')));
  }
  function sha256(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  type BodyEvidence = {
    reportId: string; reportVersionId: string; runId: string | null; audience: string; principalKey: string;
    modelId: string[]; providerRequestId: string | null; inputTokens: number; outputTokens: number;
    durationMs: number[]; wallMs: number | null; responseStatus: string | null; groundingStatus: string;
    finalBodyHash: string | null; factsHash: string | null; bodyErrorCode: string | null; attempts: number;
    advice: string[]; adviceLength: number; bodyProjects: string[]; generalAdvice: string | null;
  };

  async function runReportBodyAcceptance(fixture: ReuseFixture) {
    const eid = fixture.enterprise;
    const projectIdsOf = (facts: unknown) => ((facts as { projects?: Array<{ id?: unknown }> } | null)?.projects ?? [])
      .map(project => String(project.id));
    const reportRows = await withTenantTransaction(eid, tx => rows(tx, sql`select r.id::text report_id,r.binding_id::text,
      b.audience,b.principal_key,b.conversation_id::text,(r.id::text || ':' || v.revision::text) version_id,v.revision,
      v.status,v.facts,v.facts_hash,v.body,v.body_generated_at,v.knowledge_status,v.body_error_code,v.body_attempts,
      v.body_run_id::text
      from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id
        and v.report_id=r.id and v.revision=r.latest_revision
      join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      where r.enterprise_id=${eid} and r.kind='weekly' order by r.id`));
    const counts = () => withTenantTransaction(eid, tx => one(tx, sql`select
      (select count(*)::int from app.construction_reports where enterprise_id=${eid}) reports,
      (select count(*)::int from app.construction_report_versions where enterprise_id=${eid}) versions,
      (select count(*)::int from app.construction_report_deliveries where enterprise_id=${eid}) deliveries,
      (select count(*)::int from app.assistant_messages where enterprise_id=${eid}) messages,
      (select count(*)::int from app.assistant_runs where enterprise_id=${eid}
        and purpose='construction.report.compose') compose_runs`));
    const before = await counts();
    const modelState = await configureComposeModel(eid);
    try {
      if (!modelState.configured) {
        check('body.compose', 'not_run', '未配置真实百炼凭据，正式正文任务未执行（不使用 Mock 冒充通过）',
          { reason: modelState.reason, reports: reportRows.map(row => row.report_id) });
        check('body.model_scope', 'not_run', '模型正文未执行', {});
        return;
      }
      check('body.reuse_fixture', 'passed',
        '复用 I7.5.0 同一合成企业、项目、四端绑定与已投递周报版本，未新建企业、项目、提醒或周报',
        { enterprise: eid, projectA: fixture.projectA, projectB: fixture.projectB,
          reports: reportRows.map(row => ({ reportId: row.report_id, audience: row.audience,
            principalKey: row.principal_key, revision: row.revision, priorKnowledgeStatus: row.knowledge_status })) });

      const enqueued: Array<Record<string, unknown>> = [];
      const firstDraftEvidence = async (report: Record<string, unknown>) => {
        const runIdValue = String(report.body_run_id);
        const firstAttempts = await withPlatformTransaction(tx => rows(tx, sql`select remote_model,status,duration_ms,metadata
          from app.ai_provider_attempts where assistant_run_id=${runIdValue} order by id`));
        const firstUsage = await withTenantTransaction(eid, tx => rows(tx, sql`select input_tokens,output_tokens
          from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runIdValue}`));
        const runStep = await withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint
          from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runIdValue} and step_seq=1100`));
        const checkpoint = runStep?.private_checkpoint as { toolCalls?: Array<{ arguments?: string }> } | undefined;
        const requestIds = firstAttempts.map(item => {
          const metadata = item.metadata as Record<string, unknown> | null;
          const response = metadata?.assistantResponse as Record<string, unknown> | undefined;
          return response?.providerRequestId || null;
        }).filter(Boolean);
        return { reportId: report.report_id, audience: report.audience, firstRunId: runIdValue,
          firstError: report.body_error_code || null,
          firstDraft: checkpoint?.toolCalls?.[0]?.arguments ?? null,
          firstModelId: firstAttempts.map(item => String(item.remote_model)),
          firstProviderRequestId: requestIds[0] ? String(requestIds[0]) : null,
          firstInputTokens: firstUsage.reduce((sum, item) => sum + Number(item.input_tokens || 0), 0),
          firstOutputTokens: firstUsage.reduce((sum, item) => sum + Number(item.output_tokens || 0), 0),
          firstDurationMs: firstAttempts.map(item => Number(item.duration_ms || 0)) };
      };
      const reopenVersion = (report: Record<string, unknown>) => withTenantTransaction(eid, tx => tx.execute(
        sql`update app.construction_report_versions set body_run_id=null,knowledge_status='not_generated',body_error_code=null
          where enterprise_id=${eid} and report_id=${String(report.report_id)} and revision=${Number(report.revision)}`));
      // A prior durable model result that failed the product guard is re-opened
      // exactly once for the recorded prompt-root-cause repair. The failed run,
      // its draft and its usage stay untouched in the audit tables.
      const repairedThisRun = new Set<string>();
      const priorRepairs: Array<Record<string, unknown>> = [];
      for (const report of reportRows) {
        if (String(report.knowledge_status) === 'ready' && report.body) continue;
        if (!report.body_run_id) continue;
        const old = await withTenantTransaction(eid, tx => one(tx, sql`select r.status,j.provider_started_at
          from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
          where r.enterprise_id=${eid} and r.id=${String(report.body_run_id)}`));
        if (!old || String(old.status) !== 'failed' || !old.provider_started_at) continue;
        priorRepairs.push(await firstDraftEvidence(report));
        await reopenVersion(report);
        repairedThisRun.add(String(report.report_id));
      }
      for (const report of reportRows) {
        if (String(report.knowledge_status) === 'ready' && report.body) {
          enqueued.push({ reportId: report.report_id, runId: report.body_run_id, status: 'ready' });
          continue;
        }
        const result = await withTenantTransaction(eid, tx => enqueueReportBody(tx, eid,
          String(report.report_id), Number(report.revision)));
        enqueued.push({ reportId: report.report_id, ...result });
      }
      check('body.enqueued', enqueued.every(item => item.status !== 'failed') ? 'passed' : 'failed',
        '通过正式 construction.report.compose 入口为既有周报版本排入正文任务',
        { enqueued });

      const queryComposed = () => withTenantTransaction(eid, tx => rows(tx, sql`select r.id::text report_id,r.binding_id::text,
        b.audience,b.principal_key,(r.id::text || ':' || v.revision::text) version_id,v.revision,v.facts,v.facts_hash,
        v.body,v.body_generated_at,v.knowledge_status,v.body_error_code,v.body_attempts,v.body_run_id::text,
        br.status body_run_status,br.error_code body_run_error
        from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id
          and v.report_id=r.id and v.revision=r.latest_revision
        join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
        left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
        where r.enterprise_id=${eid} and r.kind='weekly' order by r.id`));
      const wallMs: Record<string, number> = {};
      const processQueued = async () => {
        const queuedRuns = await withTenantTransaction(eid, tx => rows(tx, sql`select r.id::text run_id
          from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
          where r.enterprise_id=${eid} and r.purpose='construction.report.compose'
          and r.status in ('queued','running') order by r.id`));
        for (const run of queuedRuns) {
          const started = Date.now();
          const lease = await claimJob({ enterpriseId: eid, runId: String(run.run_id) });
          if (lease) await processReportComposition(lease);
          wallMs[String(run.run_id)] = Date.now() - started;
        }
      };
      await processQueued();
      let composed = await queryComposed();
      const firstPass = composed.map(row => ({ reportId: row.report_id, audience: row.audience,
        runId: row.body_run_id, knowledgeStatus: row.knowledge_status,
        errorCode: row.body_error_code || row.body_run_error || null }));
      // A role whose durable model result fails the product's own commitment or
      // citation guard gets exactly one repair test with the recorded root cause.
      // The failed run, its draft and its usage stay in the audit tables; only
      // the version link is re-admitted through the same formal entry.
      const summarizeRows = (rowsValue: Array<Record<string, unknown>>) => rowsValue.map(row => ({
        reportId: row.report_id, audience: row.audience, runId: row.body_run_id,
        knowledgeStatus: row.knowledge_status, errorCode: row.body_error_code || row.body_run_error || null }));
      let repair: Record<string, unknown> | null = priorRepairs.length ? {
        rootCause: 'first draft repeated internal numeric IDs or completion wording and was rejected by the existing commitment guard',
        attempts: priorRepairs, final: summarizeRows(composed) } : null;
      const needsRepair = composed.filter(row => String(row.knowledge_status) !== 'ready' && row.body_run_id
        && !repairedThisRun.has(String(row.report_id)));
      if (needsRepair.length) {
        const attempts: Array<Record<string, unknown>> = [...priorRepairs];
        for (const row of needsRepair) {
          const attempt = await firstDraftEvidence(row);
          await reopenVersion(row);
          const result = await withTenantTransaction(eid, tx => enqueueReportBody(tx, eid,
            String(row.report_id), Number(row.revision)));
          attempts.push({ ...attempt, repairRunId: result.runId, repairStatus: result.status });
        }
        await processQueued();
        composed = await queryComposed();
        repair = { rootCause: 'first draft repeated internal numeric IDs or completion wording and was rejected by the existing commitment guard',
          attempts, final: summarizeRows(composed) };
      }
      const roleAudiences = ['customer', 'designer', 'boss', 'worker'] as const;
      const evidence: BodyEvidence[] = [];
      for (const report of composed) {
        const runIdValue = report.body_run_id ? String(report.body_run_id) : null;
        const attempts = runIdValue ? await withPlatformTransaction(tx => rows(tx, sql`select id::text,
          provider_key,remote_model,status,accepted,duration_ms,error_code,metadata
          from app.ai_provider_attempts where assistant_run_id=${runIdValue} order by id`)) : [];
        const usage = runIdValue ? await withTenantTransaction(eid, tx => rows(tx, sql`select category,input_tokens,output_tokens,
          measurement_kind from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runIdValue}`)) : [];
        const body = bodyOf(report);
        const advice = adviceOf(body);
        const requestIds = attempts.map(attempt => {
          const metadata = attempt.metadata as Record<string, unknown> | null;
          const response = metadata?.assistantResponse as Record<string, unknown> | undefined;
          return response?.providerRequestId || metadata?.providerRequestId
            || (metadata?.requestDiagnostic as Record<string, unknown> | undefined)?.requestId || null;
        }).filter(Boolean);
        evidence.push({
          reportId: String(report.report_id), reportVersionId: String(report.version_id), runId: runIdValue,
          audience: String(report.audience), principalKey: String(report.principal_key),
          modelId: attempts.map(attempt => String(attempt.remote_model)),
          providerRequestId: requestIds[0] ? String(requestIds[0]) : null,
          inputTokens: usage.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0),
          outputTokens: usage.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0),
          durationMs: attempts.map(attempt => Number(attempt.duration_ms || 0)),
          wallMs: runIdValue ? wallMs[runIdValue] ?? null : null,
          responseStatus: report.body_run_status ? String(report.body_run_status) : null,
          groundingStatus: body ? 'citation_checked' : 'not_generated',
          finalBodyHash: body ? sha256(body) : null,
          factsHash: report.facts_hash ? String(report.facts_hash) : null,
          bodyErrorCode: report.body_error_code || report.body_run_error
            ? String(report.body_error_code || report.body_run_error) : null,
          attempts: attempts.length, advice, adviceLength: advice.join('').length,
          bodyProjects: (body?.projects ?? []).map(project => String(project.projectId)),
          generalAdvice: body?.generalAdvice ? String(body.generalAdvice) : null,
        });
      }
      const roleEvidence = roleAudiences.map(audience => evidence.find(item => item.audience === audience
        && (audience !== 'worker' || item.principalKey === 'admin:' + fixture.roleIds.worker)));
      const succeededRoles = roleAudiences.filter((audience, index) => {
        const item = roleEvidence[index];
        return !!item && item.responseStatus === 'succeeded' && item.finalBodyHash
          && item.modelId.length > 0 && item.inputTokens > 0 && item.outputTokens > 0;
      });
      const composeStatus: CheckStatus = succeededRoles.length === roleAudiences.length ? 'passed'
        : succeededRoles.length > 0 ? 'limited' : 'failed';
      check('body.compose', composeStatus,
        composeStatus === 'passed' ? '四端周报均通过正式 construction.report.compose 任务生成并保存正文版本'
          : '部分或全部受众未生成模型正文，按真实结果标记，未用模板文本冒充模型成功',
        { succeededRoles, evidence, firstPass, repair });
      const modelStatus: CheckStatus = evidence.some(item => item.runId)
        && evidence.filter(item => item.runId).every(item => item.modelId.length > 0
          && item.modelId.every(id => id === model) && item.inputTokens > 0 && item.outputTokens > 0
          && item.durationMs.some(duration => duration > 0) && item.providerRequestId) ? 'passed'
        : evidence.some(item => item.runId) ? 'limited' : 'failed';
      check('body.model', modelStatus,
        modelStatus === 'passed' ? '四端均记录真实百炼模型 ID、请求 ID、Token、耗时和最终正文哈希'
          : '模型调用证据不完整，详见每个角色的 provider attempt 与用量',
        { model, evidence: evidence.map(item => ({ audience: item.audience, reportId: item.reportId,
          modelId: item.modelId, providerRequestId: item.providerRequestId, inputTokens: item.inputTokens,
          outputTokens: item.outputTokens, durationMs: item.durationMs, wallMs: item.wallMs,
          responseStatus: item.responseStatus, finalBodyHash: item.finalBodyHash })) });

      // Fact/citation/role checks on every saved body. The saved version is the
      // only source; no template text is treated as a model result.
      const factIssues: Array<Record<string, unknown>> = [];
      const audienceLeak: Array<Record<string, unknown>> = [];
      const distinctAdvice: string[] = [];
      const missingBodies: Array<Record<string, unknown>> = [];
      for (const report of composed) {
        const body = bodyOf(report);
        if (!body) {
          missingBodies.push({ reportId: report.report_id, audience: report.audience,
            errorCode: report.body_error_code || report.body_run_error || null });
          continue;
        }
        const facts = report.facts as { projects?: Array<Record<string, unknown>> } | null;
        const factsProject = facts?.projects?.[0];
        const project = body?.projects?.[0];
        const issues: string[] = [];
        if (body.protocol !== reportCompositionProtocol) issues.push('body_protocol');
        if (!project || (body?.projects ?? []).length !== 1 || project.projectId !== fixture.projectA) issues.push('body_project');
        // The saved selection is the per-project report reference. Its own
        // factsHash binds this reference; the version hash is checked separately.
        if (String(project?.selection?.reportId) !== String(report.report_id)
          || Number(project?.selection?.revision) !== Number(report.revision)
          || String(project?.selection?.bindingId) !== String(report.binding_id)
          || String(project?.selection?.projectId) !== fixture.projectA
          || !/^[a-f0-9]{64}$/u.test(String(project?.selection?.factsHash))) issues.push('body_selection');
        const snapshot = project?.context?.snapshots?.[0]?.data?.[0] as Record<string, unknown> | undefined;
        if (String(snapshot?.name) !== fixture.projectNameA) issues.push('project_name');
        if (String(snapshot?.stageKey) !== fixture.stageKey) issues.push('stage_key');
        if (!factsProject || String(factsProject.id) !== fixture.projectA) issues.push('facts_project');
        if (String(factsProject?.name) !== fixture.projectNameA) issues.push('facts_name');
        if (String(factsProject?.stageKey) !== fixture.stageKey) issues.push('facts_stage');
        if (factsProject?.noPublishedRecords !== false) issues.push('facts_records_missing');
        const recordTexts = new Set(((factsProject?.records ?? []) as Array<Record<string, unknown>>)
          .map(record => String((record.data as Record<string, unknown>)?.completed || '')));
        if (!recordTexts.size) issues.push('facts_records_empty');
        // A section only needs a citation when this role's facts actually carry
        // a matching original. Empty pending/arrangement facts stay explicit:
        // the product adds "没有可核验的原记录引用" when the view is rendered.
        const pendingQuotes = ((factsProject?.records ?? []) as Array<Record<string, unknown>>)
          .some(record => String((record.data as Record<string, unknown>)?.pending || '').trim()
            || String((record.data as Record<string, unknown>)?.coordination || '').trim())
          || ((factsProject?.publishedRecordItems ?? []) as Array<Record<string, unknown>>)
            .some(item => String(item.pending || '').trim() || String(item.coordination || '').trim());
        const arrangementQuotes = ((factsProject?.arrangements ?? []) as unknown[]).length > 0;
        const requiresCitation = { progress: recordTexts.size > 0, pending: pendingQuotes, arrangements: arrangementQuotes };
        for (const kind of ['progress', 'pending', 'arrangements'] as const) {
          const segments = project?.sections?.[kind]?.segments ?? [];
          if (!segments.length || segments.some(segment => String(segment.text) !== serverSectionText[kind])) {
            issues.push('server_section:' + kind);
          }
          if (requiresCitation[kind] && !segments.some(segment => (segment.citations ?? []).length > 0)) {
            issues.push('citation_missing:' + kind);
          }
        }
        for (const segment of project?.sections?.progress?.segments ?? []) {
          for (const citation of segment.citations ?? []) {
            const quote = String(citation.quote || '');
            if (!quote.startsWith('本次完成：') || !recordTexts.has(quote.slice('本次完成：'.length))) {
              issues.push('progress_quote_unbound');
            }
          }
        }
        if (body?.generalAdvice !== generalReportAdviceProtocol) issues.push('general_advice_protocol');
        const advice = adviceOf(body).join('\n');
        if (/验收合格|验收通过|已验收|已付款|已结算|已批准|已完成(?!的)/u.test(advice)) issues.push('false_completion');
        if (/\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}/u.test(advice) || /\d{1,2}月\d{1,2}日/u.test(advice)) {
          issues.push('invented_date');
        }
        if (/\d/u.test(advice)) issues.push('invented_number');
        if (advice.includes(fixture.projectNameB)) issues.push('other_project');
        if (advice.includes('I7.5.0 项目经理') || advice.includes('I7.5.0 施工人员')
          || advice.includes('I7.5.0 设计师') || advice.includes('I7.5.0 老板')) issues.push('staff_identity');
        try {
          assertReportBodyCitations(body as never, [{ projectId: fixture.projectA, selection: project?.selection,
            context: project?.context, facts: factsProject }] as never);
        } catch (error) {
          issues.push('citation_invalid:' + (error as Error).message);
        }
        if (issues.length) factIssues.push({ reportId: report.report_id, audience: report.audience, issues });
        const contextText = JSON.stringify(project?.context?.sources ?? []);
        const forbidden: Record<string, string[]> = {
          customer: ['补拍卫生间照片', '请核对客厅墙砖排版与现场尺寸', 'workerTasks', 'designerReviews'],
          designer: ['补拍卫生间照片', 'workerTasks', 'missingMaterials'],
          boss: [],
          worker: ['请核对客厅墙砖排版与现场尺寸', 'designerReviews'],
        };
        const leaks = forbidden[String(report.audience)]?.filter(token => advice.includes(token)
          || (String(report.audience) === 'customer' && contextText.includes(token))) ?? [];
        if (leaks.length) audienceLeak.push({ reportId: report.report_id, audience: report.audience, leaks });
        if (roleAudiences.includes(report.audience as typeof roleAudiences[number])) {
          const picked = roleEvidence.find(item => !!item && item.audience === report.audience
            && (report.audience !== 'worker' || item.principalKey === 'admin:' + fixture.roleIds.worker));
          if (picked?.reportId === report.report_id) distinctAdvice.push(advice.replace(/\s+/gu, ''));
        }
      }
      const factsStatus: CheckStatus = factIssues.length ? 'failed' : missingBodies.length ? 'limited' : 'passed';
      check('body.facts', factsStatus,
        factsStatus === 'passed'
          ? '四端正文项目、阶段、本周记录与引用均来自同一份已保存 facts；完成事项有原记录引用，未出现虚构验收、日期或数值'
          : factsStatus === 'limited'
            ? '已生成正文均通过事实与引用校验；部分受众正文未生成，详见 body.compose'
            : '正文事实或引用校验失败，详见证据',
        { issues: factIssues, missingBodies,
          factsHashes: composed.map(row => ({ reportId: row.report_id, factsHash: row.facts_hash })) });
      check('body.role_scope', audienceLeak.length === 0 ? 'passed' : 'failed',
        audienceLeak.length === 0
          ? '业主正文不含内部事项与员工信息；施工人员不含他人任务；设计师只含本人核对项；老板不含范围外项目'
          : '角色正文出现受限信息，详见证据', { leaks: audienceLeak });
      const uniqueAdvice = new Set(distinctAdvice);
      const distinctStatus: CheckStatus = distinctAdvice.length === 4 && uniqueAdvice.size >= 3 ? 'passed' : 'limited';
      check('body.distinct', distinctStatus,
        distinctStatus === 'passed'
          ? '四端正文不是简单替换标题：模型建议基于各自角色事实且内容有差异'
          : '四端模型建议差异不足，按真实结果标记 limited',
        { roles: roleAudiences, distinct: uniqueAdvice.size, advice: distinctAdvice.map(text => text.slice(0, 200)) });

      // The product's knowledge-off report path keeps progress/pending/arrangement
      // facts server-written and asks the model only for bounded stage advice.
      check('body.model_scope', 'limited',
        '既有 knowledge-off 单一路径：四端均生成了模型建议段并保存完整正文版本；进展/待核对/安排由服务端按角色事实生成并引用，不是模型撰写的全四段正文。全四段模型正文需要企业知识库与 Embedding 环境，本轮未扩展该基础设施',
        { generalAdvice: generalReportAdviceProtocol,
          modelSections: [...new Set(composed.map(row => bodyOf(row)?.generalAdvice ?? null))] });

      const roleRead = async (role: typeof roleAudiences[number]) => {
        const binding = fixture.bindings[role];
        const actor = { enterpriseId: eid, contextVersion: binding.principal === 'user' ? fixture.ownerContextVersion : 0,
          capabilities: ['assistant.followup.self'],
          principal: binding.principal === 'user' ? { kind: 'user' as const, userId: binding.principalId }
            : { kind: 'admin' as const, adminId: binding.principalId } };
        const service = new FollowupService(actor);
        return await service.detail(binding.bindingId, binding.reportId, binding.revision) as Record<string, unknown>;
      };
      const roleReads: Record<string, Record<string, unknown>> = {};
      for (const role of roleAudiences) roleReads[role] = await roleRead(role);
      const viewOf = (detail: Record<string, unknown>) => ((detail.body as Array<Record<string, unknown>> | undefined) ?? [])
        .find(project => String(project.projectId) === fixture.projectA);
      const digestOf = (detail: Record<string, unknown>) => JSON.stringify(detail.weeklyReport ?? null);
      const readIssues: Array<Record<string, unknown>> = [];
      const readOk: Record<string, boolean> = {};
      for (const role of roleAudiences) {
        const detail = roleReads[role];
        const view = viewOf(detail);
        const digest = digestOf(detail);
        const issues: string[] = [];
        if (detail.available !== true) issues.push('unavailable');
        if (detail.contentStatus !== 'composed') issues.push('not_composed');
        if (!view) issues.push('no_project_view');
        for (const kind of ['progress', 'pending', 'arrangements'] as const) {
          if (!Array.isArray(view?.[kind]) || !(view?.[kind] as unknown[]).length) issues.push('empty:' + kind);
        }
        const standards = (view?.standards as Array<{ text?: string }> | undefined) ?? [];
        if (!standards.some(segment => String(segment.text || '').startsWith('通用建议（模型知识）：'))) {
          issues.push('no_model_advice');
        }
        if (detail.deliveryState !== 'delivered') issues.push('not_delivered');
        if (!digest.includes(fixture.projectNameA)) issues.push('digest_project');
        if (digest.includes(fixture.projectNameB)) issues.push('digest_other_project');
        if (role === 'customer') {
          if (digest.includes('补拍卫生间照片') || digest.includes('请核对客厅墙砖排版')) issues.push('customer_internal');
          if (digest.includes('workerTasks') || digest.includes('designerReviews')) issues.push('customer_role_fields');
        }
        if (role === 'worker') {
          if (!digest.includes('补拍卫生间照片')) issues.push('worker_own_task_missing');
          if (digest.includes('请核对客厅墙砖排版')) issues.push('worker_other_task');
        }
        if (role === 'designer') {
          if (!digest.includes('请核对客厅墙砖排版')) issues.push('designer_review_missing');
        }
        if (issues.length) readIssues.push({ role, reportId: fixture.bindings[role].reportId, issues });
        readOk[role] = issues.length === 0;
      }
      result.unifiedRoleReads = readOk;
      check('body.role_reads', readIssues.length === 0 ? 'passed' : 'failed',
        readIssues.length === 0
          ? '四端通过正式 FollowupService 读取：正文状态 composed，项目事实与角色投影正确，业主无内部事项，施工人员只看本人任务，设计师只看核对项，老板只看获权项目'
          : '四端正式读取存在角色或正文问题，详见证据',
        { reads: readIssues, reportIds: Object.fromEntries(roleAudiences.map(role => [role, fixture.bindings[role].reportId])) });

      const deliveryRows = await withTenantTransaction(eid, tx => rows(tx, sql`select d.report_id::text,d.revision,d.state,
        d.message_id::text,m.conversation_id::text,b.audience,d.binding_id::text
        from app.construction_report_deliveries d
        left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
        join app.construction_followup_bindings b on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
        where d.enterprise_id=${eid} order by d.event_id`));
      const deliveryIssues: string[] = [];
      for (const role of roleAudiences) {
        const binding = fixture.bindings[role];
        const delivery = deliveryRows.find(row => String(row.report_id) === binding.reportId
          && String(row.binding_id) === binding.bindingId);
        if (!delivery || delivery.state !== 'delivered' || !delivery.message_id) deliveryIssues.push(role + ':not_delivered');
        else if (String(delivery.conversation_id) !== binding.conversationId) deliveryIssues.push(role + ':wrong_conversation');
      }
      const messagesBeforeDelivery = (await counts())?.messages;
      const pilotEnv = { XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: eid,
        XIAOK_WEEKLY_REPORT_PILOT_ID: 'i750-pilot' };
      const afterBodyDelivery = await deliverConfiguredConstructionReports({ now: new Date(), env: pilotEnv });
      const messagesAfterDelivery = (await counts())?.messages;
      check('body.delivery', deliveryIssues.length === 0 && afterBodyDelivery.delivered === 0
        && Number(messagesAfterDelivery) === Number(messagesBeforeDelivery) ? 'passed' : 'failed',
        '正文生成后再次执行正式投递入口：四端既投递消息仍绑定各自会话，未产生重复消息；读取结果与当前报告版本正文一致',
        { deliveryIssues, afterBodyDelivery, messagesBeforeDelivery, messagesAfterDelivery,
          deliveries: deliveryRows.map(row => ({ reportId: row.report_id, audience: row.audience, state: row.state,
            messageId: row.message_id, conversationId: row.conversation_id })) });

      const settings = await withTenantTransaction(eid, tx => one(tx, sql`select next_daily_at,next_weekly_at
        from app.construction_report_settings where enterprise_id=${eid}`));
      const earliestDue = Math.min(new Date(String(settings!.next_daily_at)).getTime(),
        new Date(String(settings!.next_weekly_at)).getTime());
      const advanceNow = new Date(Math.min(Date.now(), earliestDue - 1000));
      const repeatAdvance = await advanceConfiguredConstructionReports({ now: advanceNow, env: pilotEnv });
      const afterCompose = await counts();
      const repeatBody = [];
      for (const report of composed) {
        if (String(report.knowledge_status) !== 'ready') continue;
        const result = await withTenantTransaction(eid, tx => enqueueReportBody(tx, eid,
          String(report.report_id), Number(report.revision)));
        repeatBody.push({ reportId: report.report_id, runId: result.runId, status: result.status,
          originalRunId: report.body_run_id });
      }
      const afterRepeat = await counts();
      const repeatDelivery = await deliverConfiguredConstructionReports({ now: new Date(), env: pilotEnv });
      const final = await counts();
      const sameCounts = (left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) =>
        JSON.stringify(left) === JSON.stringify(right);
      check('body.idempotent', repeatAdvance.queued === 0 && repeatDelivery.delivered === 0
        && repeatBody.every(item => item.status === 'ready' && String(item.runId) === String(item.originalRunId))
        && sameCounts(afterCompose, final) ? 'passed' : 'failed',
        '重复执行排期、正文入队与投递不新增报告、版本、正文任务或消息；已生成正文复用原 runId',
        { repeatAdvance, repeatDelivery, repeatBody, before, afterCompose, afterRepeat, final });
      check('body.scope_isolation', composed.every(row => !projectIdsOf(row.facts).includes(fixture.projectB))
        && composed.every(row => !JSON.stringify(row.body ?? null).includes(fixture.projectNameB))
        ? 'passed' : 'failed', '范围外项目不进入任何正文 facts、正文或角色读取',
        { outsideProject: fixture.projectB });

      result.ids.bodyCompose = {
        enterprise: eid, projectA: fixture.projectA, projectB: fixture.projectB,
        reports: evidence, firstPass, repair,
        roleReads: Object.fromEntries(roleAudiences.map(role => [role, {
          reportId: fixture.bindings[role].reportId, conversationId: fixture.bindings[role].conversationId,
          ok: readOk[role] }])),
        counts: { before, afterCompose, final }, model,
      };
    } finally {
      await restoreComposeModel(modelState, eid);
    }
  }

  await closePostgresPool();
}

main().catch(error => {
  result.error = (error as Error).stack || String(error);
  check('run.completed', 'failed', '验收脚本执行失败', { error: (error as Error).message });
}).finally(async () => {
  result.finishedAt = new Date().toISOString();
  save();
  const passed = result.checks.filter(item => item.status === 'passed').length;
  const failed = result.checks.filter(item => item.status === 'failed').length;
  const limited = result.checks.filter(item => item.status === 'limited').length;
  const notRun = result.checks.filter(item => item.status === 'not_run').length;
  console.log(JSON.stringify({ output, runId, passed, failed, limited, not_run: notRun, unified: result.unified }));
});
