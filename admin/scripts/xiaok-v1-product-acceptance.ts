/** I7.5.0 家客来 1.0 第一期产品纵向闭环验收。
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

  // The first release acceptance covers facts, role projection and delivery,
  // not the model-authored report body. Do not leave this fixture's queued body
  // composition jobs behind for a later worker tick.
  const bodyRuns = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text run_id,j.id::text job_id
    from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
    where r.enterprise_id=${enterprise} and r.purpose='construction.report.compose'
    and r.status in ('queued','running') order by r.id`));
  for (const body of bodyRuns) {
    await withTenantTransaction(enterprise, async tx => {
      await tx.execute(sql`update app.assistant_jobs set status='cancelled',updated_at=now(),version=version+1
        where enterprise_id=${enterprise} and id=${body.job_id} and status in ('queued','running')`);
      await tx.execute(sql`update app.assistant_runs set status='cancelled',completed_at=now(),updated_at=now(),version=version+1
        where enterprise_id=${enterprise} and id=${body.run_id} and status in ('queued','running')`);
      await tx.execute(sql`update app.assistant_quota_reservations set status='released',version=version+1,updated_at=now()
        where enterprise_id=${enterprise} and run_id=${body.run_id}`);
      await tx.execute(sql`update app.construction_report_versions set knowledge_status='not_generated',body_run_id=null
        where enterprise_id=${enterprise} and body_run_id=${body.run_id} and knowledge_status='queued'`);
    });
  }
  check('report.body_composition', 'not_run',
    '四端周报 facts、角色投影、投递与幂等已验收；模型生成的 AI 正文（construction.report.compose）本轮未执行，排队任务已按本夹具取消',
    { queuedBodyRuns: bodyRuns.length });

  // ------------------------------------------------------------- unified
  result.unified = {
    reminderStatus: statusOf('reminder.stage_identified', 'reminder.policy_matched', 'reminder.facts_read',
      'reminder.generated', 'reminder.delivered', 'reminder.manager_no_inbox',
      'reminder.idempotent', 'reminder.project_paused_stops', 'reminder.scope_exit_stops'),
    knowledgeAnswerStatus: statusOf('qa.stage_answers') !== 'passed' ? 'failed'
      : modelStatus === 'passed' ? 'passed' : 'limited',
    weeklyReportStatus: statusOf('report.generation', 'report.four_audiences', 'report.facts_same_source',
      'report.role_digests', 'report.delivery', 'report.idempotent', 'report.scope_isolation'),
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
