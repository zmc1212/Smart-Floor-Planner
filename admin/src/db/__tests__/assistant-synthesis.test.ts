import assert from 'node:assert/strict';
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
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer, finalToolForMessages, agentSourceFinalProtocol } from '@/lib/assistant/agent/worker';
import { ConstructionService } from '@/lib/construction/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput, ModelMessage } from '@/lib/assistant/contracts/model';
import { agentMessageAvailable } from '@/lib/assistant/agent/media-context';
import { synthesisRepairBase } from '@/lib/assistant/agent/synthesis-repair';
import { synthesisRepairProjectionVersion, synthesisRepairTask } from '@/lib/assistant/agent/synthesis';
import { readToolInputProtocol, readToolContext } from '@/lib/assistant/agent/read-tool-input';

const prefix = 'synthetic-synthesis-' + randomUUID(), tenants: string[] = [], users: string[] = [];
let eid: string, ownerId: string, knowledge: KnowledgeService;
const office = '书房靠窗办公需同时考虑自然采光、屏幕眩光和通道。显示器避免直对强光窗户，可比较侧向布置。偶尔两人办公可比较共用长桌与独立桌，具体尺寸、插座和通道须现场核对，不从户型名称推断。';
const waterproof = '防水阶段先核对基层和施工条件，施工与检查由项目团队安排。闭水检查前不能把进入防水节点当作防水完成；铺砖前须核对检查记录。客户到场时间以管家实际沟通为准，不承诺固定日期。';
const call = (name: string, args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 30, outputTokens: 30 }, finishReason: 'tool_calls', providerRequestId: null });
const results = (messages: ModelMessage[]) => messages.filter(m => m.role === 'tool').flatMap(m => JSON.parse(m.content).synthesisSources || []) as Array<{ sourceId: string; kind: string; text: string; citationOptions: Array<{ citationId: string }> }>;
const synth = (segments: unknown[]) => call('final_response', { kind: 'synthesis', segments });

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));
    eid = tenants[0];
    ownerId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
  });
  for (const e of tenants) await withTenantTransaction(e, tx => tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
    values(${e},true,1000,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`));
  knowledge = new KnowledgeService({ enterpriseId: eid, adminId: ownerId });
  await publish('合成办公布置', office); await publish('合成防水条件', waterproof);
  await publish('内部禁止外发', 'PRIVATE_ONLY_NEVER_SEND 书房办公和防水的内部客户密码不得外发。', 'staff_internal');
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const e of tenants) { await deleteConstructionData(tx, BigInt(e)); await deleteAssistantData(tx, BigInt(e));
      await tx.execute(sql`delete from app.leads where enterprise_id=${e}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${e}`); await tx.execute(sql`delete from app.enterprises where id=${e}`); }
    for (const u of users) await tx.execute(sql`delete from app.users where id=${u}`);
  }); } finally { await closePostgresPool(); }
});
async function publish(title: string, body: string, audience = 'customer_public') {
  const created = await knowledge.execute('create', { title, body, audience, sourceType: 'manual_text' }, randomUUID());
  const d = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  await knowledge.execute('index', d, randomUUID()); const job = await claimKnowledgeJob(); assert.ok(job); await runKnowledgeJob(job);
  const result = await knowledge.execute('job', { jobId: job.jobId }); assert.equal(result.status, 'succeeded', JSON.stringify(result));
  await knowledge.execute('publish', d, randomUUID()); return d;
}
async function fixture(targetEid = eid, bound = true) {
  const uid = await withPlatformTransaction(async tx => { const u = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id); users.push(u);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${u},${prefix+u})`); return u; });
  const leadId = String((await withTenantTransaction(targetEid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name)
    values(${targetEid},${uid},'合成综合问答客户','13800000000','natural','合成书房之家') returning id`)))!.id);
  const actor: ActorContext = { enterpriseId: targetEid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], ...(bound ? { entry: { kind: 'lead' as const, id: leadId } } : {}) };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const send = async (text: string, model: NonNullable<Parameters<typeof processAgentAnswer>[1]>['model']) => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] }); const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, { model }); return { run: await chat.run(lease.runId), runId: lease.runId };
  };
  return { actor, chat, cid, send, leadId, uid };
}

test('original model context repairs retained1369/1370 drafts once with real writes, reentry and revocation', async () => {
  const body = '第二节 状态区别 客户同意某版方案不等于已经落实，也不等于事项关闭或工程验收通过。\n第一节 点位调整 点位调整需先核对现场尺寸，未核对不能视为已批准。';
  const doc = await publish('合成原文上下文点位说明', body), x = await fixture();
  const question = '合成原文上下文点位说明第二节如何区分方案同意和关闭？';
  const delivered: Array<{ id: string; citationId: string }> = [];
  for (const ignoreRepair of [false, false, true]) {
    let calls = 0;
    const a = await x.send(question, async (messages, tools, turn, dispatch) => {
      calls++;
      assert.doesNotMatch(JSON.stringify(messages.filter(m => m.role === 'system')), /施工节点与到场|先用当前实际阶段/);
      if (!turn) return call('search_knowledge', { query: '合成原文上下文点位说明 第二节 方案同意 关闭' });
      assert.ok(results(messages).every(s => s.kind === 'knowledge'));
      const source = results(messages).find(s => s.text.includes('第二节 状态区别')); assert.ok(source);
      const citations = [{ citationId: source.citationOptions[0].citationId }];
      if (turn === 1) return synth([
        { basis: 'evidence', text: '客户同意某版方案不等于已经落实，也不等于事项关闭或工程验收通过。', citations },
        { basis: 'evidence', text: '点位调整需先核对现场尺寸，未核对不能视为已批准。', citations },
        { basis: 'uncertainty', text: delivered.length ? '当前咨询中暂无团队明确回传的节点补充事项或已解决/关闭结果，具体事项状态需查询实时业务记录。'
          : '当前咨询中暂无团队明确回传的节点补充事项或已解决/关闭结果，具体事项状态需查询本咨询的待办事项列表确认。', citations: [] },
      ]);
      assert.equal(turn, 2); assert.equal(tools.length, 0);
      assert.match(JSON.stringify(messages), /rejectedTextPaths/);
      assert.deepEqual(((dispatch![0].parameters.properties as Row).kind as Row).enum, ['synthesis_repair']);
      return call('final_response', { kind: 'synthesis_repair', baseHash: synthesisRepairBase(messages)!.baseHash,
        edits: ignoreRepair ? [{ segment: 1, basis: 'uncertainty' }] : [{ segment: 1, remove: true }, { segment: 2, remove: true }] });
    });
    assert.equal(calls, 3);
    if (ignoreRepair) {
      assert.equal(a.run.status, 'failed'); assert.equal(a.run.errorCode, 'unsupported_model_commitment'); assert.equal(a.run.outputMessageId, null);
      continue;
    }
    assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run));
    const message = (await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)!;
    assert.ok(message.available); assert.equal(message.citations.length, 1);
    assert.doesNotMatch(JSON.stringify(message.content), /第一节|暂无团队|待办事项/);
    delivered.push({ id: message.id, citationId: message.citations[0].id });
    const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
    assert.equal(steps.filter(s => s.kind === 'agent_validation').length, 1);
    assert.equal(steps.filter(s => s.kind === 'agent_need_write').length, 0);
    assert.ok(steps.some(s => s.kind === 'agent_material_context'));
  }
  for (const foreign of [await fixture(eid, false), await fixture(tenants[1], false)]) {
    await assert.rejects(foreign.chat.messages(x.cid), /assistant_resource_not_found/);
    await assert.rejects(foreign.chat.citation(delivered[0].citationId), /assistant_resource_not_found/);
  }
  await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
  const reentry = await x.chat.messages(x.cid);
  for (const item of delivered) {
    assert.equal(reentry.items.find(m => m.id === item.id)?.available, false);
    assert.equal((await x.chat.citation(item.citationId)).available, false);
  }
});

test('original answer scope rejects retained unsupported conditions and uses one repair with real sources, permissions and revocation', async () => {
  const body = '第二节 状态区别 客户同意某版方案不等于已经落实，也不等于事项关闭或工程验收通过。';
  const doc = await publish('合成手测点位说明', body), x = await fixture(eid, false);
  const question = '合成点位说明第二节如何区分方案同意和关闭？';
  const originals = [
    '方案同意仅表示客户认可设计版本，而关闭需团队提供现场落实证据、正式解决记录或客户明确决定，三者不可混同。',
    '方案同意仅表示客户认可该版本内容，但现场落实、节点验收、费用结算及正式关闭需依赖团队实际施工记录、验收报告及客户明确签署的关闭确认。',
  ];
  const delivered: Array<{ id: string; citationId: string }> = [];
  for (const text of originals) for (const basis of ['advice', 'evidence', 'uncertainty']) {
    let calls = 0;
    const a = await x.send(question, async (messages, tools, turn, dispatch) => {
      calls++;
      if (!turn) { assert.deepEqual(dispatch!.map(t => t.name), ['search_knowledge']); return call('search_knowledge', { query: '合成点位说明 第二节 方案同意 关闭' }); }
      const source = results(messages).find(s => s.text === body); assert.ok(source);
      const citations = [{ citationId: source.citationOptions[0].citationId }];
      if (turn === 1) return synth([
        { basis: 'evidence', text: '客户同意某版方案，不等于已经落实，也不等于事项关闭或工程验收通过。', citations },
        { basis, text, citations },
      ]);
      assert.equal(turn, 2); assert.equal(tools.length, 0);
      const base = synthesisRepairBase(messages); assert.ok(base);
      assert.match(JSON.stringify(messages), /unsupported_source_condition|source_answer_scope/);
      assert.deepEqual(((dispatch![0].parameters.properties as Row).kind as Row).enum, ['synthesis_repair']);
      return call('final_response', { kind: 'synthesis_repair', baseHash: base.baseHash, edits: [{ segment: 1, remove: true }] });
    });
    assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run)); assert.equal(calls, 3);
    const message = (await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)!;
    assert.ok(message.available); assert.equal(message.citations.length, 1);
    assert.doesNotMatch(JSON.stringify(message.content), /现场落实证据|正式解决记录|费用结算|验收报告|签署|一般建议/);
    const citation = await x.chat.citation(message.citations[0].id); assert.ok('quote' in citation); assert.equal(citation.quote, body);
    delivered.push({ id: message.id, citationId: message.citations[0].id });
    const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
    assert.equal(steps.filter(s => s.kind === 'agent_validation').length, 1);
    assert.equal(steps.filter(s => s.kind === 'retrieval').length, 1);
    assert.equal(steps.filter(s => s.kind === 'agent_need_write').length, 0);
    assert.ok(steps.filter(s => s.kind === 'agent_model').every(s => (s.input_summary as Row).sourceAnswerProtocol === 'original-answer-scope-v1'));
  }
  const other = await fixture(eid, false), cross = await fixture(tenants[1], false);
  for (const foreign of [other, cross]) {
    await assert.rejects(foreign.chat.messages(x.cid), /assistant_resource_not_found/);
    await assert.rejects(foreign.chat.citation(delivered[0].citationId), /assistant_resource_not_found/);
  }
  const ignored = await x.send(question, async (messages, _tools, turn) => {
    if (!turn) return call('search_knowledge', { query: '合成点位说明 第二节' });
    const source = results(messages).find(s => s.text === body); assert.ok(source);
    if (turn === 1) return synth([{ basis: 'evidence', text: originals[0], citations: [{ citationId: source.citationOptions[0].citationId }] }]);
    return call('final_response', { kind: 'synthesis_repair', baseHash: synthesisRepairBase(messages)!.baseHash, edits: [{ segment: 0, basis: 'uncertainty' }] });
  });
  assert.equal(ignored.run.status, 'failed'); assert.equal(ignored.run.errorCode, 'ungrounded_response_scope'); assert.equal(ignored.run.outputMessageId, null);
  await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
  const reopened = await new ConversationService(x.actor).messages(x.cid);
  for (const message of delivered) {
    assert.equal(reopened.items.find(m => m.id === message.id)?.available, false);
    assert.equal((await x.chat.citation(message.citationId)).available, false);
  }
});

test('explicit completion denials persist exact knowledge and reentry while a separate positive claim stays rejected', async () => {
  const body = '厨房设备调整须先核对电器尺寸、插座位置与通道条件；若处在水电施工阶段，还需核对当前点位图和现场记录。客户提出保留冰箱只表示需求，不证明点位已落实或通过验收。未查到图纸或现场记录时不能据此认定现实没有，也不承诺更改日期。';
  const doc = await publish('合成否定完工边界厨房规程', body), x = await fixture();
  const model = (positive: boolean): NonNullable<Parameters<typeof processAgentAnswer>[1]>['model'] => async (messages, _tools, turn) => {
    if (!turn) return call('search_knowledge', { query: '合成否定完工边界厨房规程' });
    assert.equal(turn, 1, 'An explicit denial must not consume a repair');
    const source = results(messages).find(s => s.text === body); assert.ok(source?.citationOptions.length);
    return synth([{ basis: 'evidence', text: body + (positive ? '\n项目已批准。' : ''),
      citations: [{ citationId: source.citationOptions[0].citationId }] }]);
  };
  const accepted = await x.send('结合企业规程解释厨房保留冰箱需要核对哪些前提。', model(false));
  assert.equal(accepted.run.status, 'succeeded', JSON.stringify(accepted.run));
  const message = (await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === accepted.run.outputMessageId)!;
  assert.ok(message.available); assert.ok(JSON.stringify(message.content).includes(body)); assert.equal(message.citations.length, 1);
  const citation = await x.chat.citation(message.citations[0].id); assert.ok('quote' in citation); assert.equal(citation.quote, body);
  const validations = await withTenantTransaction(eid, tx => rows(tx, sql`select id from app.assistant_run_steps
    where enterprise_id=${eid} and run_id=${accepted.runId} and kind='agent_validation'`));
  assert.equal(validations.length, 0);
  const rejected = await x.send('再解释这些厨房前提，不要替我确认项目状态。', model(true));
  assert.equal(rejected.run.status, 'failed'); assert.equal(rejected.run.errorCode, 'unsupported_model_commitment');
  assert.equal(rejected.run.outputMessageId, null);
  await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await x.chat.citation(message.citations[0].id)).available, false);
  assert.equal((await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === message.id)?.available, false);
});

test('QA01/06: an enterprise without a knowledge index still receives labelled general advice and an honest knowledge gap', async () => {
  const x = await fixture(tenants[1]);
  const a = await x.send('书房靠窗办公为什么要考虑反光？', async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '书房靠窗办公 反光' });
    assert.match(JSON.stringify(m), /not_ready/); assert.equal(results(m).filter(s => s.kind === 'knowledge').length, 0);
    return synth([{ basis: 'advice', text: '可以先比较侧向与正对窗的屏幕反光情况，兼顾采光和使用感受。', citations: [] },
      { basis: 'uncertainty', text: '当前企业知识尚未就绪，企业做法和现场条件需核实。', citations: [] }]);
  }); assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run));
  const message = (await x.chat.messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)!;
  assert.match(JSON.stringify(message.content), /一般建议/); assert.match(JSON.stringify(message.content), /尚未就绪/); assert.equal(message.citations.length, 0);
});

test('AG05/09: duplicate knowledge reads execute once, retain real citations and revoke on persisted reentry', async () => {
  const doc = await publish('合成重复读甲', '书房遮光补查甲：屏幕可比较侧向布置，避免直对强光窗户。');
  const x = await fixture();
  const a = await x.send('书房遮光补查甲怎样避免反光？', async (messages, _tools, turn) => {
    if (!turn) return { ...call('search_knowledge', { query: '书房遮光补查甲' }), toolCalls: [
      { id: 'original', name: 'search_knowledge', arguments: '{"query":"书房遮光补查甲"}' },
      { id: 'same-batch', name: 'search_knowledge', arguments: '{ "query": "书房遮光补查甲" }' },
    ] };
    if (turn === 1) return call('search_knowledge', { query: '书房遮光补查甲' });
    const packets = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
    assert.equal(packets.filter(p => p.status === 'already_queried').length, 2);
    const source = results(messages).find(s => s.kind === 'knowledge' && s.text.includes('书房遮光补查甲'))!;
    assert.ok(source);
    return synth([{ basis: 'evidence', text: '这份资料建议比较侧向布置，避免直对强光窗户。', citations: [{ citationId: source.citationOptions[0].citationId }] }]);
  });
  assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run));
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,private_checkpoint,input_summary
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
  assert.equal(steps.filter(s => s.capability_name === 'knowledge.search.v1').length, 1);
  const checkpoint = steps.find(s => s.kind === 'agent_checkpoint')!.private_checkpoint as { readReceipts: unknown[] };
  assert.equal(checkpoint.readReceipts.length, 1);
  assert.ok(steps.filter(s => s.kind === 'agent_model').every(s => (s.input_summary as Row).readProtocol === 'same-run-read-v1'));
  const history = await x.chat.messages(x.cid), reply = history.items.find(m => m.id === a.run.outputMessageId)!;
  assert.ok(reply.available); assert.equal(reply.citations.length, 1);
  const citationId = reply.citations[0].id;
  assert.equal((await x.chat.citation(citationId)).available, true);
  await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === reply.id)!.available, false);
  assert.equal((await x.chat.citation(citationId)).available, false);
});

test('AG05/07: a source change before a repeated read blocks reuse and delivery', async () => {
  const doc = await publish('合成重复读乙', '书房遮光补查乙：屏幕可比较侧向布置，避免直对强光窗户。');
  const x = await fixture();
  const a = await x.send('书房遮光补查乙怎样避免反光？', async (messages, _tools, turn) => {
    if (!turn) return call('search_knowledge', { query: '书房遮光补查乙' });
    assert.ok(results(messages).some(s => s.kind === 'knowledge' && s.text.includes('书房遮光补查乙')));
    await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
    return call('search_knowledge', { query: '书房遮光补查乙' });
  });
  assert.notEqual(a.run.status, 'succeeded');
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select capability_name from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
  assert.equal(steps.filter(s => s.capability_name === 'knowledge.search.v1').length, 1);
  assert.equal((await x.chat.messages(x.cid)).items.some(m => m.authorKind === 'assistant' && m.available), false);
});

test('AG05 read-input recovery preserves real knowledge, queries once with a corrected string ID and revokes on reentry', async () => {
  const doc = await publish('合成参数恢复甲', '书房参数恢复甲：屏幕可比较侧向布置，避免直对强光窗户。');
  const x = await fixture(eid, false);
  assert.ok(Number.isSafeInteger(Number(x.leadId)));
  let calls = 0;
  const a = await x.send('书房参数恢复甲怎样避免反光，核对现场资料？', async (messages, _tools, turn) => {
    calls++;
    if (!turn) {
      const first = call('search_knowledge', { query: '书房参数恢复甲' });
      first.toolCalls.push(...call('query_materials', { leadId: Number(x.leadId), room: '书房' }).toolCalls);
      return first;
    }
    const packets = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
    assert.equal(packets.filter(p => p.protocol === readToolInputProtocol && p.status === 'invalid_arguments').length, 1);
    assert.deepEqual(packets.find(p => p.protocol === readToolInputProtocol).issues,
      [{ path: 'leadId', code: 'type', expected: 'string', received: 'number' }]);
    const source = results(messages).find(s => s.kind === 'knowledge' && s.text.includes('书房参数恢复甲'))!;
    assert.ok(source, 'complete authorized knowledge survives the parameter error');
    assert.deepEqual(((finalToolForMessages(messages).parameters.properties as Row).kind as Row).enum,
      turn === 1 ? ['synthesis'] : ['synthesis', 'business', 'knowledge', 'references'], 'a rejected read cannot widen earlier knowledge; a real business result preserves its display protocol');
    if (turn === 1) return call('query_materials', { leadId: x.leadId, room: '书房' });
    assert.ok(results(messages).some(s => s.kind === 'project'));
    return synth([{ basis: 'evidence', text: '这份资料建议比较侧向布置，避免直对强光窗户。', citations: [{ citationId: source.citationOptions[0].citationId }] }]);
  });
  assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run)); assert.equal(calls, 3);
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,private_checkpoint,input_summary
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
  const reads = steps.filter(s => s.capability_name === 'query_materials');
  assert.equal(reads.length, 1);
  assert.equal((reads[0].private_checkpoint as Row).query && ((reads[0].private_checkpoint as Row).query as Row).leadId, x.leadId);
  const checkpoint = steps.find(s => s.kind === 'agent_checkpoint')!.private_checkpoint as Row;
  assert.equal(checkpoint.argumentFailures, 1); assert.equal((checkpoint.readReceipts as unknown[]).length, 2);
  assert.ok(steps.filter(s => s.kind === 'agent_model').every(s => (s.input_summary as Row).readInputProtocol === readToolInputProtocol));
  const reply = (await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)!;
  assert.ok(reply.available); assert.equal(reply.citations.length, 1);
  await assert.rejects(new ConversationService((await fixture(tenants[1])).actor).messages(x.cid), /assistant_resource_not_found/);
  await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === reply.id)!.available, false);
  assert.equal((await x.chat.citation(reply.citations[0].id)).available, false);
});

test('AG05 read-input failure permits honest clarification, while repeated malformed reads execute nothing', async () => {
  for (const repeat of [false, true]) {
    const x = await fixture(); let calls = 0;
    const a = await x.send('核对厨房现场资料？', async (messages, _tools, turn) => {
      calls++;
      if (!turn || repeat) return call('query_materials', { leadId: Number(x.leadId), room: '厨房' });
      assert.equal(results(messages).length, 0);
      const schema = finalToolForMessages(messages).parameters.properties as Row;
      assert.ok(((schema.kind as Row).enum as string[]).includes('general'));
      return call('final_response', { kind: 'general', text: '请先明确要核对的房屋。' });
    });
    assert.equal(calls, 2);
    assert.equal(a.run.status === 'succeeded', !repeat, JSON.stringify(a.run));
    const reads = await withTenantTransaction(eid, tx => rows(tx, sql`select id from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${a.runId} and capability_name='query_materials'`));
    assert.equal(reads.length, 0);
    const replies = (await x.chat.messages(x.cid)).items.filter(m => m.authorKind === 'assistant' && m.available);
    assert.equal(replies.length, repeat ? 0 : 1);
  }
});

test('AG05 read-input correction never grants a foreign customer or tenant resource', async () => {
  const x = await fixture();
  for (const targetEid of [eid, tenants[1]]) {
    const other = await fixture(targetEid); let calls = 0;
    const a = await x.send('核对厨房现场资料？', async (_messages, _tools, turn) => {
      calls++;
      return call('query_materials', { leadId: turn === 0 ? Number(other.leadId) : other.leadId, room: '厨房' });
    });
    assert.equal(calls, 2); assert.notEqual(a.run.status, 'succeeded');
    assert.equal((await x.chat.messages(x.cid)).items.some(m => m.authorKind === 'assistant' && m.available), false);
  }
});

test('QA02/05 PPT6/15: real retrieval plus authorized originals produces persisted explanatory prose without a handling side effect', async () => {
  const x = await fixture();
  const save = await x.send('请记录书房靠窗，偶尔两人办公', async (_m,_t,turn) => turn === 0
    ? call('record_need', { room: '书房', field: 'desk', value: '靠窗，偶尔两人办公', quote: '请记录书房靠窗，偶尔两人办公' })
    : call('final_response', { kind: 'general', text: '已记录，可以继续聊。' })); assert.equal(save.run.status, 'succeeded');
  let answerCalls = 0;
  const a = await x.send('书房靠窗办公为什么还要考虑桌子的朝向？', async (m,tools,turn) => {
    answerCalls++;
    assert.doesNotMatch(JSON.stringify(m), /PRIVATE_ONLY_NEVER_SEND/);
    if (turn === 0) { const a = call('search_knowledge', { query: '书房靠窗办公 屏幕眩光 双人桌' }); a.toolCalls.push(...call('query_materials', { room: '书房' }).toolCalls); return a; }
    const s = results(m), k = s.find(s => s.kind === 'knowledge' && s.text.includes('屏幕眩光'))!, b = s.find(s => s.sourceId.includes(':customer_need:'))!;
    if (turn === 2) { assert.equal(tools.length, 0); assert.match(JSON.stringify(m), /unscoped_measurement_gap/); }
    return synth([{ basis: 'evidence', text: '你希望靠窗并偶尔两人办公，可以保留采光偏好，但桌向需要同时照顾屏幕眩光和共用通道，因此先比较侧向摆放更有讨论价值。',
      citations: [{ sourceId: k.sourceId, quote: '显示器避免直对强光窗户，可比较侧向布置。' }, { sourceId: b.sourceId, quote: '靠窗，偶尔两人办公' }] },
    { basis: 'uncertainty', text: turn === 1 ? '目前缺少有效点位图和现场尺寸，需要设计师核对后再确定位置。'
      : '本次查询未包含有效点位图和现场尺寸，需要设计师核对后再确定位置。', citations: [] }]);
  });
  assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run));
  assert.equal(answerCalls, 3);
  const repairs = await withTenantTransaction(eid, tx => rows(tx, sql`select input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId} and kind='agent_validation'`));
  assert.equal(repairs.length, 1);
  assert.equal((repairs[0].input_summary as Row).scope, 'authorized_response_scope');
  const msgs = await new ConversationService(x.actor).messages(x.cid), reply = msgs.items.find(m => m.id === a.run.outputMessageId)!;
  assert.equal(reply.available, true); assert.match(JSON.stringify(reply), /同时照顾屏幕眩光/); assert.ok(reply.citations.length);
  const state = await withTenantTransaction(eid, tx => one(tx, sql`select source_refs,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId} and kind='agent_synthesis_context'`));
  assert.ok(state); assert.match(JSON.stringify(state.source_refs), /owned_conversation|customer_need/);
  assert.equal(Number((await withTenantTransaction(eid, tx => one(tx, sql`select count(*) n from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.%issue.%' and payload->>'conversationId'=${x.cid}`)))!.n), 0);
  const added = await x.send('请记录书房还要放打印机', async (_m,_t,turn) => !turn
    ? call('record_need', { room: '书房', field: 'desk', value: '还要放打印机', quote: '请记录书房还要放打印机' })
    : call('final_response', { kind: 'general', text: '已记录，可以继续讨论。' })); assert.equal(added.run.status, 'succeeded');
  const follow = await x.send('为什么侧向会更合适？', async (m,_t,turn) => {
    if (!turn) { assert.match(JSON.stringify(m), /书房靠窗办公为什么/); return call('search_knowledge', { query: '书房办公 屏幕眩光 侧向布置' }); }
    assert.match(JSON.stringify(m.at(-1)), /为什么侧向会更合适/);
    assert.ok(results(m).some(s => s.kind === 'project' && s.sourceId.startsWith('Bbound:') && s.text.includes('打印机')),
      'A knowledge-only follow-up must receive fresh authorized home material, not the old missing-data snapshot');
    const k = results(m).find(s => s.kind === 'knowledge' && s.text.includes('屏幕眩光'))!;
    const need = results(m).find(s => s.kind === 'project' && s.sourceId.startsWith('Bbound:') && s.text.includes('打印机'))!;
    return synth([{ basis: 'evidence', text: '侧向是为了比较采光与屏幕眩光的取舍，并不是仅凭靠窗偏好就决定你家的最终桌向。你不用重复确认已保存的书房需求。',
      citations: [{ sourceId: k.sourceId, quote: '显示器避免直对强光窗户，可比较侧向布置。' }, { sourceId: need.sourceId, quote: need.text.split('\n')[0] }] }]);
  }); assert.equal(follow.run.status, 'succeeded');
  const refreshed = await withTenantTransaction(eid, tx => one(tx, sql`select source_refs from app.assistant_run_steps where enterprise_id=${eid} and run_id=${follow.runId} and kind='agent_synthesis_context'`));
  assert.match(JSON.stringify(refreshed?.source_refs), /打印机/);
});

