import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantError } from '../contracts';
import { applyNeedDelta, assertRecordedReply, currentBudgetRecallRequested, currentBudgetRecallFeedback, hasExplicitNeedCorrection, needOriginalQuotes, needReplyFeedback, needWriteFeedback, readMemory, uncoveredNeedStatements, type NeedWrite } from '../agent/memory';
import { agentToolsForMessage, needTool, needToolsForRetry } from '../agent/worker';
import { agentChatBody } from '../../ai/providers/agent-chat';
import type { ModelMessage } from '../contracts/model';
import { buildAgentContext } from '../agent/context';

const desk: NeedWrite = { room: '书房', field: 'desk', value: '书桌改为靠内墙', quote: '书房书桌改为靠内墙' };
const budget: NeedWrite = { room: '', field: 'budget', value: '18万元', quote: '预算改为18万元' };
const mixed = '更正：书房书桌改为靠内墙；预算改为18万元。另外，如果仍靠窗会有哪些取舍？后面是假设，不要保存。';
const falseBudgetAbsence = [
  '根据现有记录，我们目前没有保存您的具体预算金额。预算属于需要单独记录的重要信息，可能是在之前的沟通中口头提及但未正式录入系统，或者尚未确定。\n\n为了给您提供准确的预算参考或进行下一步方案规划，能否请您告知一下您心中预期的预算范围？这样我可以帮您评估不同装修方案的可能性。',
  '根据我们目前的咨询记录，系统里并没有保存您关于“当前预算”的具体金额或数字。\n\n虽然您之前询问过这个问题，但相关的预算数值并未在正式的工作记录中录入。如果您有具体的预算数字想要记录，或者想确认之前的某个报价，请告诉我，我可以帮您核实或补充。',
  '根据现有记录，目前系统中尚未保存您的预算金额信息。如果您之前提到过预算，可能未录入系统或已被更正。如需确认具体数值，建议直接提供当前意向金额，以便我们为您匹配更合适的方案。',
  '根据现有记录，目前系统中尚未保存您的预算信息。预算属于项目关键数据，通常在量房或方案阶段由您提供，或由我们根据项目情况协助您规划。\n\n如果您之前口头提及过预算，但系统未录入，建议我们尽快确认，以便为您匹配合适的方案。您方便透露一个大概的预算范围吗？',
];

test('current budget recall distinguishes current unavailability from unsupported never-saved explanations', () => {
  const memory = readMemory({}), question = '我当前预算记的是多少？';
  for (const text of [...falseBudgetAbsence, '当前预算无法确认，因为您从未记录预算。',
    '本次无法确认预算，可能您只在口头提及，没有正式录入。', '当前预算无法确认，因为预算数值并未在正式记录中录入。',
    '目前没有预算记录。', '当前预算无法确认，此前是18万元。']) {
    for (const reply of [{kind:'general',text}, {kind:'synthesis',segments:[{basis:'uncertainty',text,citations:[]}]}]) {
      const issue = currentBudgetRecallFeedback(JSON.stringify(reply), memory, question);
      assert.equal(issue?.code, 'ungrounded_response_scope', text);
      assert.match(issue!.feedback, /不能.*从未/);
    }
  }
  for (const text of ['当前预算无法确认。', '本次没有可用的当前预算记录，无法确认金额。',
    '目前无法读取预算来源，不能确定当前金额。', '当前预算没有有效记录可供核实。', '预算金额暂时无法确定。',
    '本次无法确认当前预算；这不代表您从未记录过预算。']) {
    assert.equal(currentBudgetRecallFeedback(JSON.stringify({kind:'general',text}), memory, question), null, text);
  }
});

test('current budget recall keeps saved-need reads narrow despite business followup history', () => {
  for (const question of ['我当前预算记的是多少？','我现在记录的预算是多少？','保存的预算现在是多少？']) {
    assert.equal(currentBudgetRecallRequested(question), true);
    assert.deepEqual(agentToolsForMessage(question, true, true).map(t => t.name), ['recall_history']);
  }
  for (const question of ['请记录预算18万元。','我当前预算够不够？','我当前预算记的是多少？另外查一下已发布方案。','当前预算与企业报价有什么区别？','“我当前预算记的是多少？”这只是引用。']) {
    assert.equal(currentBudgetRecallRequested(question), false);
  }
  assert.ok(agentToolsForMessage('请查看我的已发布方案。', true, true).some(t => t.name === 'query_business'));
});

