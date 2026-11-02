/* eslint-disable @typescript-eslint/no-require-imports -- Real-service adapter with labelled synthetic prerequisites. */
const path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { randomUUID } = require('node:crypto');

module.exports = async ctx => {
  const { root, actor, owner, chat, pid, cid, read, step, progress, state, report, save } = ctx;
  const req = createRequire(path.join(root, 'admin/package.json'));
  const { sql } = req('drizzle-orm'), { one } = req('./src/db/repositories/assistant-repository.ts');
  const { appendMessage } = req('./src/lib/assistant/core/conversation.ts');
  const { HandoffService } = req('./src/lib/assistant/handoff/service.ts');
  const { readMemory, applyNeedDelta, parseNeedDelta } = req('./src/lib/assistant/agent/memory.ts');
  const { queryNeedIssues, recordNeedIssueSupplement } = req('./src/lib/construction/need-issues.ts');
  const { agentMessageAvailable } = req('./src/lib/assistant/agent/media-context.ts');
  const { availableNeedMemory } = req('./src/lib/assistant/agent/memory-sources.ts');
  const { fingerprint } = req('./src/lib/assistant/contracts/index.ts');
  const legacy = process.argv.includes('--legacy-proof');
  const staffActor = { enterpriseId: '1454', principal: { kind: 'admin', adminId: '5410' }, contextVersion: 1, capabilities: ['assistant.handoff.staff'] };
  const customer = new HandoffService(actor), staff = new HandoffService(staffActor);
  const query = () => read(tx => queryNeedIssues(tx, actor, cid));
  const scope = () => read(tx => one(tx, sql`select current_stage_key,progress_revision,version from app.construction_projects where enterprise_id=1454 and id=${pid}`));
  const current = async label => { const q = await query(); (report.issueStates ||= []).push({ label, data: q.data }); save(); return q.data[0]; };
  report.scope = 'V1-02 explicit cross-stage staff review survives note-only edits; real services, labelled preexisting memory/run, zero model dispatch'; save();
  let seed;
  await step('labelled existing customer supplement and derived answer, followed by real cross-stage S01 correction', async () => {
    seed = await read(async tx => {
      const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=1454 and id=${cid} for update`);
      const question = await one(tx, sql`select m.id,e.payload from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
        where m.enterprise_id=1454 and m.conversation_id=${cid} and m.purpose='construction.followup' order by m.id desc limit 1`);
      assert.ok(question); const room = question.payload.room, text = '合成前置原话：' + room + '需要台灯插座。';
      const m = await appendMessage(tx, actor, cid, { author: 'user', purpose: 'synthetic.preexisting-need', content: { version: 1, blocks: [{ type: 'text', text }] } });
      const memory = applyNeedDelta(readMemory(c.entry_snapshot), parseNeedDelta({ room, field: 'devices', value: '需要台灯插座', quote: text,
        sourceMessageId: String(m.id), expectedVersion: 0 }), { id: String(m.id), text }, 'synthetic-reviewed-note-' + cid, new Date().toISOString());
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify(memory)}::jsonb) where enterprise_id=1454 and id=${cid}`);
      await recordNeedIssueSupplement(tx, actor, c, memory.facts[0]);
      const run = await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,purpose,status,policy_snapshot,context_revision,knowledge_epoch,answer_kind,completed_at)
        values(1454,${cid},'user_message',${String(m.id)},'reply','succeeded','{"synthetic":true}'::jsonb,1,1,'grounded',now()) returning id`);
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,input_summary,source_refs,status)
        values(1454,${String(run.id)},1008,'agent_construction_context','{"synthetic":true}'::jsonb,${JSON.stringify([String(question.id)])}::jsonb,'succeeded')`);
      if (legacy) {
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,input_summary,source_refs,private_checkpoint,status)
          values(1454,${String(run.id)},1100,'agent_need_write','{"syntheticLegacyReceipt":true}'::jsonb,
            ${JSON.stringify([{ messageId: String(m.id), hash: fingerprint(m.content) }])}::jsonb,
            ${JSON.stringify({ receipt: { savedFacts: [{ id: memory.facts[0].id }] } })}::jsonb,'succeeded')`);
        await tx.execute(sql`update app.domain_event_outbox set payload=payload-'sourceMessageHash'
          where enterprise_id=1454 and type='construction.need.progress.v1' and payload->>'sourceMessageId'=${String(m.id)}`);
      }
      const reply = await appendMessage(tx, actor, cid, { author: 'assistant', runId: String(run.id), purpose: 'synthetic.old-derived-answer', content: { version: 1, blocks: [{ type: 'text', text: '合成旧节点答复：台灯插座仍待核对。' }] } });
      return { messageId: String(m.id), runId: String(run.id), replyId: String(reply.id), questionId: String(question.id), legacy,
        scope: 'Labelled preexisting synthetic state, no model or usage claim' };
    });
    report.seed = seed; save();
    const original = await current('before-stage-change'); assert.equal(original.status, 'awaiting_review');
    const stages = (await owner.execute('stages')).stages, next = stages.find(s => s.key !== 'utilities'); assert.ok(next);
    await progress(next.key, '合成测试：人工按新的实际阶段核对'); assert.equal((await current('changed-stage')).status, 'invalidated');
    await customer.customerWrite(cid, randomUUID(), { action: 'request', recipientId: '5410' });
    await staff.staffWrite(cid, randomUUID(), { action: 'claim' });
    const packet = await staff.staffRead(cid), key = randomUUID(), input = { action: 'correct', field: 'devices', text: '合成内部核对：当前节点继续核对同一插座事项，不代表方案批准。', sourceMessageId: seed.messageId, expectedVersion: packet.version };
    const result = await staff.staffWrite(cid, key, input); assert.deepEqual(await staff.staffWrite(cid, key, input), result);
    const reviewed = await current('explicit-current-stage-review'); assert.equal(reviewed.issueId, original.issueId); assert.equal(reviewed.status, 'awaiting_review');
    assert.equal(reviewed.question, ''); assert.equal(reviewed.value, ''); assert.equal(reviewed.sourceMessageId, null);
    report.reviewed = { issueId: reviewed.issueId, revision: reviewed.revision, key, scope: await scope() }; save();
    return { issueId: reviewed.issueId, sameIssue: true, pendingReview: true, oldQuestionAndValueHidden: true, idempotentReview: true };
  });
  await step('only a manager note preserves the exact reviewed issue and never revives old question, memory or answer', async () => {
    const before = await current('before-note'), p = await scope(); await progress(p.current_stage_key, '合成测试：仅补当天备注，事项未变');
    const after = await current('after-note'); report.noteResult = { expected: 'awaiting_review', actual: after.status, beforeScope: p, afterScope: await scope() }; save();
    assert.equal(after.status, 'awaiting_review'); assert.equal(after.issueId, before.issueId); assert.equal(after.revision, before.revision);
    assert.equal(after.question, ''); assert.equal(after.value, ''); assert.equal(after.sourceMessageId, null);
    const raw = await read(tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=1454 and id=${cid}`));
    assert.equal((await read(tx => availableNeedMemory(tx, '1454', cid, raw.entry_snapshot))).facts.length, 0);
    assert.equal(await read(tx => agentMessageAvailable(tx, '1454', cid, seed.replyId)), false);
    return { sameIssueId: after.issueId, unchangedRevision: after.revision, oldSourcesUnavailable: true };
  });
  await step('reentry and identical/whitespace notes preserve the one review receipt without another issue write', async () => {
    const p = await scope(); await progress(p.current_stage_key, '合成测试：仅补当天备注，事项未变'); await progress(p.current_stage_key, '  合成测试：仅补当天备注，事项未变  ');
    await chat.detail(cid); await staff.staffRead(cid);
    const q = await current('reentry-same-note'); assert.equal(q.status, 'awaiting_review'); assert.equal(q.revision, report.reviewed.revision);
    return { sameIssueId: q.issueId, sameRevision: q.revision };
  });
  await step('a changed original hash remains unavailable despite a valid note anchor', async () => {
    const original = await read(tx => one(tx, sql`select content from app.assistant_messages where enterprise_id=1454 and id=${seed.messageId} and conversation_id=${cid}`));
    try {
      const changed = { version: 1, blocks: [{ type: 'text', text: '合成来源更正：原设备条件已经改变。' }] };
      await read(tx => tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(changed)}::jsonb where enterprise_id=1454 and id=${seed.messageId} and conversation_id=${cid}`));
      assert.equal((await current('synthetic-changed-original-control')).status, 'invalidated');
    } finally { await read(tx => tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(original.content)}::jsonb where enterprise_id=1454 and id=${seed.messageId} and conversation_id=${cid}`)); }
    assert.equal((await current('synthetic-original-control-reset')).status, 'awaiting_review');
    return { originalHashGuard: true, syntheticGuardControlReset: true };
  });
  await step('a legacy review without a note anchor keeps the strict progress boundary', async () => {
    const p = await read(tx => one(tx, sql`select id,payload from app.domain_event_outbox where enterprise_id=1454 and type='construction.need.progress.v1'
      and aggregate_id=${report.reviewed.issueId} order by aggregate_version desc limit 1`));
    try {
      const payload = JSON.parse(JSON.stringify(p.payload)); delete payload.stageReview.projectVersion; delete payload.stageReview.progressNote;
      await read(tx => tx.execute(sql`update app.domain_event_outbox set payload=${JSON.stringify(payload)}::jsonb where enterprise_id=1454 and id=${String(p.id)}`));
      assert.equal((await current('synthetic-legacy-anchor-control')).status, 'invalidated');
    } finally { await read(tx => tx.execute(sql`update app.domain_event_outbox set payload=${JSON.stringify(p.payload)}::jsonb where enterprise_id=1454 and id=${String(p.id)}`)); }
    assert.equal((await current('synthetic-anchor-control-reset')).status, 'awaiting_review');
    return { missingAnchorConservative: true, syntheticGuardControlReset: true };
  });
  await step('revocation and regrant cannot be disguised by duplicate note submissions', async () => {
    await state('active', false); await state('active', true); const p = await scope(); await progress(p.current_stage_key, '合成测试：撤权后补备注');
    assert.equal((await current('after-revoke-regrant')).status, 'invalidated');
    return { scopeRevoked: true, noResurrection: true };
  });
  return { realStaffService: true, sameReviewedIssue: true, syntheticPrerequisiteRuns: 1, modelCalls: 0 };
};