test('QA03 PPT18: actual project stage enters synthesis and a later stage change invalidates the old explanation', async () => {
  const x = await fixture(), service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
  const pid = String((await service.execute('create', { leadId: x.leadId, name: '合成防水问答工地', managerId: ownerId, rooms: ['书房'] }, randomUUID())).id);
  const settings = await service.execute('stages');
  await service.execute('saveStages', { expectedVersion: settings.version, stages: [
    { key: 'waterproofing', name: '防水阶段', visitReminder: false, visitReason: '', watchPoints: '' },
    { key: 'tiling', name: '铺砖阶段', visitReminder: false, visitReason: '', watchPoints: '' },
  ] }, randomUUID());
  const progress = async (key: string) => { const d = await service.execute('detail', { projectId: pid }); await service.execute('progress', { projectId: pid, expectedVersion: (d.project as Row).version, stageKey: key, note: '', sendReminder: false }, randomUUID()); };
  await progress('waterproofing');
  const a = await x.send('我家现场现在防水阶段，为什么还不能直接铺砖？', async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '防水阶段 闭水检查 铺砖条件' });
    const s = results(m), k = s.find(s => s.kind === 'knowledge' && s.text.includes('闭水检查前'))!, b = s.find(s => s.sourceId.startsWith('Bstage:'))!;
    assert.match(b.text, /防水/);
    return synth([{ basis: 'evidence', text: '当前进入防水节点只说明所处阶段；铺砖前还需核对检查记录，不能据此认定防水已经完成。',
      citations: [{ sourceId: b.sourceId, quote: '防水' + (b.text.includes('防水施工') ? '施工' : '阶段') }, { sourceId: k.sourceId, quote: '闭水检查前不能把进入防水节点当作防水完成；铺砖前须核对检查记录。' }] },
    { basis: 'uncertainty', text: '尚缺本次闭水检查结果，具体安排请与管家核对。', citations: [] }]);
  }); assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run));
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)?.available, true);
  await progress('tiling');
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)?.available, false);
  const fresh = await x.send('那现在呢？',async(m,_t,turn)=>{
    if(!turn)return call('search_knowledge',{query:'防水检查与铺砖条件'});
    const stage=results(m).find(s=>s.sourceId.startsWith('Bstage:'))!;assert.match(stage.text,/铺砖阶段/);
    return synth([{basis:'evidence',text:'团队现在标记为铺砖阶段，具体检查结果仍需核对记录。',citations:[{sourceId:stage.sourceId,quote:'团队标记的当前节点：铺砖阶段。'}]}]);
  });assert.equal(fresh.run.status,'succeeded',JSON.stringify(fresh.run));
  const reentry=await new ConversationService(x.actor).messages(x.cid);
  assert.equal(reentry.items.find(m=>m.id===fresh.run.outputMessageId)?.available,true);
  const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select capability_name from app.assistant_run_steps where enterprise_id=${eid} and run_id=${fresh.runId}`));
  assert.ok(steps.some(s=>s.capability_name==='synthesis.bound_construction.v1'));
});

test('KB3 XK07/08 a changed actual node during generation fences a knowledge-only late answer',async()=>{
  const x=await fixture(),service=new ConstructionService({enterpriseId:eid,adminId:ownerId});
  const pid=String((await service.execute('create',{leadId:x.leadId,name:'合成KB3在途变化',managerId:ownerId,rooms:['书房']},randomUUID())).id);
  const a=await x.send('结合我家阶段解释铺砖前提',async(m,_t,turn)=>{
    if(!turn)return call('search_knowledge',{query:'防水与铺砖检查'});
    assert.ok(results(m).some(s=>s.sourceId.startsWith('Bstage:')));
    const d=await service.execute('detail',{projectId:pid});await service.execute('progress',{projectId:pid,expectedVersion:(d.project as Row).version,stageKey:'tiling',note:'合成在途更新',sendReminder:false},randomUUID());
    return synth([{basis:'advice',text:'先核对项目团队当前检查记录。',citations:[]}]);
  });assert.notEqual(a.run.status,'succeeded');
  assert.equal((await x.chat.messages(x.cid)).items.filter(m=>m.authorKind==='assistant').length,0);
});

test('KB3 citation repair uses the same authorized originals and persists one repair without replaying business tools',async()=>{
  const x=await fixture();let modelCalls=0;
  const a=await x.send('书房靠窗办公应如何考虑屏幕方向？',async(m,tools,turn)=>{
    modelCalls++;
    if(!turn)return call('search_knowledge',{query:'书房靠窗办公 屏幕眩光'});
    const k=results(m).find(s=>s.kind==='knowledge'&&s.text.includes('屏幕眩光'))!;assert.ok(k);
    if(turn===2){assert.equal(tools.length,0);assert.match(JSON.stringify(m),/唯一一次格式修复/);assert.match(JSON.stringify(m),/copyExact(?:Quote|SourceText)/);
      assert.ok(k.text.includes('显示器避免直对强光窗户，可比较侧向布置。'),'The same exact authorized original must remain in the projected repair context');}
    return synth([{basis:'evidence',text:'可以比较侧向布置，兼顾采光和屏幕眩光。',citations:[{sourceId:k.sourceId,
      quote:turn===1?'显示器避免正对强光窗户，可比较侧向布置。':'显示器避免直对强光窗户，可比较侧向布置。'}]}]);
  });assert.equal(a.run.status,'succeeded',JSON.stringify(a.run));assert.equal(modelCalls,3);
  const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select kind,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
  assert.equal(steps.filter(s=>s.kind==='agent_validation').length,1);
  assert.ok(steps.some(s=>s.kind==='agent_checkpoint'&&(s.private_checkpoint as Row).validationRepairs===1));
  assert.equal((await new ConversationService(x.actor).messages(x.cid)).items.filter(m=>m.authorKind==='assistant').length,1);
});

test('AG08 source grounding repair persists one scoped reply, keeps real action claims closed and revokes on reentry', async () => {
  const document = await publish('合成管路间距核对', '强弱电管线平行间距不得小于300mm。交叉处需要屏蔽，现场长度另行核实。');
  const x = await fixture(); let modelCalls = 0;
  const response = await x.send('管路间距和交叉屏蔽应该怎样核对？', async (messages, tools, turn) => {
    modelCalls++;
    if (!turn) return call('search_knowledge', { query: '强弱电管线平行间距 交叉屏蔽' });
    const source = results(messages).find(s => s.kind === 'knowledge' && s.text.includes('300mm'))!; assert.ok(source);
    if (turn === 1) return synth([{ basis: 'evidence', text: '现场记录平行间距200mm符合手册300mm的要求。记录只看到一小段包裹。主要风险是长期干扰和检修困难。还要再等两天。',
      citations: [{ sourceId: source.sourceId, quote: source.text }] }]);
    assert.equal(tools.length, 0);
    for (const code of ['misattributed_project_quantity', 'misattributed_project_observation', 'unsupported_evidence_mechanism'])
      assert.match(JSON.stringify(messages), new RegExp(code));
    assert.match(JSON.stringify(messages), /两天/); assert.match(JSON.stringify(messages), /最多6段/);
    return synth([{ basis: 'evidence', text: '手册要求平行间距不得小于300mm，交叉处需要屏蔽。', citations: [{ sourceId: source.sourceId, quote: source.text }] },
      { basis: 'advice', text: '一般风险可从信号干扰和后期检修角度考虑，具体影响仍需现场核对。', citations: [] },
      { basis: 'uncertainty', text: '本次资料不能核实现场间距和屏蔽长度。楼下是否已联系，本次资料没有记录。', citations: [] }]);
  });
  assert.equal(response.run.status, 'succeeded', JSON.stringify(response.run)); assert.equal(modelCalls, 3);
  const reentry = await new ConversationService(x.actor).messages(x.cid);
  const reply = reentry.items.find(m => m.id === response.run.outputMessageId)!;
  assert.equal(reply.available, true); assert.match(JSON.stringify(reply.content), /一般建议.*干扰/);
  assert.match(JSON.stringify(reply.content), /楼下是否已联系/);
  const validation = await withTenantTransaction(eid, tx => rows(tx, sql`select input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${response.runId} and kind='agent_validation'`));
  assert.equal(validation.length, 1);
  let rejectedCalls = 0;
  const rejected = await x.send('楼下联系状态可以确认了吗？', async () => {
    rejectedCalls++; return call('final_response', { kind: 'general', text: '楼下是否已联系尚未核实，但我已付款。' });
  });
  assert.notEqual(rejected.run.status, 'succeeded'); assert.equal(rejectedCalls, 1);
  assert.equal((await x.chat.messages(x.cid)).items.filter(m => m.authorKind === 'assistant').length, 1);
  await knowledge.execute('retire', { documentId: document.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === response.run.outputMessageId)?.available, false);
});

test('AG08 bounded citation edits preserve knowledge while adding actual-stage support, persist originals and revoke on reentry', async () => {
  const document = await publish('合成有界修复阶段边界', '有界修复测试：铺砖前须核对检查记录，节点标记不能代替检查结果。');
  const x = await fixture(), service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
  const projectId = String((await service.execute('create', { leadId: x.leadId, name: '合成有界修复工地', managerId: ownerId, rooms: ['书房'] }, randomUUID())).id);
  const settings = await service.execute('stages');
  if (!(settings.stages as Array<Row>).some(stage => stage.key === 'waterproofing')) {
    await service.execute('saveStages', { expectedVersion: settings.version, stages: [...settings.stages as Array<Row>,
      { key: 'waterproofing', name: '防水阶段', visitReminder: false, visitReason: '', watchPoints: '' }] }, randomUUID());
  }
  const detail = await service.execute('detail', { projectId });
  await service.execute('progress', { projectId, expectedVersion: (detail.project as Row).version, stageKey: 'waterproofing', note: '', sendReminder: false }, randomUUID());
  let calls = 0, firstId = '', stageId = '';
  const response = await x.send('结合实际阶段解释有界修复测试的铺砖前提', async (messages, tools, turn) => {
    calls++;
    if (!turn) return call('search_knowledge', { query: '有界修复测试 铺砖前 核对检查记录' });
    const all = results(messages) as Array<{ sourceId: string; text: string; citationOptions: Array<{ citationId: string }> }>;
    const knowledge = all.find(source => source.text.includes('有界修复测试：'))!;
    const stage = all.find(source => source.sourceId.startsWith('Bstage:'))!; assert.ok(knowledge && stage);
    if (turn === 1) {
      firstId = knowledge.citationOptions[0].citationId; stageId = stage.citationOptions[0].citationId;
      return synth([{ basis: 'evidence', text: '铺砖前须核对检查记录，团队当前节点是防水。', citations: [{ citationId: firstId }] }]);
    }
    assert.equal(tools.length, 0);
    const base = synthesisRepairBase(messages)!; assert.ok(base);
    assert.deepEqual(messages.at(-1), { role: 'user', content: [{ type: 'text', text: synthesisRepairTask }] });
    assert.match(JSON.stringify(finalToolForMessages(messages)), /synthesis_repair/);
    return call('final_response', { kind: 'synthesis_repair', baseHash: base.baseHash, edits: [{ segment: 0, addCitationIds: [stageId] }] });
  });
  assert.equal(response.run.status, 'succeeded', JSON.stringify(response.run)); assert.equal(calls, 3);
  const reply = (await new ConversationService(x.actor).messages(x.cid)).items.find(message => message.id === response.run.outputMessageId)!;
  // The existing C01 contract exposes knowledge citation cards; project
  // provenance is retained in synthesis context and its ordinary source text.
  assert.equal(reply.available, true); assert.equal(reply.citations.length, 1);
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${response.runId}`));
  assert.equal(steps.filter(step => step.kind === 'agent_validation').length, 1);
  assert.equal(steps.filter(step => step.capability_name === 'knowledge.search.v1').length, 1);
  const persisted = steps.find(step => step.kind === 'agent_synthesis_context')!.private_checkpoint as { segments: Array<{ citations: Array<{ sourceId: string }> }> };
  assert.equal(persisted.segments[0].citations.length, 2);
  assert.ok(persisted.segments[0].citations.some(citation => citation.sourceId.startsWith('K')));
  assert.ok(persisted.segments[0].citations.some(citation => citation.sourceId.startsWith('Bstage:')));
  const provider = steps.filter(step => step.kind === 'agent_model'); assert.equal(provider.length, 3);
  const repair = provider.find(step => (step.input_summary as Row).repairProtocol === 'synthesis-edit-v1')!; assert.ok(repair);
  assert.equal((repair.input_summary as Row).repairProjection, synthesisRepairProjectionVersion);
  assert.equal((repair.input_summary as Row).contextPolicy, 'current-turn-sources-v8');
  assert.equal(JSON.parse((repair.private_checkpoint as Row).text as string).kind, 'synthesis_repair');
  assert.ok(steps.some(step => step.kind === 'agent_checkpoint' && (step.private_checkpoint as Row).validationRepairs === 1
    && JSON.parse(((step.private_checkpoint as Row).output as Row).text as string).kind === 'synthesis_repair'));
  assert.notEqual(firstId, stageId);
  await knowledge.execute('retire', { documentId: document.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await new ConversationService(x.actor).messages(x.cid)).items.find(message => message.id === response.run.outputMessageId)?.available, false);
});

