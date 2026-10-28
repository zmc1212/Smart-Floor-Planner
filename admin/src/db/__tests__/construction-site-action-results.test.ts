import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { processSiteAction } from '@/lib/construction/site-action-worker';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { customerMaterialReviews, customerSiteResults, deliverSiteResults } from '@/lib/construction/site-results';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

after(closePostgresPool);
async function fixture(work: (f: D4SharingFixture, iid: string, drawingId: string) => Promise<void>) {
  const f = new D4SharingFixture();
  try {
    await f.create(); await f.send('共享测试工地甲·书房需求：双人办公，插座位置仍需现场复核。');
    const bytes = await sharp({ create: { width: 48, height: 40, channels: 3, background: '#b7d9ca' } }).png().toBuffer();
    await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), bytes, 'image', '');
    await f.send('共享测试工地甲·书房点位图：V2参考点位，未批准施工。');
    const drawingId = (await f.sources()).sources.find(s => s.kind === 'drawing')!.id;
    const sent = await f.site(f.memberIds[1]).send(f.projectId, { text: '书房底盒今天还没固定，等待核对位置。', mediaIds: [] }, randomUUID());
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房底盒', roomId: f.roomId, completed: '', pending: '底盒未固定', coordination: '核对位置', note: '' }),
      toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 10, outputTokens: 10 } }));
    const opened = await say(f, f.memberIds[1], '跟进记录' + sent.recordId + '：PRIVATE_REQUEST 核对底盒位置');
    const iid = String(opened.issueId); await say(f, f.memberIds[0], '接手事项' + iid);
    await work(f, iid, drawingId);
  } finally { await f.cleanup(); }
}
async function say(f: D4SharingFixture, aid: string, text: string, key = randomUUID(), body?: Row) {
  const service = f.site(aid); return service.send(f.projectId, body || { text, mediaIds: [], versions: (await service.read(f.projectId)).versions }, key);
}
const issue = (f: D4SharingFixture, iid: string) => withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, iid));
async function proposal(f: D4SharingFixture, aid: string, iid: string, action: 'check' | 'return', text: string, expected = 'succeeded') {
  const sent = await say(f, aid, text), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteAction(lease!, async messages => {
    const input = JSON.parse(String((messages[1].content as { text: string }[])[0].text));
    assert.doesNotMatch(JSON.stringify(input), /PRIVATE_DO_NOT_SHARE/);
    if (action === 'check') assert.equal(input.issues.find((i: Row) => i.id === iid).drawings.length, 1);
    return { text: JSON.stringify({ action, target: iid }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 10 } };
  });
  const run = await withTenantTransaction(f.eid, tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${f.eid} and id=${String(sent.runId)}`));
  assert.equal(run!.status, expected, JSON.stringify(run)); return sent;
}
async function checkedReply(f: D4SharingFixture, iid: string, drawingId: string) {
  await say(f, f.memberIds[0], '核对事项' + iid + '图纸' + drawingId);
  await say(f, f.memberIds[0], '回复事项' + iid + '：PRIVATE_INTERNAL_REPLY 桌子摆位仍需现场复核，不能按本句施工。');
}

test('natural human drawing-check preview names the exact original and cannot be confirmed by a peer or an acknowledgement', async () => fixture(async (f, iid, drawingId) => {
  const before = (await issue(f, iid))!;
  const sent = await proposal(f, f.memberIds[0], iid, 'check', '书房这份图纸我已经人工核对过，请把关联记在底盒这件事上。');
  const response = ((await f.site().read(f.projectId)).items as Row[]).find(i => (i.message as Row).id === sent.messageId)!.response as Row;
  assert.match(String(response.text), new RegExp('图纸资料' + drawingId)); assert.match(String(response.text), /确认核对图纸/);
  await say(f, f.memberIds[0], '收到'); await say(f, f.ownerIds[0], '确认核对图纸');
  assert.equal((await issue(f, iid))!.revision, before.revision);
  await say(f, f.memberIds[0], '确认核对图纸');
  const current = (await issue(f, iid))!; assert.equal(current.revision, before.revision + 1); assert.equal(current.drawingGrantId, drawingId);
  assert.equal(current.state, 'awaiting_owner'); assert.equal(await deliverSiteResults(), 0);
}));

test('the manager confirms only its own exact excerpt to the original consultation, once, while internal replies remain private', async () => fixture(async (f, iid, drawingId) => {
  await checkedReply(f, iid, drawingId);
  const text = '请把书房底盒这条给业主回传：图纸已核对关联，先不要固定，等现场把桌子摆位核准。';
  const sent = await proposal(f, f.ownerIds[0], iid, 'return', text);
  assert.equal(await deliverSiteResults(), 0);
  await say(f, f.memberIds[0], '确认回传'); await say(f, f.ownerIds[0], '好的'); assert.equal(await deliverSiteResults(), 0);
  const key = randomUUID(), body = { text: '确认回传', mediaIds: [], versions: (await f.site().read(f.projectId)).versions };
  const result = await say(f, f.ownerIds[0], '确认回传', key, body); assert.deepEqual(await say(f, f.ownerIds[0], '确认回传', key, body), result);
  assert.equal(await deliverSiteResults(), 1); assert.equal(await deliverSiteResults(), 0);
  const results = await withTenantTransaction(f.eid, tx => customerSiteResults(tx, f.eid, f.userIds[0], f.conversationId));
  assert.equal(results.length, 1); assert.ok(results[0].text.includes(text)); assert.doesNotMatch(JSON.stringify(results), /PRIVATE_REQUEST|PRIVATE_INTERNAL_REPLY/);
  const reviews = await withTenantTransaction(f.eid, tx => customerMaterialReviews(tx, f.eid, f.userIds[0], f.conversationId));
  assert.equal(reviews[0].drawingGrantId, drawingId); assert.equal(reviews[0].issueRevision, (await issue(f, iid))!.revision);
  const other = String((await f.chat.create(randomUUID())).id);
  assert.deepEqual(await withTenantTransaction(f.eid, tx => customerSiteResults(tx, f.eid, f.userIds[0], other)), []);
  const event = await withTenantTransaction(f.eid, tx => one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.site.action.confirmed.v1' and aggregate_id=${String(sent.runId)}`));
  assert.equal((event!.payload as Row).sourceMessageId, sent.messageId);
}));

