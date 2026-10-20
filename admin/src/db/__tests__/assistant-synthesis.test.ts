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
import { processAgentAnswer, finalToolForMessages } from '@/lib/assistant/agent/worker';
import { ConstructionService } from '@/lib/construction/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput, ModelMessage } from '@/lib/assistant/contracts/model';
import { agentMessageAvailable } from '@/lib/assistant/agent/media-context';
import { synthesisRepairBase } from '@/lib/assistant/agent/synthesis-repair';

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
async function fixture(targetEid = eid) {
  const uid = await withPlatformTransaction(async tx => { const u = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id); users.push(u);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${u},${prefix+u})`); return u; });
  const leadId = String((await withTenantTransaction(targetEid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name)
    values(${targetEid},${uid},'合成综合问答客户','13800000000','natural','合成书房之家') returning id`)))!.id);
  const actor: ActorContext = { enterpriseId: targetEid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const send = async (text: string, model: NonNullable<Parameters<typeof processAgentAnswer>[1]>['model']) => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] }); const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, { model }); return { run: await chat.run(lease.runId), runId: lease.runId };
  };
  return { actor, chat, cid, send, leadId, uid };
}

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

test('QA02/05 PPT6/15: real retrieval plus authorized originals produces persisted explanatory prose without a handling side effect', async () => {
  const x = await fixture();
  const save = await x.send('请记录书房靠窗，偶尔两人办公', async (_m,_t,turn) => turn === 0
    ? call('record_need', { room: '书房', field: 'desk', value: '靠窗，偶尔两人办公', quote: '请记录书房靠窗，偶尔两人办公' })
    : call('final_response', { kind: 'general', text: '已记录，可以继续聊。' })); assert.equal(save.run.status, 'succeeded');
  let answerCalls = 0;
  const a = await x.send('书房靠窗办公为什么还要考虑桌子的朝向？', async (m,tools,turn) => {
    answerCalls++;
    assert.doesNotMatch(JSON.stringify(m), /PRIVATE_ONLY_NEVER_SEND/);
    if (turn === 0) { const a = call('search_knowledge', { query: '书房靠窗办公 屏幕眩光 双人桌' }); a.toolCalls.push(...call('query_materials', { leadId: '', room: '书房' }).toolCalls); return a; }
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
    if (!turn) return call('query_business', { domain: 'construction', leadId: '' });
    const source = m.find(m => m.role === 'tool'); assert.ok(source && source.role === 'tool');
    const result = JSON.parse(source.content); assert.deepEqual(result.leadIds, [x.leadId]); assert.equal(result.query.leadId, x.leadId);
    return call('final_response', { kind: 'business', resultKey: result.resultKey });
  }); assert.equal(a.run.status, 'succeeded');
  const b = await x.send('切换到另一套现场资料', async () => call('query_business', { domain: 'construction', leadId: otherLead }));
  assert.notEqual(b.run.status, 'succeeded');
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
  const document=await publish('合成引用目录v3.2',body),x=await fixture();
  const a=await x.send('请解释资料中的间距要求与前提，不要只摘录。',async(messages,_tools,turn)=>{
    if(!turn)return call('search_knowledge',{query:'合成引用目录 参考间距310mm 适用前提'});
    assert.equal(turn,1,'The catalog protocol must not require a format repair');
    const source=results(messages).find(s=>s.text===body) as {citationOptions?:Array<{citationId:string}>}|undefined;
    assert.ok(source?.citationOptions?.length);assert.doesNotMatch(JSON.stringify(messages),/PRIVATE_ONLY_NEVER_SEND/);
    return synth([{basis:'evidence',text:'引用目录 v3.2要求把310mm与适用前提一起核对，不能只凭间距作现场结论。',citations:[{citationId:source!.citationOptions![0].citationId}]}]);
  });assert.equal(a.run.status,'succeeded',JSON.stringify(a.run));
  const message=(await x.chat.messages(x.cid)).items.find(m=>m.id===a.run.outputMessageId)!;assert.equal(message.available,true);
  const citation=await x.chat.citation(message.citations[0].id);assert.equal(citation.available,true);assert.ok('quote' in citation);assert.equal(citation.quote,body);
  const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select kind,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${a.runId}`));
  assert.equal(steps.filter(s=>s.kind==='agent_validation').length,0);
  assert.doesNotMatch(JSON.stringify(steps.find(s=>s.kind==='agent_synthesis_context')?.private_checkpoint),/citationId/);
  await knowledge.execute('retire',{documentId:document.documentId,expectedVersion:2},randomUUID());
  assert.equal((await x.chat.citation(message.citations[0].id)).available,false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m=>m.id===message.id)?.available,false);
});