test('AG08 bounded citation edits cannot deliver a cached original after source revocation during repair', async () => {
  const document = await publish('合成有界修复撤回', '有界修复撤回测试：现场尺寸须按有效资料核对。');
  const x = await fixture(); let calls = 0;
  const response = await x.send('有界修复撤回测试应怎样核对尺寸？', async (messages, tools, turn) => {
    calls++;
    if (!turn) return call('search_knowledge', { query: '有界修复撤回测试 现场尺寸' });
    const source = results(messages).find(s => s.text.includes('有界修复撤回测试：'));
    assert.ok(source);
    if (turn === 1) return synth([{ basis: 'uncertainty', text: '目前缺少现场尺寸，需要核对。', citations: [{ citationId: source.citationOptions[0].citationId }] }]);
    assert.equal(tools.length, 0); const base = synthesisRepairBase(messages)!; assert.ok(base);
    await knowledge.execute('retire', { documentId: document.documentId, expectedVersion: 2 }, randomUUID());
    return call('final_response', { kind: 'synthesis_repair', baseHash: base.baseHash, edits: [{ segment: 0, text: '本次可用资料还不足以核实现场尺寸。' }] });
  });
  assert.notEqual(response.run.status, 'succeeded'); assert.equal(calls, 3);
  assert.equal((await x.chat.messages(x.cid)).items.filter(message => message.authorKind === 'assistant').length, 0);
});

