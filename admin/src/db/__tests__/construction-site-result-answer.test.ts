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
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import { synthesisRepairBase } from '@/lib/assistant/agent/synthesis-repair';
import type { SynthesisSource } from '@/lib/assistant/agent/synthesis';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

after(closePostgresPool);
for (const variant of ['denial', 'cross-kind-fields', 'source-scope-budget', 'legacy-without-read-reserve', 'legacy-business-text'] as const) test(`a real customer result answer preserves ${variant} handling, its original draft, source revocation and no extra business writes`, async () => {
  const f = new D4SharingFixture();
  try {
    await f.create(); await f.send('共享测试工地甲·书房需求：靠窗书桌，需要现场复核底盒。');
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e4ded1' } }).png().toBuffer();
    await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), bytes, 'image', '');
    await f.send('共享测试工地甲·书房点位图：V2参考点位，未批准施工。');
    const drawing = (await f.sources()).sources.find(s => s.kind === 'drawing')!;
    const prepared = await f.prepareReturnedIssue(drawing.id, { open: '书房底盒先别固定。', reply: '仍需核对桌子摆位。', return: '参考图已核对关联，先别固定，等现场核准桌子摆位。' });
    const before = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type like 'construction.site.issue.%'`));
    const sent = await f.send('书房底盒这件事后来怎么处理的，现在能直接按图固定了吗？');
    if (variant === 'legacy-without-read-reserve') await withTenantTransaction(f.eid, tx => tx.execute(sql`update app.assistant_runs set policy_snapshot=policy_snapshot-'homeSourceBudget'
      where enterprise_id=${f.eid} and id=${String(sent.runId)}`));
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    let calls = 0, firstDraft = '';
    await processAgentAnswer(lease!, { model: async (messages, available, turn) => {
      calls++;
      if (variant === 'source-scope-budget' && turn === 3) {
        assert.ok(available.every(t => t.name === 'final_response'));
        const base = synthesisRepairBase(messages); assert.ok(base);
        return { text: '', toolCalls: [{ id: 'repair-' + turn, name: 'final_response', arguments: JSON.stringify({ kind: 'synthesis_repair', baseHash: base.baseHash, edits: [{ segment: 2, remove: true }] }) }],
          finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      const multiRead = variant === 'source-scope-budget' || variant === 'legacy-without-read-reserve';
      const readTurns = variant === 'legacy-without-read-reserve' ? 3 : multiRead ? 2 : 1;
      if (turn < readTurns) return { text: '', toolCalls: [{ id: 'read-' + turn,
        name: multiRead && turn === 0 ? 'query_materials' : turn === 2 ? 'query_business' : 'query_followups',
        arguments: JSON.stringify(multiRead && turn === 0 ? { room: '书房' } : turn === 2 ? { domain: 'construction' } : {}) }],
        finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
      const read = messages.filter(m => m.role === 'tool').map(m => JSON.parse(String(m.content))).findLast(m => m.query?.domain === 'followups');
      const source = read.synthesisSources[0] as SynthesisSource;
      assert.doesNotMatch(source.text, /PRIVATE_INTERNAL_REQUEST|PRIVATE_INTERNAL_REPLY/);
      const citationId = sourceCitationCatalog(source)[0].citationId;
      const value: Row = { kind: 'synthesis', segments: [{ basis: 'evidence', text: '书房底盒已有团队回复，仍待核对；先别固定，需现场核准桌子摆位。', citations: [{ citationId }] },
        { basis: 'uncertainty', text: '本次读取只是查询状态，不代表方案、费用、工期、现场落实或验收已批准；也没有已确认的处理期限。', citations: [] }] };
      if (variant === 'legacy-business-text') {
        delete value.segments; value.kind = 'business'; value.resultKey = read.resultKey;
        value.text = 'MODEL_TEXT_MUST_NOT_RENDER: 已批准施工。';
        value.selections = [];
      }
      if (variant === 'cross-kind-fields' && turn === 1) value.resultKey = read.resultKey;
      if (variant === 'source-scope-budget' && turn === 2) (value.segments as Row[]).push({ basis: 'uncertainty',
        text: '本次查询未指定具体工地，同时该阶段联系电话尚未配置；如需推进现场复核，请通过原聊天窗口联系测试设计师补充信息并安排核对。', citations: [] });
      if (variant === 'cross-kind-fields' && turn > 1) { assert.ok(available.every(t => t.name === 'final_response')); assert.match(JSON.stringify(messages), /invalid_final_fields/); }
      if (variant === 'source-scope-budget' && turn >= 2) assert.ok(available.every(t => t.name === 'final_response'));
      const raw = JSON.stringify(value); if (turn === readTurns) firstDraft = raw;
      return { text: '', toolCalls: [{ id: 'final-' + turn, name: 'final_response', arguments: raw }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    } });
    const run = await f.chat.run(String(sent.runId)); assert.equal(run.status, 'succeeded', JSON.stringify(run));
    assert.equal(calls, variant === 'denial' || variant === 'legacy-business-text' ? 2 : variant === 'cross-kind-fields' ? 3 : 4);
    const output = (await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => m.id === run.outputMessageId)!;
    assert.ok(output.available); assert.match(JSON.stringify(output.content), /先别固定/);
    assert.doesNotMatch(JSON.stringify(output.content), /MODEL_TEXT_MUST_NOT_RENDER|已批准施工/);
    const model = await withTenantTransaction(f.eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
      where enterprise_id=${f.eid} and run_id=${String(sent.runId)} and step_seq=${variant === 'source-scope-budget' ? 1120 : variant === 'legacy-without-read-reserve' ? 1130 : 1110}`));
    const checkpoint = model!.private_checkpoint as { toolCalls?: { arguments: string }[]; text: string };
    assert.ok(checkpoint.text === firstDraft || checkpoint.toolCalls?.some(c => c.arguments === firstDraft));
    const after = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type like 'construction.site.issue.%'`));
    assert.equal(after!.n, before!.n); assert.ok(prepared.issueId);
    await f.send('撤回共享资料' + drawing.id);
    assert.equal((await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => m.id === run.outputMessageId)!.available, false);
  } finally {
    if (f.eid && process.env.D4_EVIDENCE_DIRECTORY) fs.writeFileSync(path.join(process.env.D4_EVIDENCE_DIRECTORY, 'answer-' + variant + '.json'), JSON.stringify(await f.snapshot(), null, 2));
    await f.cleanup();
  }
});