test('current budget recall repair rejects empty schemes and unavailable amounts without generating an answer', () => {
  const question = '我当前预算记的是多少？', memory = readMemory({});
  for (const reply of [{kind:'business',resultKey:'old:0:0'}, {kind:'general',text:'目前没有查到你在本企业的已发布方案记录。'},
    {kind:'general',text:'当前预算没有变化，仍是18万元。'}]) {
    const issue = currentBudgetRecallFeedback(JSON.stringify(reply), memory, question);
    assert.equal(issue?.code, 'ungrounded_response_scope');
    assert.match(issue!.feedback, /当前需求没有budget字段/);
    assert.ok(!issue!.feedback.includes('18'));
  }
  for (const reply of [{kind:'general',text:'本次没有可用的当前预算记录，无法确认金额。'},
    {kind:'synthesis',segments:[{basis:'uncertainty',text:'当前预算无法确认。',citations:[]}]}]) {
    assert.equal(currentBudgetRecallFeedback(JSON.stringify(reply), memory, question), null);
  }
  const available = applyNeedDelta(memory, { ...budget, sourceMessageId:'1', expectedVersion:0 }, {id:'1',text:budget.quote}, 'run:0:0', '2026-10-21T11:00:00Z');
  assert.equal(currentBudgetRecallFeedback(JSON.stringify({kind:'general',text:'沿用原记录，当前预算为18万元。'}), available, question), null);
  assert.equal(currentBudgetRecallFeedback(JSON.stringify({kind:'business'}), memory, '请查看已发布方案。'), null);
});

const budgetOnly = '更正：全屋预算改为18万元。';
test('current budget recall rejects run1345 unsupported correction dates while preserving sourced dates', () => {
  const question = '我当前预算记的是多少？';
  const memory = applyNeedDelta(readMemory({}), {...budget,sourceMessageId:'1',expectedVersion:0}, {id:'1',text:budget.quote}, 'run:0:0', '2026-10-21T11:00:00Z');
  for (const text of ['根据您之前的记录，您最初提到全屋预算为20万元，后在10月27日更正为18万元。目前系统保存的有效预算为18万元。',
    '您在2026-10-27更正预算，目前是18万元。','10月21日保存的当前预算是18万元。']) {
    for (const reply of [{kind:'general',text}, {kind:'synthesis',segments:[{basis:'evidence',text,citations:[]}]}]) {
      assert.equal(currentBudgetRecallFeedback(JSON.stringify(reply), memory, question)?.code, 'ungrounded_response_scope');
    }
  }
  const quote = '10月20日全屋预算改为18万元';
  const dated = applyNeedDelta(readMemory({}), {...budget,quote,sourceMessageId:'2',expectedVersion:0}, {id:'2',text:quote}, 'run:1:0', '2026-10-21T11:00:00Z');
  assert.equal(currentBudgetRecallFeedback(JSON.stringify({kind:'general',text:'您提及10月20日预算改为18万元，当前沿用18万元。'}), dated, question), null);
});
const staleDesk = { room: '书房', field: 'desk' as const, value: '靠内墙', quote: '更正：全屋预算改为18万元', additionalNeeds: [] };
function rejectedCurrentSource() {
  const feedback = needWriteFeedback(new AssistantError('need_source_mismatch', 422), budgetOnly, staleDesk)!;
  const messages: ModelMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'stale-desk', name: 'record_need', arguments: JSON.stringify(staleDesk) }] },
    { role: 'tool', callId: 'stale-desk', content: JSON.stringify(feedback) },
  ];
  return { feedback, messages };
}

test('current source retry foregrounds the current original without selecting a field or filling arguments', () => {
  const turns = [{ id: 'old', role: 'user' as const, text: '更正：书房书桌改为靠内墙。' }, { id: 'now', role: 'user' as const, text: budgetOnly }];
  const messages = buildAgentContext(turns, readMemory({}));
  const originals = messages.filter(m => m.role === 'user').map(m => JSON.parse((m.content[0] as { text: string }).text));
  assert.deepEqual(originals.map(m => m.sourceRole), ['history_original', 'current_request']);
  assert.deepEqual(originals.map(m => [m.sourceMessageId, m.text]), turns.map(t => [t.id,t.text]));
  const schema = agentToolsForMessage(budgetOnly,true).find(t => t.name === 'record_need')!.parameters as { properties: Record<string, { enum?: string[] }> };
  assert.equal(Object.keys(schema.properties)[0], 'quote');
  assert.deepEqual(schema.properties.field.enum, needTool.parameters.properties && (needTool.parameters.properties as typeof schema.properties).field.enum);
  assert.equal('enum' in schema.properties.value, false);
});