test('QA06/07: consulted but uncited conflict candidates remain dependencies; withdrawal hides synthesis and human packets', async () => {
  const conflict = await publish('合成冲突办公条件', '书房办公规则存在冲突：本资料要求正对强光窗户，需负责人核实适用版本，不能自行择一。');
  const x = await fixture();
  const a = await x.send('书房办公桌为什么不能直接正对窗户？', async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '书房办公 正对强光窗户 冲突' });
    const s = results(m), k = s.find(s => s.kind === 'knowledge' && s.text.includes('屏幕眩光'))!;
    assert.ok(s.some(s => s.text.includes('本资料要求正对强光窗户')));
    return synth([{ basis: 'uncertainty', text: '两份资料对正对窗户的说法不一致，适用规则需负责人核实。', citations: [] },
      { basis: 'evidence', text: '办公布置需要核对屏幕眩光和通道。', citations: [{ sourceId: k.sourceId, quote: '书房靠窗办公需同时考虑自然采光、屏幕眩光和通道。' }] }]);
  }); assert.equal(a.run.status, 'succeeded', JSON.stringify(a.run));
  await knowledge.execute('retire', { documentId: conflict.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)?.available, false);
  const h = new HandoffService(x.actor); await h.customerWrite(x.cid, randomUUID(), { action: 'request' });
  assert.doesNotMatch(JSON.stringify(await h.customerRead(x.cid)), /办公布置需要核对屏幕眩光和通道/);
});

