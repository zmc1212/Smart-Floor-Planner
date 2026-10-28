import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { SiteChatService } from '@/lib/construction/site-chat';
import { querySiteIssues, resolveSiteIssueQuery } from '@/lib/construction/site-queries';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

const f = new D4SharingFixture();
const excerpt = '靠窗双人办公，电脑和台灯各留插座';
let bookIssue = '', livingIssue = '', drawingId = '', mediaId = '';
const site = () => f.site(f.memberIds[0]);
const send = async (text: string, key = randomUUID()) => {
  const s = site(), body = { text, mediaIds: [], versions: (await s.read(f.projectId)).versions };
  return { result: await s.send(f.projectId, body, key), key, body };
};
async function response(messageId: string, s = site()) {
  const view = await s.read(f.projectId, undefined, 100);
  return (view.items as Row[]).find(i => String((i.message as Row).id) === messageId)!.response as Row;
}
const counts = () => withTenantTransaction(f.eid, tx => one(tx, sql`select
  (select count(*) from app.construction_site_records where enterprise_id=${f.eid}) records,
  (select count(*) from app.assistant_runs where enterprise_id=${f.eid}) runs,
  (select count(*) from app.ai_provider_attempts where enterprise_id=${f.eid}) attempts,
  (select count(*) from app.domain_event_outbox where enterprise_id=${f.eid} and type like 'construction.site.issue.%') issues`));

before(async () => {
  await f.create();
  assert.equal((await f.send('共享测试工地甲·书房需求：' + excerpt)).runId, null);
  const bytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer();
  mediaId = String((await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), bytes, 'image', '')).id);
  assert.equal((await f.send('共享测试工地甲·书房点位图：书房插座点位参考V2，现场尺寸仍待核对。')).runId, null);
  drawingId = (await f.sources()).sources.find(s => s.kind === 'drawing')!.id;
  assert.equal((await f.send('共享测试工地甲·客厅需求：LIVING_ONLY 电视墙插座的位置待核对。')).runId, null);
  for (const room of (await f.site().read(f.projectId)).rooms as Row[]) {
    const text = `${room.name}线管今天铺好了，底盒还没固定，等待核对位置。`;
    const sent = await f.site(f.memberIds[1]).send(f.projectId, { text, mediaIds: [] }, randomUUID());
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: room.name + '底盒待核对', roomId: String(room.id),
      completed: '线管已铺好', pending: '底盒还没固定', coordination: '核对位置', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null,
      usage: { inputTokens: 0, outputTokens: 0 } }));
    const opened = await send('跟进记录' + sent.recordId + '：' + room.name + '底盒位置核对');
    const iid = String(opened.result.issueId);
    if (room.name === '书房') bookIssue = iid; else livingIssue = iid;
    await send('接手事项' + iid);
    await send('回复事项' + iid + '：' + room.name + '还在核对尺寸，位置暂未确认。');
  }
});
after(async () => {
  try { if (process.env.D4_EVIDENCE_DIRECTORY && f.eid) fs.writeFileSync(path.join(process.env.D4_EVIDENCE_DIRECTORY, 'site-context-fixture.json'), JSON.stringify(await f.snapshot(), null, 2)); }
  finally { await f.cleanup(); await closePostgresPool(); }
});

test('a natural combined room question returns its live issue, exact shared drawing and need without writes or other-room content', async () => {
  const beforeCounts = await counts();
  const sent = await send('书房底盒现在在等谁处理，帮我找对应图纸和需求。');
  assert.equal(sent.result.runId, null); assert.equal(sent.result.recordId, null);
  const view = await response(String(sent.result.messageId));
  assert.match(String(view.text), new RegExp('事项' + bookIssue));
  assert.ok(String(view.text).includes(excerpt)); assert.match(String(view.text), /书房插座点位参考V2/);
  assert.doesNotMatch(String(view.text), new RegExp('事项' + livingIssue + '|LIVING_ONLY|PRIVATE_DO_NOT_SHARE'));
  assert.ok((view.media as Row[]).some(m => m.id === `shared-${drawingId}-${mediaId}`));
  assert.deepEqual(await site().send(f.projectId, sent.body, sent.key), sent.result);
  assert.deepEqual((await site().operation(f.projectId, sent.key)).result, sent.result);
  const reopened = await response(String(sent.result.messageId), new SiteChatService(site().staff));
  assert.equal(reopened.text, view.text); assert.deepEqual(await counts(), beforeCounts);
});

test('room clarification, correction and explicit project scope never select the latest unrelated item', async () => {
  const beforeCounts = await counts();
  for (const text of ['这件事现在在等谁？', '书房和客厅这件事在等谁处理？']) {
    const q = await send(text), view = await response(String(q.result.messageId));
    assert.match(String(view.text), /请说明.*具体房间/);
    assert.doesNotMatch(String(view.text), new RegExp('事项' + bookIssue + '|事项' + livingIssue));
  }
  const book = await send('书房这件事现在在等谁？');
  assert.doesNotMatch(String((await response(String(book.result.messageId))).text), new RegExp('事项' + livingIssue));
  const corrected = await send('刚才说错了，是客厅这件事在等谁处理？');
  const correctedView = await response(String(corrected.result.messageId));
  assert.match(String(correctedView.text), new RegExp('事项' + livingIssue));
  assert.doesNotMatch(String(correctedView.text), new RegExp('事项' + bookIssue));
  const all = await send('本项目的事项现在分别在等谁？');
  const allView = await response(String(all.result.messageId));
  assert.match(String(allView.text), new RegExp('事项' + bookIssue)); assert.match(String(allView.text), new RegExp('事项' + livingIssue));
  assert.deepEqual(await counts(), beforeCounts);
});

