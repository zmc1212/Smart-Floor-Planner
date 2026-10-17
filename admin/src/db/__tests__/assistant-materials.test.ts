import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer, agentToolsForMessage } from '@/lib/assistant/agent/worker';
import { queryMaterials, materialSnapshotAvailable, parseMaterialQuery, type MaterialSnapshot } from '@/lib/assistant/agent/materials';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'synthetic-xk-materials-' + randomUUID(), tenants: string[] = [], users: string[] = [];
const live = process.env.XIAOK_MATERIALS_LIVE === '1';
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const layout = { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{
  id: 'f', name: '一层', ceilingHeightMm: 2800,
  nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
  walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b' }, { id: 'bc', startNodeId: 'b', endNodeId: 'c' }, { id: 'cd', startNodeId: 'c', endNodeId: 'd' }, { id: 'da', startNodeId: 'd', endNodeId: 'a' }],
  openings: [], spaces: [{ id: 'study', name: '书房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }],
}] } };
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
    priorProvider = await getPlatformLlmRuntimeConfig();
    await savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: provider.baseUrl, model: 'deepseek-flash', apiKey: provider.apiKey });
  }
  await withPlatformTransaction(async tx => { for (let i = 0; i < 2; i++) tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!.id)); });
  for (const eid of tenants) await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.assistant_enterprise_settings
    (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
    values(${eid},true,1000,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`));
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of tenants) {
      await deleteAssistantData(tx, BigInt(eid));
      await tx.execute(sql`update app.leads set primary_floor_plan_id=null where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.floor_plans where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.enterprises where id=${eid}`);
    }
    for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});
async function fixture() {
  const eid = tenants[0];
  const uid = await withPlatformTransaction(async tx => {
    const id = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id); users.push(id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${prefix + id})`); return id;
  });
  const lead = () => withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name)
    values(${eid},${uid},${prefix},'13800000000','natural','合成书房之家') returning id`))!.id));
  const leadId = await lead();
  const planId = await withTenantTransaction(eid, async tx => {
    const p = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
      values(${eid},${uid},'合成正式户型','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!.id);
    await tx.execute(sql`update app.leads set primary_floor_plan_id=${p} where enterprise_id=${eid} and id=${leadId}`); return p;
  });
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const query = (room = '书房', target = '') => withTenantTransaction(eid, tx => queryMaterials(tx, actor, cid, { leadId: target, room }));
  const send = async (text: string, model?: NonNullable<Parameters<typeof processAgentAnswer>[1]>['model']) => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, model ? { model } : {}); return { sent, lease, run: await chat.run(lease.runId) };
  };
  const save = (room: string, field: string, value: string) => {
    const quote = `${room}${value}`;
    return send(quote, async (_m, _t, turn) => turn === 0 ? output('record_need', { room, field, value, quote }) : output('final_response', { kind: 'general', text: '已记录，可以继续聊。' }));
  };
  return { eid, uid, actor, chat, cid, leadId, planId, lead, query, send, save };
}

test('PPT15/23 tools allow paraphrased read requests and reject guessed or injected identity arguments', () => {
  assert.ok(agentToolsForMessage('把这些依据对在一起', true).some(t => t.name === 'query_materials'));
  assert.equal(agentToolsForMessage('找资料', false).length, 0);
  assert.throws(() => parseMaterialQuery({ leadId: '', room: '那间房' }), /invalid_message/);
  assert.throws(() => parseMaterialQuery({ leadId: '', room: '书房', enterpriseId: '1' }), /invalid_message/);
});
test('XK01/03 customer originals and formal v4 sources compose without inventing a point drawing or modifying the graph', async () => {
  const x = await fixture();
  for (const [room, field, value] of [['书房', 'daylight', '靠窗'], ['书房', 'desk', '偶尔两人办公'], ['次卧', 'use', '做客房']]) assert.equal((await x.save(room, field, value)).run.status, 'succeeded');
  const snapshot = await x.query();
  assert.equal(snapshot.data.resolution, 'resolved');
  assert.equal(snapshot.data.sources.filter(s => s.ref.type === 'customer_need').length, 2);
  assert.ok(snapshot.data.sources.some(s => s.ref.id === x.planId && s.roomId === 'study'));
  assert.ok(snapshot.data.sources.every(s => s.audience === 'customer_self' && s.hash && s.ref.version));
  assert.match(snapshot.displayText, /靠窗|偶尔两人办公/); assert.doesNotMatch(snapshot.displayText, /做客房/); assert.match(snapshot.displayText, /待核对.*点位图/);
  assert.equal(fingerprint((await withTenantTransaction(x.eid, tx => one(tx, sql`select layout_data from app.floor_plans where id=${x.planId}`)))!.layout_data), fingerprint(layout));
  const result = await x.send('找书房对应图纸和需求', async (messages, tools, turn) => {
    assert.ok(tools.some(t => t.name === 'query_materials'));
    const resultKey = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).resultKey).at(-1);
    return turn === 0 ? output('query_materials', { leadId: '', room: '书房' }) : output('final_response', { kind: 'business', resultKey, text: '伪造的已批准点位图' });
  });
  assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
  const history = await new ConversationService(x.actor).messages(x.cid);
  const answer = history.items.find(m => m.id === result.run.outputMessageId)!;
  assert.equal(answer.available, true); assert.match(JSON.stringify(answer), /靠窗|偶尔两人办公/); assert.doesNotMatch(JSON.stringify(answer), /伪造的已批准/);
  assert.equal(Number((await withTenantTransaction(x.eid, tx => one(tx, sql`select count(*) n from app.construction_site_records where enterprise_id=${x.eid}`)))!.n), 0);
  const steps = await withTenantTransaction(x.eid, tx => rows(tx, sql`select kind from app.assistant_run_steps where enterprise_id=${x.eid} and run_id=${result.lease.runId}`));
  assert.ok(steps.some(s => s.kind === 'agent_material_context'));
});
test('XK01/07 a scoped home cannot be replaced by a model argument; a generic multi-home chat asks instead of merging', async () => {
  const x = await fixture(), otherLead = await x.lead();
  await assert.rejects(x.query('书房', otherLead), /assistant_resource_not_found/);
  const genericActor = { ...x.actor, entry: undefined }, generic = new ConversationService(genericActor), cid = String((await generic.create(randomUUID())).id);
  const snapshot = await withTenantTransaction(x.eid, tx => queryMaterials(tx, genericActor, cid, { leadId: '', room: '书房' }));
  assert.equal(snapshot.data.resolution, 'clarification'); assert.equal(snapshot.data.sources.length, 0); assert.match(snapshot.displayText, /多个房屋/);
  const y = await fixture();
  await assert.rejects(withTenantTransaction(x.eid, tx => queryMaterials(tx, x.actor, y.cid, { leadId: '', room: '' })), /assistant_resource_not_found/);
  await assert.rejects(withTenantTransaction(tenants[1], tx => queryMaterials(tx, { ...x.actor, enterpriseId: tenants[1] }, x.cid, { leadId: '', room: '' })), /assistant_resource_not_found/);
});
test('XK03 repeated room names across floors require clarification and an absent room never inherits the whole plan', async () => {
  const x = await fixture();
  const missing = await x.query('儿童房'); assert.equal(missing.data.sources.length, 0); assert.match(missing.displayText, /含该房间/);
  const duplicate = { ...layout, surveyGraph: { ...layout.surveyGraph, floors: [...layout.surveyGraph.floors, { ...layout.surveyGraph.floors[0], id: 'f2', name: '二层' }] } };
  await withTenantTransaction(x.eid, tx => tx.execute(sql`update app.floor_plans set layout_data=${JSON.stringify(duplicate)}::jsonb where enterprise_id=${x.eid} and id=${x.planId}`));
  const result = await x.query(); assert.equal(result.data.resolution, 'clarification'); assert.equal(result.data.sources.length, 0); assert.match(result.displayText, /重名/);
});
test('XK07/08 a changed plan invalidates saved references, derived history and a late model reply', async () => {
  const x = await fixture(); await x.save('书房', 'desk', '偶尔两人办公');
  const first = await x.send('找书房资料', async (messages, _tools, turn) => turn === 0 ? output('query_materials', { leadId: '', room: '书房' })
    : output('final_response', { kind: 'business', resultKey: messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).resultKey).at(-1) }));
  assert.equal(first.run.status, 'succeeded');
  const old = await x.query();
  await withTenantTransaction(x.eid, tx => tx.execute(sql`update app.leads set primary_floor_plan_id=null where enterprise_id=${x.eid} and id=${x.leadId}`));
  assert.equal(await withTenantTransaction(x.eid, tx => materialSnapshotAvailable(tx, x.eid, old)), false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === first.run.outputMessageId)!.available, false);
  const second = await x.send('再核对书房资料', async (messages, _tools, turn) => {
    if (turn === 0) return output('query_materials', { leadId: '', room: '书房' });
    await withTenantTransaction(x.eid, tx => tx.execute(sql`update app.leads set primary_floor_plan_id=${x.planId} where enterprise_id=${x.eid} and id=${x.leadId}`));
    return output('final_response', { kind: 'business', resultKey: messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).resultKey).at(-1) });
  });
  assert.equal(second.run.status, 'failed'); assert.equal(second.run.outputMessageId, null);
});
test('XK08 human takeover after a materials query fences the answer while keeping the original request', async () => {
  const x = await fixture();
  const result = await x.send('找书房资料', async (messages, _tools, turn) => {
    if (turn === 0) return output('query_materials', { leadId: '', room: '书房' });
    await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'request' });
    return output('final_response', { kind: 'business', resultKey: messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).resultKey).at(-1) });
  });
  assert.equal((await x.chat.detail(x.cid)).mode, 'handoff_requested');
  assert.equal(result.run.outputMessageId, null); assert.match(JSON.stringify(await x.chat.messages(x.cid)), /找书房资料/);
});
test('PPT15/23 configured model repeats the sourced need-to-materials path twice', { skip: !live }, async () => {
  for (let iteration = 0; iteration < 2; iteration++) {
    const x = await fixture();
    const startedAt = Date.now();
    const write = await x.send('请记录书房靠窗，偶尔两人办公。'); assert.equal(write.run.status, 'succeeded', JSON.stringify(write.run));
    const result = await x.send('帮我找下书房对应的图纸和客户需求，缺什么请说清楚。');
    assert.equal(result.run.status, 'succeeded', JSON.stringify(result.run));
    const steps = await withTenantTransaction(x.eid, tx => rows(tx, sql`select capability_name,private_checkpoint from app.assistant_run_steps where enterprise_id=${x.eid} and run_id=${result.lease.runId} order by step_seq`));
    assert.ok(steps.some(s => s.capability_name === 'query_materials'), JSON.stringify(steps));
    const snapshot = steps.find(s => s.capability_name === 'query_materials')!.private_checkpoint as MaterialSnapshot;
    assert.ok(snapshot.data.sources.some(s => s.ref.type === 'customer_need' && /靠窗|两人办公/.test(s.text)));
    const message = (await x.chat.messages(x.cid)).items.find(m => m.id === result.run.outputMessageId)!;
    assert.equal(message.available, true); assert.match(JSON.stringify(message), /待核对.*点位图/);
    const trace = await withTenantTransaction(x.eid, async tx => ({
      steps: await rows(tx, sql`select run_id::text,step_seq,kind,status,capability_name,private_checkpoint,source_refs from app.assistant_run_steps
        where enterprise_id=${x.eid} and run_id in (${write.lease.runId},${result.lease.runId}) and kind not in ('agent_checkpoint') order by run_id,step_seq`),
      usage: await rows(tx, sql`select run_id::text,category,quantity,measurement_kind,input_tokens,output_tokens from app.assistant_usage_records
        where enterprise_id=${x.eid} and run_id in (${write.lease.runId},${result.lease.runId}) order by id`),
    }));
    fs.writeFileSync(`../tmp/xiaok-vector/materials-followups-batch/materials-model-trace-${iteration}.json`, JSON.stringify({
      case: 'XK01-XK03', iteration, promptVersion: agentPromptVersion, model: 'deepseek-flash', elapsedMs: Date.now() - startedAt,
      sourceTypes: snapshot.data.sources.map(s => s.ref.type), snapshot, output: message, unsupportedClaims: 'not separately scored', repeatedQuestions: 'not separately scored',
      cost: 'unknown; observed token usage retained, no inferred fee', ...trace,
    }, null, 2));
    console.log(JSON.stringify({ case: 'XK01-XK03', iteration, runId: result.lease.runId, sourceTypes: snapshot.data.sources.map(s => s.ref.type), model: 'deepseek-flash', promptVersion: agentPromptVersion }));
  }
});