test('QA06: expired source during generation prevents a late answer; valid remaining knowledge is still usable', async () => {
  const doc = await publish('合成短期办公说明', '书房临时讨论可先比较侧向布置，适用期内使用。'); const x = await fixture();
  const a = await x.send('书房临时讨论该怎么摆？', async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '书房临时讨论 侧向布置' });
    assert.ok(results(m).some(s => s.text.includes('适用期内')));
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_knowledge_versions set effective_to=now()-interval '1 second' where enterprise_id=${eid} and id=${doc.versionId}`));
    return synth([{ basis: 'advice', text: '可以先比较侧向布置。', citations: [] }]);
  }); assert.notEqual(a.run.status, 'succeeded'); assert.equal((await x.chat.messages(x.cid)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('QA06: publishing a replacement invalidates the old synthesis and its citation; a fresh question uses the effective version', async () => {
  const old = await publish('合成书房遮阳版本', '书房遮阳应先讨论浅色窗帘，此为旧版讨论方向。'); const x = await fixture();
  const model: NonNullable<Parameters<typeof processAgentAnswer>[1]>['model'] = async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '书房遮阳 窗帘 讨论方向' });
    const source = results(m).find(s => s.text.includes('书房遮阳应先讨论'))!;
    return synth([{ basis: 'evidence', text: source.text.includes('可调遮阳') ? '当前版本建议先比较可调遮阳，方便讨论不同光线下的使用感受。' : '旧版资料提供浅色窗帘作为讨论方向，具体做法仍需核对。',
      citations: [{ sourceId: source.sourceId, quote: source.text }] }]);
  };
  const a = await x.send('书房遮阳应该先讨论什么？', model); assert.equal(a.run.status, 'succeeded');
  const version = await knowledge.execute('newVersion', { documentId: old.documentId, fromVersionId: old.versionId, expectedVersion: 2 }, randomUUID());
  const next = { documentId: old.documentId, versionId: String(version.id), expectedVersion: 3, expectedEditVersion: 1 };
  await knowledge.execute('edit', { ...next, body: '书房遮阳应先讨论可调遮阳，此为当前有效讨论方向。' }, randomUUID()); next.expectedEditVersion = 2;
  await knowledge.execute('index', next, randomUUID()); const job = await claimKnowledgeJob(); assert.ok(job); await runKnowledgeJob(job);
  await knowledge.execute('publish', next, randomUUID());
  const hidden = (await x.chat.messages(x.cid)).items.find(m => m.id === a.run.outputMessageId)!;
  assert.equal(hidden.available, false); assert.ok(hidden.citations.every(c => !c.available));
  const b = await x.send('那当前版本呢，应该先讨论什么？', model); assert.equal(b.run.status, 'succeeded', JSON.stringify(b.run));
  const entry = (await x.chat.messages(x.cid)).items.find(m => m.id === b.run.outputMessageId)!;
  assert.match(JSON.stringify(entry.content), /可调遮阳/); assert.doesNotMatch(JSON.stringify(entry.content), /浅色窗帘/);
});

test('QA07: same-enterprise other customer and cross-tenant resource IDs never enter synthesized sources', async () => {
  const x = await fixture(), other = await fixture();
  const a = await x.send('核对书房现场资料', async () => call('query_materials', { leadId: other.leadId, room: '书房' }));
  assert.notEqual(a.run.status, 'succeeded'); assert.equal((await x.chat.messages(x.cid)).items.filter(m => m.authorKind === 'assistant').length, 0);
  const foreign = { ...x.actor, enterpriseId: tenants[1] };
  await assert.rejects(new ConversationService(foreign).messages(x.cid), /assistant_resource_not_found/);
});

test('QA03/07: a bound consultation scopes natural business reads to this home even when the customer owns another lead', async () => {
  const x = await fixture();
  const otherLead = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name)
    values(${eid},${x.uid},'另一套合成房屋','13800000000','natural','OTHER_OWNED_HOME') returning id`)))!.id);
  const a = await x.send('那现在呢？', async (m,tools,turn) => {
    assert.ok(tools.some(t => t.name === 'query_business'));
    if (!turn) return call('query_business', { domain: 'construction' });
    const source = m.find(m => m.role === 'tool'); assert.ok(source && source.role === 'tool');
    const result = JSON.parse(source.content); assert.deepEqual(result.leadIds, [x.leadId]); assert.equal(result.query.leadId, x.leadId);
    return call('final_response', { kind: 'business', resultKey: result.resultKey });
  }); assert.equal(a.run.status, 'succeeded');
  const b = await x.send('切换到另一套现场资料', async () => call('query_business', { domain: 'construction', leadId: otherLead }));
  assert.notEqual(b.run.status, 'succeeded');
});

