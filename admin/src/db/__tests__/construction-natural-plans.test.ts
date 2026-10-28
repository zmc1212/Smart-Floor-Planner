import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { processSiteAction } from '@/lib/construction/site-action-worker';
import { readPlan, deliverPlans, PlanCustomerService } from '@/lib/construction/site-plans';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';
import type { NaturalPlanFields } from '@/lib/construction/site-plan-input';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import { synthesisRepairBase } from '@/lib/assistant/agent/synthesis-repair';
import type { SynthesisSource } from '@/lib/assistant/agent/synthesis';
import { prepareApprovedNaturalPlans } from '../../../scripts/construction-natural-plans-fixture';
after(closePostgresPool);
const fields: NaturalPlanFields = { title: '书房插座调整', costQuote: '费用增加500元', scheduleQuote: '工期延长2天' };
const original = '请将书房底盒的正式方案发给业主，名称书房插座调整。依这张原图增加一组插座，仍须现场核对桌子摆位。费用增加500元，工期延长2天。';
const bytes = (color = '#c9dfd0') => sharp({ create: { width: 96, height: 72, channels: 3, background: color } }).png().toBuffer();
async function fixture(work: (f: D4SharingFixture, issueId: string, drawingId: string) => Promise<void>) {
  const f = new D4SharingFixture();
  try {
    await f.create(); await f.send('共享测试工地甲·书房需求：双人办公，插座位置仍需现场复核。');
    await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), await bytes(), 'image', '');
    await f.send('共享测试工地甲·书房点位图：参考图，未批准施工。');
    const drawingId = (await f.sources()).sources.find(s => s.kind === 'drawing')!.id;
    const { issueId } = await f.prepareReturnedIssue(drawingId, { open: '先别固定底盒。', reply: '仍需核对位置。', return: '位置仍待核对。' });
    await work(f, issueId, drawingId);
  } finally {
    if (f.eid && process.env.D4_EVIDENCE_DIRECTORY) fs.writeFileSync(path.join(process.env.D4_EVIDENCE_DIRECTORY, 'natural-plan-' + f.eid + '.json'), JSON.stringify(await f.snapshot(), null, 2));
    await f.cleanup();
  }
}
async function say(f: D4SharingFixture, aid: string, text: string, mediaIds: string[] = []) {
  const service = f.site(aid); return service.send(f.projectId, { text, mediaIds, versions: (await service.read(f.projectId)).versions }, randomUUID());
}
async function proposal(f: D4SharingFixture, aid: string, issueId: string, raw = original, selected = fields, expected = 'succeeded', attach = true): Promise<Row> {
  const media = attach ? await f.site(aid).upload(f.projectId, randomUUID(), await bytes()) : null;
  const sent = await say(f, aid, raw, media ? [String(media.id)] : []), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteAction(lease!, async () => ({ text: JSON.stringify({ action: 'plan', target: issueId, plan: selected }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 20, outputTokens: 20 } }));
  const run = await withTenantTransaction(f.eid, tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${f.eid} and id=${String(sent.runId)}`));
  assert.equal(run!.status, expected, JSON.stringify(run)); return { ...sent, mediaId: String(media?.id || '') };
}
const count = (f: D4SharingFixture) => withTenantTransaction(f.eid, async tx => Number((await one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.plan.published.v1'`))!.n));
const plan = (f: D4SharingFixture, id: string) => withTenantTransaction(f.eid, tx => readPlan(tx, f.eid, id));

