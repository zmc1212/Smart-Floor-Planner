/** Labelled development fixtures; two fixed configured-model resubmission trials, real HTTP and Stable controls. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { parseSiteDraft, siteDraftOutput } from '@/lib/construction/site-contract';
import { siteMessageIntent } from '@/lib/construction/site-queries';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { getPlatformLlmRuntimeConfig } from '@/lib/platform-llm-config';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';

type NativeItem = { message: { id: string }; record: { id: string; status: string; room_id?: string; resubmission_of_id?: string; original_record_id?: string; review_requirements?: string; canResubmit?: boolean; canPublish?: boolean; label?: string; run_status?: string; error_code?: string; data?: { completed?: string; pending?: string } } };
type NativeVersion = { record_id: string; media_ids: string[]; originalText: string };
type NativeState = { items: NativeItem[]; sheet: string; versions: NativeVersion[]; versionsLoading: boolean; resubmit: { id: string } | null; attachments: string[]; busy: boolean; pending?: unknown; conflict?: unknown; error: string; fatal: boolean; mediaPaths: Record<string,string>; pendingRetakeCount: number; scrollTarget: string };
type NativeElement = { tap: () => Promise<void>; input: (value: string) => Promise<void>; text: () => Promise<string>;
  size: () => Promise<{ width: string; height: string }>; offset: () => Promise<Row>; attribute: (name: string) => Promise<string>; outerWxml: () => Promise<string>;
  scrollTo: (x: number, y: number) => Promise<void> };
type NativePage = { id: number; $: (selector: string) => Promise<NativeElement>; $$: (selector: string) => Promise<NativeElement[]>;
  data: { (): Promise<NativeState>; <K extends keyof NativeState>(key: K): Promise<NativeState[K]> } };
type NativeHarness = { mp: { evaluate: <A,R>(fn: (value: A) => R, value?: A) => Promise<Awaited<R>>; redirectTo: (url: string) => Promise<unknown> };
  step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; identity: (index: number) => Promise<NativePage>; open: () => Promise<NativePage>; current: () => Promise<NativePage>;
  capture: (name: string) => Promise<Row>; waitFor: <T>(fn: () => Promise<T | null | undefined | false>, label: string) => Promise<T> };
declare const wx: { env: { USER_DATA_PATH: string }; getFileSystemManager: () => { writeFileSync: (path: string, data: string, encoding: string) => void; unlinkSync: (path: string) => void }; chooseMedia: (options: { success: (result: { tempFiles: {tempFilePath: string; size: number}[] }) => void }) => void };
declare const getApp: () => { __qaShared: { previewed: string[]; requests: { path: string; status: number }[] } };

const root = path.resolve('..'), output = path.resolve(process.env.CONSTRUCTION_REWORK_OUTPUT || path.join(root, 'tmp/construction-retake-20261028/native'));
fs.mkdirSync(output, { recursive: true }); loadEnvConfig(process.cwd(), true);
const isolated = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = isolated.DATABASE_URL;
const runLabel = 'construction-rework-' + new Date().toISOString().replace(/[:.]/g, '-');
const ledgerFile = path.join(root, 'tmp/agent-contract/trial-' + runLabel + '.json');
const prefix = 'synthetic-rework-' + randomUUID(), users: string[] = [], staff: string[] = [], identities: Row[] = [];
const boundFiles = ['admin/src/lib/construction/site-chat.ts','admin/src/lib/construction/site-worker.ts','admin/src/lib/construction/site-http.ts',
  'admin/src/lib/construction/site-contract.ts','admin/src/db/construction-schema.ts','admin/drizzle/0098_construction_record_rework.sql',
  'admin/src/lib/construction/site-publications.ts','admin/src/lib/assistant/core/conversation.ts','admin/src/lib/assistant/infrastructure/job-queue.ts',
  'admin/src/lib/ai/postgres-workflow-chat.ts','admin/src/lib/ai/providers/agent-chat.ts','admin/src/lib/assistant/agent/config.ts',
  'miniprogram/packages/construction/chat/chat.js','miniprogram/packages/construction/chat/chat.wxml','miniprogram/packages/construction/chat/chat.less',
  'miniprogram/packages/construction/chat/site-client.js','admin/scripts/construction-rework-native.ts','admin/scripts/construction-rework-native.mjs','admin/scripts/construction-chat-native.mjs',
  'admin/.env.local','admin/package.json','admin/package-lock.json','miniprogram/project.config.json','miniprogram/project.private.config.json'];
boundFiles.push('admin/tsconfig.json','admin/src/lib/auth.ts','admin/src/lib/miniprogram-jwt.ts',
  'admin/src/lib/construction/service.ts','admin/src/lib/construction/contracts.ts','admin/src/db/transaction.ts',
  'admin/src/db/repositories/assistant-repository.ts','miniprogram/utils/api.js',
  path.relative(root,'D:/微信开发工具/微信web开发者工具/wechatide.cmd'),
  path.relative(root,'D:/微信开发工具/微信web开发者工具/resources/app.asar.unpacked/js/common/cli/skill-index.js'));
const helperPath = process.env.CONSTRUCTION_REWORK_NATIVE_HELPER;
const replayImpactPath = process.env.CONSTRUCTION_REWORK_REPLAY_IMPACT;
if (replayImpactPath) {
  boundFiles.push(path.relative(root, replayImpactPath), 'tmp/construction-retake-20261028/service-08/report.json');
}
const replayPath = process.env.CONSTRUCTION_REWORK_REPLAY_FIRST;
if (replayPath) boundFiles.push(path.relative(root, replayPath), path.relative(root, path.join(path.dirname(replayPath), 'native.json')));
const replaySecondPath = process.env.CONSTRUCTION_REWORK_REPLAY_SECOND;
if (replaySecondPath) {
  assert.ok(replayPath, 'Second replay requires the first actual trial');
  boundFiles.push(path.relative(root, replaySecondPath), path.relative(root, path.join(path.dirname(replaySecondPath), 'native.json')));
}
if (helperPath) boundFiles.push(path.relative(root, helperPath));
if (process.env.CONSTRUCTION_REWORK_WINDOW_PREPARE) boundFiles.push(path.relative(root, process.env.CONSTRUCTION_REWORK_WINDOW_PREPARE));
boundFiles.push('tmp/wechat-devtools-version-test/window.ps1','tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator/package.json',
  'admin/scripts/bailian-review-test-runtime.ts','admin/scripts/assistant-review-budget.ts');
if (process.env.CONSTRUCTION_REWORK_SERVER) boundFiles.push(path.relative(root, process.env.CONSTRUCTION_REWORK_SERVER));
const binding = () => Object.fromEntries(boundFiles.map(f => [f, createHash('sha256').update(fs.readFileSync(path.resolve(root, f))).digest('hex')]));
type Call = { id: string; runId: string; status: string; reservedTokens: number; usage?: {total_tokens: number} };
const calls: Call[] = [];
const report: Row = { started: new Date().toISOString(), prefix, before: binding(), calls, scope: replaySecondPath
  ? 'Final review/history/revocation using explicitly mapped saved outputs from both actual fixed Qwen trials. No model calls.' : replayPath
  ? 'Remaining second fixed Qwen trial; first successful trial is an explicitly mapped saved-output fixture, not another model call. Isolated55432 HTTP/Worker.'
  : 'Two fixed Qwen resubmission trials; original draft is a labelled fixture. Isolated55432 HTTP/Worker, not physical camera or production.' };
const requirementsList = ['请补拍书房底盒全景和连接处近照，要看清底盒位置。','请再补拍底盒固定后的近照和周围线管全景。'];
const firstReportText = '底盒的位置补拍清楚了，还没有固定，请设计师核对。';
const secondReportText = '底盒今天固定好了，按要求补拍了，面板还没装。';
const save = () => { fs.writeFileSync(path.join(output, 'driver.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(ledgerFile, JSON.stringify(report, null, 2)); };
function verifyReplayBinding(prior: Row) {
  const previous = prior.after as Row, now = binding();
  // Check every original production dependency, even when the continuation adds
  // bindings. Saved provider checkpoints do not certify later publication code.
  const production = Object.keys(previous).filter(f => f.startsWith('admin/src/') || f.startsWith('miniprogram/'));
  const changed = production.filter(f => previous[f] !== now[f]);
  if (!changed.length) return changed;
  assert.deepEqual(changed, ['admin/src/lib/construction/site-publications.ts'], 'Only the separately audited notification change may reuse saved draft fixtures');
  assert.ok(replayImpactPath, 'Changed publication code requires a recorded impact check and current service evidence');
  const impact = JSON.parse(fs.readFileSync(replayImpactPath, 'utf8')) as Row;
  assert.equal(impact.file, changed[0]); assert.equal(impact.priorHash, previous[changed[0]]); assert.equal(impact.currentHash, now[changed[0]]);
  assert.equal(impact.reuse, 'saved-provider-output-as-labelled-fixture-only');
  assert.equal(impact.serviceEvidence, 'tmp/construction-retake-20261028/service-08/report.json');
  const evidence = JSON.parse(fs.readFileSync(path.join(root, String(impact.serviceEvidence)), 'utf8')) as Row;
  assert.equal(evidence.exitCode, 0); assert.deepEqual(evidence.drift, []);
  assert.equal((evidence.after as Row)['src/lib/construction/site-publications.ts'], now[changed[0]]);
  return changed;
}
let eid = '', pid = '', originalId = '', release: (() => Promise<void>) | undefined;
let restoreRuntime: (() => Promise<unknown>) | undefined, stopServer: (() => Promise<void>) | undefined;
let retained: RetainedReviewHold[] = [];
function holds() {
  return ['tmp/anythingllm-pilot','tmp/agent-comparison','tmp/agent-diagnosis','tmp/agent-contract'].flatMap(dir => fs.readdirSync(path.join(root,dir)).filter(f => /^trial-.*\.json$/.test(f))
    .flatMap(f => (JSON.parse(fs.readFileSync(path.join(root,dir,f),'utf8')).calls || []) as Call[]).filter(c => c.status !== 'succeeded').map(c => ({id:c.id,runId:c.runId,reservedTokens:c.reservedTokens})));
}
async function main() {
  assert.ok(process.argv.includes('--development'));
  assert.equal(process.env.CONSTRUCTION_REWORK_ENV_READY, '1', 'Start through construction-rework-native.mjs to preload module-scoped JWT/crypto bindings');
  const db = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(db.hostname)); assert.equal(db.port, '55432'); assert.equal(db.pathname, '/xiaok_embedding_eval');
  const { lockAssistantAcceptance } = await import('./assistant-acceptance-safety.mjs');
  release = await lockAssistantAcceptance(isolated.DATABASE_URL, { waitForLock: true });
  const pinned = await bindBailianReviewTestRuntime(root, ledgerFile); restoreRuntime = pinned.restore; report.runtime = pinned.receipt;
  retained = holds(); report.budgetBefore = reviewBudget(root).usedMicros; reviewBudget(root).assertReservation(0, 32000, retained);
  assert.equal(Number((await withPlatformTransaction(tx => one(tx, sql`select count(*) n from app.assistant_jobs where status in ('queued','running')`)))!.n), 0, 'Development queue must be idle');
  const runtime = await getPlatformLlmRuntimeConfig();
  assert.equal(runtime.providerKey, 'dashscope'); assert.equal(new URL(runtime.baseUrl).origin, 'https://dashscope.aliyuncs.com');
  report.platformConfigBefore = createHash('sha256').update(JSON.stringify((await withPlatformTransaction(tx => one(tx, sql`select llm_config from app.platform_configs where key='default'`)))?.llm_config)).digest('hex');
  const agent = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash', tools: true, imageInput: true, probeVersion: 'construction-rework-fixed-v1' };
  await withPlatformTransaction(async tx => {
    eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 施工补拍',${prefix},'active') returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${eid},true,10,100000,20000000,30,${JSON.stringify(agent)}::jsonb)`);
    for (let i = 0; i < 4; i++) {
      const uid = String((await one(tx, sql`insert into app.users(nickname,phone,context_version) values(${prefix+i},${'139'+String(Date.now()).slice(-6)+String(i).padStart(2,'0')},1) returning id`))!.id); users.push(uid);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix+i})`);
      if (i < 3) staff.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${uid},${prefix+i},'unusable-synthetic',${['enterprise_admin','designer','construction_staff'][i]},'active',false,${['合成负责人','合成设计师','合成师傅'][i]}) returning id`))!.id));
    }
  });
  report.fixture = { enterpriseId: eid, users, staff }; save();
  for (const [i, role] of (['enterprise_admin','designer','construction_staff'] as const).entries()) identities.push({ enterpriseId: eid, adminId: staff[i], role,
    token: await signMiniProgramToken({ sub: users[i], id: users[i], mode: 'staff', role, staffRole: role, staffId: staff[i], enterpriseId: eid, contextVersion: 1, source: 'phone' }) });
  const leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${users[3]},'合成补拍业主','13800000000','natural') returning id`)))!.id);
  const manager = new ConstructionService({ enterpriseId: eid, adminId: staff[0] });
  pid = String((await manager.execute('create', { leadId, name: '合成书房补拍工地', managerId: staff[0], rooms: ['书房'] }, randomUUID())).id);
  const version = async () => Number(((await manager.execute('detail', { projectId: pid })).project as Row).version);
  for (const i of [1,2]) await manager.execute('member', { projectId: pid, expectedVersion: await version(), adminId: staff[i], role: i === 1 ? 'designer' : 'worker', active: true, workLabel: '' }, randomUUID());
  const worker = new SiteChatService({ enterpriseId: eid, adminId: staff[2] });
  for (let i = 0; i < 3; i++) await new SiteChatService({ enterpriseId:eid, adminId:staff[i], miniProgramUserId:users[i], miniProgramContextVersion:1 }).authorize(pid);
  report.signedIdentityPreflight = { passed: true, count: 3, contract: 'Live staff/user association, nonempty phone, context version and construction authority; no permission guard bypass' };
  const shared = await worker.read(pid), roomId = String((shared.rooms as Row[])[0].id);
  const image = async (color: string) => sharp(Buffer.from(`<svg width="320" height="240"><rect width="320" height="240" fill="${color}"/><path d="M20 160H170V70H270" fill="none" stroke="#71867b" stroke-width="12"/><rect x="155" y="55" width="38" height="38" fill="#ddd" stroke="#304b3f" stroke-width="4"/><text x="18" y="220" font-size="18">Synthetic fixture</text></svg>`)).png().toBuffer();
  const firstPhoto = String((await worker.upload(pid, randomUUID(), await image('#eee4d0'))).id);
  await withTenantTransaction(eid, async tx => {
    const message = await appendMessage(tx, worker.actor, String(shared.conversationId), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: '书房线管铺好了，底盒还没固定。这是合成前置记录。' }] } });
    originalId = String((await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data,room_id,room_name_snapshot)
      values(${eid},${pid},${String(shared.conversationId)},${String(message.id)},${staff[2]},'draft',${JSON.stringify({ title: '合成书房现场记录', roomId, completed: '线管铺好', pending: '底盒还没固定', coordination: '', note: '合成前置草稿，非模型生成。' })}::jsonb,${roomId},'书房') returning id`))!.id);
    await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${eid},${pid},${originalId},${firstPhoto},0)`);
  });
  let initialRecordId = originalId;
  if (replayPath) {
    const prior = JSON.parse(fs.readFileSync(replayPath, 'utf8')) as Row;
    const native = JSON.parse(fs.readFileSync(path.join(path.dirname(replayPath), 'native.json'), 'utf8')) as Row;
    assert.ok((native.checks as Row[]).some(c => c.name === 'round1 worker reentry sees requirements and submits new protected photos' && c.passed));
    const replayDrift = verifyReplayBinding(prior);
    const run = (prior.runs as Row[])[0]; assert.equal(run.status, 'succeeded');
    const saved = run.private_checkpoint as ModelTurnOutput;
    const priorItems = (prior.workerReentry as Row).items as { record: Row }[];
    const priorRooms = [...new Set(priorItems.map(i => String(i.record.room_id || '')).filter(Boolean))];
    const data = { ...parseSiteDraft(siteDraftOutput(saved), priorRooms), roomId };
    const savedPhoto = String((await worker.upload(pid, randomUUID(), await image('#c6d4e1'))).id);
    initialRecordId = await withTenantTransaction(eid, async tx => {
      const parent = (await one(tx, sql`update app.construction_site_records set status='changes_requested',review_requirements=${requirementsList[0]},
        returned_by=${staff[0]},returned_at=now(),version=version+1 where enterprise_id=${eid} and id=${originalId} returning *`))!;
      await recordVersion(tx, eid, parent, staff[0], 'request_changes');
      const message = await appendMessage(tx, worker.actor, String(shared.conversationId), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
        content: { version: 1, blocks: [{ type: 'text', text: firstReportText }] } });
      const child = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,
        resubmission_of_id,original_record_id,review_requirements,returned_by,returned_at,room_id,room_name_snapshot)
        values(${eid},${pid},${String(shared.conversationId)},${String(message.id)},${staff[2]},${originalId},${originalId},${requirementsList[0]},${staff[0]},now(),${roomId},'书房') returning *`))!;
      await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${eid},${pid},${String(child.id)},${savedPhoto},0)`);
      await recordVersion(tx, eid, child, staff[2], 'submitted');
      const draft = (await one(tx, sql`update app.construction_site_records set status='draft',data=${JSON.stringify(data)}::jsonb,version=version+1
        where enterprise_id=${eid} and id=${String(child.id)} returning *`))!;
      await recordVersion(tx, eid, draft, staff[2], 'organized');
      const linked = (await one(tx, sql`update app.construction_site_records set version=version+1 where enterprise_id=${eid} and id=${originalId} returning *`))!;
      await recordVersion(tx, eid, linked, staff[2], 'resubmit');
      return String(child.id);
    });
    report.reusedFirstTrial = { source: path.relative(root, replayPath), runId: String(run.id),
      outputHash: createHash('sha256').update(JSON.stringify(saved)).digest('hex'), fixtureOnly: true, providerDispatched: false,
      productionDrift: replayDrift, impact: replayImpactPath ? path.relative(root, replayImpactPath) : null, mappedOriginalId: originalId, mappedSubmissionId: initialRecordId };
  }
  if (replaySecondPath) {
    const prior = JSON.parse(fs.readFileSync(replaySecondPath, 'utf8')) as Row;
    const native = JSON.parse(fs.readFileSync(path.join(path.dirname(replaySecondPath), 'native.json'), 'utf8')) as Row;
    assert.ok((native.checks as Row[]).some(c => c.name === 'round2 worker reentry sees requirements and submits new protected photos' && c.passed));
    const replayDrift = verifyReplayBinding(prior);
    const run = (prior.runs as Row[])[0]; assert.equal(run.status, 'succeeded');
    const saved = run.private_checkpoint as ModelTurnOutput;
    const priorItems = (prior.workerReentry as Row).items as { record: Row }[];
    const priorRooms = [...new Set(priorItems.map(i => String(i.record.room_id || '')).filter(Boolean))];
    const data = { ...parseSiteDraft(siteDraftOutput(saved), priorRooms), roomId };
    const savedPhoto = String((await worker.upload(pid, randomUUID(), await image('#d9e8e0'))).id);
    const previousId = initialRecordId;
    initialRecordId = await withTenantTransaction(eid, async tx => {
      const parent = (await one(tx, sql`update app.construction_site_records set status='changes_requested',review_requirements=${requirementsList[1]},
        returned_by=${staff[0]},returned_at=now(),version=version+1 where enterprise_id=${eid} and id=${previousId} returning *`))!;
      await recordVersion(tx, eid, parent, staff[0], 'request_changes');
      const message = await appendMessage(tx, worker.actor, String(shared.conversationId), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
        content: { version: 1, blocks: [{ type: 'text', text: secondReportText }] } });
      const child = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,
        resubmission_of_id,original_record_id,review_requirements,returned_by,returned_at,room_id,room_name_snapshot)
        values(${eid},${pid},${String(shared.conversationId)},${String(message.id)},${staff[2]},${previousId},${originalId},${requirementsList[1]},${staff[0]},now(),${roomId},'书房') returning *`))!;
      await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${eid},${pid},${String(child.id)},${savedPhoto},0)`);
      await recordVersion(tx, eid, child, staff[2], 'submitted');
      const draft = (await one(tx, sql`update app.construction_site_records set status='draft',data=${JSON.stringify(data)}::jsonb,version=version+1
        where enterprise_id=${eid} and id=${String(child.id)} returning *`))!;
      await recordVersion(tx, eid, draft, staff[2], 'organized');
      const linked = (await one(tx, sql`update app.construction_site_records set version=version+1 where enterprise_id=${eid} and id=${previousId} returning *`))!;
      await recordVersion(tx, eid, linked, staff[2], 'resubmit');
      return String(child.id);
    });
    report.reusedSecondTrial = { source: path.relative(root, replaySecondPath), runId: String(run.id),
      outputHash: createHash('sha256').update(JSON.stringify(saved)).digest('hex'), fixtureOnly: true, providerDispatched: false,
      productionDrift: replayDrift, impact: replayImpactPath ? path.relative(root, replayImpactPath) : null, mappedOriginalId: originalId, mappedSubmissionId: initialRecordId };
  }
  report.fixture = { ...(report.fixture as Row), projectId: pid, originalId }; save();
  if (process.env.CONSTRUCTION_REWORK_SERVER) {
    const server = await import(pathToFileURL(process.env.CONSTRUCTION_REWORK_SERVER).href);
    const started = await server.start(root, output, { databaseUrl: isolated.DATABASE_URL, projectId: pid, token: identities[0].token });
    stopServer = started.stop; report.server = { port: started.port, target: 'loopback:55432/xiaok_embedding_eval' };
  }
  if (process.env.CONSTRUCTION_REWORK_WINDOW_PREPARE) {
    const prepare = await import(pathToFileURL(process.env.CONSTRUCTION_REWORK_WINDOW_PREPARE).href);
    report.window = await prepare.prepare(root, output);
  }
  const helper = helperPath ? await import(pathToFileURL(helperPath).href) : await import('./construction-chat-native.mjs');
  assert.equal((report.server as Row)?.port, 3112, 'Retake native checks require the owned isolated service');
  report.native = await helper.run({ root, output, projectId: pid, identities, apiOrigin: 'http://localhost:3112', refreshWithCli: true, verifyWorkerHttp: true, recordPreview: true, exercise: async ({ mp, step, identity, open, capture, waitFor, current }: NativeHarness) => {
    const element = async (selector: string) => waitFor(async () => {
      try { return await (await current()).$(selector); }
      catch (error) { if (/Cannot read properties of undefined \(reading 'id'\)/.test((error as Error).message)) return null; throw error; }
    }, 'rendered control: ' + selector);
    const locate = (selector: string, id: string) => element(`#source-${id} ${selector}`);
    let recordId = initialRecordId;
    for (const [round, requirements] of requirementsList.entries()) {
      if (replaySecondPath) continue;
      if (replayPath && round === 0) continue;
      await identity(0);
      await step(`round${round+1} manager enters required retake instructions`, async () => {
        const p = await current(), item = (await p.data('items')).find(i => i.record.id === recordId)!;
        await (await locate('.request-changes', item.message.id)).tap();
        await waitFor(async () => await p.data('sheet') === 'request_changes', 'return sheet');
        await (await p.$('.requirements-input')).input(requirements);
        await (await p.$('.confirm-changes')).tap();
        await waitFor(async () => (await p.data('items')).some(i => i.record.id === recordId && i.record.status === 'changes_requested'), 'persisted return');
        return capture('returned-'+round);
      });
      // Later acknowledgements are labelled history fixtures, not model trials
      // or evidence that real time passed. They must not consume the retake.
      assert.notEqual(siteMessageIntent('收到', 0), 'report');
      for (let i = 0; i < 2; i++) assert.equal((await worker.send(pid, { text: '收到', mediaIds: [] }, randomUUID())).runId, null);
      await identity(2);
      await step(`round${round+1} worker reentry sees requirements and submits new protected photos`, async () => {
        let p = await current(); const state = await p.data();
        report.workerReentry = { round, recordId, items: state.items.map(i => ({ messageId: i.message?.id, record: i.record })),
          pendingRetakeCount: state.pendingRetakeCount, capture: await capture('worker-before-' + round) }; save();
        const item = state.items.find(i => i.record?.id === recordId); assert.ok(item, 'Returned original must remain visible on worker reentry');
        assert.equal(item.record.review_requirements, requirements); assert.equal(item.record.canResubmit, true);
        assert.equal(await p.data('pendingRetakeCount'), 1);
        await (await element('.view-retake')).tap();
        await waitFor(async () => await p.data('scrollTarget') === 'source-' + item.message.id, 'recipient retake location');
        await (await locate('.begin-resubmit', item.message.id)).tap();
        await waitFor(async () => (await p.data('resubmit'))?.id === recordId, 'selected retake composer');
        const bytes = await image(round ? '#d9e8e0' : '#c6d4e1');
        await mp.evaluate((b: string) => { const filePath = wx.env.USER_DATA_PATH + '/synthetic-retake.png';
          wx.getFileSystemManager().writeFileSync(filePath, b, 'base64');
          wx.chooseMedia = o => o.success({ tempFiles: [{ tempFilePath: filePath, size: 10000 }] });
        }, bytes.toString('base64'));
        await (await p.$('.add-photo')).tap();
        await waitFor(async () => (await p.data('attachments')).length === 1 && !await p.data('busy'), 'real upload');
        await mp.evaluate(() => wx.getFileSystemManager().unlinkSync(wx.env.USER_DATA_PATH + '/synthetic-retake.png'));
        await (await p.$('.composer-input')).input(round ? secondReportText : firstReportText);
        await open(); p = await current(); assert.equal((await p.data('resubmit'))!.id, recordId); assert.equal((await p.data('attachments')).length, 1);
        reviewBudget(root).assertReservation(0, 16000, retained);
        const call: Call = {id:runLabel+':'+round,runId:'pending-native-round:'+round,status:'reserved',reservedTokens:16000}; calls.push(call); save();
        await (await p.$('.send')).tap();
        const child = await waitFor(async () => { const d = await (await current()).data(); if (d.error && !d.busy) throw Error(d.error);
          const failed = d.items.find(i => i.record.resubmission_of_id === recordId && ['failed','cancelled'].includes(i.record.run_status || ''));
          if (failed) throw Error('Site draft organization failed: ' + failed.record.error_code);
          return d.items.find(i => i.record.resubmission_of_id === recordId && i.record.status === 'draft'); }, 'fixed real Qwen resubmission trial');
        assert.equal(child.record.original_record_id, originalId); assert.equal(child.record.canPublish, false); assert.equal(child.record.label, '待复审');
        assert.equal(child.record.room_id, roomId, 'Explicit original selection retains the known room without repeating its name');
        assert.match(child.record.data?.pending || '', round ? /面板/ : /底盒/);
        if (round) { assert.match(child.record.data?.completed || '', /底盒/); assert.match(child.record.data?.completed || '', /固定/); }
        const usage = await withTenantTransaction(eid, tx => one(tx, sql`select u.run_id::text,u.input_tokens,u.output_tokens,u.measurement_kind from app.assistant_usage_records u
          join app.construction_site_records r on r.enterprise_id=u.enterprise_id and r.run_id=u.run_id where r.enterprise_id=${eid} and r.id=${child.record.id} order by u.id desc limit 1`));
        assert.ok(usage && usage.measurement_kind === 'observed'); call.runId = String(usage.run_id); call.status = 'succeeded'; call.usage = {total_tokens:Number(usage.input_tokens)+Number(usage.output_tokens)}; save();
        const old = recordId; recordId = child.record.id;
        await open(); assert.ok((await (await current()).data('items')).some(i => i.record.id === recordId && i.record.resubmission_of_id === old));
        return { recordId, capture: await capture('resubmitted-'+round) };
      });
    }
    await identity(0);
    await step('manager reviews latest submission and can read every original/photo in the same version sheet', async () => {
      const p = await current(), item = (await p.data('items')).find(i => i.record.id === recordId)!;
      await (await locate('.record-actions .primary', item.message.id)).tap(); await waitFor(async () => await (await current()).data('sheet') === 'publish', 'review sheet');
      // Existing sheetOpen starts after20ms and animates for240ms. Measure the
      // settled sheet before comparing actual control bounds.
      await new Promise(resolve => setTimeout(resolve, 350));
      const ready = await current(), sheet = await element('.sheet'), sheetOffset = await sheet.offset(), sheetSize = await sheet.size();
      report.reviewProbe = { pageBefore: p.id, pageNow: ready.id, sheet: await ready.data('sheet'),
        direct: (await ready.$$('.sheet > .primary')).length, descendant: (await ready.$$('.sheet .primary')).length,
        sheetOffset, sheetSize, controls: [], capture: await capture('review-selector-probe') };
      fs.writeFileSync(path.join(output, 'review-sheet.wxml'), await sheet.outerWxml()); save();
      const controls = [];
      for (const button of await ready.$$('button')) {
        controls.push({ button, text: (await button.text()).trim(), offset: await button.offset(), size: await button.size(), disabled: await button.attribute('disabled') });
        (report.reviewProbe as Row).controls = controls.map(c => ({ text: c.text, offset: c.offset, size: c.size, disabled: c.disabled })); save();
      }
      const matches = controls.filter(c => c.text === '核对并发布' && Number(c.size.width) > 0 && Number(c.size.height) > 0
        && Number(c.offset.top) >= Number(sheetOffset.top) - 2 && Number(c.offset.top) + Number(c.size.height) <= Number(sheetOffset.top) + Number(sheetSize.height) + 2);
      (report.reviewProbe as Row).targetCount = matches.length; save();
      assert.equal(matches.length, 1, 'Confirm only a unique visible publish button inside the actual review sheet');
      const state = await (await current()).data(); assert.equal(state.busy, false); assert.ok(!state.pending && !state.conflict);
      assert.notEqual(matches[0].disabled, 'true');
      await matches[0].button.tap();
      await waitFor(async () => (await (await current()).data('items')).some(i => i.record.id === recordId && i.record.status === 'published'), 'reviewed publication');
      await open();
      assert.equal((await (await current()).data('items')).find(i => i.record.id === recordId)?.record.status, 'published', 'Reviewed publication persists on reentry');
      report.reviewPublication = { recordId, status: 'published', persistedReentry: true }; save();
      await (await locate('.record-links .text-button', item.message.id)).tap();
      const versions = await waitFor(async () => { const d = await (await current()).data(); return d.sheet === 'versions' && !d.versionsLoading && d.versions; }, 'chain versions');
      assert.ok(versions.some(v => v.record_id === originalId)); assert.equal(new Set(versions.map(v => v.record_id)).size, 3);
      assert.ok(versions.some(v => v.originalText === firstReportText));
      assert.ok(versions.some(v => v.originalText === secondReportText));
      const originals = [...new Map(versions.filter(v => v.media_ids?.length).map(v => [v.record_id, v])).values()];
      assert.equal(originals.length, 3, 'All three generations retain their own photos');
      const previews = [];
      for (const original of originals) {
        const mediaId = original.media_ids[0];
        const body = await element('.sheet-body'); await body.scrollTo(0, 0);
        await waitFor(async () => (await (await current()).data('mediaPaths'))[mediaId], 'history photo bytes for ' + mediaId);
        const photos = await (await current()).$$('.sheet .photo-slot');
        let photo: NativeElement | undefined;
        for (const candidate of photos) if (String(await candidate.attribute('data-id')) === mediaId) { photo = candidate; break; }
        assert.ok(photo, 'History contains the photo control for ' + mediaId);
        const bodyOffset = await body.offset(), photoOffset = await photo.offset();
        await body.scrollTo(0, Math.max(0, Number(photoOffset.top) - Number(bodyOffset.top) - 12));
        await waitFor(async () => { const offset = await photo.offset(), size = await photo.size(), bodySize = await body.size();
          return Number(offset.top) >= Number(bodyOffset.top) - 2 && Number(offset.top) + Number(size.height) <= Number(bodyOffset.top) + Number(bodySize.height) + 2;
        }, 'visible history photo control');
        await mp.evaluate(() => { getApp().__qaShared.previewed = []; });
        await photo.tap();
        const preview = await waitFor(async () => mp.evaluate(id => {
          const state = getApp().__qaShared;
          return state.previewed.length === 1 && state.requests.some(r => r.path.endsWith('/media/' + id) && r.status === 200)
            ? { mediaId: id, displayed: true, privateRead: true } : null;
        }, mediaId), 'actual protected history photo preview');
        previews.push({ recordId: original.record_id, ...preview, capture: await capture('history-' + original.record_id) });
      }
      report.historyPreviews = previews; save();
      return { previews, capture: await capture('chain-review') };
    });
    await identity(2);
    await step('removed worker loses the shared conversation and photos on reentry', async () => {
      await manager.execute('member', { projectId: pid, expectedVersion: await version(), adminId: staff[2], role: 'worker', active: false, workLabel: '' }, randomUUID());
      await mp.redirectTo('/packages/construction/chat/chat?projectId='+pid);
      await waitFor(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length; }, 'revoked worker');
      return { cleared: true };
    });
  } });
  report.runs = await withTenantTransaction(eid, tx => rows(tx, sql`select r.id::text,r.status,r.error_code,s.private_checkpoint from app.assistant_runs r
    left join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id and s.step_seq=1100 where r.enterprise_id=${eid} order by r.id`));
  report.attempts = await withTenantTransaction(eid, tx => rows(tx, sql`select a.id::text,a.status,a.remote_model,to_jsonb(a)->'metadata' as metadata from app.ai_provider_attempts a where enterprise_id=${eid} order by id`));
  assert.equal((report.runs as Row[]).length, replaySecondPath ? 0 : replayPath ? 1 : 2); assert.ok((report.runs as Row[]).every(r => r.status === 'succeeded'));
  report.passed = true;
}
main().catch(e => { report.error = e.message; report.errorStack = e.stack; console.error(e.stack || e.message); process.exitCode = 1; }).finally(async () => {
  try {
    await stopServer?.();
    if (eid) {
      report.runs = await withTenantTransaction(eid, tx => rows(tx, sql`select r.id::text,r.status,r.error_code,s.private_checkpoint from app.assistant_runs r
        left join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id and s.step_seq=1100 where r.enterprise_id=${eid} order by r.id`));
      report.attempts = await withTenantTransaction(eid, tx => rows(tx, sql`select a.id::text,a.status,a.remote_model,to_jsonb(a)->'metadata' as metadata from app.ai_provider_attempts a where enterprise_id=${eid} order by id`));
      report.usage = await withTenantTransaction(eid, tx => rows(tx, sql`select run_id::text,measurement_kind,input_tokens,output_tokens from app.assistant_usage_records where enterprise_id=${eid} order by id`));
      const runs = report.runs as Row[], attempts = report.attempts as Row[], usage = report.usage as Row[];
      for (const [index,call] of [...calls].entries()) if (call.status !== 'succeeded') {
        const run = runs[index], observed = run && usage.find(u => u.run_id === run.id);
        if (observed?.measurement_kind === 'observed') { call.status = 'succeeded'; call.runId = String(run.id); call.usage = {total_tokens:Number(observed.input_tokens)+Number(observed.output_tokens)}; }
        else if (!run || !attempts.some(a => (a.metadata as Row)?.runId === run.id) && !await withTenantTransaction(eid, tx => one(tx, sql`select id from app.assistant_jobs where enterprise_id=${eid} and run_id=${String(run.id)} and provider_started_at is not null`))) {
          if (!Array.isArray(report.notDispatched)) report.notDispatched = [];
          (report.notDispatched as Row[]).push({...call,reason:'No provider attempt or provider-start marker; unexecuted reservation released'}); calls.splice(calls.indexOf(call),1);
        } else call.status = 'unknown';
      }
      await withPlatformTransaction(async tx => {
        await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
        await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`);
        for (const uid of users) { await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`); }
      }); report.cleaned = true;
    }
    if (report.platformConfigBefore) {
      report.platformConfigAfter = createHash('sha256').update(JSON.stringify((await withPlatformTransaction(tx => one(tx, sql`select llm_config from app.platform_configs where key='default'`)))?.llm_config)).digest('hex');
      assert.equal(report.platformConfigBefore, report.platformConfigAfter);
    }
  } catch (e) { report.cleanupError = (e as Error).message; process.exitCode = 1; }
  finally { try { if (restoreRuntime) { report.runtimeRestore = await restoreRuntime(); report.runtimeRestored = true; } } catch (e) { report.restoreError = (e as Error).message; process.exitCode = 1; } }
  report.after = binding(); report.drift = boundFiles.filter(f => (report.before as Row)[f] !== (report.after as Row)[f]);
  if ((report.drift as string[]).length) process.exitCode = 1;
  report.finished = new Date().toISOString(); report.budgetAfter = reviewBudget(root).usedMicros; save(); await closePostgresPool(); await release?.();
});
