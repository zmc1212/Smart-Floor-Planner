import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';

after(closePostgresPool);
async function fixture(name: string, run: (f: D4SharingFixture) => Promise<void>) {
  const f = new D4SharingFixture();
  try {
    await f.create({ runtime: 'langgraph-v1', providerKey: 'deepseek', model: 'deepseek-flash', tools: true, imageInput: true, probeVersion: 'watch-no-provider' });
    await run(f);
  } finally {
    if (process.env.D4_EVIDENCE_DIRECTORY && f.eid) fs.writeFileSync(path.join(process.env.D4_EVIDENCE_DIRECTORY, name + '.json'), JSON.stringify({ ...(await f.snapshot()), watches: await watches(f) }, null, 2));
    await f.cleanup();
  }
}
const watches = (f: D4SharingFixture) => withTenantTransaction(f.eid, tx => rows(tx, sql`select id::text,project_id::text,room_id::text,photos_only,active,source_message_id::text from app.construction_watches where enterprise_id=${f.eid} order by id`));
const pending = (f: D4SharingFixture) => withTenantTransaction(f.eid, async tx => (await new AssistantRepository(tx, f.actor).conversation(f.conversationId)).entry_snapshot as Row);
async function inert(f: D4SharingFixture, text: string) {
  // Engineering guard check: persist the actual whole user text without scheduling an unrelated model answer.
  return withTenantTransaction(f.eid, async tx => {
    const c = await new AssistantRepository(tx, f.actor).conversation(f.conversationId);
    const message = await appendMessage(tx, f.actor, f.conversationId, { author: 'user', clientMessageId: randomUUID(), content: { version: 1, blocks: [{ type: 'text', text }] } });
    return siteWatchInterceptor.apply(tx, f.actor, c, message);
  });
}
async function publish(f: D4SharingFixture, roomId = f.roomId, photos = true) {
  const media = photos ? await f.site().upload(f.projectId, randomUUID(), await sharp({ create: { width: 48, height: 40, channels: 3, background: '#427511' } }).jpeg().toBuffer()) : null;
  const sent = await f.site().send(f.projectId, { text: '书房线管已铺好，底盒等待设计师核对。', mediaIds: media ? [String(media.id)] : [] }, randomUUID());
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房施工进展', roomId, completed: '线管已铺好', pending: '底盒等待设计师核对', coordination: '', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const record = ((await f.site().read(f.projectId)).items as Row[]).find(i => (i.record as Row)?.id === sent.recordId)!.record as Row;
  await f.site().mutate(f.projectId, String(sent.recordId), 'publish', { expectedVersion: record.version, audience: 'customer' }, randomUUID());
  return String(sent.recordId);
}

test('room clarification survives reentry and colloquial selection writes exactly one photo watch', () => fixture('room-reentry', async f => {
  assert.equal((await f.send('测试工地甲书房和客厅有新照片告诉我')).runId, null);
  assert.equal((await pending(f)).siteWatchQuestion && ((await pending(f)).siteWatchQuestion as Row).projectId, f.projectId);
  assert.ok(JSON.stringify(await f.chat.messages(f.conversationId)).includes('想关注哪个房间'));
  const key = randomUUID(), sent = await f.send('就书房吧', key);
  assert.equal(sent.runId, null); assert.deepEqual(await f.send('就书房吧', key), sent);
  const list = await watches(f); assert.equal(list.length, 1); assert.equal(list[0].room_id, f.roomId); assert.equal(list[0].photos_only, true);
  assert.equal((await pending(f)).siteWatchQuestion, undefined);
  assert.ok((await f.chat.messages(f.conversationId)).items.some(m => m.siteWatch));
}));

test('project-only clarification retains the requested room, while an explicit new room replaces it', () => fixture('project-room-correction', async f => {
  await f.send('书房有新照片告诉我');
  assert.equal((await watches(f)).length, 0);
  assert.equal((await f.send('那就测试工地乙吧')).runId, null);
  let list = await watches(f); assert.equal(list.length, 1); assert.equal(list[0].project_id, f.otherProjectId);
  await f.send('书房有新照片告诉我');
  assert.equal((await f.send('就测试工地甲的客厅吧')).runId, null);
  list = await watches(f); const added = list.find(w => w.project_id === f.projectId)!;
  const room = await withTenantTransaction(f.eid, tx => one(tx, sql`select name from app.construction_rooms where enterprise_id=${f.eid} and id=${added.room_id}`));
  assert.equal(room!.name, '客厅');
}));