test('a model-selected customer return cannot bypass the actual member management boundary', async () => fixture(async (f, iid, drawingId) => {
  await checkedReply(f, iid, drawingId); const before = (await issue(f, iid))!.revision;
  const sent = await proposal(f, f.memberIds[0], iid, 'return', '请把书房底盒这条回复给业主：位置还要核对。', 'failed');
  const run = await withTenantTransaction(f.eid, tx => one(tx, sql`select error_code from app.assistant_runs where enterprise_id=${f.eid} and id=${String(sent.runId)}`));
  assert.equal(run!.error_code, 'construction_forbidden'); await say(f, f.memberIds[0], '确认回传');
  assert.equal((await issue(f, iid))!.revision, before); assert.equal(await deliverSiteResults(), 0);
}));

test('drawing revocation between preview and confirmation invalidates the exact human check without substituting another original', async () => fixture(async (f, iid, drawingId) => {
  await proposal(f, f.memberIds[0], iid, 'check', '书房共享图纸我已人工核对，请记录与底盒事项的关联。');
  await f.send('撤回共享资料' + drawingId);
  await assert.rejects(say(f, f.memberIds[0], '确认核对图纸'), /context_changed/);
  assert.equal((await issue(f, iid))!.drawingGrantId, undefined);
}));

test('a revoked need prevents a pending manager return and clears an already delivered exact-version result on reentry', async () => fixture(async (f, iid, drawingId) => {
  await checkedReply(f, iid, drawingId);
  await proposal(f, f.ownerIds[0], iid, 'return', '请把书房底盒的处理回给业主：仍待现场核准。');
  await say(f, f.ownerIds[0], '确认回传'); await deliverSiteResults();
  await proposal(f, f.ownerIds[0], iid, 'return', '请再把书房底盒这条回给业主：暂时不固定。');
  const need = (await f.sources()).sources.find(s => s.kind === 'need')!; await f.send('撤回共享资料' + need.id);
  await assert.rejects(say(f, f.ownerIds[0], '确认回传'), /context_changed/);
  const results = await withTenantTransaction(f.eid, tx => customerSiteResults(tx, f.eid, f.userIds[0], f.conversationId));
  assert.equal(results[0].status, 'invalidated');
  assert.deepEqual(await withTenantTransaction(f.eid, tx => customerMaterialReviews(tx, f.eid, f.userIds[0], f.conversationId)), []);
}));

test('enterprise owner, admin and super_admin inherit the same explicitly selected-enterprise return without employee membership', async () => fixture(async (f, iid, drawingId) => {
  await checkedReply(f, iid, drawingId);
  for (const aid of [f.ownerIds[0], ...f.platformIds]) {
    await proposal(f, aid, iid, 'return', '请把书房底盒处理回传给业主：点位仍需现场复核。');
    await say(f, aid, '确认回传'); assert.equal((await issue(f, iid))!.action, 'return');
  }
  await deliverSiteResults();
  const results = await withTenantTransaction(f.eid, tx => customerSiteResults(tx, f.eid, f.userIds[0], f.conversationId));
  assert.equal(results[0].status, 'awaiting_review');
}));
