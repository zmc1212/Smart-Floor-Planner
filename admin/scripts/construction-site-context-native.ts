/* eslint-disable @typescript-eslint/no-explicit-any -- Stable SDK and isolated synthetic DTOs. */
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
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { D4SharingFixture } from './assistant-d4-sharing-fixture';
import { wechatideNativeClient } from './wechatide-native-client';
import { run as runSharedChat } from './construction-chat-native.mjs';

type Row = Record<string, any>;
declare function getApp(): Row;
declare function getCurrentPages(): Row[];
const admin = process.cwd(), root = path.dirname(admin); loadEnvConfig(admin, true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const name = process.argv[2]; assert.match(name, /^d4-site-context-native-[a-z0-9-]+$/);
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const f = new D4SharingFixture(), project = path.join(root, 'miniprogram'), apiOrigin = 'http://127.0.0.1:3117';
const report: Row = { delivery: 'D4', scope: 'Deterministic same-room combined issue/material reads through existing S04, real signed HTTP, original media, reentry and revocation. Seed extraction is injected; no provider semantic or whole-D4 claim.',
  started: new Date().toISOString(), providerCalls: 0, passed: false, captures: [], checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const binding = () => {
  const files: string[] = [];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai/providers',
    'miniprogram/packages/assistant', 'miniprogram/packages/construction']) {
    const walk = (folder: string) => { for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + item.name; if (item.isDirectory()) walk(file); else if (/\.(ts|js|mjs|json|wxml|less|png)$/.test(file)) files.push(file);
    } }; walk(dir);
  }
  files.push('admin/scripts/construction-site-context-native.ts', 'admin/scripts/construction-site-context-native.mjs',
    'admin/scripts/construction-chat-native.mjs', 'admin/scripts/assistant-d4-sharing-fixture.ts', 'admin/scripts/assistant-acceptance-safety.mjs',
    'admin/scripts/assistant-d4-runtime-config.mjs', 'admin/scripts/wechatide-native-client.ts', 'admin/scripts/wechatide-window-state.ps1',
    'tmp/wechat-devtools-version-test/window.ps1', 'admin/src/app/api/miniprogram/construction/[[...path]]/route.ts',
    'admin/src/lib/miniprogram-jwt.ts', 'admin/src/lib/miniprogram-auth.ts', 'admin/src/lib/miniprogram-identity-context.ts', 'admin/src/lib/admin-user-roles.ts',
    'admin/package-lock.json', 'admin/.env.local', 'miniprogram/utils/api.js', 'tmp/xiaok-vector/connection.private.json', path.relative(root, process.env.TSX_TSCONFIG_PATH!));
  return Object.fromEntries([...new Set(files)].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
};
let release: (() => Promise<void>) | undefined, server: http.Server | undefined;
const originalFetch = globalThis.fetch;
const s = () => f.site(f.memberIds[0]);
const say = async (text: string) => s().send(f.projectId, { text, mediaIds: [], versions: (await s().read(f.projectId)).versions }, randomUUID());
let bookIssue = '', livingIssue = '', drawingId = '', mediaId = '';
const excerpt = '靠窗双人办公，电脑和台灯各留插座';
async function seed() {
  await f.create();
  assert.equal((await f.send('共享测试工地甲·书房需求：' + excerpt)).runId, null);
  mediaId = String((await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(),
    await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer(), 'image', '')).id);
  assert.equal((await f.send('共享测试工地甲·书房点位图：书房插座点位参考V2，现场尺寸仍待核对。')).runId, null);
  drawingId = (await f.sources()).sources.find(v => v.kind === 'drawing')!.id;
  assert.equal((await f.send('共享测试工地甲·客厅需求：LIVING_ONLY 电视墙插座的位置待核对。')).runId, null);
  for (const room of (await f.site().read(f.projectId)).rooms as Row[]) {
    const sent = await f.site(f.memberIds[1]).send(f.projectId, { text: `${room.name}线管今天铺好了，底盒还没固定，等待核对位置。`, mediaIds: [] }, randomUUID());
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: room.name + '底盒待核对', roomId: String(room.id),
      completed: '线管已铺好', pending: '底盒还没固定', coordination: '核对位置', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null,
      usage: { inputTokens: 0, outputTokens: 0 } }));
    const opened = await say('跟进记录' + sent.recordId + '：' + room.name + '底盒位置核对');
    const iid = String(opened.issueId); if (room.name === '书房') bookIssue = iid; else livingIssue = iid;
    await say('接手事项' + iid); await say('回复事项' + iid + '：' + room.name + '还在核对尺寸，位置暂未确认。');
  }
}
async function main() {
  report.imported = binding(); save();
  try {
    release = await lockAssistantAcceptance(process.env.DATABASE_URL!, { waitForLock: true });
    assert.deepEqual(binding(), report.imported, 'Source changed while waiting for the native acceptance lock');
    await seed();
    const identities: Row[] = [];
    for (const [index, adminId] of [f.ownerIds[0], f.memberIds[0], f.memberIds[1]].entries()) {
      const role = (['enterprise_admin', 'designer', 'construction_staff'] as const)[index];
      const uid = await withPlatformTransaction(async tx => {
        const id = String((await one(tx, sql`insert into app.users(nickname,role,context_version) values(${f.prefix + role},'staff',1) returning id`))!.id);
        await tx.execute(sql`update app.users set phone=${'199' + id.padStart(8, '0')} where id=${id}`);
        await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${f.prefix + role})`);
        await tx.execute(sql`update app.admin_users set user_id=${id} where enterprise_id=${f.eid} and id=${adminId}`);
        return id;
      });
      f.userIds.push(uid);
      identities.push({ role, adminId, enterpriseId: f.eid, token: await signMiniProgramToken({ sub: uid, id: uid, contextVersion: 1,
        mode: 'staff', role, staffRole: role, staffId: adminId, enterpriseId: f.eid, source: 'wechat' }) });
    }
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Deterministic acceptance cannot dispatch external inference');
      return originalFetch(input, init);
    };
    server = http.createServer(async (incoming, outgoing) => {
      try {
        assert.ok(identities.some(i => incoming.headers.authorization === 'Bearer ' + i.token));
        const parts: Buffer[] = []; for await (const chunk of incoming) parts.push(Buffer.from(chunk));
        const request = new NextRequest(apiOrigin + incoming.url, { method: incoming.method, headers: incoming.headers as HeadersInit,
          ...(incoming.method === 'POST' ? { body: new Uint8Array(Buffer.concat(parts)) } : {}) });
        const pathname = new URL(request.url).pathname, prefix = '/api/miniprogram/construction/';
        assert.ok(pathname.startsWith(prefix));
        const result = await constructionHttp(request, { params: Promise.resolve({ path: pathname.slice(prefix.length).split('/') }) });
        const bytes = Buffer.from(await result.arrayBuffer());
        if (result.ok && incoming.method === 'POST') assert.equal(JSON.parse(bytes.toString()).data.runId, null, 'Queries must not schedule inference');
        outgoing.writeHead(result.status, Object.fromEntries(result.headers.entries())); outgoing.end(bytes);
      } catch (error) { report.bridgeError = String(error); outgoing.writeHead(500, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3117, '127.0.0.1', resolve); });
    report.httpPreflight = [];
    for (const identity of identities) {
      const result = await fetch(apiOrigin + '/api/miniprogram/construction/projects/' + f.projectId + '/chat', { headers: { Authorization: 'Bearer ' + identity.token } });
      const data = await result.json();
      report.httpPreflight.push({ role: identity.role, status: result.status, projectId: data.data?.project?.id, error: data.error });
      assert.equal(result.status, 200, JSON.stringify(data)); assert.equal(data.data.project.id, f.projectId);
    }
    const probe = wechatideNativeClient(project, output);
    report.exactProject = await probe.call('automation_runtime_info', { project, action: 'systemInfo' });
    fs.writeFileSync(path.join(output, 'window-launch.json'), JSON.stringify({ projectPath: project, autoPort: 9420 }));
    report.before = binding(); save();
    report.native = await runSharedChat({ root, output, projectId: f.projectId, identities, apiOrigin, refreshWithCli: true, recordPreview: true,
      exercise: async ({ mp, step, identity, open, send, current, waitFor, capture }: Row) => {
        await identity(1);
        let queryId = '';
        const imageKey = `shared-${drawingId}-${mediaId}`;
        await step('natural combined question, actual same-key response-loss recovery and authenticated original image', async () => {
          const row = await send('书房底盒现在在等谁处理，帮我找对应图纸和需求。', true); queryId = String(row.message.id);
          assert.match(row.response.text, new RegExp('事项' + bookIssue)); assert.ok(row.response.text.includes(excerpt));
          assert.match(row.response.text, /书房插座点位参考V2/); assert.doesNotMatch(row.response.text, new RegExp('事项' + livingIssue + '|LIVING_ONLY|PRIVATE_DO_NOT_SHARE'));
          const p = await current(); await waitFor(async () => (await p.data()).mediaPaths[imageKey] && await p.$(`.photo-slot[data-id="${imageKey}"] image`), 'actual original image render');
          await (await p.$(`.photo-slot[data-id="${imageKey}"]`)).tap();
          await waitFor(async () => (await mp.evaluate(() => getApp().__qaShared.previewed))?.length, 'authenticated image preview after its asynchronous download');
          report.captures.push(await capture('combined-book')); return { queryId, bookIssue, imageKey, previewed: true };
        });
        await step('same-project reentry retains both parts and one committed original', async () => {
          const p = await open(), data = await p.data();
          const rows = data.items.filter((i: Row) => i.message.id === queryId); assert.equal(rows.length, 1);
          assert.ok(rows[0].response.text.includes(excerpt)); assert.match(rows[0].response.text, new RegExp('事项' + bookIssue));
          await waitFor(async () => (await p.data()).mediaPaths[imageKey], 'reentered original image');
          report.captures.push(await capture('combined-reentry')); return { queryId, oneOriginal: true };
        });
        await step('incomplete question clarifies and the corrected room never inherits the previous room', async () => {
          const unknown = await send('这件事现在在等谁？'); assert.match(unknown.response.text, /请说明.*具体房间/);
          const corrected = await send('刚才说错了，是客厅这件事在等谁处理？');
          assert.match(corrected.response.text, new RegExp('事项' + livingIssue)); assert.doesNotMatch(corrected.response.text, new RegExp('事项' + bookIssue));
          report.captures.push(await capture('room-correction')); return { livingIssue };
        });
        await step('customer withdrawal removes the old original and invalidates the combined answer on native reentry', async () => {
          await f.send('撤回共享资料' + drawingId);
          await open(); const p = await current();
          const row = (await p.data()).items.find((i: Row) => i.message.id === queryId); assert.ok(row);
          assert.match(row.response.text, /资料已变化/); assert.doesNotMatch(row.response.text, /书房插座点位参考V2|书房还在核对尺寸/);
          await waitFor(async () => !(await p.data()).mediaPaths[imageKey], 'withdrawn original temp path cleared');
          await assert.rejects(s().materialMedia(f.projectId, drawingId, mediaId));
          const fresh = await send('书房底盒现在在等谁处理，帮我找对应图纸和需求。'); assert.match(fresh.response.text, /缺项.*点位图/);
          report.captures.push(await capture('withdrawn-reentry')); return { drawingId, originalUnavailable: true };
        });
        await step('live membership removal clears the same native chat, originals and write access', async () => {
          await f.member(f.memberIds[0], 'designer', false);
          await mp.redirectTo('/packages/construction/chat/chat?projectId=' + f.projectId);
          await waitFor(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length && !d.write; }, 'revoked native history and media');
          report.captures.push(await capture('member-revoked')); return { historyCleared: true };
        });
      } });
    report.checks = report.native.checks;
    report.passed = report.native.passed;
  } catch (error) {
    report.error = String((error as Error).stack || error);
    if (fs.existsSync(path.join(output, 'native.json'))) { report.native = JSON.parse(fs.readFileSync(path.join(output, 'native.json'), 'utf8')); report.checks = report.native.checks; }
  }
  finally {
    globalThis.fetch = originalFetch;
    const errors: string[] = [];
    try { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } } catch (error) { errors.push(String(error)); }
    try { if (f.eid) {
      report.attempts = await withTenantTransaction(f.eid, tx => rows(tx, sql`select id::text,status from app.ai_provider_attempts where enterprise_id=${f.eid}`));
      assert.equal(report.attempts.length, 0);
      fs.writeFileSync(path.join(output, 'fixture.json'), JSON.stringify(await f.snapshot(), null, 2));
    } } catch (error) { errors.push(String(error)); }
    finally { try { await f.cleanup(); report.fixtureCleaned = true; } catch (error) { errors.push(String(error)); } }
    report.after = binding(); report.drift = Object.keys(report.imported).filter(file => report.after[file] !== report.imported[file]);
    report.cleanupErrors = errors; report.finished = new Date().toISOString();
    report.passed = report.passed && !errors.length && !report.drift.length && !report.bridgeError && report.native?.transport?.active === false;
    save(); await release?.(); await closePostgresPool(); process.exitCode = report.passed ? 0 : 1;
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, captures: report.captures.length, drift: report.drift, cleanupErrors: errors, error: report.error, output }));
  }
}
void main();