test('natural formal publication waits for its author, preserves the full original, and V2 cannot inherit a customer V1 decision', async () => fixture(async (f, iid) => {
  const designer = f.memberIds[0], customer = new PlanCustomerService(f.actor, f.conversationId);
  const request = await proposal(f, designer, iid); assert.equal(await count(f), 0);
  await say(f, f.ownerIds[0], '确认发布方案'); await say(f, designer, '收到'); assert.equal(await count(f), 0);
  const service = f.site(designer), body = { text: '确认发布方案', mediaIds: [], versions: (await service.read(f.projectId)).versions }, key = randomUUID();
  const first = await service.send(f.projectId, body, key), duplicate = await service.send(f.projectId, body, key);
  assert.equal(first.planId, duplicate.planId); assert.equal(await count(f), 1);
  const p1 = (await plan(f, String(first.planId)))!; assert.equal(p1.sourceMessageId, request.messageId); assert.equal(p1.mediaId, request.mediaId);
  assert.equal(p1.difference, original); assert.equal(p1.costDeltaCents, 50000); assert.equal(p1.scheduleDeltaDays, 2);
  await deliverPlans(); await customer.media(p1.id); await customer.decide(p1.id, 'preview', { expectedRevision: p1.revision }, randomUUID());
  const current = (await plan(f, p1.id))!; await customer.decide(p1.id, 'approve', { expectedRevision: current.revision }, randomUUID());
  assert.equal((await plan(f, p1.id))!.status, 'approved');
  const next = '请将书房底盒正式方案换一版发给业主，名称书房插座调整。将插座移到桌子右侧，仍需现场复核。费用不变，工期不变。';
  await proposal(f, designer, iid, next, { title: fields.title, costQuote: '费用不变', scheduleQuote: '工期不变' });
  const second = await say(f, designer, '确认发布方案'), p2 = (await plan(f, String(second.planId)))!;
  assert.equal(p2.number, 2); assert.equal(p2.previousVersionId, p1.id); assert.equal(p2.status, 'pending_customer'); assert.equal(p2.previewed, false);
  assert.equal(await plan(f, p1.id), null); await assert.rejects(customer.media(p1.id), /plan_unavailable/);
  await deliverPlans(); const messages = (await f.chat.messages(f.conversationId, undefined, 100)).items;
  const visiblePlans = messages.filter(m => m.planDecision?.id === p2.id && m.available);
  assert.equal(visiblePlans.length, 1); assert.doesNotMatch(JSON.stringify(visiblePlans), /PRIVATE_INTERNAL/);
  await assert.rejects(customer.decide(p2.id, 'approve', { expectedRevision: p2.revision }, randomUUID()), /plan_preview_required/);
  await say(f, f.ownerIds[0], '撤回方案' + p2.id + '：现场需要复核'); assert.equal(await plan(f, p2.id), null);
}));
test('missing impacts or a missing original remain visibly unsubmitted and cannot be confirmed as zero', async () => fixture(async (f, iid) => {
  const sent = await proposal(f, f.memberIds[0], iid, '请发布书房底盒的正式方案，名称书房插座调整。费用和工期还没定。', { title: fields.title, costQuote: '', scheduleQuote: '' }, 'succeeded', false);
  const row = ((await f.site().read(f.projectId)).items as Row[]).find(i => (i.message as Row).id === sent.messageId)!;
  assert.match(String((row.response as Row).text), /尚未发布/); assert.match(String((row.response as Row).text), /费用|工期/);
  await say(f, f.memberIds[0], '确认发布方案'); assert.equal(await count(f), 0);
}));
test('withdrawn source after preview fences both publication and persisted reentry', async () => fixture(async (f, iid, drawingId) => {
  const sent = await proposal(f, f.memberIds[0], iid); await f.send('撤回共享资料' + drawingId);
  await assert.rejects(say(f, f.memberIds[0], '确认发布方案'), /context_changed|site_review_required|version_conflict/);
  assert.equal(await count(f), 0); const row = ((await f.site().read(f.projectId)).items as Row[]).find(i => (i.message as Row).id === sent.messageId)!;
  assert.match(String((row.response as Row).text), /权限已变化|材料或权限/);
}));
test('an ordinary worker cannot publish a model-selected proposal, and an actual designer downgrade invalidates a pending one', async () => fixture(async (f, iid) => {
  await proposal(f, f.memberIds[1], iid, original, fields, 'failed'); assert.equal(await count(f), 0);
  await proposal(f, f.memberIds[0], iid); await f.member(f.memberIds[0], 'worker', true);
  await assert.rejects(say(f, f.memberIds[0], '确认发布方案'), /context_changed|construction_forbidden/); assert.equal(await count(f), 0);
}));
test('owner, admin and super_admin publish natural proposals in the selected enterprise without employee membership', async () => {
  for (const index of [0, 1, 2]) await fixture(async (f, iid) => {
    const aid = [f.ownerIds[0], ...f.platformIds][index];
    if (index === 1) await proposal(f, aid, iid, '把书房底盒这个正式调整方案交给业主决定，名称书房插座调整。桌子摆位仍需到现场核准。费用减少100元，工期缩短1天。',
      { title: fields.title, costQuote: '费用减少100元', scheduleQuote: '工期缩短1天' });
    else await proposal(f, aid, iid);
    const result = await say(f, aid, '确认发布方案'); assert.equal((await plan(f, String(result.planId)))!.publisherId, aid);
    if (index === 1) assert.equal((await plan(f, String(result.planId)))!.costDeltaCents, -10000);
  });
});
test('a concurrent publication or a new confirmation attachment cannot silently change the reviewed target', async () => fixture(async (f, iid) => {
  await proposal(f, f.memberIds[0], iid); await proposal(f, f.ownerIds[0], iid);
  const extra = await f.site(f.memberIds[0]).upload(f.projectId, randomUUID(), await bytes('#93acbf'));
  await assert.rejects(say(f, f.memberIds[0], '确认发布方案', [String(extra.id)]), /invalid_plan/); assert.equal(await count(f), 0);
  await say(f, f.memberIds[0], '确认发布方案');
  await assert.rejects(say(f, f.ownerIds[0], '确认发布方案'), /version_conflict|context_changed/); assert.equal(await count(f), 1);
}));
for (const corrected of [true, false]) test(`ordinary formal-state validation uses one real final repair and keeps positive claims closed (corrected=${corrected})`, async () => fixture(async (f, iid, drawingId) => {
  let id: string;
  if (corrected) {
    const prepared = await prepareApprovedNaturalPlans(f, iid, { first: original,
      second: '请将书房底盒正式方案换一版发给业主，名称书房插座调整。将插座移到桌子右侧，仍需现场复核。费用不变，工期不变。', cost: 50000, days: 2 });
    assert.equal(prepared.providerCalls, 0); assert.equal(prepared.plans[1].number, 2); assert.equal(prepared.plans[1].status, 'approved'); id = prepared.plans[1].id;
  } else {
    await proposal(f, f.memberIds[0], iid); const issued = await say(f, f.memberIds[0], '确认发布方案'); id = String(issued.planId);
    await deliverPlans(); const customer = new PlanCustomerService(f.actor, f.conversationId);
    await customer.media(id); await customer.decide(id, 'preview', { expectedRevision: (await plan(f, id))!.revision }, randomUUID());
    await customer.decide(id, 'approve', { expectedRevision: (await plan(f, id))!.revision }, randomUUID());
  }
  const sent = await f.send('我刚才同意的是哪一版书房方案？现在是不是已经落实并关闭了？'), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  let calls = 0, rejected = '', resultKey = '';
  await processAgentAnswer(lease!, { model: async (messages, available, turn) => {
    calls++;
    if (!turn) return { text: '', toolCalls: [{ id: 'formal-read', name: 'query_followups', arguments: '{}' }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    if (turn === 1) {
      const result = messages.filter(m => m.role === 'tool').map(m => JSON.parse(String(m.content))).findLast(m => m.query?.domain === 'followups');
      resultKey = result.resultKey;
      const source = (result.synthesisSources as SynthesisSource[]).find(s => s.followup?.kind === 'formal_plan' || s.material?.ref.type === 'formal_plan')!;
      assert.ok(source); const citationId = sourceCitationCatalog(source)[0].citationId;
      rejected = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: `你同意的是书房正式方案V${corrected ? 2 : 1}，现场仍待核对。`, citations: [{ citationId }] },
        { basis: 'uncertainty', text: '已正式关闭事项。', citations: [{ citationId }] }] });
      return { text: '', toolCalls: [{ id: 'formal-final', name: 'final_response', arguments: rejected }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    assert.equal(turn, 2); assert.ok(available.every(t => t.name === 'final_response')); assert.match(JSON.stringify(messages), /rejectedTextPaths/);
    const base = synthesisRepairBase(messages); assert.ok(base);
    if (base.businessSourceOnly) return { text: '', toolCalls: [{ id: 'formal-service-repair', name: 'final_response', arguments: JSON.stringify({ kind: 'business_repair', baseHash: base.baseHash,
      resultKey, ...(corrected ? {} : { text: '已正式关闭事项。' }) }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    return { text: '', toolCalls: [{ id: 'formal-repair', name: 'final_response', arguments: JSON.stringify({ kind: 'synthesis_repair', baseHash: base.baseHash,
      edits: [{ segment: 1, text: corrected ? '同意方案和现场处理分别记录，当前仍待现场核对。' : '已正式关闭事项。' }] }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  } });
  const run = await f.chat.run(String(sent.runId)); assert.equal(calls, 3); assert.equal(run.status, corrected ? 'succeeded' : 'failed', JSON.stringify(run));
  if (!corrected) assert.equal(run.errorCode, 'invalid_model_answer');
  assert.equal(await count(f), corrected ? 2 : 1); assert.equal((await plan(f, id))!.status, 'approved');
  const first = await withTenantTransaction(f.eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${f.eid} and run_id=${String(sent.runId)} and step_seq=1110`));
  assert.ok(JSON.stringify(first!.private_checkpoint).includes('已正式关闭事项'));
  if (corrected) { const output = (await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => m.id === run.outputMessageId)!;
    assert.ok(output.available); assert.doesNotMatch(JSON.stringify(output.content), /已正式关闭/);
    await f.send('撤回共享资料' + drawingId); assert.equal((await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => m.id === run.outputMessageId)!.available, false);
  }
}));