test('AG05 bound-read injects the same home for material and business reads, persists originals and revokes knowledge on reentry', async () => {
  const doc = await publish('合成身份绑定甲', '厨房身份绑定甲：设备布置先核对通道和使用条件，不从需求原话推断现场已完成。');
  const x = await fixture();
  const seed = await x.send('请记录厨房保留冰箱。', async (_messages, _tools, turn) => !turn
    ? call('record_need', { room: '厨房', field: 'devices', value: '冰箱', quote: '厨房保留冰箱' })
    : call('final_response', { kind: 'general', text: '已记录厨房保留冰箱。' }));
  assert.equal(seed.run.status, 'succeeded', JSON.stringify(seed.run));
  let calls = 0;
  const answer = await x.send('查询我家厨房需求和施工资料，结合厨房身份绑定甲解释核对条件。', async (messages, tools, turn) => {
    calls++;
    if (!turn) {
      for (const name of ['query_materials', 'query_business']) {
        const tool = tools.find(t => t.name === name)!; assert.ok(tool);
        assert.equal(Object.hasOwn(tool.parameters.properties as object, 'leadId'), false);
        assert.equal((tool.parameters.required as string[]).includes('leadId'), false);
      }
      const output = call('query_materials', { room: '厨房' });
      output.toolCalls.push(...call('query_business', { domain: 'construction' }).toolCalls,
        ...call('search_knowledge', { query: '厨房身份绑定甲 通道 使用条件' }).toolCalls);
      return output;
    }
    const packets = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
    for (const packet of packets.filter(p => ['materials', 'construction'].includes(p.query?.domain))) {
      assert.deepEqual(packet.leadIds, [x.leadId]); assert.equal(packet.query.leadId, x.leadId);
    }
    const knowledge = results(messages).find(s => s.kind === 'knowledge' && s.text.includes('厨房身份绑定甲'))!;
    const need = results(messages).find(s => s.kind === 'project' && s.text.includes('厨房保留冰箱'))!;
    assert.ok(knowledge && need);
    return synth([
      { basis: 'evidence', text: '资料要求核对通道和使用条件，不能据需求判断现场已完成。', citations: [{ citationId: knowledge.citationOptions[0].citationId }] },
      { basis: 'evidence', text: '你这次咨询的需求原话是厨房保留冰箱。', citations: [{ citationId: need.citationOptions[0].citationId }] },
    ]);
  });
  assert.equal(answer.run.status, 'succeeded', JSON.stringify(answer.run)); assert.equal(calls, 2);
  const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select kind,capability_name,input_summary,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${eid} and run_id=${answer.runId}`));
  for (const step of steps.filter(s => ['agent_model', 'agent_checkpoint'].includes(String(s.kind))))
    assert.deepEqual((step.input_summary as Row).readContext, readToolContext({ kind: 'lead', id: x.leadId }));
  assert.equal(steps.filter(s => ['query_materials', 'query_business'].includes(String(s.capability_name))).length, 2);
  const reply = (await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === answer.run.outputMessageId)!;
  assert.equal(reply.available, true); assert.equal(reply.citations.length, 1, 'public citation IDs contain knowledge; project originals use the existing synthesis source contract');
  const durable = steps.find(s => s.kind === 'agent_synthesis_context')!.private_checkpoint as { segments: Array<{ citations: Array<{ sourceId: string; quote: string }> }> };
  const citations = durable.segments.flatMap(s => s.citations);
  assert.equal(citations.length, 2);
  assert.ok(citations.some(c => c.sourceId.startsWith('K') && c.quote.includes('厨房身份绑定甲')));
  assert.ok(citations.some(c => c.sourceId.startsWith('B') && c.quote.includes('厨房保留冰箱')));
  await knowledge.execute('retire', { documentId: doc.documentId, expectedVersion: 2 }, randomUUID());
  assert.equal((await new ConversationService(x.actor).messages(x.cid)).items.find(m => m.id === reply.id)!.available, false);
  assert.ok((await Promise.all(reply.citations.map(c => x.chat.citation(c.id)))).some(c => !c.available));
});

test('AG05 bound-read recovers cached new and legacy provider outputs without replaying the completed model call', async () => {
  for (const legacy of [false, true]) {
    const x = await fixture();
    const sent = await x.chat.send(x.cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '查询我家厨房资料。' }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    const cached = call('query_materials', legacy ? { leadId: x.leadId, room: '厨房' } : { room: '厨房' });
    const summary = legacy ? { fixture: true } : { fixture: true, readContext: readToolContext({ kind: 'lead', id: x.leadId }) };
    await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary,private_checkpoint)
      values(${eid},${lease.runId},1100,'agent_model','succeeded',${JSON.stringify(summary)}::jsonb,${JSON.stringify(cached)}::jsonb)`));
    let calls = 0;
    await processAgentAnswer(lease, { model: async (messages, tools, turn) => {
      calls++; assert.equal(turn, 1);
      assert.equal(Object.hasOwn(tools.find(t => t.name === 'query_materials')!.parameters.properties as object, 'leadId'), legacy);
      const packet = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).find(p => p.query?.domain === 'materials');
      assert.equal(packet.query.leadId, x.leadId);
      return call('final_response', { kind: 'business', resultKey: packet.resultKey });
    } });
    assert.equal((await x.chat.run(lease.runId)).status, 'succeeded'); assert.equal(calls, 1);
    const checkpoint = await withTenantTransaction(eid, tx => one(tx, sql`select input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${lease.runId} and kind='agent_checkpoint'`));
    assert.equal(Object.hasOwn(checkpoint!.input_summary as object, 'readContext'), !legacy);
  }
});