test('current source retry diagnoses stale room and value while preserving the actual rejected packet', () => {
  const original=JSON.stringify(staleDesk), {feedback}=rejectedCurrentSource();
  assert.deepEqual(feedback.sourceIssues, [{ index: 0, property: 'room', reason: 'not_in_current_original' }, { index: 0, property: 'value', reason: 'not_in_selected_quote' }]);
  assert.equal(feedback.batchCommitted,false);assert.equal(feedback.submittedWrites![0].quoteIsOriginal,true);
  assert.equal(JSON.stringify(staleDesk),original);
  assert.match(feedback.instructions,/field.*quote/);
  assert.throws(()=>applyNeedDelta(readMemory({}),{...staleDesk,sourceMessageId:'now',expectedVersion:0},{id:'now',text:budgetOnly},'run:0:0',''),/need_source_mismatch/);
});

test('current source retry schema excludes only lexically impossible proposals in a matched error pair', () => {
  const {messages}=rejectedCurrentSource(), tools=agentToolsForMessage(budgetOnly,true), before=JSON.stringify({messages,tools});
  const retried=needToolsForRetry(messages,tools), tool=retried.find(t=>t.name==='record_need')!;
  const wire=agentChatBody({model:'Qwen/Qwen3.5-4B',messages,tools:[tool],maxTokens:100});
  const p=wire.tools![0].function.parameters.properties as Record<string,{not?:{enum:string[]};enum?:string[];items?:{properties:unknown}} >;
  assert.deepEqual(p.room.not,{enum:['书房']});assert.deepEqual(p.value.not,{enum:['靠内墙']});
  assert.equal(p.field.not,undefined);assert.deepEqual(p.quote.enum,needOriginalQuotes(budgetOnly));
  assert.deepEqual(p.additionalNeeds.items!.properties,Object.fromEntries(Object.entries(p).filter(([key])=>key!=='additionalNeeds')));
  assert.equal(JSON.stringify({messages,tools}),before);assert.equal(wire.messages[1].content,(messages[1] as {content:string}).content);
  assert.equal(needToolsForRetry(messages,[]).length,0);
});

test('current source retry does not suppress an original from another valid clause or trust mismatched feedback', () => {
  const {messages}=rejectedCurrentSource();
  const mixedTools=agentToolsForMessage(mixed,true);
  assert.equal(needToolsForRetry(messages,mixedTools),mixedTools,'A different current-source catalog cannot be rebound by old feedback');
  const source='更正：全屋预算改为18万元；书房书桌靠内墙。',tools=agentToolsForMessage(source,true);
  const failed={...staleDesk,quote:'更正：全屋预算改为18万元'};
  const feedback=needWriteFeedback(new AssistantError('need_source_mismatch',422),source,failed)!;
  const paired:ModelMessage[]=[{role:'assistant',content:'',toolCalls:[{id:'bad',name:'record_need',arguments:JSON.stringify(failed)}]}, {role:'tool',callId:'bad',content:JSON.stringify(feedback)}];
  assert.equal(needToolsForRetry(paired,tools),tools,'Values supported by a different valid clause still need model-selected matching quote');
  assert.equal(needToolsForRetry([{role:'tool',callId:'stale-desk',content:JSON.stringify(feedback)}],tools),tools);
});

test('atomic need envelope requires an explicit additional array in the actual provider schema', () => {
  for (const text of [mixed, '书房安静', '请记下：全屋预算18万元。']) {
    const tool = agentToolsForMessage(text, true).find(t => t.name === 'record_need')!;
    assert.ok(tool);
    const body = agentChatBody({ model: 'Qwen/Qwen3.5-4B', messages: [], tools: [tool], maxTokens: 100 });
    const schema = body.tools![0].function.parameters as { required: string[]; properties: { additionalNeeds: { minItems: number; maxItems: number } } };
    assert.ok(schema.required.includes('additionalNeeds'));
    assert.equal(schema.properties.additionalNeeds.minItems, 0, 'A single need remains valid with []');
    assert.equal(schema.properties.additionalNeeds.maxItems, 3);
  }
});

