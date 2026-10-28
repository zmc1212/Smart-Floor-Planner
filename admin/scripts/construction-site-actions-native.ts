/* eslint-disable @typescript-eslint/no-explicit-any -- Stable SDK and recorded synthetic DTOs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { GET as constructionHttp } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { cancelRuns, ConversationService } from '@/lib/assistant/core/conversation';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { nativeFinalProtocol } from '@/lib/assistant/agent/native-final';
import { parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { customerMaterialReviews, customerSiteResults } from '@/lib/construction/site-results';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { readPlan, deliverPlans } from '@/lib/construction/site-plans';
import { naturalPlanCases, runNaturalPlanScenario, runNaturalPlanAnswerScenario } from './construction-natural-plans-scenario.mjs';
import { prepareApprovedNaturalPlans } from './construction-natural-plans-fixture';
import { prepareOtherManagementProject, prepareClosedLifecycle } from './construction-natural-lifecycle-fixture';
import { lifecycleCases, runNaturalLifecycleScenario } from './construction-natural-lifecycle-scenario.mjs';
import { readSiteResolution } from '@/lib/construction/site-resolution';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { D4SharingFixture } from './assistant-d4-sharing-fixture';
import { wechatideNativeClient } from './wechatide-native-client';
import { run as runSharedChat } from './construction-chat-native.mjs';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';

type Row = Record<string, any>;
declare const wx: Row;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const admin = process.cwd(), root = path.dirname(admin); loadEnvConfig(admin, true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const name = process.argv[2]; assert.match(name, /^(?:d4-natural-actions|d5-natural-plans|d5-natural-lifecycle)-native-[a-z0-9-]+$/); assert.ok(process.argv.includes('--live'));
const journeys = process.argv.includes('--journeys');
const continuation = process.argv.includes('--continue-journeys');
const answerCheck = process.argv.includes('--answer-check');
const planCheck = process.argv.includes('--plan-check');
const planAnswers = process.argv.includes('--plan-answers');
const formalAnswerCheck = process.argv.includes('--formal-answer-check');
const lifecycleCheck = process.argv.includes('--lifecycle-check');
const lifecycleAnswers = process.argv.includes('--lifecycle-answer-check');
const resumeName = process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : '';
if (resumeName) assert.match(resumeName, /^(?:d4-natural-actions|d5-natural-plans)-native-[a-z0-9-]+$/);
const previous = resumeName ? JSON.parse(fs.readFileSync(path.join(root, 'tmp', resumeName, 'report.json'), 'utf8')) : null;
assert.ok(!journeys || !previous, 'Fixed full journeys do not reuse a prior failed model draft');
assert.ok(!continuation || previous && !journeys, 'Continuation requires a saved full-journey batch and zero new trials');
assert.ok(!answerCheck || !previous && !journeys && !continuation, 'Final-answer trials use fresh, separately labelled fixture sources');
assert.ok(!planCheck || !previous && !journeys && !continuation && !answerCheck, 'Natural formal plans use exactly two fresh fixed trials');
assert.ok(!planAnswers || previous?.delivery === 'D5' && !planCheck && !journeys && !continuation && !answerCheck, 'Formal answer repair reuses the saved completed publications only');
assert.ok(!formalAnswerCheck || !previous && !planCheck && !journeys && !continuation && !answerCheck && !planAnswers, 'Fresh formal answer fixtures never revive revoked originals');
assert.ok(!lifecycleCheck || !previous && !planCheck && !journeys && !continuation && !answerCheck && !planAnswers && !formalAnswerCheck, 'Lifecycle uses two fixed fresh scoped native journeys');
assert.ok(!lifecycleAnswers || !previous && !planCheck && !journeys && !continuation && !answerCheck && !planAnswers && !formalAnswerCheck && !lifecycleCheck, 'Lifecycle answer trials use fresh actual closed sources without regrading staff steps');
if (previous) { assert.ok(previous.finished); assert.deepEqual(previous.drift, []); assert.equal(previous.calls.length, planAnswers ? 8 : continuation ? 24 : 10); assert.ok(previous.calls.every((c: Row) => c.status === 'succeeded'));
  if (planAnswers) assert.ok(previous.trials.every((t: Row) => ['natural formal V1', 'natural V2', 'customer V2'].every(prefix => t.native.checks.some((c: Row) => c.name.startsWith(prefix) && c.passed))));
  if (continuation) assert.ok(previous.trials.every((t: Row) => t.native.checks.some((c: Row) => c.name === 'manager explicitly returns only its own confirmed excerpt to the source consultation' && c.passed))); }
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const ledger = path.join(root, 'tmp/agent-contract/trial-' + name + '.json'), apiOrigin = 'http://127.0.0.1:3118';
const cases = [
  { report: '帮我记下书房今天的进展：线管铺好了，插座底盒还没固定，需要再核对位置。',
    open: '帮我继续跟进书房底盒的位置，先别固定。', claim: '书房这个底盒的位置我来负责核对。',
    reply: '书房底盒的位置我核过了，请把我的回复记下来：先别固定，还要对一下桌子的位置。',
    check: '书房这张共享图纸我已经人工核对过，请把图纸关联记在底盒这件事上。',
    return: '请把书房底盒这条回传给业主：参考图已核对关联，先别固定，等现场核准桌子摆位。',
    preparation: '测试工地甲现在做到哪一步了？我去现场前需要准备什么？',
    customerReply: '书房底盒这件事后来怎么处理的，现在能直接按图固定了吗？' },
  { report: '书房这边今天线管铺完了，底盒还没固定，帮我记一条现场进展。',
    open: '书房底盒的位置还要核对，麻烦继续跟进这条记录。', claim: '这个书房底盒位置由我来核对，后面我负责跟进。',
    reply: '把书房底盒这件事记一下我的处理回复：位置先别定，桌子摆位我还要再核一遍。',
    check: '书房底盒这份共享图纸我已人工核对，麻烦把这次图纸关联记上。',
    return: '把书房底盒这件事回给业主：已对照参考图核对关联，位置还没最终定，现场复核桌子后再处理。',
    preparation: '这次去测试工地甲，我要提前带些什么、先确认哪些事？',
    customerReply: '那书房的底盒位置现在是什么情况，我能让师傅照图固定了吗？' },
];
const report: Row = { delivery: 'D4', started: new Date().toISOString(), scope: 'Two fixed natural report/open/claim/reply chains through actual Stable S04, configured Qwen, explicit author confirmation, original media, customer publication/reentry and member revocation. No D2 pixel understanding or whole-D4 claim.',
  cases, trials: [], calls: [], captures: [], passed: false, authorization: { model: 'qwen3.8-flash', cumulativeCapMicros: 100000000, fixedTrials: 2, maxDispatches: 10, reservedTokensPerDispatch: 64000 }, budgetBefore: reviewBudget(root).usedMicros };
if (previous) { report.scope = 'Zero-model continuation of the two original successfully interpreted/confirmed chains; original publication-selector failures remain separate. Exact retained records, customer publication/reentry and member revocation only.'; report.sourceEvidence = resumeName; report.authorization.fixedTrials = 0; report.authorization.maxDispatches = 0; }
if (continuation) report.scope = 'Zero-model continuation of the two original successful human drawing checks/designer replies/manager returns. Inspect the same exact customer publication/result versions and finish source/member revocation. Original C01 answer failures remain failed; no answer retry or new inference.';
if (journeys) { report.scope = 'Two fixed original D4 journeys: actual native manager stage update/customer preparation, natural photo draft/reviewed publication/reentry, natural issue/drawing check/designer reply/manager excerpt return/customer current-version answer and revocation. No D2 professional image interpretation.'; report.authorization.maxDispatches = 40; }
if (answerCheck) { report.scope = 'Two fixed configured-model C01 final-answer trials after deterministic denial-scope and tagged-field recovery fixes. Fresh labelled fixtures use existing services and a zero-provider record fixture; reuse the unchanged earlier native S04/stage/publication evidence, without regrading its failed customer answers. Includes actual C01 input/reentry and source/member revocation.'; report.authorization.maxDispatches = 12; }
if (planCheck) { report.delivery = 'D5'; report.cases = naturalPlanCases; report.scope = 'Two fixed natural formal-publication trials with real S04 original upload/author confirmation/V1-V2, exact C05 preview/decision/lost-receipt recovery, configured current-version question and reentry. Source/member revocations are engineering injections. Zero-provider pre-existing issue setup reuses unchanged D4 evidence; no professional image interpretation or complete D5 claim.'; report.authorization.maxDispatches = 12;
  report.bindingPolicy = 'Fixed before first D5 dispatch: full Agent/construction/database/provider dependencies and C01 chat/lib/assets plus construction/utils/components/app. Designer studio page WXML/Less are not imported/included by these tested routes (usingComponents empty) and are excluded up front. No retrospective binding reduction.'; }
if (planAnswers) { report.delivery = 'D5'; report.cases = naturalPlanCases; report.authorization.fixedTrials = 2; report.authorization.maxDispatches = 8;
  report.scope = 'Two fixed configured C01 formal-version answer trials after the bounded textual-validation recovery change. Reuses only the original two actually published/approved V2 originals, with no new staff model calls or publication/decision writes. Original first-draft failures remain failed. Includes protected original/reentry/source/member revocation.';
  report.bindingPolicy = previous.bindingPolicy; }
if (formalAnswerCheck) { report.delivery = 'D5'; report.cases = naturalPlanCases; report.authorization.maxDispatches = 8;
  report.scope = 'Second and final fixed C01 formal-state repair batch. Fresh labelled domain-written V1/V2/decision context because the prior passing case truly revoked its source; no revoked source resurrection, staff inference or native-decision regrading. Reuses original successful natural-publication/C05 evidence; tests actual question/protected original/reentry/source/member revocation.';
  report.bindingPolicy = 'Fixed before dispatch: full Agent/construction/database/provider dependencies; C01 chat/lib/assets and construction/utils/components/app. Independent designer-page WXML/Less excluded up front; no retrospective reduction.'; }
if (lifecycleCheck) { report.delivery = 'D5'; report.cases = lifecycleCases; report.scope = 'Two fixed natural transfer/new-assignee reply/completion-record/implementation/separate resolution/closure journeys from a real two-project brief, with actual Qwen, original author confirmations, exact evidence, explicit customer excerpt/original policy, lost receipts/reentry/source/member revocation. Existing exact-plan publication/decision native evidence reused; fresh plan context written through original domain services after assignment changes, not regraded as native publication.';
  report.authorization.maxDispatches = 20; report.bindingPolicy = 'Fixed before dispatch: full Agent/construction/database/provider dependencies; C01 chat/lib/assets and construction/utils/components/app plus brief entry, all test drivers/configuration. Independent designer-page WXML/Less excluded up front; no retrospective reduction.'; }
if (lifecycleAnswers) { report.delivery = 'D5'; report.cases = lifecycleCases; report.authorization.maxDispatches = 8;
  report.scope = 'Two fixed C01-only trials after hash-bound formal business projection recovery. Fresh labelled service-written closed V2/evidence context because the prior passing source was genuinely revoked. Reuse both successful natural staff/brief/write/lost-receipt chains without more staff inference or regrading; actual customer question/reentry, conditional originals, source/member revocation.';
  report.bindingPolicy = 'Fixed before dispatch: full Agent/construction/database/provider dependencies; C01 chat/lib/assets and construction/utils/components/app plus all test drivers/configuration. No retrospective binding reduction.'; }
const save = () => { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(ledger, JSON.stringify(report, null, 2)); };
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const binding = () => {
  const files: string[] = [];
  const assistantDirs = planCheck || planAnswers || formalAnswerCheck || lifecycleCheck || lifecycleAnswers ? ['miniprogram/packages/assistant/chat', 'miniprogram/packages/assistant/lib', 'miniprogram/packages/assistant/assets'] : ['miniprogram/packages/assistant'];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai/providers', ...assistantDirs, 'miniprogram/packages/construction', 'miniprogram/utils', 'miniprogram/components']) {
    const walk = (folder: string) => { for (const e of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) { const p = folder + '/' + e.name;
      if (e.isDirectory()) walk(p); else if (/\.(ts|js|json|wxml|less|png)$/.test(p)) files.push(p); } }; walk(dir);
  }
  files.push('admin/scripts/construction-site-actions-native.ts', 'admin/scripts/construction-site-actions-native.mjs', 'admin/scripts/construction-chat-native.mjs', 'admin/scripts/construction-natural-plans-scenario.mjs', 'admin/scripts/construction-natural-plans-fixture.ts',
    'admin/scripts/construction-natural-lifecycle-scenario.mjs', 'admin/scripts/construction-natural-lifecycle-fixture.ts',
    'admin/scripts/assistant-d4-sharing-fixture.ts', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/scripts/assistant-d4-runtime-config.mjs',
    'admin/scripts/wechatide-native-client.ts', 'admin/scripts/wechatide-window-state.ps1', 'tmp/wechat-devtools-version-test/window.ps1',
    'admin/scripts/bailian-review-test-runtime.ts', 'admin/scripts/assistant-review-budget.ts', 'admin/src/lib/ai/postgres-workflow-chat.ts',
    'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/miniprogram-auth.ts', 'admin/src/lib/miniprogram-identity-context.ts', 'admin/src/lib/admin-user-roles.ts',
    'admin/src/app/api/miniprogram/construction/[[...path]]/route.ts', 'admin/.env.local', 'admin/package-lock.json', 'miniprogram/utils/api.js',
    'miniprogram/app.js', 'miniprogram/app.json', 'miniprogram/app.less', 'miniprogram/package.json',
    'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator/package.json',
    'tmp/xiaok-vector/connection.private.json', 'tmp/xiaok-intelligent-consult/.env.qwen37', path.relative(root, process.env.TSX_TSCONFIG_PATH!));
  return Object.fromEntries([...new Set(files)].map(p => [p, hash(fs.readFileSync(path.join(root, p)))]));
};
const retained: RetainedReviewHold[] = ['tmp/anythingllm-pilot', 'tmp/agent-comparison', 'tmp/agent-diagnosis', 'tmp/agent-contract'].flatMap(dir =>
  fs.readdirSync(path.join(root, dir)).filter(p => /^trial-.*\.json$/.test(p)).flatMap(p => (JSON.parse(fs.readFileSync(path.join(root, dir, p), 'utf8')).calls || []))
    .filter((c: Row) => c.status !== 'succeeded').map((c: Row) => ({ id: c.id, runId: c.runId, reservedTokens: c.reservedTokens })));
let release: (() => Promise<void>) | undefined, restore: (() => Promise<unknown>) | undefined, server: http.Server | undefined;
let fixture: D4SharingFixture | undefined, trial: Row | undefined, activeRunId = '', processing: Promise<void> | undefined;
let tokens: string[] = [];
const scheduledRuns = new Set<string>();
const originalFetch = globalThis.fetch, delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function schedule(runId: string) {
  assert.ok(fixture && trial); assert.ok(!processing, 'One processor owns the fixed native trial');
  const f = fixture, currentTrial = trial;
  processing = (async () => {
    let first = true;
    for (let count = 0; count < 2; count++) {
      let lease = await claimJob();
      for (let i = 0; !lease && i < 30; i++) {
        const pending = await withTenantTransaction(f.eid, tx => one(tx, sql`select id from app.assistant_jobs where enterprise_id=${f.eid} and status='queued' limit 1`));
        if (!pending) break;
        await delay(100); lease = await claimJob();
      }
      if (!lease) break;
      assert.equal(lease.enterpriseId, f.eid); if (first) assert.equal(lease.runId, runId); first = false;
      activeRunId = lease.runId; currentTrial.runs.push(lease.runId); save();
      await processAssistantRun(lease);
      const state = await withTenantTransaction(f.eid, tx => one(tx, sql`select id::text,purpose,status,error_code from app.assistant_runs where enterprise_id=${f.eid} and id=${lease!.runId}`));
      currentTrial.runResults.push(state); save();
      if (state?.status !== 'succeeded') throw Error('Configured Worker did not complete: ' + JSON.stringify(state));
    }
  })().catch(error => { currentTrial.processorError = String(error.stack || error); save(); }).finally(() => { processing = undefined; activeRunId = ''; });
  await processing;
}
async function retire(f: D4SharingFixture, index: number) {
  fs.writeFileSync(path.join(output, `fixture-${index}.json`), JSON.stringify(await f.snapshot(), null, 2));
  const cancelled: string[] = [];
  for (const eid of f.enterpriseIds) await withTenantTransaction(eid, async tx => {
    for (const run of await rows(tx, sql`select id::text,conversation_id::text,policy_snapshot from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')`)) {
      await cancelRuns(tx, (run.policy_snapshot as Row).actor as ActorContext, String(run.conversation_id), String(run.id)); cancelled.push(String(run.id));
    }
  });
  return withPlatformTransaction(async tx => {
    assert.equal(Number((await one(tx, sql`select count(*) n from app.assistant_runs where enterprise_id=${f.eid} and status in ('queued','running')`))!.n), 0, 'Owned jobs must reach a known terminal state before retiring identities');
    await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id in (${f.enterpriseIds[0]},${f.enterpriseIds[1]})`);
    await tx.execute(sql`update app.admin_users set status='disabled' where id=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify([...f.ownerIds, ...f.memberIds, ...f.platformIds])}::jsonb))::bigint[])`);
    await tx.execute(sql`update app.construction_members set active=false where enterprise_id=${f.eid}`);
    for (const uid of f.userIds) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
    return { retainedForAudit: true, identitiesRevoked: true, enterpriseIds: f.enterpriseIds, userIds: f.userIds, activeJobs: 0, cancelled };
  });
}
async function main() {
  report.imported = binding(); save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!, { waitForLock: true });
    assert.deepEqual(binding(), report.imported, 'Source changed while waiting for acceptance lock');
    if (!previous || planAnswers) { const runtime = await bindBailianReviewTestRuntime(root, path.join(output, 'runtime.json')); restore = runtime.restore; report.runtime = runtime.receipt; }
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return originalFetch(input, init);
      assert.ok(!previous || planAnswers, 'Saved-result continuation cannot dispatch external inference');
      assert.equal(url.hostname, 'dashscope.aliyuncs.com'); assert.ok(trial && activeRunId); assert.ok(report.calls.length < report.authorization.maxDispatches, 'Fixed dispatch cap');
      assert.deepEqual(binding(), report.imported, 'Source/configuration drift fences further paid dispatch');
      reviewBudget(root).assertReservation(0, 64000, retained);
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'qwen3.8-flash');
      const call: Row = { id: name + ':' + report.calls.length, runId: activeRunId, trial: trial.index, phase: trial.phase, status: 'reserved', reservedTokens: 64000 };
      report.calls.push(call); save();
      const wire: Row = { url: url.href, body, requestHash: hash(JSON.stringify(body)), callId: call.id }, file = path.join(output, `wire-${report.calls.length}.json`);
      fs.writeFileSync(file, JSON.stringify(wire, null, 2));
      try {
        const result = await originalFetch(input, init), raw = await result.clone().text(); wire.status = result.status; wire.rawResponse = raw;
        const usage = result.ok ? parseAgentUsage(JSON.parse(raw).usage) : null;
        if (usage) { call.status = 'succeeded'; call.usage = { total_tokens: usage.inputTokens + usage.outputTokens }; } else call.status = 'unknown';
        fs.writeFileSync(file, JSON.stringify(wire, null, 2)); save(); return result;
      } catch (error) { call.status = 'unknown'; call.error = String(error); save(); throw error; }
    };
    server = http.createServer(async (incoming, outgoing) => {
      try {
        assert.ok(tokens.some(t => incoming.headers.authorization === 'Bearer ' + t));
        const parts: Buffer[] = []; for await (const chunk of incoming) parts.push(Buffer.from(chunk));
        const request = new NextRequest(apiOrigin + incoming.url, { method: incoming.method, headers: incoming.headers as HeadersInit,
          ...(['POST', 'PATCH'].includes(incoming.method || '') ? { body: new Uint8Array(Buffer.concat(parts)) } : {}) });
        const p = new URL(request.url).pathname, assistant = '/api/miniprogram/assistant/', construction = '/api/miniprogram/construction/';
        assert.ok(p.startsWith(assistant) || p.startsWith(construction));
        const result = p.startsWith(assistant) ? await assistantHttp(request, p.slice(assistant.length).split('/'))
          : await constructionHttp(request, { params: Promise.resolve({ path: p.slice(construction.length).split('/') }) });
        const bytes = Buffer.from(await result.arrayBuffer()); outgoing.writeHead(result.status, Object.fromEntries(result.headers.entries())); outgoing.end(bytes);
        if (result.ok && incoming.method === 'POST' && /\/messages$/.test(p)) {
          const sent = JSON.parse(bytes.toString()).data;
          if (sent.runId && !scheduledRuns.has(String(sent.runId))) { scheduledRuns.add(String(sent.runId)); void schedule(String(sent.runId)).catch(error => { if (trial) trial.processorError = String(error); save(); }); }
        }
      } catch (error) { report.bridgeError = String(error); if (!outgoing.writableEnded) { outgoing.writeHead(500); outgoing.end(JSON.stringify({ error: String(error) })); } save(); }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3118, '127.0.0.1', resolve); });
    for (const [index, c] of cases.entries()) {
      const f = new D4SharingFixture(); fixture = f;
      trial = { index, input: c, runs: [], runResults: [], passed: false }; report.trials.push(trial); save();
      const trialOutput = path.join(output, 'trial-' + index); fs.mkdirSync(trialOutput);
      try {
        if (previous) {
          const original = JSON.parse(fs.readFileSync(path.join(root, 'tmp', resumeName, `fixture-${index}.json`), 'utf8')).fixture;
          assert.deepEqual(original.enterpriseIds, previous.trials[index].retirement.enterpriseIds);
          for (const field of ['enterpriseIds', 'userIds', 'ownerIds', 'memberIds', 'platformIds'] as const) f[field].push(...original[field]);
          for (const field of ['projectId', 'otherProjectId', 'conversationId', 'leadId', 'roomId'] as const) f[field] = original[field];
          trial.originalRecordId = previous.trials[index].recordId; trial.originalIssueId = previous.trials[index].issueId;
          if (continuation || planAnswers) { trial.drawingGrantId = previous.trials[index].drawingGrantId; trial.drawingMediaId = previous.trials[index].drawingMediaId; trial.returnedReview = previous.trials[index].returnedReview; }
          if (planAnswers) trial.savedPlans = ['natural formal V1', 'natural V2'].map(prefix => previous.trials[index].native.checks.find((c: Row) => c.name.startsWith(prefix) && c.passed).result);
          const currentBinding = binding();
          for (const [p, originalHash] of Object.entries(previous.after)) if ((p.startsWith('admin/src/') || p.startsWith('miniprogram/')) && currentBinding[p]) {
            if (planAnswers && ['admin/src/lib/assistant/agent/synthesis.ts', 'admin/src/lib/assistant/__tests__/synthesis.test.ts', 'admin/src/db/__tests__/construction-natural-plans.test.ts'].includes(p)) continue;
            assert.equal(currentBinding[p], originalHash, 'Saved model/business source changed: ' + p);
          }
          await withPlatformTransaction(async tx => {
            const enterprise = await one(tx, sql`select code from app.enterprises where id=${f.eid}`); assert.ok(String(enterprise?.code).startsWith('synthetic-d4-sharing-'));
            await tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(f.enterpriseIds)}::jsonb))::bigint[])`);
            await tx.execute(sql`update app.admin_users set status='active' where id=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify([...f.ownerIds, ...f.memberIds, ...f.platformIds])}::jsonb))::bigint[])`);
            await tx.execute(sql`update app.construction_members set active=true where enterprise_id=${f.eid}`);
          });
        } else {
          await f.create({ runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash', tools: true, imageInput: false, structuredFinal: nativeFinalProtocol, probeVersion: 'd4-site-actions-live' });
          assert.equal((await f.send('共享测试工地甲·书房需求：靠窗放书桌，电脑和台灯需要插座。')).runId, null);
          assert.equal((await f.send('测试工地甲书房有新照片告诉我')).runId, null);
          if (journeys || answerCheck || planCheck || formalAnswerCheck || lifecycleCheck || lifecycleAnswers) {
            const drawingBytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#e4ded1' } }).png().toBuffer();
            trial.drawingMediaId = String((await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), drawingBytes, 'image', '')).id);
            assert.equal((await f.send('共享测试工地甲·书房点位图：V2书桌底盒参考图，仍需结合现场实测，未批准施工。')).runId, null);
            trial.drawingGrantId = (await f.sources()).sources.find(s => s.kind === 'drawing')!.id;
            const settings = await f.owner.execute('stages');
            await f.owner.execute('saveStages', { expectedVersion: settings.version, stages: (settings.stages as Row[]).map(s => s.key === 'utilities'
              ? { ...s, watchPoints: '去现场请带书桌尺寸和电脑、显示器、台灯的电器清单；先与项目团队核对书房底盒位置。', visitReason: '水电点位仍需现场复核，具体进场时间尚未约定。' } : s) }, randomUUID());
          }
          if (answerCheck || planCheck || formalAnswerCheck || lifecycleCheck || lifecycleAnswers) {
            const detail = await f.owner.execute('detail', { projectId: f.projectId });
            await f.owner.execute('progress', { projectId: f.projectId, expectedVersion: (detail.project as Row).version, stageKey: 'utilities',
              note: '书房底盒位置仍需现场复核，具体进场时间尚未安排。', sendReminder: false }, randomUUID());
            const prepared = await f.prepareReturnedIssue(trial.drawingGrantId, c);
            trial.recordId = prepared.recordId; trial.issueId = prepared.issueId; trial.fixtureRecordRunId = prepared.recordRunId;
            trial.fixturePreparation = { ...prepared, source: 'existing domain services', recordModel: 'labelled zero-provider fixture' }; save();
            if (formalAnswerCheck) { const versions = await prepareApprovedNaturalPlans(f, prepared.issueId, naturalPlanCases[index]);
              trial.savedPlans = versions.plans; trial.fixturePlanPreparation = versions; save(); }
            if (lifecycleCheck) { trial.otherManagementProject = await prepareOtherManagementProject(f); save(); }
            if (lifecycleAnswers) { const closed = await prepareClosedLifecycle(f, prepared.issueId, naturalPlanCases[index], lifecycleCases[index].originals);
              trial.savedPlans = closed.plans; trial.completionRecordId = closed.recordId; trial.closedContextPreparation = closed; await deliverSiteResults(); save(); }
          }
        }
        const version = async (uid: string) => Number((await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${uid}`)))!.context_version);
        const customerToken = await signMiniProgramToken({ sub: f.userIds[0], id: f.userIds[0], contextVersion: await version(f.userIds[0]), mode: 'customer', role: 'user', enterpriseId: f.eid, source: 'wechat' });
        const identities: Row[] = []; tokens = [customerToken];
        for (const [i, adminId] of [f.ownerIds[0], f.memberIds[0], f.memberIds[1]].entries()) {
          const role = (['enterprise_admin', 'designer', 'construction_staff'] as const)[i];
          const uid = previous ? String((await withPlatformTransaction(tx => one(tx, sql`select user_id::text from app.admin_users where id=${adminId}`)))!.user_id) : await withPlatformTransaction(async tx => { const id = String((await one(tx, sql`insert into app.users(nickname,role,context_version) values(${f.prefix + role},'staff',1) returning id`))!.id);
            await tx.execute(sql`update app.users set phone=${'199' + id.padStart(8, '0')} where id=${id}`); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${f.prefix + role})`);
            await tx.execute(sql`update app.admin_users set user_id=${id} where enterprise_id=${f.eid} and id=${adminId}`); return id; });
          if (!previous) f.userIds.push(uid); const token = await signMiniProgramToken({ sub: uid, id: uid, contextVersion: await version(uid), mode: 'staff', role, staffRole: role, staffId: adminId, enterpriseId: f.eid, source: 'wechat' });
          tokens.push(token); identities.push({ role, adminId, enterpriseId: f.eid, token });
        }
        const probe = wechatideNativeClient(path.join(root, 'miniprogram'), trialOutput);
        trial.exactProject = await probe.call('automation_runtime_info', { project: path.join(root, 'miniprogram'), action: 'systemInfo' });
        fs.writeFileSync(path.join(trialOutput, 'window-launch.json'), JSON.stringify({ projectPath: path.join(root, 'miniprogram'), autoPort: 9420 }));
        trial.before = binding(); save();
        trial.native = await runSharedChat({ root, output: trialOutput, projectId: f.projectId, identities, apiOrigin, refreshWithCli: true, recordPreview: true, projectManagement: journeys || lifecycleCheck, managementBrief: lifecycleCheck,
          customer: { conversationId: f.conversationId }, exercise: async ({ mp, step, identity, open, send, current, waitFor, capture }: Row) => {
            const check = async (read: () => Promise<unknown>, label: string) => waitFor(async () => { if (trial!.processorError) throw Error(trial!.processorError); return read(); }, label);
            const take = async (name: string) => { const value = await capture(name); report.captures.push(value); save(); return value; };
            const latest = async (id: string) => (await (await current()).data()).items.find((i: Row) => String(i.message.id) === id);
            let rid = previous ? String(trial!.originalRecordId) : '', iid = previous ? String(trial!.originalIssueId) : '';
            const bodyText = (m: Row) => (m.content?.blocks || []).map((b: Row) => b.text || b.fallbackText || '').join('\n');
            const takeRoute = async (name: string, route: string) => {
              assert.equal((await mp.currentPage()).path, route); const stack = await mp.evaluate(() => getCurrentPages().map(p => p.route));
              assert.equal(stack.at(-1), route); const target = path.join(trialOutput, name + '.png'); await mp.screenshot({ path: target }); const b = fs.readFileSync(target);
              report.captures.push({ target, route, stack, logical: [390, 844], encoded: [b.readUInt32BE(16), b.readUInt32BE(20)] }); save();
            };
            const customerOpen = async () => {
              await mp.evaluate((token: string, eid: string) => { const app = getApp(); app.globalData.token = token; app.__qaShared.memory.set('token', token);
                app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.service', 'customer.projects', 'account'], context: { enterpriseId: eid } } }; }, customerToken, f.eid);
              await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + f.conversationId);
              return check(async () => { const p = await mp.currentPage(); if (p.path !== 'packages/assistant/chat/chat') return false; const d = await p.data();
                if (d.fatal || d.needsLogin) throw Error('Customer reentry rejected: ' + d.error); return !d.loading && d.conversation?.id === f.conversationId ? p : false; }, 'original customer consultation');
            };
            const customerSay = async (text: string) => {
              const p: any = await customerOpen(), before = new Set((await p.data()).messages.map((m: Row) => m.id));
              await check(async () => { const d = await p.data(); return !d.busy && !d.generating && !d.pendingSend && d.canSend; }, 'customer composer ready');
              await (await p.$('.composer-input')).input(text); await (await p.$('.send-button')).tap();
              const answer: any = await check(async () => { const d = await p.data(); const found = d.messages.find((m: Row) => !before.has(m.id) && m.authorKind === 'assistant');
                return !d.busy && !d.generating && found ? found : false; }, 'configured customer answer');
              assert.ok((await p.data()).messages.some((m: Row) => !before.has(m.id) && m.authorKind === 'user' && bodyText(m) === text));
              await mp.callWxMethod('hideKeyboard'); return { id: answer.id, text: bodyText(answer) };
            };
            const publishToCustomer = async () => {
              await identity(0); const p = await current(); await (await p.$(`.record-actions .primary[data-id="${rid}"]`)).tap();
              await check(async () => (await p.data()).sheet === 'publish', 'original publication scope sheet');
              await (await p.$('.sheet switch')).trigger('change', { value: true });
              const publish: any = await check(async () => p.$('.sheet .primary'), 'positive native publication selector'); await publish.tap();
              await check(async () => { const d = await p.data(); return !d.sheet && !d.busy && d.items.some((i: Row) => i.record.id === rid && i.record.audience === 'customer'); }, 'explicit manager publication');
              await deliverSiteNotifications(); const customer: any = await customerOpen();
              await check(async () => { const d = await customer.data(); return d.messages.some((m: Row) => (m.siteRecordList || []).some((r: Row) => String(r.id) === rid))
                && Object.keys(d.siteRecordPaths || {}).some(k => k.startsWith(rid + '_')); }, 'exact published record and authenticated original');
              await takeRoute('published-customer', 'packages/assistant/chat/chat');
              const record = await withTenantTransaction(f.eid, tx => one(tx, sql`select version,published_version from app.construction_site_records where enterprise_id=${f.eid} and id=${rid}`));
              trial!.publishedRecordVersion = Number(record!.published_version); save(); return { recordId: rid, version: record!.published_version, customerReentry: true };
            };
            try {
              if (lifecycleCheck || lifecycleAnswers) {
                await runNaturalLifecycleScenario({ mp, step, identity, open, send, current, check, latest, take, takeRoute, customerOpen, customerSay, trial, save,
                  input: lifecycleCases[index], answerOnly: lifecycleAnswers, projectId: f.projectId, otherProjectId: f.otherProjectId, workerId: f.memberIds[1],
                  picture: async () => (await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer()).toString('base64'),
                  readIssue: () => withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, trial!.issueId)),
                  readResolution: () => withTenantTransaction(f.eid, tx => readSiteResolution(tx, f.eid, f.projectId, trial!.issueId)),
                  preparePlans: () => prepareApprovedNaturalPlans(f, trial!.issueId, naturalPlanCases[index], f.ownerIds[0]),
                  deliver: deliverSiteResults,
                  withdrawSource: () => new ConversationService({ ...f.actor, contextVersion: 1 }).send(f.conversationId, randomUUID(),
                    { version: 1, blocks: [{ type: 'text', text: '撤回共享资料' + trial!.drawingGrantId }] }, siteWatchInterceptor),
                  removeWorker: () => f.member(f.memberIds[1], 'worker', false) });
                return;
              }
              if (planCheck || planAnswers || formalAnswerCheck) {
                const scenario = planAnswers || formalAnswerCheck ? runNaturalPlanAnswerScenario : runNaturalPlanScenario;
                await scenario({ mp, step, identity, open, send, current, check, latest, customerOpen, customerSay, take, takeRoute, trial, save,
                  input: naturalPlanCases[index], projectId: f.projectId, savedPlans: trial!.savedPlans,
                  picture: async (number: number) => (await sharp({ create: { width: 96, height: 72, channels: 3, background: number === 1 ? '#c9dfd0' : '#93acbf' } }).png().toBuffer()).toString('base64'),
                  countPlans: () => withTenantTransaction(f.eid, async tx => Number((await one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.plan.published.v1'`))!.n)),
                  readPlan: (id: string) => withTenantTransaction(f.eid, tx => readPlan(tx, f.eid, id)), deliver: deliverPlans,
                  repairCount: () => withTenantTransaction(f.eid, async tx => ((await one(tx, sql`select private_checkpoint from app.assistant_run_steps
                    where enterprise_id=${f.eid} and run_id=${trial!.runs.at(-1)} and kind='agent_checkpoint'`))!.private_checkpoint as Row).validationRepairs),
                  withdrawSource: async () => new ConversationService({ ...f.actor, contextVersion: await version(f.userIds[0]) }).send(f.conversationId, randomUUID(),
                    { version: 1, blocks: [{ type: 'text', text: '撤回共享资料' + trial!.drawingGrantId }] }, siteWatchInterceptor),
                  removeMember: () => f.member(f.memberIds[0], 'designer', false) });
                return;
              }
              if (answerCheck) {
                await step('configured customer answer reads the exact current team result and preserves its pending status', async () => {
                  trial!.phase = 'customer-result'; save(); const answer = await customerSay(c.customerReply); trial!.customerResultAnswer = answer;
                  assert.match(answer.text, /底盒|插座|点位/); assert.match(answer.text, /核对|复核|还|待|未|暂|先/);
                  assert.doesNotMatch(answer.text, /PRIVATE_INTERNAL_REQUEST|PRIVATE_INTERNAL_REPLY|已经验收|已正式批准施工/);
                  const p: any = await customerOpen(); await (await p.$('.conversation-scroll')).scrollTo(0, 100000);
                  await takeRoute('customer-answer-reentry', 'packages/assistant/chat/chat');
                  const checkpoint = await withTenantTransaction(f.eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
                    where enterprise_id=${f.eid} and run_id=${trial!.runs.at(-1)} and kind='agent_checkpoint'`));
                  trial!.finalValidationRepairs = (checkpoint!.private_checkpoint as Row).validationRepairs; return { ...answer, validationRepairs: trial!.finalValidationRepairs };
                });
                await step('source withdrawal invalidates the newly generated answer on actual customer reentry', async () => {
                  await new ConversationService({ ...f.actor, contextVersion: await version(f.userIds[0]) }).send(f.conversationId, randomUUID(),
                    { version: 1, blocks: [{ type: 'text', text: '撤回共享资料' + trial!.drawingGrantId }] }, siteWatchInterceptor);
                  const p: any = await customerOpen(); await check(async () => (await p.data()).messages.some((m: Row) => m.id === trial!.customerResultAnswer.id && m.available === false), 'derived answer source revocation');
                  await (await p.$('.conversation-scroll')).scrollTo(0, 100000); await takeRoute('customer-answer-source-withdrawn', 'packages/assistant/chat/chat'); return { cleared: true };
                });
                await step('member removal still clears native project text and originals after final-answer recovery', async () => {
                  await identity(1); await f.member(f.memberIds[0], 'designer', false); await mp.redirectTo('/packages/construction/chat/chat?projectId=' + f.projectId);
                  await check(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length && !d.write; }, 'member removal after answer check');
                  await take('answer-check-member-revoked'); return { cleared: true };
                });
                return;
              }
              if (!previous) {
              if (journeys) {
                await step('manager actually updates the phase through the approved Mini Program project controls', async () => {
                  await identity(0); await mp.redirectTo('/packages/construction/projects/projects');
                  const p: any = await check(async () => { const page = await mp.currentPage(); if (page.path !== 'packages/construction/projects/projects') return false; const d = await page.data(); return !d.loading && d.items.some((p: Row) => p.id === f.projectId) ? page : false; }, 'authorized project overview');
                  await (await p.$(`.project-card[data-id="${f.projectId}"]`)).tap(); await check(async () => (await p.data()).detail?.project.id === f.projectId, 'project detail');
                  const buttons = await p.$$('.surface button'); assert.equal(await buttons[0].text(), '更新实际节点'); await buttons[0].tap();
                  await check(async () => (await p.data()).sheet === 'progress', 'phase update sheet');
                  const utilities = (await p.data()).detail.stages.findIndex((s: Row) => s.key === 'utilities'); assert.ok(utilities >= 0);
                  await (await p.$('.sheet picker')).trigger('change', { value: utilities });
                  await (await p.$('.sheet textarea')).input('书房线管准备施工，底盒位置仍需按桌子摆位复核，具体进场时间尚未安排。');
                  await (await p.$('.sheet button')).tap();
                  await check(async () => { const d = await p.data(); return !d.busy && !d.pending && !d.sheet && d.detail?.project.current_stage_key === 'utilities'; }, 'actual persisted utilities phase');
                  const actual = await f.owner.execute('detail', { projectId: f.projectId }); assert.equal((actual.project as Row).current_stage_key, 'utilities');
                  await takeRoute('manager-actual-stage', 'packages/construction/projects/projects'); return { stageKey: 'utilities', version: (actual.project as Row).version };
                });
                await step('customer asks naturally about the real phase and preparation in its original consultation', async () => {
                  trial!.phase = 'preparation'; save(); const answer = await customerSay(c.preparation); trial!.preparationAnswer = answer;
                  assert.match(answer.text, /水电/); assert.match(answer.text, /书桌|电器|清单|尺寸/); assert.doesNotMatch(answer.text, /明天进场|已经验收|已批准施工/);
                  await takeRoute('customer-preparation', 'packages/assistant/chat/chat'); await identity(2); return answer;
                });
              }
              await step('natural progress request, actual private photo and configured model feed the existing reviewed-draft path', async () => {
                trial!.phase = 'report'; save(); const bytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: index ? '#b3c9d3' : '#c9dfd0' } }).png().toBuffer();
                await mp.evaluate((value: string, size: number) => { const state = getApp().__qaShared; state.photoPath = wx.env.USER_DATA_PATH + '/d4-natural-actions.png'; state.photoSize = size;
                  wx.getFileSystemManager().writeFileSync(state.photoPath, value, 'base64'); }, bytes.toString('base64'), bytes.length);
                await (await (await current()).$('.add-photo')).tap(); await check(async () => { const d = await (await current()).data(); return d.attachments.length === 1 && !d.busy && !d.pending; }, 'actual photo upload');
                const sent = await send(c.report), messageId = String(sent.message.id);
                const draft: any = await check(async () => { const item = await latest(messageId); return item?.record?.status === 'draft' ? item : false; }, 'configured report classification and original record Worker');
                rid = draft.record.id; assert.equal(draft.record.room_id, f.roomId); assert.equal(draft.record.media.length, 1); assert.equal(draft.record.audience, 'internal');
                assert.match(draft.record.data.pending, /底盒|固定|核对/); trial!.recordId = rid;
                await take('record-draft'); return { recordId: rid, messageId };
              });
              if (journeys) { await step('reviewed original photo reaches the original customer before the issue starts', publishToCustomer); await identity(2); }
              await step('natural follow-up is only a persisted preview until the actual author confirms', async () => {
                trial!.phase = 'open'; save(); const sent = await send(c.open), messageId = String(sent.message.id);
                await check(async () => /确认跟进/.test((await latest(messageId))?.response?.text || ''), 'natural follow-up preview');
                const before = await withTenantTransaction(f.eid, tx => rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.site.issue.opened.v1'`)); assert.equal(before.length, 0);
                await send('收到'); await take('followup-preview'); const confirmed = await send('确认跟进'); iid = confirmed.response.issue.issueId;
                assert.equal(confirmed.response.issue.requestMessageId, messageId); assert.equal(confirmed.response.issue.requestText, c.open); await open();
                const actual = await withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, iid)); assert.equal(actual!.ownerId, null); trial!.issueId = iid;
                return { issueId: iid, originalMessageId: messageId };
              });
              await step('designer finds actual room material and naturally takes responsibility after confirmation', async () => {
                await identity(1); const material = await send('书房底盒这件事现在在等谁处理，帮我找对应需求和现场记录。');
                assert.match(material.response.text, /靠窗放书桌/); assert.doesNotMatch(material.response.text, /PRIVATE_DO_NOT_SHARE/);
                trial!.phase = 'claim'; save(); const sent = await send(c.claim); await check(async () => /确认接手/.test((await latest(String(sent.message.id)))?.response?.text || ''), 'natural claim preview');
                assert.equal((await withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, iid)))!.ownerId, null);
                const confirmed = await send('确认接手'); assert.equal(confirmed.response.issue.ownerId, f.memberIds[0]); await open();
                return { issueId: iid, ownerId: f.memberIds[0] };
              });
              if (journeys) await step('designer records a real human drawing check only after the exact preview and personal confirmation', async () => {
                trial!.phase = 'check'; save(); const sent = await send(c.check), messageId = String(sent.message.id);
                await check(async () => /确认核对图纸/.test((await latest(messageId))?.response?.text || ''), 'natural drawing-check preview');
                assert.match((await latest(messageId)).response.text, new RegExp('图纸资料' + trial!.drawingGrantId));
                const confirmed = await send('确认核对图纸'); assert.equal(confirmed.response.issue.drawingGrantId, trial!.drawingGrantId);
                await open(); await take('drawing-check-reentry'); return { issueId: iid, drawingGrantId: trial!.drawingGrantId };
              });
              await step('natural designer reply preserves its complete original, reentry and pending-review boundary', async () => {
                trial!.phase = 'reply'; save(); const sent = await send(c.reply), messageId = String(sent.message.id);
                await check(async () => /确认回复/.test((await latest(messageId))?.response?.text || ''), 'natural reply preview');
                const confirmed = await send('确认回复'); assert.equal(confirmed.response.issue.progressMessageId, messageId); assert.equal(confirmed.response.issue.state, 'awaiting_review');
                assert.ok(confirmed.response.issue.text.includes(c.reply)); await open(); await take('reply-reentry');
                return { issueId: iid, originalMessageId: messageId, state: 'awaiting_review' };
              });
              } else {
                await identity(1); const state = await withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, iid));
                assert.ok(state!.text.includes(c.reply)); assert.equal(state!.state, 'awaiting_review'); await take('saved-reply-reentry');
              }
              if (continuation) await step('same saved manager excerpt and drawing association remain exact on customer reentry without any model retry', async () => {
                const reviews = await withTenantTransaction(f.eid, tx => customerMaterialReviews(tx, f.eid, f.userIds[0], f.conversationId));
                assert.equal(reviews.length, 1); assert.equal(reviews[0].version, trial!.returnedReview.version);
                const p: any = await customerOpen();
                await check(async () => (await p.data()).messages.some((m: Row) => bodyText(m).includes(c.return)), 'saved exact manager excerpt');
                const scroll = await p.$('.conversation-scroll'); await scroll.scrollTo(0, 100000);
                await takeRoute('saved-customer-result', 'packages/assistant/chat/chat');
                const photos = await p.$$('.site-record-photos .message-photo'); const data = await p.data(); assert.ok(photos.length > 0);
                assert.ok(data.messages.some((m: Row) => (m.siteRecordList || []).some((r: Row) => r.id === rid && r.version === previous.trials[index].publishedRecordVersion)));
                assert.ok(Object.keys(data.siteRecordPaths).some(k => k.startsWith(rid + '_')));
                const metrics = await mp.evaluate(() => new Promise(resolve => {
                  const query = wx.createSelectorQuery(); query.select('.conversation-scroll').scrollOffset();
                  query.select('.site-record-photos .message-photo').boundingClientRect(); query.exec(resolve);
                }));
                trial!.photoFocus = { metrics, focused: !!(metrics[0] && metrics[1]) };
                if (trial!.photoFocus.focused) { await scroll.scrollTo(0, Math.max(0, metrics[0].scrollTop + metrics[1].top - 250)); await takeRoute('saved-published-original', 'packages/assistant/chat/chat'); }
                // Optional optical framing never blocks the independent source/permission checks.
                return { reviewVersion: reviews[0].version, recordId: rid, nativePhotoElements: photos.length, photoFocus: trial!.photoFocus };
              });
              if (!journeys && !continuation) await step('manager reviews the real original through approved publication controls and customer reentry receives its exact photo version', publishToCustomer);
              else if (journeys) {
                await step('manager explicitly returns only its own confirmed excerpt to the source consultation', async () => {
                  await identity(0); trial!.phase = 'return'; save(); const sent = await send(c.return), messageId = String(sent.message.id);
                  await check(async () => /确认回传/.test((await latest(messageId))?.response?.text || ''), 'natural manager return preview');
                  assert.match((await latest(messageId)).response.text, new RegExp('原咨询' + f.conversationId));
                  await take('manager-return-preview'); await send('确认回传'); await deliverSiteNotifications();
                  const results = await withTenantTransaction(f.eid, tx => customerSiteResults(tx, f.eid, f.userIds[0], f.conversationId));
                  assert.equal(results.length, 1); assert.ok(results[0].text.includes(c.return)); assert.ok(!results[0].text.includes(c.reply));
                  const reviews = await withTenantTransaction(f.eid, tx => customerMaterialReviews(tx, f.eid, f.userIds[0], f.conversationId));
                  assert.equal(reviews.length, 1); assert.equal(reviews[0].drawingGrantId, trial!.drawingGrantId); trial!.returnedReview = reviews[0];
                  const p: any = await customerOpen(); await check(async () => (await p.data()).messages.some((m: Row) => bodyText(m).includes(c.return)), 'exact manager excerpt on C01 reentry');
                  await takeRoute('customer-return-reentry', 'packages/assistant/chat/chat'); return { issueId: iid, revision: results[0].revision, materialVersion: reviews[0].materialVersion };
                });
                await step('customer asks about the returned issue and the configured answer retains its actual pending status', async () => {
                  trial!.phase = 'customer-result'; save(); const answer = await customerSay(c.customerReply); trial!.customerResultAnswer = answer;
                  assert.match(answer.text, /底盒|插座|点位/); assert.match(answer.text, /核对|复核|还|待|未|暂|先/); assert.doesNotMatch(answer.text, /已经验收|已正式批准施工/);
                  await customerOpen(); await takeRoute('customer-current-result', 'packages/assistant/chat/chat'); return answer;
                });
              }
              if (journeys || continuation) {
                await step('source withdrawal removes the exact returned drawing association on actual customer reentry', async () => {
                  await new ConversationService({ ...f.actor, contextVersion: await version(f.userIds[0]) }).send(f.conversationId, randomUUID(),
                    { version: 1, blocks: [{ type: 'text', text: '撤回共享资料' + trial!.drawingGrantId }] }, siteWatchInterceptor);
                  const reviews = await withTenantTransaction(f.eid, tx => customerMaterialReviews(tx, f.eid, f.userIds[0], f.conversationId)); assert.equal(reviews.length, 0);
                  const p: any = await customerOpen(); await check(async () => (await p.data()).messages.some((m: Row) => m.available === false), 'source-dependent customer content cleared');
                  await takeRoute('customer-withdrawn-source', 'packages/assistant/chat/chat'); return { cleared: true };
                });
              }
              await step('removing the designer clears private chat, originals and action access on actual reentry', async () => {
                await identity(1); await f.member(f.memberIds[0], 'designer', false); await mp.redirectTo('/packages/construction/chat/chat?projectId=' + f.projectId);
                await check(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length && !d.write; }, 'revoked originals and history');
                await take('revoked'); return { cleared: true };
              });
            } finally {
              await mp.evaluate(() => { const state = getApp().__qaShared; if (state?.photoPath) { try { wx.getFileSystemManager().unlinkSync(state.photoPath); } catch { /* Original fixture already removed. */ } } });
            }
          } });
        trial.passed = trial.native.passed && !trial.processorError;
      } catch (error) { trial.error = String((error as Error).stack || error); }
      finally {
        if (processing) await processing;
        if (fs.existsSync(path.join(trialOutput, 'native.json'))) trial.native = JSON.parse(fs.readFileSync(path.join(trialOutput, 'native.json'), 'utf8'));
        if (f.eid) trial.retirement = await retire(f, index);
        trial.after = binding(); trial.drift = Object.keys(report.imported).filter(p => report.imported[p] !== trial!.after[p]);
        trial.passed = trial.passed && !trial.drift.length && trial.native?.transport?.active === false; save();
      }
    }
    report.passed = report.trials.every((t: Row) => t.passed);
  } catch (error) { report.error = String((error as Error).stack || error); }
  finally {
    if (processing) await processing;
    globalThis.fetch = originalFetch;
    const errors: string[] = [];
    try { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } } catch (error) { errors.push(String(error)); }
    try { report.configurationRestoration = await restore?.(); } catch (error) { errors.push(String(error)); }
    report.after = binding(); report.drift = Object.keys(report.imported).filter(p => report.imported[p] !== report.after[p]); report.cleanupErrors = errors;
    report.finished = new Date().toISOString(); report.budgetAfter = reviewBudget(root).usedMicros;
    report.passed = report.passed && !report.drift.length && !errors.length && !report.bridgeError; save();
    await release?.(); await closePostgresPool(); process.exitCode = report.passed ? 0 : 1;
    console.log(JSON.stringify({ passed: report.passed, trials: report.trials.map((t: Row) => ({ index: t.index, passed: t.passed, error: t.error, processorError: t.processorError })), calls: report.calls.length, drift: report.drift, error: report.error, cleanupErrors: errors, output }));
  }
}
void main();