test('AG05 bound-read detects a changed conversation home before executing a tool or returning an answer', async () => {
  const x = await fixture();
  const a = await x.send('查询我家厨房资料。', async () => {
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_conversations
      set entry_snapshot=jsonb_set(entry_snapshot,'{id}',to_jsonb('999999999999'::text)) where enterprise_id=${eid} and id=${x.cid}`));
    return call('query_materials', { room: '厨房' });
  });
  assert.notEqual(a.run.status, 'succeeded');
  const reads = await withTenantTransaction(eid, tx => rows(tx, sql`select id from app.assistant_run_steps
    where enterprise_id=${eid} and run_id=${a.runId} and capability_name='query_materials'`));
  assert.equal(reads.length, 0);
  assert.equal((await x.chat.messages(x.cid)).items.filter(m => m.authorKind === 'assistant' && m.available).length, 0);
});

test('QA08 PPT10/11: takeover during synthesis stops the late answer but retains originals and observed usage', async () => {
  const x = await fixture();
  const a = await x.send('书房办公布置需要考虑哪些条件？', async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '书房办公布置 采光 通道' });
    const k = results(m).find(s => s.kind === 'knowledge' && s.text.includes('屏幕眩光'))!;
    await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'request' });
    return synth([{ basis: 'evidence', text: '书房办公需兼顾采光和通道。', citations: [{ sourceId: k.sourceId, quote: '书房靠窗办公需同时考虑自然采光、屏幕眩光和通道。' }] }]);
  }); assert.notEqual(a.run.status, 'succeeded'); assert.equal((await x.chat.detail(x.cid)).mode, 'handoff_requested');
  assert.equal((await x.chat.messages(x.cid)).items.filter(m => m.authorKind === 'assistant').length, 0);
  assert.ok((await withTenantTransaction(eid, tx => rows(tx, sql`select id from app.assistant_usage_records where enterprise_id=${eid} and run_id=${a.runId}`))).length >= 2);
});

test('QA07: loss of the customer participant hides synthesis instead of treating reception staff as a preview owner', async () => {
  const x = await fixture();
  const a = await x.send('书房办公要考虑什么？', async (m,_t,turn) => {
    if (!turn) return call('search_knowledge', { query: '书房办公 采光 眩光' });
    const k = results(m).find(s => s.kind === 'knowledge' && s.text.includes('屏幕眩光'))!;
    return synth([{basis:'evidence',text:'办公布置需要兼顾自然采光、眩光和通道。',citations:[{sourceId:k.sourceId,quote:'书房靠窗办公需同时考虑自然采光、屏幕眩光和通道。'}]}]);
  }); assert.equal(a.run.status,'succeeded');
  await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'request', recipientId: ownerId });
  await new HandoffService({ enterpriseId: eid, principal: { kind: 'admin', adminId: ownerId }, contextVersion: 0,
    capabilities: ['assistant.handoff.staff'] }).staffWrite(x.cid, randomUUID(), { action: 'claim' });
  await withTenantTransaction(eid,async tx=>{
    assert.equal(await agentMessageAvailable(tx,eid,x.cid,String(a.run.outputMessageId)),true);
    await tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now(),version=version+1 where enterprise_id=${eid} and conversation_id=${x.cid} and user_id=${x.uid}`);
    assert.equal(await agentMessageAvailable(tx,eid,x.cid,String(a.run.outputMessageId)),false);
  });
});

test('KB3 projected legacy selection writes exact original citations and revokes them on reentry',async()=>{
  const body=office+'\n😀合成选择定位：仅核对原文，不表示项目安排。';
  const document=await publish('合成投影摘录',body),x=await fixture();let selectedQuote='';
  const a=await x.send('请只摘录书房靠窗办公的原文，不做综合解释。',async(messages,_tools,turn)=>{
    if(!turn)return call('search_knowledge',{query:'书房靠窗办公 屏幕眩光 自然采光 通道'});
    const packets=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
    const source=packets.flatMap(p=>p.synthesisSources||[]).find(s=>s.text===body);
    assert.ok(source?.selectionLines,'The actual model request must use the compact selection map');
    assert.equal(source.text,body);assert.doesNotMatch(JSON.stringify(messages),/PRIVATE_ONLY_NEVER_SEND/);
    const choice=Object.entries(source.selectionLines as Record<string,number|number[]>).find(([,span])=>{
      const line=source.text.split('\n')[(Array.isArray(span)?span[0]:span)-1];
      const quote=Array.isArray(span)?line.slice(span[1],span[2]):line;
      if(!quote.includes('显示器避免直对'))return false;selectedQuote=quote;return true;
    });assert.ok(choice);return call('final_response',{kind:'knowledge',selections:[choice[0]]});
  });
  assert.equal(a.run.status,'succeeded',JSON.stringify(a.run));
  const message=(await x.chat.messages(x.cid)).items.find(m=>m.id===a.run.outputMessageId)!;
  assert.equal(message.available,true);assert.match(JSON.stringify(message.content),/显示器避免直对/);
  assert.equal(message.citations.length,1);const citationId=message.citations[0].id;
  const citation=await x.chat.citation(citationId);assert.equal(citation.available,true);assert.ok('quote' in citation);assert.equal(citation.quote,selectedQuote);
  await knowledge.execute('retire',{documentId:document.documentId,expectedVersion:2},randomUUID());
  assert.equal((await x.chat.citation(citationId)).available,false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m=>m.id===message.id)?.available,false);
});