test('published photos arrive offline once; plain cancellation works in human mode and prevents later delivery', () => fixture('delivery-cancel', async f => {
  await f.send('测试工地甲书房和客厅有新照片告诉我'); await f.send('就书房吧');
  const recordId = await publish(f);
  assert.ok(await deliverSiteNotifications() >= 1);
  let history = await f.chat.messages(f.conversationId);
  assert.equal(history.items.filter(m => (m.siteRecord as Row)?.id === recordId).length, 1);
  assert.equal((await f.chat.messages(f.conversationId)).items.filter(m => (m.siteRecord as Row)?.id === recordId).length, 1);
  await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${f.eid} and id=${f.conversationId}`));
  assert.equal((await f.send('不用提醒了')).runId, null);
  assert.ok((await watches(f)).every(w => !w.active));
  await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${f.eid} and id=${f.conversationId}`));
  const laterId = await publish(f); await deliverSiteNotifications();
  history = await f.chat.messages(f.conversationId);
  assert.ok(!history.items.some(m => (m.siteRecord as Row)?.id === laterId));
  assert.ok(!history.items.some(m => m.siteWatch));
}));

test('scoped cancellation preserves other rooms and other projects; questions do not cancel', () => fixture('scoped-cancel', async f => {
  for (const text of ['测试工地甲书房有新照片告诉我', '测试工地甲客厅有新照片告诉我', '测试工地乙书房有新照片告诉我']) await f.send(text);
  for (const text of ['我不是说不用提醒了', '不用提醒了是什么意思', '不要停止提醒', '书房不用提醒了，客厅继续提醒']) assert.equal(await inert(f, text), false);
  assert.equal((await watches(f)).filter(w => w.active).length, 3);
  await f.send('测试工地甲书房不用提醒了');
  const active = (await watches(f)).filter(w => w.active); assert.equal(active.length, 2);
  assert.ok(active.some(w => w.project_id === f.otherProjectId));
  assert.ok(active.some(w => w.project_id === f.projectId && w.room_id !== f.roomId));
}));

test('human-mode clarification may finish a cancellation but cannot turn into a new subscription', () => fixture('human-cancel-clarification', async f => {
  await f.send('测试工地甲书房有新照片告诉我'); await f.send('测试工地乙书房有新照片告诉我');
  await f.send('书房不用提醒了');
  assert.equal(((await pending(f)).siteWatchQuestion as Row).cancel, true);
  await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${f.eid} and id=${f.conversationId}`));
  assert.equal(await inert(f, '测试工地甲客厅有新照片告诉我'), false);
  // The unrelated sentence clears its question in normal AI mode only; the
  // pending cancellation remains available while a human owns the conversation.
  assert.equal((await f.send('那就测试工地甲吧')).runId, null);
  const active = (await watches(f)).filter(w => w.active);
  assert.equal(active.length, 1); assert.equal(active[0].project_id, f.otherProjectId);
}));

test('failed receipt transaction rolls back the write and original-key retry recovers without duplicates', () => fixture('rollback-retry', async f => {
  await f.send('测试工地甲书房和客厅有新照片告诉我');
  const key = randomUUID(), content = { version: 1, blocks: [{ type: 'text', text: '就书房吧' }] };
  await assert.rejects(f.chat.send(f.conversationId, key, content, { ...siteWatchInterceptor, async apply(tx, actor, c, message) {
    await siteWatchInterceptor.apply(tx, actor, c, message); throw Error('Synthetic receipt transaction outage');
  } }), /Synthetic receipt transaction outage/);
  assert.equal((await watches(f)).length, 0); assert.ok((await pending(f)).siteWatchQuestion);
  const sent = await f.send('就书房吧', key); assert.equal(sent.runId, null);
  assert.deepEqual(await f.send('就书房吧', key), sent); assert.equal((await watches(f)).length, 1);
}));

test('access revocation between clarification turns cannot silently select the remaining project', () => fixture('revoked-project', async f => {
  await f.send('测试工地甲书房和客厅有新照片告诉我');
  await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.construction_projects set customer_access=false where enterprise_id=${f.eid} and id=${f.projectId}`));
  assert.equal((await f.send('就书房吧')).runId, null);
  assert.equal((await watches(f)).length, 0);
  assert.ok(JSON.stringify(await f.chat.messages(f.conversationId)).includes('想关注哪个工地'));
  const other = new ConversationService({ ...f.actor, enterpriseId: f.enterpriseIds[1] });
  await assert.rejects(other.messages(f.conversationId));
  const stranger = new ConversationService({ ...f.actor, principal: { kind: 'user', userId: f.userIds[1] } });
  await assert.rejects(stranger.send(f.conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '不用提醒了' }] }, siteWatchInterceptor));
  assert.equal((await watches(f)).length, 0);
}));
