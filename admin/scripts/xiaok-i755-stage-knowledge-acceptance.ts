/** I7.5.5 十阶段知识问答闭环验收（隔离 PG17，不连接真实 1454）。
 *
 * 通过正式 C01 链路 appendMessage → newRun → claimJob → processAnswer 验证：
 * 十个装修阶段的普通知识问题由当前阶段知识包确定性回答；项目未知/多项目歧义
 * 不猜测；会话历史链接优先于客户绑定；企业知识缺失标注通用知识，已配置时保留
 * 真实来源引用；专业问题不借用知识包。模型仅在确实需要时调用，并记录真实
 * 百炼模型 ID、请求 ID、Token 与最终结果；未配置凭据时标记 not_run，不用 Mock。
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
const connections = JSON.parse(fs.readFileSync(connectionFile, 'utf8')) as { DATABASE_URL: string };
const target = new URL(connections.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/i745_f1_accept'
  || target.username !== 'sfp_app') throw new Error('Reuse only 127.0.0.1:55432/i745_f1_accept as sfp_app');
const sourceDevelopmentUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = connections.DATABASE_URL;
delete process.env.ASSISTANT_TEXT_MODEL;

type CheckStatus = 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown';
const args = process.argv.slice(2);
const argValue = (name: string) => args.find(item => item.startsWith('--' + name + '='))?.slice(name.length + 3);
const liveModelSource = argValue('llm-source');
const model = argValue('model') || 'deepseek-v4.1-flash-1017';
const output = path.resolve(argValue('output') || path.resolve(admin, '..', 'tmp/xiaok-i755-stage-knowledge/run-' + Date.now()));
assert.ok(!fs.existsSync(path.join(output, 'result.json')), 'Retain every original outcome');
fs.mkdirSync(output, { recursive: true });
const runId = randomUUID();
const result: {
  runId: string; startedAt: string; finishedAt?: string; database: string; user: string;
  checks: Array<{ id: string; status: CheckStatus; detail: string; evidence?: unknown }>;
  unified: Record<string, CheckStatus>; ids: Record<string, unknown>; error?: string;
} = { runId, startedAt: new Date().toISOString(), database: 'i745_f1_accept', user: 'sfp_app', checks: [], unified: {}, ids: {} };
const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
const check = (id: string, status: CheckStatus, detail: string, evidence?: unknown) => {
  result.checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
  console.log(id + ': ' + status);
  save();
};

async function main() {
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one, rows } = await import('@/db/repositories/assistant-repository');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { stageAnswerForProject } = await import('@/lib/xiaok-v1/stage-answer-service');
  const { stageChatForConversation, resolveStageProject, isStageChatQuestion } = await import('@/lib/xiaok-v1/stage-chat-service');
  const { routeStageQuestion } = await import('@/lib/xiaok-v1/stage-router');
  const { stageDefinitions, constructionKeysForStage } = await import('@/lib/xiaok-v1/stages');
  const { appendMessage, newRun } = await import('@/lib/assistant/core/conversation');
  const { claimJob } = await import('@/lib/assistant/infrastructure/job-queue');
  const { processAnswer } = await import('@/lib/assistant/infrastructure/answer-worker');
  const { AssistantError } = await import('@/lib/assistant/contracts');
  const pg = (await import('pg')).default;

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    (select rolsuper from pg_roles where rolname=current_user) super,
    (select rolbypassrls from pg_roles where rolname=current_user) bypass`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept');
  assert.equal(identity.super, false);
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('construction_projects','assistant_conversations','assistant_messages','assistant_runs',
      'construction_links','assistant_enterprise_settings') order by 1`));
  check('env.pg17_rls', rls.length === 6 && rls.every(row => row.rls === true && row.forced === true) ? 'passed' : 'failed',
    '隔离 PG17 非超级用户，阶段问答相关核心表强制 RLS', { identity, rls });

  const suffix = String(Date.now());
  let phoneSeq = 760000;
  const nextPhone = () => '19977' + String(++phoneSeq);
  const enterprise = await withPlatformTransaction(async tx => {
    const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${'I7.5.5 十阶段知识问答合成企业-' + suffix},${'i755-' + suffix},'active','manual') returning id::text`);
    const eid = String(row!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${eid},true,365,100000,1000000000,1000000000)`);
    return eid;
  });
  const createUser = async (name: string) => withPlatformTransaction(async tx => String((await one(tx,
    sql`insert into app.users(enterprise_id,phone,nickname,role) values(${enterprise},${nextPhone()},${name},'user') returning id::text`))!.id));
  const createAdmin = async (role: string, name: string, index: number) => withPlatformTransaction(async tx => {
    const linked = await one(tx, sql`insert into app.users(enterprise_id,nickname,role) values(${enterprise},${name},'user') returning id::text`);
    const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password)
      values(${enterprise},${String(linked!.id)},${'i755_' + suffix + '_' + index},'i755-not-a-login-secret',${name},${role},'active',false) returning id::text`);
    return String(row!.id);
  });
  const boss = await createAdmin('enterprise_admin', 'I7.5.5 老板', 0);
  const worker = await createAdmin('construction_staff', 'I7.5.5 施工人员', 1);
  const service = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  const createProject = async (owner: string, name: string, stageKey: string) => {
    const leadId = await withTenantTransaction(enterprise, async tx => String((await one(tx, sql`insert into app.leads
      (enterprise_id,customer_user_id,name,phone,source) values(${enterprise},${owner},${name},${nextPhone()},'natural') returning id::text`))!.id));
    const pid = String((await service.execute('create', { leadId, name, managerId: boss, rooms: ['卫生间', '客厅'] }, randomUUID())).id);
    const detail = (await service.execute('detail', { projectId: pid })).project as Record<string, unknown>;
    await service.execute('progress', { projectId: pid, expectedVersion: Number(detail.version), stageKey, note: 'I7.5.5 验收：进入' + stageKey, sendReminder: false }, randomUUID());
    await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=true
      where enterprise_id=${enterprise} and id=${pid}`));
    return { pid, leadId };
  };
  const createConversation = async (owner: string, leadId: string, linkedProject?: string) => withTenantTransaction(enterprise, async tx => {
    const conversation = await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
      values(${enterprise},'customer_consultation',${JSON.stringify({ kind: 'lead', id: leadId })}::jsonb,1) returning id::text`);
    const cid = String(conversation!.id);
    await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,grant_basis)
      values(${enterprise},${cid},'user',${owner},'{"kind":"i755"}'::jsonb)`);
    if (linkedProject) await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id)
      values(${enterprise},${linkedProject},${cid}) on conflict do nothing`);
    return cid;
  });
  const turn = async (owner: string, conversationId: string, question: string) => {
    const actor = { enterpriseId: enterprise, contextVersion: 1, capabilities: [] as string[],
      principal: { kind: 'user' as const, userId: owner } };
    const message = await withTenantTransaction(enterprise, tx => appendMessage(tx, actor, conversationId, {
      author: 'user', clientMessageId: randomUUID(), purpose: 'reply', content: { version: 1, blocks: [{ type: 'text', text: question }] } }));
    const run = await withTenantTransaction(enterprise, async tx => newRun(tx, actor,
      (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${enterprise} and id=${conversationId}`))!,
      (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${enterprise}`))!, String(message.id)));
    const lease = await claimJob({ enterpriseId: enterprise, runId: String(run.runId) });
    if (lease) await processAnswer(lease);
    const finished = await withTenantTransaction(enterprise, tx => one(tx, sql`select id,status,error_code,output_message_id
      from app.assistant_runs where enterprise_id=${enterprise} and id=${String(run.runId)}`));
    const outputMessage = finished?.output_message_id ? await withTenantTransaction(enterprise, tx => one(tx, sql`select purpose,content
      from app.assistant_messages where enterprise_id=${enterprise} and id=${String(finished.output_message_id)}`)) : null;
    const attempts = await withPlatformTransaction(tx => rows(tx, sql`select provider_key,remote_model,status,duration_ms,metadata
      from app.ai_provider_attempts where assistant_run_id=${String(run.runId)} order by id`));
    const usage = await withTenantTransaction(enterprise, tx => one(tx, sql`select coalesce(sum(input_tokens),0) input,coalesce(sum(output_tokens),0) output
      from app.assistant_usage_records where enterprise_id=${enterprise} and run_id=${String(run.runId)}`));
    const text = outputMessage ? (((outputMessage.content as Record<string, unknown>).blocks as Array<{ text?: string }>) || [])
      .map(block => block.text || '').join('') : '';
    return { runId: String(run.runId), status: finished?.status, errorCode: finished?.error_code || null,
      purpose: outputMessage?.purpose || null, text, attempts, inputTokens: Number(usage?.input || 0), outputTokens: Number(usage?.output || 0) };
  };

  // ------------------------------------------------- ten-stage C01 knowledge
  const stageTurns = [];
  const stageOwners = new Map<string, { owner: string; conversation: string }>();
  for (const stage of stageDefinitions) {
    const owner = await createUser('I7.5.5 业主-' + stage.stageId);
    const key = constructionKeysForStage(stage.stageId)[0];
    const { pid, leadId } = await createProject(owner, 'I7.5.5 工地-' + stage.stageId, key);
    const conversation = await createConversation(owner, leadId, pid);
    stageOwners.set(stage.stageId, { owner, conversation });
    const question = '当前' + stage.name + '阶段需要注意什么？';
    const answer = await turn(owner, conversation, question);
    stageTurns.push({ stageId: stage.stageId, stageName: stage.name, projectId: pid, question,
      runId: answer.runId, status: answer.status, errorCode: answer.errorCode, purpose: answer.purpose,
      hasStageName: answer.text.includes(stage.name), deterministic: answer.attempts.length === 0,
      inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, answer: answer.text.slice(0, 260) });
  }
  const tenStagePassed = stageTurns.length === 10 && stageTurns.every(item => item.status === 'succeeded'
    && item.purpose === 'construction.stage_knowledge' && item.hasStageName && item.deterministic && item.inputTokens === 0);
  check('qa.ten_stage_c01', tenStagePassed ? 'passed' : 'failed',
    '十个装修阶段均通过正式 C01 对话入口由当前阶段知识包确定性回答，未调用模型',
    { stageTurns });
  check('qa.no_model_for_knowledge', tenStagePassed ? 'passed' : 'failed',
    '普通阶段知识问题不调用模型（无 provider attempt、Token 为 0）',
    { providerAttempts: stageTurns.reduce((sum, item) => sum + (item.deterministic ? 0 : 1), 0) });

  // ------------------------------------------------- unknown stage / ambiguity
  const unknownOwner = await createUser('I7.5.5 未知阶段业主');
  const unknownProject = await createProject(unknownOwner, 'I7.5.5 未知阶段工地', 'design');
  const unknownConversation = await createConversation(unknownOwner, unknownProject.leadId, unknownProject.pid);
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set current_stage_key='custom_stage'
    where enterprise_id=${enterprise} and id=${unknownProject.pid}`));
  const unknown = await turn(unknownOwner, unknownConversation, '当前阶段需要注意什么？');
  check('qa.unknown_stage_c01', unknown.status === 'succeeded' && /阶段未知|还没有可识别的装修阶段|不能猜测/u.test(unknown.text)
    && unknown.attempts.length === 0 ? 'passed' : 'failed',
    '当前项目阶段未知时明确停止，不猜测阶段或标准', { runId: unknown.runId, text: unknown.text.slice(0, 300) });

  const ambiguousOwner = await createUser('I7.5.5 多项目业主');
  const first = await createProject(ambiguousOwner, 'I7.5.5 多项目工地一', 'masonry_carpentry');
  await createProject(ambiguousOwner, 'I7.5.5 多项目工地二', 'painting');
  const ambiguousConversation = await createConversation(ambiguousOwner, first.leadId);
  const ambiguous = await turn(ambiguousOwner, ambiguousConversation, '泥木阶段需要注意什么？');
  check('qa.multi_project_ambiguity_c01', ambiguous.status === 'succeeded'
    && /多个在施项目/u.test(ambiguous.text) && ambiguous.text.includes('I7.5.5 多项目工地一')
    && ambiguous.text.includes('I7.5.5 多项目工地二') && ambiguous.attempts.length === 0 ? 'passed' : 'failed',
    '多项目歧义时列出项目并请用户选择，不猜测阶段', { runId: ambiguous.runId, text: ambiguous.text.slice(0, 320) });

  // The conversation's original project link wins even when the customer also
  // has another accessible project (project switching / historical session).
  const linkedConversation = await createConversation(ambiguousOwner, first.leadId, first.pid);
  const linkedResolution = await withTenantTransaction(enterprise, tx =>
    resolveStageProject(tx, enterprise, linkedConversation, ambiguousOwner));
  const linkedTurn = await turn(ambiguousOwner, linkedConversation, '泥木阶段需要注意什么？');
  check('qa.project_link_precedence', linkedResolution.status === 'resolved'
    && linkedResolution.project.id === first.pid && linkedResolution.project.current_stage_key === 'masonry_carpentry'
    && linkedTurn.status === 'succeeded' && linkedTurn.text.includes('泥木')
    ? 'passed' : 'failed', '历史会话的项目链接优先于多项目回退，项目切换不串阶段',
    { resolution: linkedResolution.status === 'resolved' ? linkedResolution.project : linkedResolution,
      turn: { runId: linkedTurn.runId, status: linkedTurn.status, text: linkedTurn.text.slice(0, 200) } });

  // ------------------------------------------------- enterprise knowledge
  const masonryOwner = stageOwners.get('masonry')!;
  const missing = await turn(masonryOwner.owner, masonryOwner.conversation, '铺砖前需要准备什么？');
  check('qa.enterprise_knowledge_missing', missing.status === 'succeeded' && /本次未核实企业施工标准/u.test(missing.text)
    && /通用装修常识/u.test(missing.text) && missing.attempts.length === 0 ? 'passed' : 'failed',
    '企业知识未配置时明确标注通用知识，不冒充企业标准', { runId: missing.runId, text: missing.text.slice(0, 260) });

  const cited = await withTenantTransaction(enterprise, tx => stageChatForConversation({
    tx, enterpriseId: enterprise, conversationId: masonryOwner.conversation, userId: masonryOwner.owner,
    actor: { enterpriseId: enterprise, contextVersion: 1, capabilities: [], principal: { kind: 'user', userId: masonryOwner.owner } },
    knowledgeEpoch: 1, question: '铺砖前需要准备什么？',
    enterpriseKnowledge: async () => ({ status: 'available', items: [{ sourceId: 'K-I755-1',
      title: 'I7.5.5 企业泥木工艺（合成）', quote: '铺贴前按企业书面工艺核对材料批次与现场条件。' }] }),
  }));
  check('qa.enterprise_knowledge_citations', !!cited && cited.includes('I7.5.5 企业泥木工艺（合成）')
    && cited.includes('铺贴前按企业书面工艺核对材料批次与现场条件。') && !cited.includes('本次未核实企业施工标准')
    ? 'passed' : 'failed', '企业知识可用时保留真实来源标题与原句，不降级成通用知识', { answer: cited?.slice(0, 320) });

  // ------------------------------------------------- specialist handoff / permission
  const deep = routeStageQuestion({ constructionStageKey: 'utilities', message: '卫生间闭水试验要怎么做？' });
  check('qa.specialist_handoff_routing', deep.kind === 'specialist' && deep.domain === 'waterproof'
    && !isStageChatQuestion('卫生间闭水试验要怎么做？') ? 'passed' : 'failed',
    '深度专业问题不借用阶段知识包，保留既有防水专业 Agent 路由', { route: deep });

  const otherOwner = await createUser('I7.5.5 权限隔离业主');
  const ownerActor = (userId: string) => ({ enterpriseId: enterprise, contextVersion: 1, capabilities: [] as string[],
    principal: { kind: 'user' as const, userId } });
  let ownerDenied = false;
  try { await stageAnswerForProject(ownerActor(otherOwner), { projectId: first.pid, question: '泥木阶段注意什么？' }); }
  catch (error) { ownerDenied = error instanceof AssistantError && error.code === 'construction_not_found'; }
  const workerActor = { enterpriseId: enterprise, contextVersion: 1, capabilities: ['assistant.chat.self'],
    principal: { kind: 'admin' as const, adminId: worker } };
  let workerDenied = false;
  try { await stageAnswerForProject(workerActor, { projectId: first.pid, question: '泥木阶段注意什么？' }); }
  catch (error) { workerDenied = error instanceof AssistantError && ['construction_forbidden', 'construction_not_found'].includes(error.code); }
  check('qa.permission_isolation', ownerDenied && workerDenied ? 'passed' : 'failed',
    '非本人业主与未授权施工人员不能读取他人项目的阶段知识', { ownerDenied, workerDenied });

  // ------------------------------------------------- real model only when needed
  let modelStatus: CheckStatus = 'not_run';
  let modelEvidence: Record<string, unknown> = { reason: 'bailian_credentials_not_configured' };
  let llmConfigured = false;
  const isolatedLlm = await withPlatformTransaction(tx => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
  const llmBefore: unknown = isolatedLlm?.llm_config ?? null;
  try {
    let sourceConfig: Record<string, unknown> | null = null;
    if (liveModelSource === 'development') {
      assert.ok(sourceDevelopmentUrl && new URL(sourceDevelopmentUrl).pathname === '/smart_floor_planner',
        '--llm-source=development requires the development DATABASE_URL');
      const dev = new pg.Client({ connectionString: sourceDevelopmentUrl });
      await dev.connect();
      try {
        await dev.query('begin read only');
        sourceConfig = (await dev.query("select llm_config from app.platform_configs where key='default'")).rows[0]?.llm_config ?? null;
        await dev.query('rollback');
      } finally { await dev.end(); }
    } else if (isolatedLlm?.llm_config && Object.keys(isolatedLlm.llm_config as object).length) {
      sourceConfig = isolatedLlm.llm_config as Record<string, unknown>;
    }
    const profiles = (sourceConfig?.profiles ?? {}) as Record<string, Record<string, unknown>>;
    const profile = profiles.dashscope
      ?? Object.values(profiles).find(item => item?.apiKeyEncrypted && /dashscope|bailian/iu.test(String(item.baseUrl || '')));
    if (!sourceConfig || !profile?.apiKeyEncrypted) {
      modelEvidence = { reason: 'bailian_credentials_not_configured' };
    } else {
      const next = { ...sourceConfig, ...profile, providerKey: 'dashscope', model, enabled: true,
        profiles: { ...profiles, dashscope: { ...profile, model, enabled: true } } };
      await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(next)}::jsonb where key='default'`));
      await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.assistant_enterprise_settings
        set agent_config=${JSON.stringify({ runtime: 'langgraph-v1', providerKey: 'dashscope', model, imageInput: false,
          tools: true, probeVersion: 'i755-stage-knowledge-v1', enterpriseKnowledgeEnabled: false })}::jsonb
        where enterprise_id=${enterprise}`));
      llmConfigured = true;
      const modelTurn = await turn(masonryOwner.owner, masonryOwner.conversation, '工地现在有照片或记录吗？');
      const attempts = modelTurn.attempts.map(attempt => {
        const metadata = attempt.metadata as Record<string, unknown> | null;
        return { providerKey: attempt.provider_key, modelId: attempt.remote_model, status: attempt.status,
          durationMs: attempt.duration_ms,
          requestId: metadata?.providerRequestId || (metadata?.requestDiagnostic as Record<string, unknown> | undefined)?.requestId || null };
      });
      const recorded = attempts.length > 0 && attempts.every(item => item.modelId === model)
        && modelTurn.inputTokens > 0 && modelTurn.outputTokens > 0;
      modelStatus = recorded ? 'passed' : 'limited';
      modelEvidence = { model, turn: { runId: modelTurn.runId, status: modelTurn.status, errorCode: modelTurn.errorCode,
        purpose: modelTurn.purpose, inputTokens: modelTurn.inputTokens, outputTokens: modelTurn.outputTokens,
        attempts, answer: modelTurn.text.slice(0, 400) },
        requestIdNote: '百炼当前 Chat Completions 回执未返回请求 ID；attempt 已记录 provider、模型、状态与耗时',
        detail: recorded ? '真实百炼调用已记录模型 ID、Token 与结果；请求 ID 由供应商决定，本次未回传' : '真实调用已尝试但未记录完整用量' };
    }
  } catch (error) {
    modelStatus = 'failed';
    modelEvidence = { reason: 'real_model_turn_failed', error: (error as Error).message };
  } finally {
    if (llmConfigured) {
      try {
        await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(llmBefore ?? {})}::jsonb where key='default'`));
      } catch (error) {
        check('cleanup.llm_config', 'failed', '隔离库平台模型配置恢复失败', { error: (error as Error).message });
      }
    }
  }
  check('qa.real_model_turn', modelStatus, modelStatus === 'passed'
    ? '仅项目事实问题调用真实百炼 deepseek-flash，记录模型 ID、Token 与结果；供应商未回传请求 ID'
    : modelStatus === 'not_run' ? '未配置真实百炼凭据，真实模型调用未执行（不使用 Mock 冒充）'
      : '真实百炼调用结果已记录但未完全通过，详见证据', modelEvidence);

  const stageKnowledgePassed = ['qa.ten_stage_c01', 'qa.no_model_for_knowledge', 'qa.unknown_stage_c01',
    'qa.multi_project_ambiguity_c01', 'qa.project_link_precedence', 'qa.enterprise_knowledge_missing',
    'qa.enterprise_knowledge_citations', 'qa.specialist_handoff_routing', 'qa.permission_isolation']
    .every(id => result.checks.find(item => item.id === id)?.status === 'passed');
  result.unified = {
    knowledgeAnswerStatus: stageKnowledgePassed ? 'passed' : 'failed',
    deterministicStageLoop: stageTurns.every(item => item.deterministic) ? 'passed' : 'failed',
    enterpriseKnowledgeStatus: result.checks.find(item => item.id === 'qa.enterprise_knowledge_citations')?.status === 'passed'
      && result.checks.find(item => item.id === 'qa.enterprise_knowledge_missing')?.status === 'passed' ? 'passed' : 'failed',
    modelOnlyWhenNeeded: modelStatus,
  };
  result.ids.fixture = { enterprise, boss, worker, stages: [...stageOwners.entries()].map(([stageId, value]) => ({ stageId, ...value })) };
  check('unified.knowledge_answer', result.unified.knowledgeAnswerStatus,
    '十阶段知识问答闭环是否真正解除 limited', result.unified);

  result.finishedAt = new Date().toISOString();
  save();
  await closePostgresPool();
}

main().catch(async error => {
  result.error = (error as Error).stack || (error as Error).message;
  result.finishedAt = new Date().toISOString();
  save();
  console.error(error);
  const { closePostgresPool } = await import('@/lib/postgresql');
  await closePostgresPool();
  process.exitCode = 1;
});
