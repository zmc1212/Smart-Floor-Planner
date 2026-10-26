/** Opt-in configured-model evidence run for designer recommendations.
 * Requires PORTFOLIO_DESIGNER_LIVE_TRIAL=1 and the isolated evaluation database.
 * The persisted provider is read from the development database only to reuse its
 * credentials; the trial imports a tool-capable model on the same provider into
 * the evaluation settings for the duration of the run and restores the prior row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { decryptText } from '@/lib/crypto';
import { PortfolioService } from '@/lib/portfolio/service';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { savePlatformLlmConfig } from '@/lib/platform-llm-config';
import type { ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const TRIAL_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const TRIAL_LABEL = (process.env.PORTFOLIO_DESIGNER_TRIAL_LABEL || 'first').replace(/[^a-z0-9-]/gi, '');
const prefix = 'designer-trial-' + randomUUID();
let tenantId = '';
let userId = '';
let adminId = '';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readDevelopmentProvider() {
  const connectionString = process.env.DATABASE_URL?.trim() || '';
  const url = new URL(connectionString);
  assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Development database is required to read provider credentials');
  assert(url.port === '5432' && url.pathname === '/smart_floor_planner', 'Development provider source must be loopback:5432/smart_floor_planner');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query('select llm_config from app.platform_configs where key = $1', ['default']);
    const config = result.rows[0]?.llm_config as Row | undefined;
    assert(config?.enabled === true, 'Development platform model is not enabled');
    assert(config.providerKey === 'siliconflow', 'Trial expects the configured SiliconFlow provider');
    assert(String(config.baseUrl).startsWith('https://api.siliconflow.cn'), 'Trial expects the configured SiliconFlow base URL');
    return {
      providerKey: String(config.providerKey), baseUrl: String(config.baseUrl), model: String(config.model),
      apiKey: decryptText(String(config.apiKeyEncrypted || '')),
    };
  } finally { await client.end(); }
}

async function buildFixtures() {
  const image = (await sharp({ create: { width: 480, height: 360, channels: 3, background: '#dfe7dc' } }).png().toBuffer()).toString('base64');
  const portrait = (await sharp({ create: { width: 320, height: 400, channels: 3, background: '#cdd8cf' } }).png().toBuffer()).toString('base64');
  await withPlatformTransaction(async tx => {
    const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status,professional_designer_title,professional_default_experience_years)
      values(${prefix},${prefix},'active','主创设计师',8) returning id`))!;
    tenantId = String(enterprise.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${tenantId},true,1000,12000000,1000000000,30,${JSON.stringify({ runtime: 'langgraph-v1', model: TRIAL_MODEL, providerKey: 'siliconflow', imageInput: true, tools: true, probeVersion: 'designer-live-trial-v1' })}::jsonb)`);
    const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;
    userId = String(user.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
    const admin = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${tenantId},${prefix + '-manager'},'test-only','enterprise_admin','active',false,'试点企业管理员') returning id`))!;
    adminId = String(admin.id);
  });
  const manager = new PortfolioService({ enterpriseId: tenantId, adminId });
  type DesignerSpec = { name: string; cityCode: string; cityName: string; style: string; layout: string; portrait?: boolean; tours?: number; profileStyles?: string[]; profileLayouts?: string[] };
  const specs: DesignerSpec[] = [
    { name: '林清禾', cityCode: '330100', cityName: '杭州市', style: '原木风', layout: '三居', portrait: true, tours: 2, profileStyles: ['原木风', '现代简约'], profileLayouts: ['三居'] },
    { name: '周屿', cityCode: '330100', cityName: '杭州市', style: '原木风', layout: '三居', tours: 1, profileStyles: ['原木风'], profileLayouts: ['三居'] },
    { name: '沈知远', cityCode: '330100', cityName: '杭州市', style: '原木风', layout: '三居', profileStyles: ['原木风'], profileLayouts: ['三居', '四居及以上'] },
    { name: '陆晚', cityCode: '330100', cityName: '杭州市', style: '原木风', layout: '三居', profileStyles: ['原木风'], profileLayouts: ['三居'] },
    { name: '许一白', cityCode: '330100', cityName: '杭州市', style: '现代简约', layout: '三居', profileStyles: ['现代简约'], profileLayouts: ['三居'] },
    { name: '苏棠', cityCode: '510100', cityName: '成都市', style: '奶油风', layout: '两居', portrait: true, tours: 1, profileStyles: ['奶油风'], profileLayouts: ['两居'] },
    { name: '顾言', cityCode: '510100', cityName: '成都市', style: '奶油风', layout: '两居', profileStyles: ['奶油风'], profileLayouts: ['两居'] },
  ];
  const designers: Array<{ authorId: string; workId: string; name: string }> = [];
  for (const [index, spec] of specs.entries()) {
    const author = (await withPlatformTransaction(tx => one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name,professional_title,professional_title_visible,professional_career_start_year)
      values(${tenantId},${prefix + '-d' + index},'test-only','designer','active',false,${spec.name},'主创设计师',true,${2012 + index}) returning id`)))!;
    const authorId = String(author.id);
    const service = new PortfolioService({ enterpriseId: tenantId, adminId: authorId });
    const created = await service.execute('create', {}, randomUUID());
    const workId = String(created.id);
    const upload = await service.execute('upload', { workId, expectedVersion: 1, imageBase64: image }, randomUUID());
    const tours = Array.from({ length: spec.tours || 0 }, (_, tourIndex) => ({
      url: `https://my.matterport.com/show/?m=${prefix}-${index}-${tourIndex}`, provider: '', title: '隔离试点3D看房',
    }));
    const content = {
      title: `${spec.cityName}${spec.layout}${spec.style}公开作品`, description: '隔离试点合成作品，仅用于验证推荐链路与真实服务读取。',
      primaryStyle: spec.style, secondaryStyles: [], cityCode: spec.cityCode, cityName: spec.cityName, district: spec.cityCode === '330100' ? '西湖区' : '武侯区',
      communityId: null, area: 118, rooms: spec.layout === '两居' ? '2室2厅' : '3室2厅', layoutTypes: [spec.layout], authorRole: '主创设计',
      source: '隔离试点合成图片，不是实际客户案例', authorization: '试点合成内容，作者授权展示与推荐',
      rightsUntil: null, highlights: ['客餐厅一体动线', '收纳与采光兼顾'], materials: ['白橡木饰面', '浅色岩板'],
      palette: [{ name: '暖木', hex: '#c8a97e' }, { name: '米白', hex: '#f2ede4' }],
      tours, images: [{ assetId: String(upload.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '试点合成效果图', space: '客厅' }],
      coverAssetId: String(upload.assetId), showOnProfile: true, recommendable: true,
    };
    await service.execute('save', { workId, expectedVersion: 1, content }, randomUUID());
    const detail = await service.execute('detail', { workId }) as { work: { version: number } };
    await service.execute('submit', { workId, expectedVersion: Number(detail.work.version) }, randomUUID());
    const submitted = await service.execute('detail', { workId }) as { work: { version: number } };
    await manager.execute('publish', { workId, expectedVersion: Number(submitted.work.version) }, randomUUID());
    await service.execute('saveProfile', { authorId, expectedVersion: 0, content: {
      bio: `${spec.name}，专注${spec.style}${spec.layout}的居住设计。`, cities: [{ code: spec.cityCode, name: spec.cityName, districts: [] }],
      styles: spec.profileStyles || [spec.style], layoutSpecialties: spec.profileLayouts || [spec.layout], featuredWorkIds: [workId],
    } }, randomUUID());
    if (spec.portrait) await service.execute('savePortrait', { authorId, imageBase64: portrait, consent: true }, randomUUID());
    designers.push({ authorId, workId, name: spec.name });
  }
  return designers;
}

async function runTrial(label: string, customer: ActorContext, turns: string[]) {
  const chat = new ConversationService(customer);
  const conversationId = String((await chat.create(randomUUID())).id);
  const observed: Row[] = [];
  for (const text of turns) {
    const sent = await chat.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
    const lease = await claimJob();
    assert(lease && lease.runId === sent.runId, 'Queued run could not be claimed');
    let error: string | null = null;
    try { await processAgentAnswer(lease); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    const run = await chat.run(lease.runId);
    const storedRun = await withTenantTransaction(customer.enterpriseId, tx => one(tx, sql`select status,error_code,output_message_id
      from app.assistant_runs where enterprise_id=${customer.enterpriseId} and id=${lease.runId}`));
    const steps = await withTenantTransaction(customer.enterpriseId, tx => rows(tx, sql`select step_seq,kind,capability_name,status,private_checkpoint,input_summary
      from app.assistant_run_steps where enterprise_id=${customer.enterpriseId} and run_id=${lease.runId} order by step_seq`));
    const models = steps.filter(step => step.kind === 'agent_model').map(step => ({
      seq: String(step.step_seq), status: step.status,
      toolCalls: ((step.private_checkpoint as Row)?.toolCalls as Row[] || []).map(call => ({ name: String(call.name), arguments: call.arguments })),
      text: String(((step.private_checkpoint as Row)?.text as string) || '').slice(0, 800),
      activeTools: ((step.input_summary as Row)?.activeToolNames as string[] || []),
      errorCode: step.error_code || null,
    }));
    const designerReads = steps.filter(step => step.capability_name === 'designers.search.v1').map(step => ({
      seq: String(step.step_seq), snapshot: step.private_checkpoint,
    }));
    const finalSnapshot = steps.filter(step => step.kind === 'agent_designer_result').map(step => ({ seq: String(step.step_seq), snapshot: step.private_checkpoint }));
    const messages = await chat.messages(conversationId);
    const output = messages.items.find(message => message.id === String(storedRun?.output_message_id || run.outputMessageId));
    observed.push({ text, runStatus: String(storedRun?.status || run.status), errorCode: storedRun?.error_code || null, thrown: error, models, designerReads, finalSnapshot,
      replyText: output ? JSON.stringify(output.content) : null, replyDesigners: output?.designerRecommendation ?? null });
  }
  return { label, conversationId, turns: observed };
}

async function main() {
  assert(process.env.PORTFOLIO_DESIGNER_LIVE_TRIAL === '1', 'Explicit PORTFOLIO_DESIGNER_LIVE_TRIAL=1 flag required');
  const development = await readDevelopmentProvider();
  const connection = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
  const evaluationUrl = new URL(connection.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(evaluationUrl.hostname) && evaluationUrl.port === '55432' && evaluationUrl.pathname === '/xiaok_embedding_eval',
    'Isolated evaluation database required');
  process.env.DATABASE_URL = connection.DATABASE_URL;
  await closePostgresPool();
  const release = await lockAssistantAcceptance();
  const evidence: Row & { trials: unknown[] } = { startedAt: new Date().toISOString(), configuredProvider: development.providerKey,
    persistedModel: development.model, trialModel: TRIAL_MODEL, developmentModelToolProbe:
      'SiliconFlow rejected function calling for the persisted model: "Function call is not supported for this model." (400/code 20037)',
    fixtures: {}, trials: [] };
  let prior: unknown = null;
  try {
    prior = await withPlatformTransaction(async tx => (await one(tx, sql`select llm_config from app.platform_configs where key='default'`))?.llm_config ?? null);
    await savePlatformLlmConfig({ enabled: true, providerKey: development.providerKey, baseUrl: development.baseUrl, model: TRIAL_MODEL, apiKey: development.apiKey });
    const designers = await buildFixtures();
    evidence.fixtures = { tenantId, designers, worksPublished: designers.length, hangzhouYuanmuSanju: 4, chengduNaiyouLiangju: 2 };
    const customer: ActorContext = { enterpriseId: tenantId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
    const trialA = await runTrial('A-complete-preferences', customer, ['我在杭州，想找擅长原木风三居、有真实作品的设计师。']);
    evidence.trials.push(trialA);
    fs.writeFileSync(path.resolve(`../tmp/xiaok-vector/designer-trials-${TRIAL_LABEL}-a.json`), JSON.stringify(evidence, null, 2));
    const trialB = await runTrial('B-gradual-clarification', customer, ['想找一位设计师，我比较喜欢奶油风。', '在成都，两居也可以看看。']);
    evidence.trials.push(trialB);
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.resolve(`../tmp/xiaok-vector/designer-trials-${TRIAL_LABEL}.json`), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ evidence: `tmp/xiaok-vector/designer-trials-${TRIAL_LABEL}.json`, trials: evidence.trials }, null, 2));
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(path.resolve(`../tmp/xiaok-vector/designer-trials-${TRIAL_LABEL}.json`), JSON.stringify(evidence, null, 2));
    throw error;
  } finally {
    try {
      if (tenantId) await withPlatformTransaction(async tx => {
        await deletePortfolioData(tx, BigInt(tenantId)); await deleteAssistantData(tx, BigInt(tenantId));
        await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenantId}`);
        await tx.execute(sql`delete from app.enterprises where id=${tenantId}`);
      });
      if (userId) await withPlatformTransaction(tx => tx.execute(sql`delete from app.users where id=${userId}`));
      await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs set llm_config=${prior ? JSON.stringify(prior) : null}::jsonb where key='default'`));
    } finally { await closePostgresPool(); await release(); }
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'designer trial failed'); process.exitCode = 1; });
