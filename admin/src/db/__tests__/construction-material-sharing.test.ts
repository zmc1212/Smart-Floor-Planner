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
import { safeText, type MessageContent } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { prepareMaterialShare } from '@/lib/construction/material-sharing';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

const f = new D4SharingFixture();
const excerpt = '书房靠窗双人办公，电脑和台灯各留插座';
let needGrantId = '', drawingId = '', mediaId = '', originalSourceId = '', originalConfirmationId = '';
const count = () => withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox
  where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
async function prepared(text: string, input: Row = {}) {
  const sent = await f.send(text), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processAgentAnswer(lease!, { model: async (_messages, tools) => {
    assert.ok(tools.some(t => t.name === 'prepare_material_share'));
    return { text: '', toolCalls: [{ id: randomUUID(), name: 'prepare_material_share', arguments: JSON.stringify({ project: '测试工地甲', room: '书房',
      kind: 'need', sourceMessageId: '', excerpt, ...input }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 25 } };
  } });
  const run = await f.chat.run(String(sent.runId)); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const output = (await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => String(m.id) === run.outputMessageId)!;
  return { sent, text: safeText(output.content as MessageContent) };
}
before(async () => { await f.create(); });
after(async () => {
  try {
    if (process.env.D4_EVIDENCE_DIRECTORY && f.eid) fs.writeFileSync(path.join(process.env.D4_EVIDENCE_DIRECTORY, 'service-trace.json'), JSON.stringify(await f.snapshot(), null, 2));
  } finally { await f.cleanup(); await closePostgresPool(); }
});

test('natural personal-recipient request produces a durable private team preview with no grant', async () => {
  const result = await prepared(`测试工地甲的${excerpt}，帮我把这段需求给设计师看看。`);
  originalSourceId = String(result.sent.messageId);
  assert.match(result.text, /尚未共享/); assert.match(result.text, /不能只开放给某位设计师/);
  assert.match(result.text, /观察员/); assert.ok(result.text.includes(excerpt));
  assert.doesNotMatch(result.text, /PRIVATE_DO_NOT_SHARE/);
  assert.equal((await f.sources()).sources.length, 0); assert.equal((await count())!.n, 0);
  const reopened = await f.chat.detail(f.conversationId); assert.equal(reopened.latestRun?.status, 'succeeded');
});
test('explicit customer team consent writes the exact excerpt once and survives lost-receipt retry/reentry', async () => {
  const key = randomUUID(), raw = '可以，把这段共享给这个项目团队，其他聊天不要发。';
  const first = await f.send(raw, key); assert.equal(first.runId, null); originalConfirmationId = String(first.messageId);
  assert.deepEqual(await f.send(raw, key), first);
  await f.send(raw);
  assert.equal((await count())!.n, 1);
  const source = (await f.sources()).sources[0]; needGrantId = source.id;
  assert.equal(source.text, excerpt); assert.equal(source.sourceMessageId, originalSourceId);
  assert.equal(source.consentMessageId, originalConfirmationId); assert.equal(source.audience, 'project_members');
  assert.equal(source.conversationId, f.conversationId);
  assert.ok((await f.chat.messages(f.conversationId, undefined, 100)).items.some(m => safeText(m.content as MessageContent).includes('资料' + needGrantId)));
});
test('only live project recipients read consented text; observers cannot write and managers inherit owner rights', async () => {
  const designer = f.site(f.memberIds[0]);
  await designer.send(f.projectId, { text: '帮我查书房的需求和资料', mediaIds: [], versions: (await designer.read(f.projectId)).versions }, randomUUID());
  for (const aid of [...f.ownerIds.slice(0, 1), ...f.memberIds, ...f.platformIds]) {
    const view = await f.site(aid).read(f.projectId);
    assert.ok(JSON.stringify(view).includes(excerpt), aid);
    assert.ok(!JSON.stringify(view).includes('PRIVATE_DO_NOT_SHARE'));
  }
  await assert.rejects(f.site(f.memberIds[2]).send(f.projectId, { text: '书房今天做好了', mediaIds: [] }, randomUUID()), /construction_forbidden/);
  assert.ok(!JSON.stringify(await f.site().read(f.otherProjectId)).includes(excerpt));
  await assert.rejects(f.site(f.ownerIds[1]).read(f.projectId));
  const other = new ConversationService({ ...f.actor, principal: { kind: 'user', userId: f.userIds[1] } });
  await assert.rejects(other.messages(f.conversationId));
});
test('unknown scope, forged source and source drift cannot turn a preview into a grant', async () => {
  const missing = await prepared('把书房这段需求给团队看看', { project: '' });
  assert.match(missing.text, /还没有共享/); assert.match(missing.text, /项目/);
  const updated = await prepared(`测试工地甲的${excerpt}，这段再共享给团队。`);
  const c = await withTenantTransaction(f.eid, tx => one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.eid} and id=${f.conversationId}`));
  await assert.rejects(withTenantTransaction(f.eid, tx => prepareMaterialShare(tx, { ...f.actor, principal: { kind: 'user', userId: f.userIds[1] } }, c!,
    { id: updated.sent.messageId, seq: 9999 }, String(updated.sent.runId), { project: '测试工地甲', room: '书房', kind: 'need', sourceMessageId: originalSourceId, excerpt })), /assistant_resource_not_found|assistant_capability_forbidden/);
  const content = await withTenantTransaction(f.eid, tx => one(tx, sql`select content from app.assistant_messages where enterprise_id=${f.eid} and id=${String(updated.sent.messageId)}`));
  try {
    await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"撤回原文"}]}'::jsonb where enterprise_id=${f.eid} and id=${String(updated.sent.messageId)}`));
    await assert.rejects(f.send('确认共享给项目团队。'), /context_changed/);
    assert.equal((await count())!.n, 1);
  } finally { await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(content!.content)}::jsonb where enterprise_id=${f.eid} and id=${String(updated.sent.messageId)}`)); }
});
test('drawing consent binds the exact preceding own upload, never another private photo', async () => {
  const bytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#d7e3d8' } }).png().toBuffer();
  mediaId = String((await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), bytes, 'image', '')).id);
  await prepared('测试工地甲书房的点位图，给设计师看看这张参考图。', { kind: 'drawing', excerpt: '书房的点位图' });
  assert.equal((await count())!.n, 1);
  await f.send('确认把这张图共享给项目团队。');
  const drawing = (await f.sources()).sources.find(s => s.kind === 'drawing')!; drawingId = drawing.id;
  assert.equal(drawing.mediaId, mediaId);
  const original = await new AssistantMediaService(f.actor).read(f.conversationId, mediaId);
  for (const aid of [...f.memberIds, ...f.platformIds, f.ownerIds[0]]) assert.deepEqual(await f.site(aid).materialMedia(f.projectId, drawingId, mediaId), original);
  await assert.rejects(f.site().materialMedia(f.otherProjectId, drawingId, mediaId));
  await assert.rejects(f.site().materialMedia(f.projectId, needGrantId, mediaId));
});
test('member removal immediately denies original media; explicit cancellation revokes instead of resurrecting access', async () => {
  await f.member(f.memberIds[0], 'designer', false);
  await assert.rejects(f.site(f.memberIds[0]).materialMedia(f.projectId, drawingId, mediaId));
  const key = randomUUID(), first = await f.send('停止共享这张图', key); assert.equal(first.runId, null);
  assert.deepEqual(await f.send('停止共享这张图', key), first);
  assert.ok(!(await f.sources()).sources.some(s => s.id === drawingId));
  await assert.rejects(f.site().materialMedia(f.projectId, drawingId, mediaId));
  await f.member(f.memberIds[0], 'designer', true);
  await assert.rejects(f.site(f.memberIds[0]).materialMedia(f.projectId, drawingId, mediaId));
  assert.ok((await f.sources()).sources.some(s => s.id === needGrantId));
});
