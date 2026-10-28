import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { safeText, type MessageContent } from '@/lib/assistant/contracts';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

const f = new D4SharingFixture(), now = Date.now;
const excerpt = '书房需要靠窗双人办公';
before(() => f.create());
after(async () => { Date.now = now; try { await f.cleanup(); } finally { await closePostgresPool(); } });

test('scoped revocation selects the actual requested kind and rejects a model-selected different grant', async () => {
  await preview(); await f.send('确认共享给项目团队。');
  const need = (await f.sources()).sources.find(s => s.kind === 'need')!;
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#c6d5cf' } }).png().toBuffer();
  await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), bytes, 'image', '');
  const imageRequest = await f.send('测试工地甲书房点位图，给设计师看看。'), imageLease = await claimJob(); assert.equal(imageLease?.runId, imageRequest.runId);
  await processAgentAnswer(imageLease!, { model: async () => ({ text: '', toolCalls: [{ id: randomUUID(), name: 'prepare_material_share', arguments: JSON.stringify({
    project: '测试工地甲', room: '书房', kind: 'drawing', sourceMessageId: '', excerpt: '书房点位图',
  }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 25 } }) });
  await f.send('确认把这张图共享给项目团队。');
  const drawing = (await f.sources()).sources.find(s => s.kind === 'drawing')!;
  const revoke = async (text: string, grantId: string, quote = text) => {
    const sent = await f.send(text); assert.ok(sent.runId, 'named target must not revoke the latest preview implicitly');
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processAgentAnswer(lease!, { model: async () => ({ text: '', toolCalls: [{ id: randomUUID(), name: 'revoke_material_share',
      arguments: JSON.stringify({ grantId, quote }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 25 } }) });
    assert.equal((await f.chat.run(String(sent.runId))).status, 'succeeded');
  };
  await revoke('如果停止共享书房需求会怎样？', need.id, '停止共享书房需求');
  assert.equal((await f.sources()).sources.length, 2);
  await revoke('不要撤回共享资料' + need.id + '。', need.id, '撤回共享资料' + need.id);
  assert.equal((await f.sources()).sources.length, 2);
  await revoke('停止共享书房需求后会怎样。', need.id, '停止共享书房需求');
  assert.equal((await f.sources()).sources.length, 2);
  await revoke('停止共享书房需求。', drawing.id);
  assert.deepEqual(new Set((await f.sources()).sources.map(s => s.id)), new Set([need.id, drawing.id]));
  await revoke('请停止共享书房的需求。', '');
  assert.deepEqual((await f.sources()).sources.map(s => s.id), [drawing.id]);
  await assert.rejects(f.site().materialMedia(f.projectId, need.id, drawing.mediaId!));
  await f.send('停止共享这张图。');
  assert.equal((await f.sources()).sources.length, 0);
});
async function preview() {
  const sent = await f.send(`测试工地甲的${excerpt}，把这段需求发给设计师。`), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processAgentAnswer(lease!, { model: async () => ({ text: '', toolCalls: [{ id: randomUUID(), name: 'prepare_material_share', arguments: JSON.stringify({
    project: '测试工地甲', room: '书房', kind: 'need', sourceMessageId: '', excerpt,
  }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 25 } }) });
  assert.equal((await f.chat.run(String(sent.runId))).status, 'succeeded'); return sent;
}
test('an expired displayed preview cannot grant access', async () => {
  await preview();
  try { Date.now = () => now() + 31 * 60 * 1000; await assert.rejects(f.send('确认共享给项目团队。'), /context_changed/); }
  finally { Date.now = now; }
  assert.equal((await f.sources()).sources.length, 0);
});

test('legacy commands with personal-recipient wording stay private until the actual preview and team confirmation', async () => {
  const before = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
  for (const text of ['共享测试工地甲·书房需求：双人书桌，仅向张三开放。', '共享测试工地甲·书房需求：留两个插座，供张三查看。']) {
    const sent = await f.send(text), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processAgentAnswer(lease!, { model: async () => ({ text: '', toolCalls: [{ id: randomUUID(), name: 'prepare_material_share', arguments: JSON.stringify({
      project: '测试工地甲', room: '书房', kind: 'need', sourceMessageId: '', excerpt: text.split('：')[1],
    }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 25 } }) });
    assert.equal((await f.chat.run(String(sent.runId))).status, 'succeeded');
    const after = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
    assert.equal(after!.n, before!.n);
    await f.send('取消本次共享。');
  }
});
test('a newer same-room grant from another owned consultation fences the previous preview', async () => {
  await preview();
  const other = new ConversationService(f.actor), cid = String((await other.create(randomUUID())).id);
  await other.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '共享测试工地甲·书房需求：单人办公，以这次为准。' }] }, siteWatchInterceptor);
  await assert.rejects(f.send('确认共享给项目团队。'), /context_changed/);
  assert.equal((await f.sources()).sources.length, 1); assert.equal((await f.sources()).sources[0].text, '单人办公，以这次为准。');
});
test('two confirmations do not duplicate a grant and consent-source changes revoke its read model', async () => {
  await preview();
  const key = randomUUID(), text = '确认共享给项目团队。';
  const outcomes = await Promise.allSettled([f.send(text, key), f.send(text, key)]);
  assert.ok(outcomes.some(o => o.status === 'fulfilled'));
  const current = (await f.sources()).sources[0]; assert.equal(current.text, excerpt);
  const count = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox
    where enterprise_id=${f.eid} and type='construction.material.shared.v1' and payload->>'sourceMessageId'=${current.sourceMessageId}`));
  assert.equal(count!.n, 1);
  await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_messages
    set content='{"version":1,"blocks":[{"type":"text","text":"合成来源已不可用"}]}'::jsonb where enterprise_id=${f.eid} and id=${current.consentMessageId!}`));
  assert.equal((await f.sources()).sources.length, 0);
});
test('a model cannot claim it shared or revoked data without the actual service receipt', async () => {
  const before = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
  const sent = await f.send('把测试工地甲书房的这段资料给设计师看看。'), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processAgentAnswer(lease!, { model: async () => ({ text: JSON.stringify({ kind: 'general', text: '已把资料发给设计师。' }), toolCalls: [],
    finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 20 } }) });
  const run = await f.chat.run(String(sent.runId)); assert.equal(run.status, 'failed'); assert.equal(run.errorCode, 'unsupported_model_commitment');
  const after = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
  assert.equal(after!.n, before!.n); assert.equal(run.outputMessageId, null);
});
test('an old private upload cannot be selected through a source-message argument after intervening text', async () => {
  const key = randomUUID(), bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#cad6cd' } }).png().toBuffer();
  await new AssistantMediaService(f.actor).upload(f.conversationId, key, bytes, 'image', '');
  const original = await withTenantTransaction(f.eid, tx => one(tx, sql`select id,content from app.assistant_messages
    where enterprise_id=${f.eid} and conversation_id=${f.conversationId} and client_message_id=${'media:' + key}`));
  await withTenantTransaction(f.eid, tx => appendMessage(tx, f.actor, f.conversationId, { author: 'user', clientMessageId: randomUUID(),
    content: { version: 1, blocks: [{ type: 'text', text: '先聊一下书房的其他安排。' }] } }));
  const sent = await f.send('给设计师看看测试工地甲书房这张图。'), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processAgentAnswer(lease!, { model: async () => ({ text: '', toolCalls: [{ id: randomUUID(), name: 'prepare_material_share', arguments: JSON.stringify({
    project: '测试工地甲', room: '书房', kind: 'drawing', sourceMessageId: String(original!.id), excerpt: safeText(original!.content as MessageContent),
  }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 25 } }) });
  const run = await f.chat.run(String(sent.runId)); assert.equal(run.status, 'succeeded');
  const answer = (await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => String(m.id) === run.outputMessageId)!;
  assert.match(safeText(answer.content as MessageContent), /还没有共享图片/);
  assert.ok(!(await f.sources()).sources.some(s => s.kind === 'drawing'));
});
test('an interrupted clarification after a project correction cannot confirm the older preview', async () => {
  await preview();
  // Preserve the customer's correction while the hypothetical model/service
  // fails before it can replace the preview; no model output is manufactured.
  await withTenantTransaction(f.eid, tx => appendMessage(tx, f.actor, f.conversationId, { author: 'user', clientMessageId: randomUUID(),
    content: { version: 1, blocks: [{ type: 'text', text: '我说的是测试工地乙，先别按原来的项目发。' }] } }));
  const before = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
  await assert.rejects(f.send('确认共享给项目团队。'), /context_changed/);
  const after = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.material.shared.v1'`));
  assert.equal(after!.n, before!.n);
});
test('an ordinary acknowledgement retains privacy until the separate explicit team authorization', async () => {
  await preview();
  await withTenantTransaction(f.eid, tx => appendMessage(tx, f.actor, f.conversationId, { author: 'user', clientMessageId: randomUUID(),
    content: { version: 1, blocks: [{ type: 'text', text: '好的' }] } }));
  assert.equal((await f.sources()).sources.length, 0);
  const confirmed = await f.send('可以，把这段共享给这个项目团队，其他聊天不要发。'); assert.equal(confirmed.runId, null);
  assert.equal((await f.sources()).sources[0].text, excerpt);
  await f.send('停止共享这次资料。'); assert.equal((await f.sources()).sources.length, 0);
});
