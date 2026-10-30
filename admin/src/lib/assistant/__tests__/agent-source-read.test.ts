import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentToolsForMessage, agentToolsForTurn } from '../agent/worker';
import type { ModelMessage } from '../contracts/model';

const question = '合成点位说明第二节如何区分方案同意和关闭？';
const original = (text = question): ModelMessage => ({ role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', sourceRole: 'current_request', text }) }] });
const read = (content = '{"knowledgeStatus":"ready","evidence":[],"synthesisSources":[]}'): ModelMessage[] => [
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: '{"query":"模型选择的原文查询词"}' }] },
  { role: 'tool', callId: 'read', content },
];
const names = (text = question, messages: ModelMessage[] = [original(text)]) => agentToolsForTurn(text, messages, agentToolsForMessage(text, true), 'current').map(t => t.name);

test('a project knowledge question must obtain this turn\'s paired read even without naming a source',()=>{
  for(const text of ['卫生间防水前要准备哪些？','只回答当前这句话：管根呢？','不查资料，只给一般建议。']) {
    const tools=agentToolsForTurn(text,[original(text)],agentToolsForMessage(text,true),'current',{requiredKnowledge:true});
    assert.deepEqual(tools.map(t=>t.name),['search_knowledge']);
    const complete=agentToolsForTurn(text,[original(text),...read()],tools,'current',{requiredKnowledge:true});
    assert.ok(complete.some(t=>t.name==='final_response'));
    const failed=agentToolsForTurn(text,[original(text),...read('{"status":"tool_exhausted"}')],tools,'current',{requiredKnowledge:true});
    assert.deepEqual(failed.map(t=>t.name),['search_knowledge']);
  }
  const disabled=agentToolsForTurn('只回答当前这句话：管根呢？',[original('只回答当前这句话：管根呢？')],[],'current',{requiredKnowledge:true});
  assert.deepEqual((disabled[0].parameters.properties as Record<string,{enum:string[]}>).kind.enum,['unavailable']);
});

test('a named original section must read before the model receives a final envelope', () => {
  for (const text of [question, '请解释《点位说明》第二节原文。', '合成手测点位说明.pdf如何区分同意和关闭？', '请按原文解释方案同意。'])
    assert.deepEqual(names(text), ['search_knowledge']);
});

test('only this turn\'s paired completed knowledge read opens the existing citation envelope', () => {
  assert.deepEqual(names(question, [original(), ...read()]).at(-1), 'final_response');
  for (const fake of [read(), [{ role: 'tool', callId: 'unpaired', content: '{"synthesisSources":[]}' } as ModelMessage],
    [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(read()) }] } as ModelMessage],
    read('{"protocol":"read-input-v2","status":"invalid_arguments"}'), read('{"status":"already_queried"}'), read('{"status":"tool_exhausted"}')]) {
    assert.deepEqual(names(question, [...fake, original()]), ['search_knowledge']);
    assert.deepEqual(names(question, [original(), ...fake.filter(m => m.role !== 'assistant')]), ['search_knowledge']);
  }
  for (const packet of ['{"protocol":"read-input-v2","status":"invalid_arguments"}', '{"status":"already_queried"}', '{"status":"tool_exhausted"}', '{}'])
    assert.deepEqual(names(question, [original(), ...read(packet)]), ['search_knowledge']);
});

test('an empty or not-ready real read closes without another mandatory lookup or fabricated citations', () => {
  for (const knowledgeStatus of ['ready', 'not_ready']) {
    const tools = agentToolsForTurn(question, [original(), ...read(JSON.stringify({ knowledgeStatus, evidence: [], synthesisSources: [] }))], agentToolsForMessage(question, true), 'current');
    const final = tools.find(t => t.name === 'final_response')!;
    const properties = final.parameters.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(properties.kind.enum, ['synthesis']);
    assert.equal((((properties.segments.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).citations).maxItems, 0);
  }
});

test('ordinary advice, current budget, project queries and explicit no-read keep their existing tool path', () => {
  for (const text of ['书房柔和照明怎么选？不新增或修改需求。', '现在记住的预算是多少？', '现有户型资料能说明什么，现场尺寸是否已核实？',
    '不查文件或原文，只给一般建议。', '只回顾聊天原话，不查图纸。', '请回顾我之前说的预算原文。', '请给第一条照明建议。', '今天读完合成点位说明第二节了。']) {
    assert.deepEqual(names(text), [...agentToolsForMessage(text, true).map(t => t.name), 'final_response']);
  }
});

test('read gating preserves separate explicit writes and disabled/final-only tools never reopen a read', () => {
  const text = '更正：书房改为单人办公。另外，合成点位说明第二节如何区分方案同意和关闭？';
  assert.deepEqual(new Set(names(text)), new Set(['record_need', 'search_knowledge']));
  const tools = agentToolsForTurn(question, [original()], [], 'current');
  assert.deepEqual(tools.map(t => t.name), ['final_response']);
  assert.deepEqual((tools[0].parameters.properties as Record<string, { enum: string[] }>).kind.enum, ['unavailable']);
});