test('KB3 legacy full-source citation selection persists canonical quotes without advertising the legacy wire format',async()=>{
  const body='合成完整引用：主卫参考高度1800mm，须先核对基层；观察不等于验收。😀';
  const document=await publish('合成整段引用选择',body),x=await fixture();
  const a=await x.send('请结合原资料解释主卫高度和核对前提，不要只返回摘录。',async(messages,_tools,turn)=>{
    if(!turn)return call('search_knowledge',{query:'主卫 参考高度1800mm 核对基层'});
    const source=results(messages).find(s=>s.text===body) as {sourceId:string;text:string;citationOptions?:unknown[]}|undefined;
    assert.ok(source?.citationOptions?.length);assert.doesNotMatch(JSON.stringify(messages),/PRIVATE_ONLY_NEVER_SEND/);
    return synth([{basis:'evidence',text:'参考高度1800mm应和基层前提一起核对，观察本身不能替代检查结论。',citations:[{sourceId:source!.sourceId,quoteFromSource:true}]}]);
  });assert.equal(a.run.status,'succeeded',JSON.stringify(a.run));
  const message=(await x.chat.messages(x.cid)).items.find(m=>m.id===a.run.outputMessageId)!;assert.equal(message.available,true);assert.equal(message.citations.length,1);
  const citation=await x.chat.citation(message.citations[0].id);assert.equal(citation.available,true);assert.ok('quote' in citation);assert.equal(citation.quote,body);
  const durable=await withTenantTransaction(eid,tx=>one(tx,sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId} and kind='agent_synthesis_context'`));
  assert.match(JSON.stringify(durable?.private_checkpoint),/合成完整引用/);assert.doesNotMatch(JSON.stringify(durable?.private_checkpoint),/quoteFromSource/);
  await knowledge.execute('retire',{documentId:document.documentId,expectedVersion:2},randomUUID());
  assert.equal((await x.chat.citation(message.citations[0].id)).available,false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m=>m.id===message.id)?.available,false);
});

test('KB3 catalog citation first draft persists exact originals with typed document metadata and revokes on reentry',async()=>{
  const body='合成引用目录：参考间距310mm，须先核对适用前提；不代表现场结论。😀';
  const filename='03 合成引用目录v3.2.pdf';
  const document=await publish(filename,body),x=await fixture();
  const a=await x.send('请解释资料中的间距要求与前提，不要只摘录。',async(messages,_tools,turn)=>{
    if(!turn)return call('search_knowledge',{query:'合成引用目录 参考间距310mm 适用前提'});
    assert.equal(turn,1,'The catalog protocol must not require a format repair');
    const kinds = (finalToolForMessages(messages).parameters.properties as Record<string, { enum: string[] }>).kind.enum;
    assert.deepEqual(kinds, ['synthesis']);
    const source=results(messages).find(s=>s.text===body) as {citationOptions?:Array<{citationId:string}>}|undefined;
    assert.ok(source?.citationOptions?.length);assert.doesNotMatch(JSON.stringify(messages),/PRIVATE_ONLY_NEVER_SEND/);
    return synth([{basis:'evidence',text:'《'+filename+'》要求把310mm与适用前提一起核对，不能只凭间距作现场结论。',citations:[{citationId:source!.citationOptions![0].citationId}]}]);
  });assert.equal(a.run.status,'succeeded',JSON.stringify(a.run));
  const message=(await x.chat.messages(x.cid)).items.find(m=>m.id===a.run.outputMessageId)!;assert.equal(message.available,true);
  assert.match(JSON.stringify(message.content),/03 合成引用目录v3\.2\.pdf/);
  assert.doesNotMatch(JSON.stringify(message.content),/文档名称/);
  const citation=await x.chat.citation(message.citations[0].id);assert.equal(citation.available,true);assert.ok('quote' in citation);assert.equal(citation.quote,body);
  const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select kind,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
  for (const step of steps.filter(s => s.kind === 'agent_model')) assert.equal((step.input_summary as Row).finalProtocol, agentSourceFinalProtocol);
  assert.equal(steps.filter(s=>s.kind==='agent_validation').length,0);
  assert.doesNotMatch(JSON.stringify(steps.find(s=>s.kind==='agent_synthesis_context')?.private_checkpoint),/citationId/);
  await knowledge.execute('retire',{documentId:document.documentId,expectedVersion:2},randomUUID());
  assert.equal((await x.chat.citation(message.citations[0].id)).available,false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m=>m.id===message.id)?.available,false);
});

test('AG08 knowledge-only mixed final envelopes remain rejected despite real current citations',async()=>{
 const body='合成最终协议：检查安排由项目团队核对，阶段标签不证明检查通过。';
 await publish('合成最终协议',body);const x=await fixture();let calls=0;
 const sent=await x.send('请解释企业资料中的检查安排和阶段标签含义。',async(messages,_tools,turn,requestTools)=>{
  calls++;if(!turn)return call('search_knowledge',{query:'合成最终协议 检查安排 阶段标签'});
  const final=requestTools?.find(t=>t.name==='final_response');assert.ok(final);
  assert.deepEqual((final.parameters.properties as Row).kind,{type:'string',enum:['synthesis']});
  const source=results(messages).find(s=>s.text===body);assert.ok(source);
  return call('final_response',{kind:'knowledge',text:body,segments:[{basis:'evidence',text:body,citations:[{citationId:source.citationOptions[0].citationId}]}]});
 });assert.equal(calls,2);assert.equal(sent.run.status,'failed');assert.equal(sent.run.errorCode,'invalid_model_answer');assert.equal(sent.run.outputMessageId,null);
 const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select kind,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${sent.runId}`));
 assert.equal(steps.filter(s=>s.kind==='agent_need_write').length,0);
 const checkpoint=steps.filter(s=>s.kind==='agent_model').at(-1)!.private_checkpoint as Row;
 const raw=JSON.parse(String(((checkpoint.providerOutput as Row).toolCalls as Row[])[0].arguments));
 assert.equal(raw.kind,'knowledge');assert.equal(raw.text,body);assert.equal(raw.segments[0].text,body);
});

test('AG08 zero-evidence final schema persists advice before and after retirement while fabricated citations still fail',async()=>{
 const x=await fixture(tenants[1],false);
 const send=async(fabricated:boolean,knowledgeStatus:string)=>x.send('请查询企业资料，说明书房靠窗办公的一般布置思路；没有依据时说明缺口，不要记录需求。',async(messages,_tools,turn,requestTools)=>{
  if(!turn)return call('search_knowledge',{query:'合成空目录边界 书房靠窗办公'});
  assert.equal(turn,1,'Empty evidence needs no extra read or repair');
  const packet=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(p=>Array.isArray(p.synthesisSources));
  assert.equal(packet.knowledgeStatus,knowledgeStatus);assert.equal(packet.synthesisSources.length,0);
  const final=requestTools?.find(t=>t.name==='final_response');assert.ok(final);
  const properties=(final.parameters.properties as Row).segments as Row,segment=(properties.items as Row).properties as Row;
  assert.deepEqual((segment.basis as Row).enum,['advice','uncertainty']);assert.equal((segment.citations as Row).maxItems,0);
  return synth([{basis:'advice',text:'可先比较书桌侧向与正对窗的反光，兼顾采光和通道，具体布置需结合实际条件。',citations:fabricated?[{citationId:'current_citation_1'}]:[]},
    {basis:'uncertainty',text:'本次企业资料没有可用依据，企业做法仍需核实。',citations:[]}]);
 });
 const check=async(status:string)=>{const answer=await send(false,status);assert.equal(answer.run.status,'succeeded',JSON.stringify(answer.run));const message=(await new ConversationService(x.actor).messages(x.cid)).items.find(m=>m.id===answer.run.outputMessageId)!;assert.ok(message.available);assert.equal(message.citations.length,0);assert.match(JSON.stringify(message.content),/一般建议/);return answer;};
 const unready=await check('not_ready');
 const adminId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${tenants[1]},${prefix+'empty'},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`)))!.id);
 const ops=new KnowledgeService({enterpriseId:tenants[1],adminId}),created=await ops.execute('create',{title:'合成空目录边界',body:'合成办公资料仅用于撤回边界验证，布局仍由获权团队核对。',audience:'customer_public',sourceType:'manual_text'},randomUUID());
 const doc={documentId:String((created.document as Row).id),versionId:String((created.draft as Row).id),expectedVersion:1,expectedEditVersion:1};
 const indexed=await ops.execute('index',doc,randomUUID()),job=await claimKnowledgeJob();assert.ok(job);assert.equal(job.jobId,indexed.jobId);await runKnowledgeJob(job);assert.equal((await ops.execute('job',{jobId:job.jobId},randomUUID())).status,'succeeded');
 await ops.execute('publish',doc,randomUUID());await ops.execute('retire',{documentId:doc.documentId,expectedVersion:2},randomUUID());assert.equal(((await ops.execute('detail',{documentId:doc.documentId},randomUUID())).document as Row).status,'retired');
 const retired=await check('ready'),bad=await send(true,'ready');assert.equal(bad.run.status,'failed');assert.equal(bad.run.errorCode,'invalid_model_citation');assert.equal(bad.run.outputMessageId,null);
 const steps=await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select kind from app.assistant_run_steps where enterprise_id=${tenants[1]} and run_id in (${unready.runId},${retired.runId},${bad.runId})`));assert.equal(steps.filter(s=>s.kind==='agent_need_write').length,0);
 await assert.rejects(new ConversationService((await fixture()).actor).messages(x.cid),/assistant_resource_not_found/);
});
