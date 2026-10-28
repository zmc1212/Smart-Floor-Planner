/* eslint-disable @typescript-eslint/no-explicit-any -- Stable SDK and recorded synthetic DTOs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
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
import { cancelRuns } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { nativeFinalProtocol } from '@/lib/assistant/agent/native-final';
import { parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
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
const name = process.argv[2]; assert.match(name, /^d4-natural-actions-native-[a-z0-9-]+$/); assert.ok(process.argv.includes('--live'));
const resumeName = process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : '';
if (resumeName) assert.match(resumeName, /^d4-natural-actions-native-[a-z0-9-]+$/);
const previous = resumeName ? JSON.parse(fs.readFileSync(path.join(root, 'tmp', resumeName, 'report.json'), 'utf8')) : null;
if (previous) { assert.ok(previous.finished); assert.deepEqual(previous.drift, []); assert.equal(previous.calls.length, 10); assert.ok(previous.calls.every((c: Row) => c.status === 'succeeded')); }
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const ledger = path.join(root, 'tmp/agent-contract/trial-' + name + '.json'), apiOrigin = 'http://127.0.0.1:3118';
const cases = [
  { report: '帮我记下书房今天的进展：线管铺好了，插座底盒还没固定，需要再核对位置。',
    open: '帮我继续跟进书房底盒的位置，先别固定。', claim: '书房这个底盒的位置我来负责核对。',
    reply: '书房底盒的位置我核过了，请把我的回复记下来：先别固定，还要对一下桌子的位置。' },
  { report: '书房这边今天线管铺完了，底盒还没固定，帮我记一条现场进展。',
    open: '书房底盒的位置还要核对，麻烦继续跟进这条记录。', claim: '这个书房底盒位置由我来核对，后面我负责跟进。',
    reply: '把书房底盒这件事记一下我的处理回复：位置先别定，桌子摆位我还要再核一遍。' },
];
const report: Row = { delivery: 'D4', started: new Date().toISOString(), scope: 'Two fixed natural report/open/claim/reply chains through actual Stable S04, configured Qwen, explicit author confirmation, original media, customer publication/reentry and member revocation. No D2 pixel understanding or whole-D4 claim.',
  cases, trials: [], calls: [], captures: [], passed: false, authorization: { model: 'qwen3.8-flash', cumulativeCapMicros: 100000000, fixedTrials: 2, maxDispatches: 10, reservedTokensPerDispatch: 64000 }, budgetBefore: reviewBudget(root).usedMicros };
if (previous) { report.scope = 'Zero-model continuation of the two original successfully interpreted/confirmed chains; original publication-selector failures remain separate. Exact retained records, customer publication/reentry and member revocation only.'; report.sourceEvidence = resumeName; report.authorization.fixedTrials = 0; report.authorization.maxDispatches = 0; }
const save = () => { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(ledger, JSON.stringify(report, null, 2)); };
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const binding = () => {
  const files: string[] = [];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai/providers', 'miniprogram/packages/assistant', 'miniprogram/packages/construction', 'miniprogram/utils', 'miniprogram/components']) {
    const walk = (folder: string) => { for (const e of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) { const p = folder + '/' + e.name;
      if (e.isDirectory()) walk(p); else if (/\.(ts|js|json|wxml|less|png)$/.test(p)) files.push(p); } }; walk(dir);
  }
  files.push('admin/scripts/construction-site-actions-native.ts', 'admin/scripts/construction-site-actions-native.mjs', 'admin/scripts/construction-chat-native.mjs',
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
    if (!previous) { const runtime = await bindBailianReviewTestRuntime(root, path.join(output, 'runtime.json')); restore = runtime.restore; report.runtime = runtime.receipt; }
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return originalFetch(input, init);
      assert.ok(!previous, 'Saved-result continuation cannot dispatch external inference');
      assert.equal(url.hostname, 'dashscope.aliyuncs.com'); assert.ok(trial && activeRunId); assert.ok(report.calls.length < 10, 'Fixed dispatch cap');
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
          const currentBinding = binding();
          for (const [p, originalHash] of Object.entries(previous.after)) if ((p.startsWith('admin/src/') || p.startsWith('miniprogram/')) && currentBinding[p]) assert.equal(currentBinding[p], originalHash, 'Saved model/business source changed: ' + p);
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
        trial.native = await runSharedChat({ root, output: trialOutput, projectId: f.projectId, identities, apiOrigin, refreshWithCli: true, recordPreview: true,
          customer: { conversationId: f.conversationId }, exercise: async ({ mp, step, identity, open, send, current, waitFor, capture }: Row) => {
            const check = async (read: () => Promise<unknown>, label: string) => waitFor(async () => { if (trial!.processorError) throw Error(trial!.processorError); return read(); }, label);
            const take = async (name: string) => { const value = await capture(name); report.captures.push(value); save(); return value; };
            const latest = async (id: string) => (await (await current()).data()).items.find((i: Row) => String(i.message.id) === id);
            let rid = previous ? String(trial!.originalRecordId) : '', iid = previous ? String(trial!.originalIssueId) : '';
            try {
              if (!previous) {
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
              await step('manager reviews the real original through approved publication controls and customer reentry receives its exact photo version', async () => {
                await identity(0); const p = await current(); await (await p.$(`.record-actions .primary[data-id="${rid}"]`)).tap();
                await check(async () => (await p.data()).sheet === 'publish', 'original publication scope sheet');
                await (await p.$('.sheet switch')).trigger('change', { value: true });
                const publish = await check(async () => p.$('.sheet .primary'), 'positive native publication selector'); await (publish as Row).tap();
                await check(async () => { const d = await p.data(); return !d.sheet && !d.busy && d.items.some((i: Row) => i.record.id === rid && i.record.audience === 'customer'); }, 'explicit manager publication');
                await deliverSiteNotifications();
                await mp.evaluate((token: string, eid: string) => { const app = getApp(); app.globalData.token = token; app.__qaShared.memory.set('token', token);
                  app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.service', 'customer.projects', 'account'], context: { enterpriseId: eid } } }; }, customerToken, f.eid);
                await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + f.conversationId);
                const customer = await check(async () => { const page = await mp.currentPage(); if (page.path !== 'packages/assistant/chat/chat') return false; const d = await page.data();
                  return !d.loading && d.messages.some((m: Row) => (m.siteRecordList || []).some((r: Row) => String(r.id) === rid)) && Object.keys(d.siteRecordPaths || {}).some(k => k.startsWith(rid + '_')) ? page : false; }, 'customer exact published record and authenticated photo');
                const stack = await mp.evaluate(() => getCurrentPages().map(p => p.route)); assert.equal(stack.at(-1), 'packages/assistant/chat/chat');
                const file = path.join(trialOutput, 'published-customer.png'); await mp.screenshot({ path: file }); const bytes = fs.readFileSync(file);
                report.captures.push({ target: file, route: stack.at(-1), stack, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] });
                assert.ok(customer); save(); return { recordId: rid, customerReentry: true };
              });
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