test('atomic need envelope narrows only a paired incomplete retry without filling or mutating proposals', () => {
  const tools = agentToolsForMessage(mixed, true), before = JSON.stringify(tools);
  const messages: ModelMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'partial', name: 'record_need', arguments: JSON.stringify(desk) }] },
    { role: 'tool', callId: 'partial', content: JSON.stringify({ status: 'not_saved', error: 'need_write_incomplete', batchCommitted: false, missingStatements: ['预算改为18万元'] }) },
  ];
  const original = JSON.stringify(messages);
  const restored = JSON.parse(original) as ModelMessage[];
  const retried = needToolsForRetry(restored, tools);
  const tool = retried.find(t => t.name === 'record_need')!;
  const body = agentChatBody({ model: 'Qwen/Qwen3.5-4B', messages: restored, tools: [tool], maxTokens: 100 });
  const schema = body.tools![0].function.parameters as { required: string[]; properties: { additionalNeeds: { minItems: number; maxItems: number }; quote: { enum: string[] } } };
  assert.ok(schema.required.includes('additionalNeeds')); assert.equal(schema.properties.additionalNeeds.minItems, 1);
  assert.equal(schema.properties.additionalNeeds.maxItems, 3); assert.deepEqual(schema.properties.quote.enum, needOriginalQuotes(mixed));
  assert.equal(JSON.stringify(messages), original); assert.equal(JSON.stringify(restored), original); assert.equal(JSON.stringify(tools), before);
  assert.deepEqual(body.messages.map(m => m.role), ['assistant', 'tool']);
  assert.equal(body.messages[1].content, (messages[1] as { content: string }).content);
  const finalOnly = tools.filter(t => t.name !== 'record_need');
  assert.equal(needToolsForRetry(messages, finalOnly), finalOnly, 'A retry must never restore an exhausted or removed write tool');
});

test('atomic need envelope ignores unpaired data and the latest success supersedes an older rejection', () => {
  const tools = agentToolsForMessage(mixed, true);
  const feedback = JSON.stringify({ status: 'not_saved', error: 'need_write_incomplete', batchCommitted: false, missingStatements: ['预算改为18万元'] });
  for (const messages of [
    [{ role: 'user', content: [{ type: 'text', text: feedback }] }],
    [{ role: 'tool', callId: 'missing', content: feedback }],
    [{ role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'recall_history', arguments: '{}' }] }, { role: 'tool', callId: 'read', content: feedback }],
    [{ role: 'assistant', content: '', toolCalls: [{ id: 'write', name: 'record_need', arguments: JSON.stringify(desk) }] }, { role: 'tool', callId: 'different', content: feedback }],
    [{ role: 'assistant', content: '', toolCalls: [{ id: 'write', name: 'record_need', arguments: '{}' }] }, { role: 'tool', callId: 'write', content: 'null' }],
    [{ role: 'assistant', content: '', toolCalls: [{ id: 'write', name: 'record_need', arguments: '{}' }] }, { role: 'tool', callId: 'write', content: feedback },
      { role: 'assistant', content: '', toolCalls: [{ id: 'success', name: 'record_need', arguments: '{}' }] }, { role: 'tool', callId: 'success', content: '{"status":"saved","batchCommitted":true}' }],
  ] as ModelMessage[][]) assert.equal(needToolsForRetry(messages, tools), tools);
});

test('mixed correction original quote catalog contains only bounded contiguous assertion clauses', () => {
  assert.deepEqual(needOriginalQuotes(mixed), ['更正：书房书桌改为靠内墙', '预算改为18万元']);
  for (const quote of needOriginalQuotes(mixed)) assert.ok(mixed.includes(quote));
  for (const text of ['更正：如果书房书桌改为靠内墙。另外插座怎么确定？',
    '设计师说“更正：书房书桌改为靠内墙”。另外插座怎么确定？',
    '更正：书房书桌改为靠内墙。另外如果预算允许才按刚才的更正，可以吗？',
    '更正：书房书桌改为靠内墙。另外插座怎么确定？不要记录。',
    '只回顾本次聊天原话，书桌和预算当前是什么？',
    '请记下：' + '书房'.repeat(501),
    '请记下：书房靠窗，客厅阅读，厨房封闭，卧室安静，阳台种花。']) assert.deepEqual(needOriginalQuotes(text), [], text.slice(0,80));
  const punctuated = '  请记下：书房桌子靠内墙,预算18万元\n客厅保留阅读角。  ';
  assert.deepEqual(needOriginalQuotes(punctuated), ['请记下：书房桌子靠内墙', '预算18万元', '客厅保留阅读角']);
});

