/** V1-02 report follow-up04 complete natural journeys: correction continuity,
 * exact site referral, persisted reentry, revocation and HTTP503 recovery.
 * Never generates/retries report bodies and never reopens the stopped
 * plain-admission per-Q sampling loop. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { withTenantTransaction, withPlatformTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AdminUserRepository } from '@/db/repositories/admin-user-repository';
import { MiniProgramIdentityRepository } from '@/db/repositories/miniprogram-identity-repository';
import { UserRepository } from '@/db/repositories/user-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { type ActorContext } from '@/lib/assistant/contracts';
import { ConversationService, cancelRuns, appendMessage, newRun } from '@/lib/assistant/core/conversation';
import { reportNativeFinalProtocol, reportFinalFunctionCarrier, reportStructuralFinalSchema } from '@/lib/assistant/agent/report-native-final';
import { reportSourceProjectionProtocol, reportAnswerGroundingProtocol } from '@/lib/assistant/agent/report-source-scope';
import { assistantDailyLimitsEnabled } from '@/lib/assistant/core/daily-limits';
import { ConstructionService } from '@/lib/construction/service';
import { FollowupService } from '@/lib/construction/followup-service';
import { ReportContextService } from '@/lib/construction/report-context';
import { queryReportFollowups } from '@/lib/assistant/agent/report-context';
import { readReportQuestionPlan, reportHistoryScopeProtocol, reportQuestionPlanningProtocol, reportReadCompletionProtocol, reportCoordinationProtocol, reportCoordinationText } from '@/lib/assistant/agent/report-question-plan';
import { reportCoordinationAnswer } from '@/lib/assistant/agent/report-coordination';
import { safeText } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { SignJWT } from 'jose';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
assert.ok(process.argv.includes('--development'));
const configured = process.argv.includes('--configured-model');
const nativeOnly = process.argv.includes('--native-only');
assert.ok(configured || process.argv.includes('--preflight-only'));
if (nativeOnly) assert.ok(configured, 'Native-only batches reuse recorded service evidence and never re-send the service journeys');
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55434' && target.pathname === '/sfp_public_live_eval');
assert.equal(assistantDailyLimitsEnabled(), false);
const loadDriver = createRequire(import.meta.url);
const nativeDriver = path.join(root, 'tmp/public-live-package/successor05/resume01');
const { stageOwnedRuntime, restoreOwnedRuntime } = loadDriver(path.join(nativeDriver, 'stage-owned-runtime.cjs'));
const { startNativeHttp } = loadDriver(path.join(nativeDriver, 'native-http.cjs'));
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-followup-journey04/preflight-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Keep every original batch');
fs.mkdirSync(output, { recursive: true });
const nativeScript = process.argv.find(a => a.startsWith('--native-script='))?.slice(16);
if (configured) assert.ok(nativeScript, 'Bind the planned native journey scope before dispatch');
const log: Row = { startedAt: new Date().toISOString(), owner: process.env.CODEX_THREAD_ID,
  scope: 'V1-02 follow-up04 complete natural journeys on retained labelled customer61/worker63 frozen originals in isolated55434; current coordination admission only',
  mechanism: 'report-coordination-referral-v1 is bound with reportNativeFinal on every new private selected-report reply; site questions persist the exact application-owned referral after the authorized frozen read; corrections stay the user\'s own words through report-selection-history-v1; no model-authored report-fact prose, no plain-admission per-Q resampling, no knowledge-pipeline rebuild (eval DB has no knowledge tables; the knowledge branch reuses existing authorized-retrieval evidence).',
  fixedScope: { roles: ['customer', 'worker'], serviceJourneysPerRole: 2, turnsPerJourney: 2, maxServiceRuns: 8, nativeJourneyCount: 2, maxNativeRuns: 4,
    stop: 'First failed/unknown expectation, source/configuration drift or unavailable original; no sampling retries',
    serviceJourneys: [
      { role: 'customer', turns: ['我先更正一下，之前我说的开关问题是客厅的，不是卧室。现在客厅的照明回路定下来了吗？', '那这件事接下来我该找谁确认？'] },
      { role: 'customer', turns: ['我在看这周的周报，先改个口：我上次说的插座位置是主卧，不是客厅。主卧的插座现在装到哪一步了？', '装完之后我需要到场验收吗？'] },
      { role: 'worker', turns: ['这份日报我看了，先纠正一下：客户说的是A户不是B户。A户的照明回路现在能安排施工吗？', '那A户这边下一步怎么接？'] },
      { role: 'worker', turns: ['客户刚才电话里说厨房插座要往左挪一点，这样算不算确认过了？我今天能不能先开槽？', '那我先做哪一步比较稳妥？'] },
    ], nativeJourneys: [
      { role: 'customer', turns: ['我先更正一下，之前我说的开关问题是客厅的，不是卧室。现在客厅的照明回路定下来了吗？', '那这件事接下来我该找谁确认？'] },
      { role: 'worker', turns: ['这份日报我看了，先纠正一下：客户说的是A户不是B户。A户的照明回路现在能安排施工吗？', '那A户这边下一步怎么接？'] },
    ], expected: 'Exact fixed site-team referral after the authenticated frozen report read for every turn. Same-selection cross-turn continuity keeps prior originals and replies projected with corrections as the user\'s own words; no announced approval, confirmation, handoff or invented report facts. Knowledge answering stays bounded to the existing authorized-retrieval evidence because this eval database has no knowledge pipeline.' },
  checks: [], attempts: [], ownedRuns: [], modelCalls: configured ? null : 0, ingestionCalls: 0, reportBodyCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(log, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const sourceFiles = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/lib/ai', 'admin/src/db', 'admin/drizzle', 'miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
sourceFiles.push('admin/scripts/xiaok-v1-02-followup-journey04-check.ts', 'admin/scripts/xiaok-v1-02-live-followups-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
  'admin/scripts/wechatide-native-client.ts', 'admin/src/lib/platform-llm-config.ts', 'admin/.env.local', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json',
  'tmp/xiaok-vector/connection.private.json', 'tmp/wechat-devtools-version-test/window.ps1', 'tmp/v1-02-followup-journey04/inspect-saved-placement.ps1',
  'tmp/public-live-package/serve.ps1', 'tmp/public-live-package/successor05/runtime.cjs',
  'tmp/public-live-package/successor05/resume01/stage-owned-runtime.cjs', 'tmp/public-live-package/successor05/resume01/native-http.cjs',
  'tmp/public-live-package/successor05/resume01/followups-native.cjs', 'tmp/public-live-package/successor05/fixture.json',
  'tmp/public-live-package/successor05/fixture-resume03.json', 'tmp/public-live-package/successor05/isolation-restore.private.json',
  'tmp/public-live-package/successor05/resume01/coordination-configured08/report.json',
  'tmp/public-live-package/successor05/resume01/coordination-native-readback01/report.json',
  'tmp/public-live-package/successor05/resume01/coordination-next.txt', 'tmp/public-live-package/successor05/resume01/next-action.txt',
  'tmp/public-live-package/successor05/resume01/report-next-action-discriminator01.json',
  'tmp/v1-02-live-followups/discriminator.json', 'tmp/v1-02-live-followups/report-coverage-discriminator.json',
  'tmp/v1-02-followup-journey04/run-journey04.cjs', 'tmp/v1-02-followup-journey04/journey-native.cjs',
  'tmp/v1-02-followup-journey04/restore-project-baseline.cjs', 'tmp/v1-02-followup-journey04/restore-after-kill01.json',
  'tmp/v1-02-followup-journey04/restore-project-baseline01.json',
  'tmp/v1-02-followup-journey04/preflight01/report.json', 'tmp/v1-02-followup-journey04/preflight02/report.json', 'tmp/v1-02-followup-journey04/preflight03/report.json',
  'tmp/v1-02-followup-journey04/preflight04/report.json', 'tmp/v1-02-followup-journey04/configured01/report.json', 'tmp/v1-02-followup-journey04/configured02/report.json',
  'tmp/v1-02-followup-journey04/configured02/run-68.json', 'tmp/v1-02-followup-journey04/configured02/run-75.json',
  'tmp/v1-02-followup-journey04/configured03/report.json', 'tmp/v1-02-followup-journey04/configured03/native.json', 'tmp/v1-02-followup-journey04/configured03/failure.png',
  'tmp/v1-02-followup-journey04/configured04/report.json', 'tmp/v1-02-followup-journey04/configured04/native.json', 'tmp/v1-02-followup-journey04/configured04/failure.png',
  'tmp/v1-02-followup-journey04/repair-configured04b.json',
  'tmp/v1-02-followup-journey04/repair-queued-runs.cjs', 'tmp/v1-02-followup-journey04/repair-selections.cjs',
  'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md',
  'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/04-report-follow-up-v001.png',
  'design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/follow-up-v1/06-worker-follow-up-v001.png');
if (nativeScript) sourceFiles.push(path.resolve(nativeScript), 'D:/微信开发工具/微信web开发者工具/resources/app.asar', 'D:/微信开发工具/微信web开发者工具/微信开发者工具.exe');
const bind = () => Object.fromEntries([...new Set(sourceFiles)].sort().map(p => [p.replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p)) as unknown as import('node:crypto').BinaryLike).digest('hex')]));
const before = bind();
const fixturePath = path.join(root, 'tmp/public-live-package/successor05/fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const owner = new ConstructionService({ enterpriseId: eid, adminId: fixture.ownerId });
const actors: Row[] = fixture.actors.map((a: Row) => ({ ...a, contextVersion: a.name === 'customer' ? 1 : 0 }));
const actor = (a: Row): ActorContext => ({ enterpriseId: eid, principal: a.name === 'customer' ? { kind: 'user', userId: String(a.uid) } : { kind: 'admin', adminId: String(a.aid) },
  contextVersion: Number(a.contextVersion || 0), capabilities: ['assistant.followup.self', ...(a.name === 'customer' ? ['assistant.chat.self'] : [])] });
let runtimeStage: Awaited<ReturnType<typeof stageOwnedRuntime>> | undefined;
let nativeHttp: Awaited<ReturnType<typeof startNativeHttp>> | undefined;
let quotaBaseline = '0';
let release: (() => Promise<void>) | undefined, accounts: Row[] = [], projects: Row[] = [], createdUser = '';
const selections: Row[] = [];
const ownedRuns: string[] = log.ownedRuns as string[];
const accounting = () => read(async tx => ({
  providerMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
  knowledgeMax: String((await one(tx, sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id),
  unknown3753: await one(tx, sql`select status,input_tokens::text,error_code from app.assistant_knowledge_attempts where id=3753 and enterprise_id=${eid}`),
  oldHolds: await rows(tx, sql`select id::text,run_id::text,status,version,reserved_tokens::text,settled_tokens::text,settled_cost_micros::text
    from app.assistant_quota_reservations where enterprise_id=${eid} and id<=${quotaBaseline} and status='reconciling' order by id`),
}));
const config = () => read(async tx => ({
  assistant: await one(tx, sql`select enabled,knowledge_epoch,active_index_profile_id::text,md5(agent_config::text) hash from app.assistant_enterprise_settings where enterprise_id=${eid}`),
  provider: await one(tx, sql`select md5(llm_config::text) hash from app.platform_configs where key='default'`),
  policy: await one(tx, sql`select enabled,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`),
  knowledgeDocs: await rows(tx, sql`select id::text,status from app.assistant_knowledge_documents where enterprise_id=${eid} order by id`),
  reports: await rows(tx, sql`select report_id::text,run_id::text,revision,facts_hash,body_run_id::text,body_attempts,knowledge_status from app.construction_report_versions where enterprise_id=${eid} and report_id in(${actors[0].rid},${actors[1].rid}) order by report_id,revision`),
}));
async function idle() { assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in('queued','running')`)))!.n, 0); }
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (log.checks as Row[]).push({ name, passed: true, data }); return data; }
  catch (e) { (log.checks as Row[]).push({ name, passed: false, error: (e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + ((log.checks as Row[]).at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
async function denied(fn: () => Promise<unknown>) {
  await assert.rejects(fn, e => ['assistant_resource_not_found', 'identity_context_invalid', 'assistant_capability_forbidden', 'context_changed'].includes(String((e as Row).code)));
}
const selectionRevision = async (a: Row) => Number((await read(tx => one(tx, sql`select entry_snapshot->'reportContext'->>'revision' version
  from app.assistant_conversations where enterprise_id=${eid} and id=${String(a.cid)}`)))!.version);
async function inspectRun(a: Row, runId: string) {
  assert.ok(ownedRuns.includes(runId));
  const detail = await read(async tx => ({
    run: await one(tx, sql`select id::text,conversation_id::text,purpose,status,error_code,trigger_message_id::text,
      policy_snapshot->>'reportNativeFinal' report_native_final,policy_snapshot->>'reportFinalCarrier' report_final_carrier,
      policy_snapshot->>'reportFinalSchema' report_final_schema,policy_snapshot->>'reportQuestionPlanning' report_question_planning,
      policy_snapshot->>'reportReadCompletion' report_read_completion,policy_snapshot->>'reportHistoryScope' report_history_scope,policy_snapshot->>'reportCoordination' report_coordination,
      policy_snapshot->'knowledgePolicy'->>'enabled' knowledge_enabled
      from app.assistant_runs where enterprise_id=${eid} and id=${runId}`),
    steps: await rows(tx, sql`select step_seq,kind,capability_name,status,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`),
    usage: await rows(tx, sql`select category,quantity::text,cost_micros::text,currency,measurement_kind,input_tokens::text,output_tokens::text from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`),
  }));
  const file = path.join(output, 'run-' + runId + '.json');
  fs.writeFileSync(file, JSON.stringify(detail, null, 2));
  if (['queued', 'running'].includes(String(detail.run?.status))) return null;
  const messages = await new ConversationService(actor(a)).messages(String(a.cid));
  const raw = await read(tx => one(tx, sql`select id::text,content from app.assistant_messages where enterprise_id=${eid} and run_id=${runId} and author_kind='assistant' order by id desc limit 1`));
  Object.assign(detail, { messages, raw }); fs.writeFileSync(file, JSON.stringify(detail, null, 2));
  assert.equal(detail.run?.status, 'succeeded', 'Original configured-model first draft: ' + JSON.stringify(detail.run));
  assert.equal(detail.run?.report_native_final, reportNativeFinalProtocol);
  assert.equal(detail.run?.report_final_carrier, reportFinalFunctionCarrier);
  assert.equal(detail.run?.report_final_schema, reportStructuralFinalSchema);
  assert.equal(detail.run?.report_question_planning, reportQuestionPlanningProtocol);
  assert.equal(detail.run?.report_read_completion, reportReadCompletionProtocol);
  assert.equal(detail.run?.report_history_scope, reportHistoryScopeProtocol);
  assert.equal(detail.run?.report_coordination, reportCoordinationProtocol);
  assert.equal(detail.run?.knowledge_enabled, 'false', 'Knowledge stays disabled in this eval database; the enabled branch reuses prior authorized-retrieval evidence');
  const trigger = await read(tx => one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and id=${detail.run!.trigger_message_id}`));
  const reportRead = detail.steps.filter(step => step.kind === 'agent_tool' && step.capability_name === 'query_followups' && step.status === 'succeeded');
  assert.equal(reportRead.length, 1);
  const frozen = reportRead[0].private_checkpoint as Row;
  const selection = (frozen.reportReference as { selection: Parameters<typeof readReportQuestionPlan>[1]['selection'] }).selection;
  assert.equal(selection.reportId, a.rid);
  const coverage = readReportQuestionPlan(frozen.reportQuestionPlan, { enterpriseId: eid, runId, messageId: String(detail.run?.trigger_message_id),
    question: safeText(trigger!.content as Parameters<typeof safeText>[0]), selection }, true)!;
  const rendered = detail.steps.find(step => step.kind === 'agent_synthesis_context');
  assert.deepEqual((rendered?.input_summary as Row).reportCoverage, coverage);
  const modelSteps = detail.steps.filter(s => s.kind === 'agent_model');
  const selectionVersion = (trigger!.content as Row).reportContextVersion;
  assert.ok(modelSteps.every(step => {
    const binding = (step.input_summary as Row).reportPlanningBinding as Row;
    return binding?.protocol === reportQuestionPlanningProtocol && binding?.completion === reportReadCompletionProtocol
      && binding?.history === reportHistoryScopeProtocol && binding?.selectionVersion === selectionVersion && binding?.coordination === reportCoordinationProtocol;
  }));
  const checkpoint = detail.steps.find(step => step.kind === 'agent_checkpoint')!.private_checkpoint as { messages: Row[] };
  const originalIds = [...new Set(checkpoint.messages.flatMap(m => m.role === 'user' ? (m.content as Row[]).flatMap(part => {
    if (part.type !== 'text') return [];
    try { const data = JSON.parse(String(part.text)); return data.sourceMessageId ? [String(data.sourceMessageId)] : []; } catch { return []; }
  }) : []))];
  const currentBatchIds = (log.attempts as Row[]).filter(attempt => attempt.role === a.name).map(attempt => String(attempt.messageId));
  assert.deepEqual(originalIds, currentBatchIds, 'Same-selection continuity: every prior original in this selection is projected, nothing from other selections');
  assert.ok(modelSteps.length >= 1 && modelSteps.length <= 2, 'Planning can use the existing bounded unavailable-read recovery');
  assert.ok(modelSteps.every(step => (step.input_summary as Row).purpose === 'answer' && (step.input_summary as Row).finalOnly === false));
  assert.ok(detail.steps.filter(step => step.kind === 'agent_tool').every(step => step.capability_name === 'query_followups'));
  if (modelSteps.length === 2) {
    const refused = ((modelSteps[0].private_checkpoint as Row).providerOutput as Row).toolCalls as Row[];
    assert.ok(refused.length && refused.every(call => checkpoint.messages.some(m => m.role === 'tool' && m.callId === call.id && JSON.parse(String(m.content)).status === 'not_dispatched')));
  }
  const frame = (modelSteps.at(-1)!.private_checkpoint as Row).providerOutput as Row;
  assert.deepEqual((frame.toolCalls as Row[]).map(call => call.name), ['query_followups']);
  assert.equal((checkpoint as Row).finalFromTools, true);
  assert.equal(((checkpoint as Row).output as Row).text, reportCoordinationAnswer);
  assert.equal((rendered?.input_summary as Row).fixedReferral, true);
  assert.equal(detail.steps.some(step => step.kind === 'agent_report_review' || step.kind === 'agent_validation' && step.status === 'failed'), false);
  const source = detail.steps.find(s => Number(s.step_seq) === 740)?.private_checkpoint as Row | undefined;
  assert.equal((source?.snapshot as Row)?.reportAnswerGrounding, reportAnswerGroundingProtocol);
  assert.ok(raw);
  const message = messages.items.find(m => m.id === raw.id);
  assert.ok(message?.available, 'Saved referral must survive ordinary projection');
  assert.deepEqual((raw.content as Row).blocks, [{ type: 'text', text: reportCoordinationText }]);
  return { runId, messageId: raw.id, text: reportCoordinationText, source: (source?.snapshot as Row)?.reportReference, usage: detail.usage };
}
async function waitRun(a: Row, runId: string) {
  assert.ok(ownedRuns.includes(runId));
  // Native sends race the page's own settings-locked reads (coordination run55
  // recorded the same collision); wait boundedly for the REGISTERED job only.
  const deadline = Date.now() + 90000;
  let lease: Awaited<ReturnType<typeof claimJob>> = null;
  let claimAttempts = 0;
  do {
    const active = await withPlatformTransaction(tx => rows(tx, sql`select enterprise_id::text,run_id::text,status
      from app.assistant_jobs where status in('queued','running')`));
    assert.deepEqual(active, [{ enterprise_id: eid, run_id: runId, status: 'queued' }], 'Only the newly registered owned job may be queued');
    claimAttempts++;
    lease = await claimJob();
    if (!lease) await new Promise(resolve => setTimeout(resolve, 150));
  } while (!lease && Date.now() < deadline);
  assert.ok(lease, 'Owned job remained unclaimed through the bounded settings-lock wait');
  (log.claims as Row[] || (log.claims = []) as Row[]).push({ runId, attempts: claimAttempts });
  assert.equal(lease.enterpriseId, eid); assert.equal(lease.runId, runId); assert.ok(ownedRuns.includes(lease.runId));
  log.activeOwnedWorker = { runId, jobId: lease.jobId }; save();
  try { await processAssistantRun(lease); } finally { log.activeOwnedWorker = null; save(); }
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const result = await inspectRun(a, runId);
    if (result) { save(); return result; }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw Error('Original run remains unresolved; preserve unknown outcome without a retry: ' + runId);
}
async function registerRun(a: Row, runId: string, text: string, transport: string, messageId?: string) {
  assert.ok(!ownedRuns.includes(runId), 'Only first admission is registered');
  assert.ok(ownedRuns.length < 13, 'Fixed bounded scope: 8 service turns + 4 native turns');
  ownedRuns.push(runId); (log.attempts as Row[]).push({ role: a.name, runId, text, transport, messageId }); save();
}
async function sendTurn(a: Row, text: string, transport: string) {
  const revision = await selectionRevision(a);
  const key = randomUUID();
  const response = await fetch(`http://127.0.0.1:${nativeHttp!.port}/api/miniprogram/assistant/followups/${a.bid}/conversation/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, Authorization: 'Bearer ' + a.token,
      ...(a.name === 'customer' && a.entryToken ? { 'X-Assistant-Entry': String(a.entryToken) } : {}) },
    body: JSON.stringify({ clientMessageId: key, content: { version: 1, reportContextVersion: revision, blocks: [{ type: 'text', text }] } }) });
  assert.equal(response.status, 200, 'Real HTTP message send: ' + JSON.stringify(await response.clone().json().catch(() => null)));
  const payload = await response.json() as Row;
  assert.equal(payload.success, true);
  const data = payload.data as Row;
  assert.ok(data.runId && data.messageId, 'Committed send returns the run and message ids');
  await registerRun(a, String(data.runId), text, transport, String(data.messageId));
  return waitRun(a, String(data.runId));
}
async function signIdentities() {
  const staff = actors[1];
  const user = await withPlatformTransaction(async tx => {
    const account = await new AdminUserRepository(tx).findById(BigInt(String(staff.aid))); assert.ok(account);
    assert.equal(account.userId, null, 'Only the unlinked synthetic worker fixture can acquire a temporary native identity');
    const mini = new MiniProgramIdentityRepository(tx), user = await mini.ensureStaffUser(account);
    if (!accounts.find(a => a.id === staff.aid)?.user_id) createdUser = String(user.id);
    await new UserRepository(tx).update(user.id, { phone: '199' + String(user.id).padStart(8, '0') });
    assert.ok(await mini.selectContext(user.id, { mode: 'staff', staffId: BigInt(String(staff.aid)), enterpriseId: BigInt(eid) }));
    return user;
  });
  staff.uid = String(user.id); staff.contextVersion = Number(user.contextVersion);
  for (const a of actors) a.token = await new SignJWT({ sub: String(a.uid), id: String(a.uid), mode: a.name === 'customer' ? 'customer' : 'staff', role: a.name === 'customer' ? 'user' : a.role,
    ...(a.aid ? { staffId: a.aid } : {}), enterpriseId: eid, contextVersion: a.contextVersion, source: 'password' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(a.uid)).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  // Customer identities carry no persisted enterprise, so the production path
  // requires the same X-Assistant-Entry the real client always sends; mint it
  // through the real entry-context endpoint instead of hand-signing one.
  const minted = await fetch(`http://127.0.0.1:${nativeHttp!.port}/api/miniprogram/assistant/entry-context`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + actors[0].token }, body: '{}' });
  assert.equal(minted.status, 200, 'Real entry-context mint for the customer identity');
  const entry = await minted.json() as Row;
  assert.equal(entry.success, true); assert.ok((entry.data as Row)?.entryToken);
  actors[0].entryToken = (entry.data as Row).entryToken;
  return { memoryOnlyTokens: true, originalUsers: [actors[0].uid], newSyntheticStaffUser: createdUser || null, customerEntryMinted: true };
}
async function main() {
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL);
  await idle();
  runtimeStage = await stageOwnedRuntime({ configured, ownerId: fixture.ownerId, onBaseline: (state: NonNullable<typeof runtimeStage>) => { runtimeStage = state; } });
  log.runtimeStage = runtimeStage.evidence;
  quotaBaseline = String((await read(tx => one(tx, sql`select coalesce(max(id),0)::text id from app.assistant_quota_reservations where enterprise_id=${eid}`)))!.id);
  log.accountingBefore = await accounting(); log.configBefore = await config();
  assert.equal(((log.configBefore as Row).policy as Row).enabled, false);
  assert.equal(((log.configBefore as Row).knowledgeDocs as Row[]).length, 0, 'This eval database keeps no knowledge documents; the knowledge branch reuses prior evidence');
  await step('snapshot retained labelled controls and reopen only required historical context', async () => {
    accounts = await withPlatformTransaction(tx => rows(tx, sql`select id::text,username,status,user_id::text from app.admin_users where id in(${fixture.ownerId},${fixture.workerId}) order by id`));
    assert.equal(accounts.length, 2); for (const a of accounts) { assert.match(String(a.username), /^synthetic-public-live-/); assert.equal(a.status, 'active'); }
    projects = await read(tx => rows(tx, sql`select id::text,name,status,customer_access,version from app.construction_projects where enterprise_id=${eid} and id in(${actors[0].pid},${actors[1].pid}) order by id`));
    assert.equal(projects.length, 2); for (const p of projects) { assert.match(String(p.name), /^合成测试/); assert.equal(p.status, 'archived'); assert.equal(p.customer_access, false); }
    log.controlBefore = { accounts, projects }; save();
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id in(${fixture.ownerId},${fixture.workerId})`));
    for (const p of projects) await owner.execute('update', { projectId: p.id, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: true }, randomUUID());
    for (const a of actors) {
      if (a.name === 'customer') a.contextVersion = Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${String(a.uid)}`)))!.context_version);
      const context = new ReportContextService(actor(a), String(a.cid)), initial = await context.read();
      selections.push({ name: a.name, selection: initial.selected ? { bindingId: initial.selected.bindingId, reportId: initial.selected.reportId, revision: initial.selected.revision, projectId: initial.selected.projectId } : null });
      const selected = await context.select(randomUUID(), { expectedVersion: initial.version, selection: { bindingId: a.bid, reportId: a.rid, revision: a.revision, projectId: a.pid } });
      assert.equal(selected.selected?.reportId, a.rid);
      const detail = await new FollowupService(actor(a)).detail(String(a.bid), String(a.rid), 1);
      assert.ok(detail.available && detail.facts?.projects.some(p => p.id === a.pid));
      assert.equal(detail.contentStatus, 'facts_only');
      const persisted = await new ConversationService(actor(a)).detail(String(a.cid));
      assert.equal(persisted.reportContext.selected?.reportId, a.rid); a.selection = selected.selected;
    }
    return { reports: actors.map(a => ({ role: a.name, reportId: a.rid, projectId: a.pid })), frozenOriginals: true, bodyDispatch: 0, bindingsRemainStopped: true };
  });
  await step('original recipient, cross-tenant and staff private-conversation guards', async () => {
    const c = actors[0], s = actors[1];
    await denied(() => new ReportContextService(actor(c), String(s.cid)).read());
    await denied(() => new ReportContextService(actor(s), String(c.cid)).read());
    await denied(() => new ReportContextService({ ...actor(c), enterpriseId: '1455' }, String(c.cid)).read());
    return { rejected: 3, writesOrProviderCalls: 0 };
  });
  await step('rollback-only report query adapter revalidates originals, cached results and recipient scope', async () => {
    const checked: Row[] = [];
    for (const a of actors) {
      const runId = (((log.configBefore as Row).reports as Row[]).find(r => r.report_id === a.rid))!.run_id;
      const rollback = new Error('intentional_adaptor_probe_rollback');
      try {
        await read(async tx => {
          const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(a.cid)}`))!;
          const result = await queryReportFollowups(tx, actor(a), c, String(runId), 7777);
          const snapshot = result.snapshot as Row & { reportReference?: { selection: { reportId: string } } };
          assert.equal(result.questionCoverage, undefined);
          assert.deepEqual(await queryReportFollowups(tx, actor(a), c, String(runId), 7777), result);
          assert.equal(snapshot.reportReference?.selection.reportId, a.rid);
          assert.ok((snapshot.data as Row[]).every(p => p.id === a.pid));
          const other = actors.find(other => other.name !== a.name)!;
          await denied(() => queryReportFollowups(tx, actor(other), c, String(runId), 7778));
          if (a.name === 'customer') await tx.execute(sql`update app.construction_projects set customer_access=false where enterprise_id=${eid} and id=${String(a.pid)}`);
          else await tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eid} and project_id=${String(a.pid)} and admin_id=${String(a.aid)}`);
          await denied(() => queryReportFollowups(tx, actor(a), c, String(runId), 7777));
          checked.push({ role: a.name, freshAndCached: true, wrongRecipientDenied: true, cachedReadAfterRevocationDenied: true });
          throw rollback;
        });
      } catch (e) { if (e !== rollback) throw e; }
      assert.equal((await read(tx => one(tx, sql`select count(*)::int n from app.assistant_run_steps where enterprise_id=${eid} and run_id=${String(runId)} and step_seq in(7777,7778)`)))!.n, 0);
    }
    return { checked, temporaryRowsRolledBack: true, originalRunsNotResumed: true, providerCalls: 0 };
  });
  await step('rollback-only new report runs bind the coordination admission and original quota while old runs/config remain unchanged', async () => {
    const checked: Row[] = [];
    for (const a of actors) {
      const rollback = new Error('intentional_new_report_native_admission_rollback');
      let probeId: string | undefined;
      try {
        await read(async tx => {
          const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(a.cid)}`))!;
          const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
          const beforeConfig = JSON.stringify(settings.agent_config);
          const selected = (await one(tx, sql`select entry_snapshot->'reportContext'->>'revision' version from app.assistant_conversations
            where enterprise_id=${eid} and id=${String(a.cid)}`))!;
          const message = await appendMessage(tx, actor(a), String(a.cid), { author: actor(a).principal.kind, clientMessageId: randomUUID(),
            content: { version: 1, reportContextVersion: Number(selected.version), blocks: [{ type: 'text', text: '合成测试：核验新报告运行绑定，事务结束即回滚。' }] } });
          const receipt = await newRun(tx, actor(a), c, settings, String(message.id));
          probeId = receipt.runId;
          const probe = (await one(tx, sql`select policy_snapshot from app.assistant_runs where enterprise_id=${eid} and id=${probeId}`))!;
          const policy = probe.policy_snapshot as Row, agent = policy.agent as Row;
          assert.equal(policy.reportNativeFinal, reportNativeFinalProtocol);
          assert.equal(policy.reportFinalOutputTokens, 4096);
          assert.equal(policy.reportFinalCarrier, reportFinalFunctionCarrier);
          assert.equal(policy.reportFinalSchema, reportStructuralFinalSchema);
          assert.equal(policy.reportAnswerGrounding, reportAnswerGroundingProtocol);
          assert.equal(policy.reportQuestionPlanning, reportQuestionPlanningProtocol);
          assert.equal(policy.reportReadCompletion, reportReadCompletionProtocol);
          assert.equal(policy.reportHistoryScope, reportHistoryScopeProtocol);
          assert.equal(policy.reportCoordination, reportCoordinationProtocol);
          assert.equal((policy.knowledgePolicy as Row).enabled, false);
          const questions = ['合成测试当前待核对哪一步？'], args = { questions };
          await assert.rejects(() => queryReportFollowups(tx, actor(a), c, String(probeId), 7779), /invalid_message/);
          const planned = await queryReportFollowups(tx, actor(a), c, String(probeId), 7779, args);
          const scopedSnapshot = planned.snapshot;
          assert.deepEqual(planned.questionCoverage?.questions, questions);
          assert.deepEqual(await queryReportFollowups(tx, actor(a), c, String(probeId), 7779, args), planned);
          await assert.rejects(() => queryReportFollowups(tx, actor(a), c, String(probeId), 7779, { questions: ['替换已保存的原计划？'] }), /context_changed/);
          await assert.rejects(() => queryReportFollowups(tx, actor(a), c, String(probeId), 7780, args), /context_changed/);
          await denied(() => queryReportFollowups(tx, { ...actor(a), enterpriseId: '1455' }, c, String(probeId), 7779, args));
          assert.equal('reportReference' in scopedSnapshot ? scopedSnapshot.reportReference?.selection.reportId : undefined, a.rid);
          const reservation = (await one(tx, sql`select reserved_tokens::text,reserved_cost_micros::text from app.assistant_quota_reservations where enterprise_id=${eid} and run_id=${probeId}`))!;
          assert.equal(reservation.reserved_tokens, '72000');
          assert.equal(reservation.reserved_cost_micros, '1000000');
          assert.equal(JSON.stringify((await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${eid}`))!.agent_config), beforeConfig);
          assert.equal(policy.reportSourceProjection, reportSourceProjectionProtocol);
          assert.equal(agent.imageInput, true); assert.equal(agent.structuredFinal, undefined); assert.equal(agent.imageContext, undefined);
          const other = actors.find(candidate => candidate.name !== a.name)!;
          await denied(() => queryReportFollowups(tx, actor(other), c, String(probeId), 7779, args));
          if (a.name === 'customer') await tx.execute(sql`update app.construction_projects set customer_access=false where enterprise_id=${eid} and id=${String(a.pid)}`);
          else await tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eid} and project_id=${String(a.pid)} and admin_id=${String(a.aid)}`);
          await denied(() => queryReportFollowups(tx, actor(a), c, String(probeId), 7779, args));
          checked.push({ role: a.name, planBoundAndCacheRevalidated: true, changedPlanDenied: true, missingPlanDenied: true,
            tenantAndRecipientDenied: true, revocationDenied: true, newRunProtocol: policy.reportNativeFinal, coordination: policy.reportCoordination,
            reservation, knowledgeDisabled: (policy.knowledgePolicy as Row).enabled === false, enterpriseConfigurationUnchanged: true });
          throw rollback;
        });
      } catch (e) { if (e !== rollback) throw e; }
      assert.equal(await read(tx => one(tx, sql`select id from app.assistant_runs where enterprise_id=${eid} and id=${probeId!}`)), undefined);
    }
    return { checked, temporaryRowsRolledBack: true, originalRunsNotResumed: true, providerCalls: 0 };
  });
  if (!configured) { log.passed = true; return; }
  const prior = JSON.parse(fs.readFileSync(path.join(root, 'tmp/public-live-package/successor05/resume01/coordination-configured08/report.json'), 'utf8'));
  assert.equal(prior.passed, true, 'The accepted fixed 4+2 referral evidence is reused, never re-sampled');
  log.reusedPriorAcceptance = { report: 'coordination-configured08', serviceFirstDrafts: 4, nativeJourneys: 2 };
  if (nativeOnly) {
    const serviceBatch = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-followup-journey04/configured02/report.json'), 'utf8'));
    assert.equal(serviceBatch.passed, false, 'The service batch stays recorded as its original mixed outcome');
    const serviceChecks = Object.fromEntries((serviceBatch.checks as Row[]).map(check => [check.name, check.passed]));
    assert.equal(serviceChecks['two complete customer journeys with cross-turn correction continuity'], true, 'Customer service journeys pass and are reused without re-sending');
    assert.equal(serviceChecks['two complete worker journeys with cross-turn correction continuity'], true, 'Worker service journeys pass and are reused without re-sending');
    assert.equal(serviceChecks['persisted reentry readback of every journey message'], true, 'Service reentry readback is reused without re-sending');
    assert.equal((serviceBatch.drift as string[]).length, 0);
    log.reusedServiceJourneys = { report: 'configured02', runs: (serviceBatch.ownedRuns as string[]).length, stopCause: 'cross-realm empty-array assertion in the first native driver' };
    save(); console.log('SERVICE_JOURNEYS_REUSED');
  }
  await step('loopback 3019 mounts the bound production HTTP handlers', async () => {
    nativeHttp = await startNativeHttp();
    const denial = await fetch(`http://127.0.0.1:${nativeHttp.port}/api/miniprogram/assistant/followups`);
    assert.equal(denial.status, 401);
    return { host: '127.0.0.1', port: nativeHttp.port, unauthenticatedReadDenied: true };
  });
  await step('signed retained recipient identities for real HTTP sends and native input', signIdentities);
  if (!nativeOnly) {
    await step('two complete customer journeys with cross-turn correction continuity', async () => {
      const results: Row[] = [];
      for (const journey of ((log.fixedScope as Row).serviceJourneys as Row[]).filter(j => j.role === 'customer')) {
        for (const text of journey.turns as string[]) results.push(await sendTurn(actors[0], text, 'real loopback HTTP send'));
      }
      return { journeys: 2, turns: results.length, replies: results.map(r => r.text) };
    });
    await step('two complete worker journeys with cross-turn correction continuity', async () => {
      const results: Row[] = [];
      for (const journey of ((log.fixedScope as Row).serviceJourneys as Row[]).filter(j => j.role === 'worker')) {
        for (const text of journey.turns as string[]) results.push(await sendTurn(actors[1], text, 'real loopback HTTP send'));
      }
      return { journeys: 2, turns: results.length, replies: results.map(r => r.text) };
    });
    await step('persisted reentry readback of every journey message', async () => {
      const readback: Row[] = [];
      for (const a of actors) {
        const messages = await new ConversationService(actor(a)).messages(String(a.cid));
        const sent = (log.attempts as Row[]).filter(attempt => attempt.role === a.name);
        for (const attempt of sent) {
          const original = messages.items.find(m => m.id === attempt.messageId);
          assert.ok(original?.available, 'Every journey original survives reentry');
          const reply = await read(tx => one(tx, sql`select id::text,content from app.assistant_messages where enterprise_id=${eid} and run_id=${attempt.runId} and author_kind='assistant' order by id desc limit 1`));
          assert.deepEqual((reply!.content as Row).blocks, [{ type: 'text', text: reportCoordinationText }]);
          readback.push({ role: a.name, runId: attempt.runId, originalAvailable: true, replyExactReferral: true });
        }
      }
      return { readback, totalRuns: ownedRuns.length };
    });
  }
  const nativeFile = path.resolve(nativeScript!); const nativeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(nativeFile, 'utf8'), { module: nativeModule, exports: nativeModule.exports, require: createRequire(pathToFileURL(nativeFile)), console, Buffer, process, setTimeout, clearTimeout }, { filename: nativeFile });
  const native = nativeModule.exports as (context: Row) => Promise<unknown>;
  log.native = await native({ root, output, actors, nativeHttp, trials: (log.fixedScope as Row).nativeJourneys, registerRun, waitRun, idle });
  log.passed = true;
}
async function execute() {
try { await main(); }
catch (e) { log.passed = false; log.error = (e as Error).stack; process.exitCode = 1; }
finally {
  const cleanup: Row[] = [];
  const clean = async (name: string, fn: () => Promise<unknown>) => { try { cleanup.push({ name, passed: true, data: await fn() }); } catch (e) { cleanup.push({ name, passed: false, error: (e as Error).stack }); process.exitCode = 1; } save(); };
  try {
    if (release) {
      if (nativeHttp) await clean('close owned HTTP 3019 and expire one-use native tickets', () => nativeHttp!.stop());
      for (const a of actors) await clean('owned undispatched run cleanup ' + a.name, () => read(async tx => {
        for (const runId of ownedRuns) {
          const r = await one(tx, sql`select status,conversation_id::text from app.assistant_runs where enterprise_id=${eid} and id=${runId}`);
          if (r && r.conversation_id === a.cid && ['queued', 'running'].includes(String(r.status))) await cancelRuns(tx, actor(a), String(a.cid), runId, true);
        }
        return true;
      }));
      for (const saved of selections) await clean('restore explicit selection ' + saved.name, async () => {
        const a = actors.find(a => a.name === saved.name)!, service = new ReportContextService(actor(a), String(a.cid));
        const current = await service.read(); return service.select(randomUUID(), { expectedVersion: current.version, selection: saved.selection });
      });
      for (const p of projects) await clean('restore project semantic state ' + p.id, async () => {
        const current = (await owner.execute('detail', { projectId: p.id })).project as Row;
        return owner.execute('update', { projectId: p.id, expectedVersion: current.version, name: p.name, status: p.status, customerAccess: p.customer_access }, randomUUID());
      });
      if (accounts.length) await clean('restore retained account state and revoke new synthetic staff session', () => withPlatformTransaction(async tx => {
        for (const a of accounts) await tx.execute(sql`update app.admin_users set status=${a.status},user_id=${a.user_id || null} where id=${a.id}`);
        if (createdUser) await tx.execute(sql`update app.users set phone=null,context_version=context_version+1 where id=${createdUser}`);
        return { restored: accounts.map(a => a.id), newSyntheticUserRevoked: createdUser || null };
      }));
      if (log.configBefore) await clean('final configuration, original ledger and idle queue', async () => {
        await idle(); const after = await accounting(), configuration = await config();
        assert.deepEqual(configuration, log.configBefore);
        assert.deepEqual(after.oldHolds, (log.accountingBefore as Row).oldHolds);
        assert.deepEqual(after.unknown3753, (log.accountingBefore as Row).unknown3753);
        if (!configured) { assert.equal(after.providerMax, (log.accountingBefore as Row).providerMax); assert.equal(after.knowledgeMax, (log.accountingBefore as Row).knowledgeMax); }
        log.accountingAfter = after; log.configAfter = configuration;
        log.providerAttempts = await read(tx => rows(tx, sql`select id::text,assistant_run_id::text,remote_model,status,accepted,error_code,estimated_cost,actual_cost
          from app.ai_provider_attempts where enterprise_id=${eid} and ${JSON.stringify(ownedRuns)}::jsonb ? assistant_run_id::text order by id`));
        log.modelCalls = (log.providerAttempts as Row[]).length;
        const usage = await read(tx => rows(tx, sql`select coalesce(sum(input_tokens),0)::text input, coalesce(sum(output_tokens),0)::text output
          from app.assistant_usage_records where enterprise_id=${eid} and ${JSON.stringify(ownedRuns)}::jsonb ? run_id::text and category='tokens'`));
        log.tokenUsage = usage[0];
        log.controlAfter = await read(tx => rows(tx, sql`select id::text,name,status,customer_access,version from app.construction_projects where enterprise_id=${eid} and id in(${actors[0].pid},${actors[1].pid}) order by id`));
        return { queue: 0, originalUnknownAndHoldsUnchanged: true, reportBodiesAndConfigUnchanged: true };
      });
      if (runtimeStage) await clean('restore isolated runtime and disable owned provider projections', () => restoreOwnedRuntime(runtimeStage!));
    }
    const after = bind(), drift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
    fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2));
    log.drift = drift; log.cleanupChecks = cleanup; log.cleanup = cleanup.every(c => c.passed); log.finishedAt = new Date().toISOString();
    if (drift.length || !log.cleanup) { log.passed = false; process.exitCode = 1; }
    save();
  } finally { await closePostgresPool(); await release?.(); }
}
}
execute().catch(e => { console.error((e as Error).stack); process.exitCode = 1; });
