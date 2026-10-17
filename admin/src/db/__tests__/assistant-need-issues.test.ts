import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { ConstructionService } from '@/lib/construction/service';
import { defaultConstructionStages } from '@/lib/construction/stages';
import { queryNeedIssues, needIssueSnapshotAvailable, recordNeedIssueSupplement } from '@/lib/construction/need-issues';
import { availableNeedMemory } from '@/lib/assistant/agent/memory-sources';
import { readMemory, applyNeedDelta, parseNeedDelta } from '@/lib/assistant/agent/memory';
import { buildAgentContext } from '@/lib/assistant/agent/context';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'synthetic-xk-issues-' + randomUUID(), users: string[] = [];
let eid: string, ownerId: string, designerId: string, workerId: string;
const live = process.env.XIAOK_MATERIALS_LIVE === '1';
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const output = (name: string, args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: 'call-' + name, name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 20, outputTokens: 20 }, finishReason: 'tool_calls', providerRequestId: null });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  if (live) {
    const primary = new URL(process.env.XIAOK_MATERIALS_PRIMARY_DATABASE_URL || '');
    assert.ok(['localhost', '127.0.0.1'].includes(primary.hostname)); assert.equal(primary.port, '5432'); assert.equal(primary.pathname, '/smart_floor_planner');
    const evaluation = process.env.DATABASE_URL; await closePostgresPool();
    let provider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try { process.env.DATABASE_URL = primary.toString(); provider = await getPlatformLlmRuntimeConfig(); }
    finally { await closePostgresPool(); process.env.DATABASE_URL = evaluation; }
    assert.equal(provider.providerKey, 'deepseek'); assert.equal(new URL(provider.baseUrl).origin, 'https://api.deepseek.com');
    priorProvider = await getPlatformLlmRuntimeConfig(); await savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: provider.baseUrl, model: 'deepseek-flash', apiKey: provider.apiKey });
  }
  await withPlatformTransaction(async tx => {
    eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${eid},true,1000,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`);
    const ids: string[] = [];
    for (const role of ['enterprise_admin', 'designer', 'construction_staff']) ids.push(String((await one(tx, sql`insert into app.admin_users
      (enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix + role},'test-only',${role},'active',false,${'合成' + role}) returning id`))!.id));
    [ownerId, designerId, workerId] = ids;
  });
});
after(async () => {
  try { if (eid) await withPlatformTransaction(async tx => {
    await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
    await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
    await tx.execute(sql`delete from app.enterprises where id=${eid}`); for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});
async function fixture() {
  const uid = await withPlatformTransaction(async tx => {
    const id = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id); users.push(id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${prefix + id})`); return id;
  });
  const leadId = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eid},${uid},${prefix},'13800000000','natural') returning id`))!.id));
  const service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
  const execute = (action: string, input: Row = {}, key = randomUUID()) => service.execute(action, input, key);
  const projectId = String((await execute('create', { leadId, name: '合成节点接续之家', managerId: designerId, rooms: ['书房', '客厅'] })).id);
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const settings = await execute('stages');
  await execute('saveStages', { expectedVersion: settings.version, stages: defaultConstructionStages.map(s => s.key === 'utilities'
    ? { ...s, followUps: [{ field: 'devices', room: '书房', question: '书房还有其他准备添置的设备吗？' }] } : s) });
  const progress = async (stageKey = 'utilities') => {
    const detail = await execute('detail', { projectId });
    await execute('progress', { projectId, expectedVersion: Number((detail.project as Row).version), stageKey, note: '', sendReminder: false });
    await chat.messages(cid);
  };
  const query = () => withTenantTransaction(eid, tx => queryNeedIssues(tx, actor, cid));
  const send = async (text: string, model?: NonNullable<Parameters<typeof processAgentAnswer>[1]>['model']) => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] }); const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, model ? { model } : {}); return { sent, lease, run: await chat.run(lease.runId) };
  };
  const save = (value: string) => send('书房' + value, async (_m, _t, turn) => turn === 0 ? output('record_need', { room: '书房', field: 'devices', value, quote: '书房' + value })
    : output('final_response', { kind: 'general', text: '已记录书房补充，仍需设计师核对。' }));
  const ask = () => send('之前书房补充的事现在在等谁？', async (messages, _tools, turn) => turn === 0 ? output('query_followups', {})
    : output('final_response', { kind: 'business', resultKey: messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).resultKey).at(-1) }));
  const staffActor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: designerId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] };
  const staff = new HandoffService(staffActor), customer = new HandoffService(actor);
  return { uid, leadId, projectId, actor, chat, cid, execute, progress, query, send, save, ask, staff, customer };
}
test('PPT16/35/37 a remaining-device gap uses known needs, creates one stable question and survives reentry', async () => {
  const x = await fixture(); assert.equal((await x.save('需要电脑插座')).run.status, 'succeeded');
  assert.equal((await x.query()).data.length, 0); await x.progress();
  const before = await x.query(); assert.equal(before.data.length, 1); assert.equal(before.data[0].status, 'awaiting_customer');
  assert.match(JSON.stringify(await x.chat.messages(x.cid)), /你前面提到.*电脑插座.*其他准备添置/);
  await x.progress(); await new ConversationService(x.actor).messages(x.cid);
  const after = await x.query(); assert.equal(after.data[0].issueId, before.data[0].issueId); assert.equal(after.data[0].revision, 1);
});
test('XK02/04 explicit supplement and correction advance one issue; duplicate receipt and worker replay do not duplicate progress', async () => {
  const x = await fixture(); await x.progress(); const opened = (await x.query()).data[0];
  const saved = await x.save('还需要显示器和台灯插座'); assert.equal(saved.run.status, 'succeeded', JSON.stringify(saved.run));
  const current = (await x.query()).data[0]; assert.equal(current.issueId, opened.issueId); assert.equal(current.revision, 2); assert.equal(current.waitingFor, 'unassigned');
  await processAgentAnswer(saved.lease, { model: async () => { throw Error('terminal worker must not call model'); } });
  await withTenantTransaction(eid, async tx => {
    const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${x.cid} for update`))!;
    const fact = readMemory(c.entry_snapshot).facts.find(f => f.id === current.sourceFactId)!;
    await recordNeedIssueSupplement(tx, x.actor, c, fact);
  });
  assert.equal((await x.query()).data[0].revision, 2);
  const answer = await x.ask(); assert.equal(answer.run.status, 'succeeded');
  const correction = await x.save('更正为只需显示器插座'); assert.equal(correction.run.status, 'succeeded', JSON.stringify(correction.run));
  const updated = (await x.query()).data[0]; assert.equal(updated.issueId, opened.issueId); assert.equal(updated.revision, 3); assert.match(updated.value, /更正为/);
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === answer.run.outputMessageId)!.available, false);
});
test('XK04 S01 consent gates review; a reviewed item and a human reply are not an approved or resolved change', async () => {
  const x = await fixture(); await x.progress(); const answer = await x.save('需要显示器插座');
  await assert.rejects(x.staff.staffRead(x.cid), /not_found|forbidden|context_changed/);
  await x.customer.customerWrite(x.cid, randomUUID(), { action: 'request', recipientId: designerId });
  await x.staff.staffWrite(x.cid, randomUUID(), { action: 'claim' });
  const waiting = await x.query(); assert.equal(waiting.data[0].waitingFor, 'designer');
  const packet = await x.staff.staffRead(x.cid), key = randomUUID();
  const input = { action: 'correct', field: 'devices', text: '显示器需求已核对，点位仍需图纸', sourceMessageId: answer.sent.messageId, expectedVersion: packet.version };
  await x.staff.staffWrite(x.cid, key, input); await x.staff.staffWrite(x.cid, key, input);
  const reviewed = (await x.query()).data[0]; assert.equal(reviewed.lastProgress, 'designer_review'); assert.equal(reviewed.revision, 3); assert.equal(reviewed.status, 'awaiting_review');
  await x.staff.staffWrite(x.cid, randomUUID(), { action: 'reply', text: '收到，点位仍在核对。' });
  assert.equal((await x.query()).data[0].revision, 3);
  await x.customer.customerWrite(x.cid, randomUUID(), { action: 'end' });
  const reentered = await x.ask(); assert.equal(reentered.run.status, 'succeeded', JSON.stringify(reentered.run));
  assert.match(JSON.stringify(await x.chat.messages(x.cid)), /已有内部核对记录/);
  await assert.rejects(x.staff.staffRead(x.cid), /not_found|context_changed/);
  const worker = new HandoffService({ enterpriseId: eid, principal: { kind: 'admin', adminId: workerId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] });
  await assert.rejects(worker.staffRead(x.cid), /not_found|forbidden/);
  assert.equal(Number((await withTenantTransaction(eid, tx => one(tx, sql`select count(*) n from app.assistant_requirement_summaries where enterprise_id=${eid} and conversation_id=${x.cid} and status='confirmed'`)))!.n), 0);
});
test('XK07/08 stage changes invalidate pending sources, derived history and memory before further model calls', async () => {
  const x = await fixture(); await x.progress(); await x.save('需要台灯插座');
  const prior = await x.query(), answered = await x.ask(); assert.equal(answered.run.status, 'succeeded');
  await x.progress('painting'); const next = await x.query();
  assert.equal(next.data[0].issueId, prior.data[0].issueId); assert.equal(next.data[0].status, 'invalidated'); assert.equal(next.data[0].value, '');
  assert.equal(await withTenantTransaction(eid, tx => needIssueSnapshotAvailable(tx, eid, prior)), false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === answered.run.outputMessageId)!.available, false);
  const c = await withTenantTransaction(eid, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${x.cid}`));
  const memory = await withTenantTransaction(eid, tx => availableNeedMemory(tx, eid, x.cid, c!.entry_snapshot)); assert.equal(memory.facts.length, 0);
  const result = await x.send('我们先聊采光', async messages => { assert.doesNotMatch(JSON.stringify(messages), /需要台灯插座/); return output('final_response', { kind: 'general', text: '可以先讨论自然采光。' }); });
  assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
});
test('XK04/07 questions, okay and unrelated rooms do not falsely advance an issue; another owner cannot query it', async () => {
  const x = await fixture(); await x.progress(); const before = await x.query();
  await x.send('可以，先聊别的。', async () => output('final_response', { kind: 'general', text: '可以继续聊。' }));
  assert.equal((await x.query()).data[0].revision, before.data[0].revision);
  const y = await fixture(); await assert.rejects(withTenantTransaction(eid, tx => queryNeedIssues(tx, y.actor, x.cid)), /assistant_resource_not_found/);
  await assert.rejects(withTenantTransaction(eid, tx => queryNeedIssues(tx, { ...x.actor, principal: { kind: 'admin', adminId: ownerId } }, x.cid)), /assistant_capability_forbidden/);
});
test('XK08 expired lease replays a committed supplement before its checkpoint without a second memory or issue write', async () => {
  const x = await fixture(); await x.progress();
  const quote = '书房需要显示器插座', input = { room: '书房', field: 'devices', value: '需要显示器插座', quote };
  const sent = await x.chat.send(x.cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: quote }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  const modelOutput = output('record_need', input);
  await withTenantTransaction(eid, async tx => {
    const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${x.cid} for update`))!;
    const memory = readMemory(c.entry_snapshot), next = applyNeedDelta(memory, parseNeedDelta({ ...input, sourceMessageId: sent.messageId, expectedVersion: memory.version }),
      { id: String(sent.messageId), text: quote }, `${lease.runId}:0:0`, new Date().toISOString());
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify(next)}::jsonb),version=version+1 where enterprise_id=${eid} and id=${x.cid}`);
    await recordNeedIssueSupplement(tx, x.actor, c, next.facts.at(-1)!);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint)
      values(${eid},${lease.runId},1100,'agent_model','succeeded',${JSON.stringify(modelOutput)}::jsonb)`);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary,private_checkpoint)
      values(${eid},${lease.runId},1000,'agent_checkpoint','succeeded',${JSON.stringify({ promptVersion: agentPromptVersion })}::jsonb,
      ${JSON.stringify({ version: 1, turn: 0, messages: buildAgentContext([{ id: String(sent.messageId), role: 'user', text: quote }], memory), output: modelOutput })}::jsonb)`);
    await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),lease_expires_at=now()-interval '1 second' where enterprise_id=${eid} and id=${lease.jobId}`);
  });
  const recovered = await claimJob(); assert.ok(recovered); assert.equal(recovered.runId, lease.runId);
  let calls = 0;
  await processAgentAnswer(recovered, { model: async () => { calls++; return output('final_response', { kind: 'general', text: '补充已记录，仍需设计师核对。' }); } });
  assert.equal(calls, 1); assert.equal((await x.chat.run(lease.runId)).status, 'succeeded');
  assert.equal((await x.query()).data[0].revision, 2);
  const c = await withTenantTransaction(eid, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${x.cid}`));
  assert.equal(readMemory(c!.entry_snapshot).version, 1); assert.equal(readMemory(c!.entry_snapshot).facts.length, 1);
});
test('PPT16/37 configured model repeats same-issue supplement and waiting-state lookup twice', { skip: !live }, async () => {
  for (let iteration = 0; iteration < 2; iteration++) {
    const x = await fixture(); await x.progress();
    const startedAt = Date.now();
    const first = (await x.query()).data[0];
    const saved = await x.send('请记录，书房还需要显示器和台灯插座。'); assert.equal(saved.run.status, 'succeeded', JSON.stringify(saved.run));
    const result = await x.send('之前书房补充的这件事现在在等谁核对？'); assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
    const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select capability_name from app.assistant_run_steps where enterprise_id=${eid} and run_id=${result.lease.runId}`));
    assert.ok(steps.some(s => s.capability_name === 'query_followups'));
    const current = (await x.query()).data[0]; assert.equal(current.issueId, first.issueId); assert.equal(current.status, 'awaiting_review'); assert.equal(current.waitingFor, 'unassigned');
    assert.match(JSON.stringify(await x.chat.messages(x.cid)), /尚未分配有权接续的设计师/);
    const trace = await withTenantTransaction(eid, async tx => ({
      steps: await rows(tx, sql`select run_id::text,step_seq,kind,status,capability_name,private_checkpoint,source_refs from app.assistant_run_steps
        where enterprise_id=${eid} and run_id in (${saved.lease.runId},${result.lease.runId}) and kind not in ('agent_checkpoint') order by run_id,step_seq`),
      usage: await rows(tx, sql`select run_id::text,category,quantity,measurement_kind,input_tokens,output_tokens from app.assistant_usage_records
        where enterprise_id=${eid} and run_id in (${saved.lease.runId},${result.lease.runId}) order by id`),
    }));
    fs.writeFileSync(`../tmp/xiaok-vector/materials-followups-batch/issues-model-trace-${iteration}.json`, JSON.stringify({
      case: 'XK02-XK04', iteration, issue: current, model: 'deepseek-flash', promptVersion: agentPromptVersion, elapsedMs: Date.now() - startedAt,
      unsupportedClaims: 'not separately scored', repeatedQuestions: 'not separately scored', cost: 'unknown; observed token usage retained, no inferred fee', ...trace,
    }, null, 2));
    console.log(JSON.stringify({ case: 'XK02-XK04', iteration, issueId: current.issueId, revision: current.revision, runId: result.lease.runId, model: 'deepseek-flash', promptVersion: agentPromptVersion }));
  }
});