test('mixed correction original quote catalog scopes both atomic schema positions without mutating the shared tool', () => {
  const before = JSON.stringify(needTool);
  const selected = agentToolsForMessage(mixed, true).find(tool => tool.name === 'record_need')!;
  const schema = selected.parameters as { properties: { quote: { enum: string[] }; additionalNeeds: { items: { properties: { quote: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.quote.enum, needOriginalQuotes(mixed));
  assert.deepEqual(schema.properties.additionalNeeds.items.properties.quote.enum, needOriginalQuotes(mixed));
  assert.equal(JSON.stringify(needTool), before);
  assert.equal(agentToolsForMessage('书房安静', true).find(tool => tool.name === 'record_need'), needTool);
  assert.deepEqual(agentToolsForMessage(mixed, false), []);
});

test('mixed correction original quote choices remain data and never fix or authorize submitted parameters', () => {
  const invalid = { ...desk, quote: '更正：书房书桌改为靠内墙。' };
  const feedback = needWriteFeedback(new AssistantError('need_source_mismatch', 422), mixed, invalid)!;
  assert.deepEqual(feedback.quoteOptions, needOriginalQuotes(mixed));
  assert.equal(feedback.batchCommitted, false);
  assert.throws(() => applyNeedDelta(readMemory({}), { ...invalid, sourceMessageId: '2', expectedVersion: 0 },
    { id: '2', text: mixed }, '9:0:0', 'now'), /need_source_mismatch/);
  assert.throws(() => applyNeedDelta(readMemory({}), { ...budget, room: '书房', sourceMessageId: '2', expectedVersion: 0 },
    { id: '2', text: mixed }, '9:0:0', 'now'), /need_source_mismatch/);
});

test('mixed correction coverage requires the whole explicit block but excludes the separately introduced hypothetical question', () => {
  assert.equal(hasExplicitNeedCorrection(mixed), true);
  assert.deepEqual(uncoveredNeedStatements(mixed, [desk]), ['预算改为18万元']);
  assert.deepEqual(uncoveredNeedStatements(mixed, [desk, budget]), []);
  const broad = { ...desk, quote: mixed };
  assert.deepEqual(uncoveredNeedStatements(mixed, [broad]), ['预算改为18万元'], 'A broad quote is not a receipt for a missing value');
  assert.deepEqual(uncoveredNeedStatements('更正：书房书桌改为靠内墙，书房收纳改为封闭柜，另外插座怎么确定？', [desk]), ['书房收纳改为封闭柜']);
});

test('mixed correction coverage cannot turn conditions, reported speech or a refusal into a saving scope', () => {
  for (const text of ['更正：如果书房书桌改为靠内墙；预算改为18万元。另外插座怎么确定？',
    '设计师说“更正：书房书桌改为靠内墙；预算改为18万元”。另外插座怎么确定？',
    '更正：书房书桌改为靠内墙，另外如果预算允许才按刚才的更正，可以吗？',
    '更正：书房书桌改为靠内墙；预算改为18万元。另外插座怎么确定？不要记录。']) {
    assert.deepEqual(uncoveredNeedStatements(text, [desk]), [], text);
    assert.equal(hasExplicitNeedCorrection(text), false, text);
  }
});

test('mixed correction global budget cannot inherit a room from an unrelated clause', () => {
  for (const text of [mixed, '更正：书房书桌改为靠内墙；全屋预算改为18万元。另外插座怎么确定？']) {
    assert.throws(() => applyNeedDelta(readMemory({}), { ...budget, room: '书房', sourceMessageId: '2', expectedVersion: 0 },
      { id: '2', text }, '9:0:0', 'now'), /need_source_mismatch/);
  }
});

test('mixed correction explicit budget scope and the unchanged global scope retain their own correction keys', () => {
  for (const [room, quote] of [['', '预算改为18万元'], ['全屋', '全屋预算改为18万元'], ['书房', '书房预算改为18万元']]) {
    const text = `更正：书房书桌改为靠内墙；${quote}。另外插座怎么确定？`;
    const next = applyNeedDelta(readMemory({}), { ...budget, room, quote, sourceMessageId: '2', expectedVersion: 0 },
      { id: '2', text }, '9:0:0', 'now');
    assert.equal(next.facts[0].room, room);
  }
});

test('mixed correction hypothetical tail cannot supply a new current need', () => {
  assert.throws(() => applyNeedDelta(readMemory({}), { ...desk, value: '靠窗', quote: '如果仍靠窗会有哪些取舍', sourceMessageId: '2', expectedVersion: 0 },
    { id: '2', text: mixed }, '9:0:0', 'now'), /need_source_mismatch/);
});

function savedMixed() {
  let state = readMemory({});
  for (const [i, write] of [desk, budget].entries()) state = applyNeedDelta(state,
    { ...write, sourceMessageId: '2', expectedVersion: state.version }, { id: '2', text: mixed }, `9:0:${i}`, 'now');
  return state;
}

test('mixed correction completed update predicates require a real receipt from this run', () => {
  const text = '书桌位置已更改为靠内墙，预算也调整为18万元。';
  for (const memory of [readMemory({}), savedMixed()]) {
    assert.throws(() => assertRecordedReply(text, memory, '90'), /unsupported_model_commitment/);
  }
  assert.doesNotThrow(() => assertRecordedReply(text, savedMixed(), '9'));
});

const recapQuestion = '只回顾本次聊天原话，书桌和预算当前是什么？';
const currentRecap = '当前工作记录：书桌位置已更改为靠内墙，预算已调整为18万元。';

test('mixed correction exclusive current recap describes authorized existing targets without a new receipt', () => {
  const memory = savedMixed(), before = JSON.stringify(memory);
  assert.doesNotThrow(() => assertRecordedReply(currentRecap, memory, '90', [], recapQuestion));
  assert.equal(needReplyFeedback(currentRecap, memory, '90', recapQuestion), null);
  memory.facts[0].field = 'style';
  assert.doesNotThrow(() => assertRecordedReply(currentRecap, memory, '90', [], recapQuestion));
  memory.facts[0].field = 'desk'; assert.equal(JSON.stringify(memory), before);
});

test('mixed correction exclusive current recap cannot borrow historical, unavailable or wrong targets', () => {
  for (const memory of [readMemory({}), { ...savedMixed(), facts: savedMixed().facts.filter(f => f.field !== 'budget') },
    { ...savedMixed(), facts: savedMixed().facts.map(f => ({ ...f, status: 'superseded' as const })) }]) {
    assert.throws(() => assertRecordedReply(currentRecap, memory, '90', [], recapQuestion), /unsupported_model_commitment/);
  }
  for (const text of ['当前预算已调整为19万元。', '当前书桌位置已更改为靠窗。']) {
    assert.throws(() => assertRecordedReply(text, savedMixed(), '90', [], recapQuestion), /unsupported_model_commitment/);
  }
});

test('mixed correction exclusive recap never authorizes a new action acknowledgement or generic save claim', () => {
  for (const text of ['本次书桌位置已更改为靠内墙，预算已调整为18万元。',
    '本轮预算已调整为18万元。', '刚刚替你把书桌位置更改为靠内墙。',
    '我已将预算调整为18万元。', '书桌位置已更改为靠内墙，预算已调整为18万元。已保存。',
    '本次已记录书桌和预算。']) {
    assert.throws(() => assertRecordedReply(text, savedMixed(), '90', [], recapQuestion), /unsupported_model_commitment/, text);
  }
  for (const question of [mixed, '书桌和预算是什么？', '不要只回顾本次聊天原话，帮我更正预算。']) {
    assert.throws(() => assertRecordedReply(currentRecap, savedMixed(), '90', [], question), /unsupported_model_commitment/, question);
  }
});

test('mixed correction a desk save or unrelated preference cannot authorize an unsaved budget update', () => {
  const memory = savedMixed();
  memory.facts = memory.facts.filter(f => f.field === 'desk');
  assert.throws(() => assertRecordedReply('书桌位置已更改为靠内墙，预算也调整为18万元。', memory, '9'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('预算已调整为18万元。', readMemory({}), '9', ['9:preference']), /unsupported_model_commitment/);
});

test('mixed correction a receipt does not support a different completed target value', () => {
  assert.throws(() => assertRecordedReply('预算已调整为19万元。', savedMixed(), '9'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('书桌位置已更改为靠窗。', savedMixed(), '9'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('书桌位置已经改成靠窗。', savedMixed(), '9'), /unsupported_model_commitment/);
  assert.doesNotThrow(() => assertRecordedReply('书桌位置和预算已调整为靠内墙和18万元。', savedMixed(), '9'));
});

test('mixed correction historical updates, denials and future proposals stay distinct from a new acknowledgement', () => {
  for (const text of ['之前书桌位置已更改为靠内墙，预算也调整为18万元，当前沿用原工作记录。',
    '上次预算已调整为18万元。本轮没有再改。', '当前预算尚未调整为18万元。', '如果预算调整为18万元，需要再核对范围。',
    '书桌位置还没有更改为靠内墙。', '预算将调整为18万元，确认后再处理。', '预算会调整为18万元，确认后再处理。',
    '书桌位置未更改为靠内墙。', '书桌位置从靠窗调整为靠内墙，预算从20万元调整为18万元。',
    '之前书桌位置已按你的更正更新为靠内墙。']) {
    assert.doesNotThrow(() => assertRecordedReply(text, savedMixed(), '90'), text);
  }
  assert.throws(() => assertRecordedReply('之前预算已调整为18万元，但这次预算已调整为19万元。', savedMixed(), '90'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('预算没有调整为18万元。但书桌位置已更改为靠内墙。', savedMixed(), '90'), /unsupported_model_commitment/);
});

test('mixed correction historical desk updates recognize existing legacy field keys without rewriting them', () => {
  const state = savedMixed(); state.facts[0].field = 'style';
  const before = JSON.stringify(state);
  assert.doesNotThrow(() => assertRecordedReply('之前书桌位置已更改为靠内墙，预算也调整为18万元。', state, '90'));
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => assertRecordedReply('本次书桌位置已更改为靠内墙，预算也调整为18万元。', state, '90'), /unsupported_model_commitment/);
});

test('mixed correction receipt-only text and echoed hypotheses cannot complete the separate question', () => {
  for (const text of ['本次已记录书桌改为靠内墙和预算18万元。后面的假设不保存。',
    '书桌位置已更改为靠内墙，预算也调整为18万元。如果仍靠窗会有哪些取舍？后面是假设，不要保存。',
    '已记录。关于靠窗的取舍：这是假设，不保存。']) {
    const issue = needReplyFeedback(text, savedMixed(), '9', mixed);
    assert.equal(issue?.code, 'ungrounded_response_scope', text);
    assert.match(issue.feedback, /不取消回答/);
  }
  for (const text of ['书桌和预算本次已记录。靠窗能利用自然光，但直射光容易造成屏幕反光，还要留出开窗空间。',
    '本次没有保存成功。一般建议：靠窗能利用自然采光，但要注意屏幕眩光和窗帘的使用空间。',
    '本次实际保存两项。一般建议考虑自然光与屏幕反光，具体布置仍需核对现场尺寸。']) {
    assert.equal(needReplyFeedback(text, savedMixed(), '9', mixed), null, text);
  }
  assert.equal(needReplyFeedback('沿用原记录。', savedMixed(), '90', '只回顾本次聊天原话。'), null);
});

test('mixed correction one repair combines unsupported updates and the missing answer without a write', () => {
  const before = JSON.stringify(savedMixed());
  const issue = needReplyFeedback('书桌位置已更改为靠内墙，预算也调整为18万元。后面的假设不保存。', readMemory({}), '9', mixed)!;
  assert.equal(issue.code, 'unsupported_model_commitment'); assert.match(issue.feedback, /"savedFacts":\[\]/);
  assert.match(issue.feedback, /必须实际回答/); assert.match(issue.feedback, /不调用保存、查询或业务工具/);
  assert.equal(JSON.stringify(savedMixed()), before);
});

test('mixed correction parameter feedback preserves the exact assertion and diagnoses each submitted field without saving', () => {
  const wrong = { ...desk, quote: '书房书桌改为靠内墙。预算改为18万元', additionalNeeds: [{ ...budget, room: '书房' }] };
  const feedback = needWriteFeedback(new AssistantError('need_source_mismatch', 422), mixed, wrong)!;
  assert.equal(feedback.batchCommitted, false); assert.equal(feedback.assertionText, '更正：书房书桌改为靠内墙；预算改为18万元');
  assert.deepEqual(feedback.submittedWrites?.map(w => [w.quoteIsOriginal, w.validationError]), [[false,'need_source_mismatch'],[true,'need_source_mismatch']]);
  assert.equal(feedback.assertionText.includes('靠窗'), false); assert.match(feedback.instructions, /不表示写入成功/);
});