test('explicit item identity supplies only its actual room and a contradictory room requires clarification', async () => {
  const q = await send('事项' + bookIssue + '现在在等谁？帮我找对应图纸和需求。');
  const view = await response(String(q.result.messageId));
  assert.ok(String(view.text).includes(excerpt));
  assert.doesNotMatch(String(view.text), /LIVING_ONLY/);
  const wrong = await send('客厅事项' + bookIssue + '现在在等谁？帮我找对应图纸和需求。');
  const wrongView = await response(String(wrong.result.messageId));
  assert.match(String(wrongView.text), /请说明.*具体房间/); assert.equal((wrongView.media as Row[]).length, 0);
  assert.doesNotMatch(String(wrongView.text), new RegExp('事项' + bookIssue + '|LIVING_ONLY|' + excerpt));
  for (const badId of ['9999999999999999999', '99999999999999999999', '0']) {
    const malformed = await send('事项' + badId + '现在在等谁？');
    assert.match(String((await response(String(malformed.result.messageId))).text), /请说明.*具体房间/);
  }
  const outsideOverview = await withTenantTransaction(f.eid, async tx => querySiteIssues(tx, f.eid, f.projectId,
    await resolveSiteIssueQuery(tx, f.eid, f.projectId, '事项' + bookIssue + '现在在等谁？'), []));
  assert.match(outsideOverview, new RegExp('事项' + bookIssue));
});

test('historical issue replies recover room scope from the original question without a migration', async () => {
  const q = await send('书房这件事现在在等谁？');
  await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.domain_event_outbox set payload=payload-'issueQueryScope'
    where enterprise_id=${f.eid} and type='construction.chat.response.v1' and aggregate_id=${String(q.result.messageId)}`));
  const view = await response(String(q.result.messageId));
  assert.match(String(view.text), new RegExp('事项' + bookIssue));
  assert.doesNotMatch(String(view.text), new RegExp('事项' + livingIssue));
});

test('room changes invalidate the persisted combined scope instead of switching to another room on reentry', async () => {
  const q = await send('书房底盒现在在等谁处理，帮我找图纸和需求。');
  const rename = async (name: string) => f.owner.execute('room', { projectId: f.projectId, roomId: f.roomId, name,
    expectedVersion: ((await f.owner.execute('detail', { projectId: f.projectId })).project as Row).version }, randomUUID());
  try {
    await rename('书斋');
    const view = await response(String(q.result.messageId));
    assert.match(String(view.text), /请说明.*具体房间/); assert.match(String(view.text), /资料已变化/);
    assert.doesNotMatch(String(view.text), /书房插座点位参考V2|LIVING_ONLY|靠窗双人办公/);
    assert.equal((view.media as Row[]).length, 0);
  } finally { await rename('书房'); }
});

test('withdrawal invalidates both parts of an old combined answer and removes the authenticated drawing on reentry', async () => {
  const q = await send('书房这件事在等谁处理，帮我找图纸和需求。');
  await f.send('撤回共享资料' + drawingId);
  const view = await response(String(q.result.messageId));
  assert.match(String(view.text), /资料已变化/); assert.match(String(view.text), /原材料或房间已变化/);
  assert.doesNotMatch(String(view.text), /书房插座点位参考V2|书房还在核对尺寸/);
  assert.equal((view.media as Row[]).length, 0);
  await assert.rejects(site().materialMedia(f.projectId, drawingId, mediaId));
  const fresh = await send('书房这件事在等谁处理，帮我找图纸和需求。');
  assert.match(String((await response(String(fresh.result.messageId))).text), /缺项.*点位图/);
});

test('live membership, selected enterprise management and private-consultation boundaries remain authoritative', async () => {
  await send('书房底盒现在在等谁处理，帮我找对应图纸和需求。');
  for (const aid of [f.ownerIds[0], ...f.platformIds]) {
    const view = await f.site(aid).read(f.projectId, undefined, 100);
    assert.ok(JSON.stringify(view).includes(excerpt)); assert.ok(!JSON.stringify(view).includes('PRIVATE_DO_NOT_SHARE'));
  }
  await assert.rejects(site().read(f.otherProjectId));
  await assert.rejects(f.site(f.ownerIds[1]).read(f.projectId));
  await assert.rejects(f.site(f.memberIds[2]).send(f.projectId, { text: '书房的事项在等谁？', mediaIds: [] }, randomUUID()));
  await f.member(f.memberIds[0], 'designer', false);
  await assert.rejects(site().read(f.projectId)); await assert.rejects(site().operation(f.projectId, randomUUID()));
  await assert.rejects(site().materialMedia(f.projectId, drawingId, mediaId));
});
