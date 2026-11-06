import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeSourceBudgetProtocol, homeSourceRuntimeBudget } from '../agent/home-source-budget';
import { runRenovationAgent, agentTurnScheduleProtocol, type AgentRuntimePorts } from '../agent/runtime';
const tools = ['query_materials', 'query_followups', 'search_knowledge', 'final_response'].map(name => ({ name, description: name, parameters: {} }));
const base = { policy: homeSourceBudgetProtocol, boundHome: true, images: 0, nativeFinalization: false, tools,
  summaries: 0, perceptions: 0, scheduleProtocol: agentTurnScheduleProtocol };
test('read-only bound-home turns reserve one final repair within the same four total calls, including auxiliaries', () => {
  for (const summaries of [0, 1]) for (const perceptions of [0, 1]) {
    const budget = homeSourceRuntimeBudget({ ...base, summaries, perceptions })!;
    assert.equal(budget.primaryModelTurns + budget.reservedValidationRepairs + budget.auxiliaryCalls, 4);
  }
  for (const extra of [{ policy: undefined }, { boundHome: false }, { images: 1 }, { nativeFinalization: true },
    { tools: [...tools, { name: 'record_need', description: '', parameters: {} }] },
    { tools: tools.filter(t => t.name === 'search_knowledge') }, { resume: { primaryModelTurns: 3 } }])
    assert.equal(homeSourceRuntimeBudget({ ...base, ...extra }), undefined);
  assert.ok(homeSourceRuntimeBudget({ ...base, resume: { turnSchedule: agentTurnScheduleProtocol, primaryModelTurns: 3 } }));
});
test('ordinary public web/history reads use the original loop while existing reserved schedules remain compatible',()=>{
 const web={name:'search_web',description:'public read',parameters:{}};
 assert.deepEqual(homeSourceRuntimeBudget({...base,tools:[...tools,web]}),homeSourceRuntimeBudget(base));
 assert.equal(homeSourceRuntimeBudget({...base,boundHome:false,ordinaryDialogue:true,tools:[web]}),undefined);
 assert.equal(homeSourceRuntimeBudget({...base,boundHome:false,ordinaryDialogue:true,tools:[{...web,name:'recall_history'}]}),undefined);
 assert.ok(homeSourceRuntimeBudget({...base,ordinaryDialogue:true,resume:{turnSchedule:agentTurnScheduleProtocol,primaryModelTurns:3}}));
 assert.equal(homeSourceRuntimeBudget({...base,ordinaryDialogue:true,tools:[web,{...web,name:'record_need'}]}),undefined);
 assert.equal(homeSourceRuntimeBudget({...base,tools:[web]}),undefined);
});

test('two actual source reads, a rejected final and its final-only repair never dispatch a fifth call or repeat a read', async () => {
  const budget = homeSourceRuntimeBudget(base)!; let calls = 0, reads = 0;
  const output = (text: string) => ({ text, toolCalls: [], usage: null, finishReason: null, providerRequestId: null });
  const ports: AgentRuntimePorts = { authorize: async () => {}, checkpoint: async () => {}, tool: async () => { reads++; return { content: '{}' }; },
    model: async (turn, _messages, available) => { calls++;
      if (turn < 2) return { ...output(''), toolCalls: [{ id: 'read-' + turn, name: tools[turn].name, arguments: '{}' }] };
      assert.deepEqual(available, []); return output(turn === 2 ? 'unsupported contact instruction' : 'only the actual pending status'); },
    validateFinal: async raw => raw === 'only the actual pending status' ? null : { code: 'ungrounded_response_scope', feedback: 'No source supports an in-chat contact or arrangement workflow.' } };
  const result = await runRenovationAgent({ messages: [], tools, ports, ...budget });
  assert.equal(result.output!.text, 'only the actual pending status'); assert.equal(calls, 4); assert.equal(reads, 2);
});

test('ordinary discovery, refinement, original read and final share the original four calls',async()=>{
  const names=['search_web','read_web'],available=names.map(name=>({name,description:name,parameters:{}}));
  let calls=0,reads=0;
  const result=await runRenovationAgent({messages:[],tools:available,ports:{authorize:async()=>{},checkpoint:async()=>{},
    tool:async()=>{reads++;return{content:'{}'};},model:async(turn,_messages,tools)=>{
      calls++;if(turn===3){assert.deepEqual(tools,[]);return{text:'Answer from the selected original.',toolCalls:[],usage:null,finishReason:null,providerRequestId:null};}
      return{text:'',toolCalls:[{id:'read-'+turn,name:turn<2?'search_web':'read_web',arguments:JSON.stringify({step:turn})}],usage:null,finishReason:null,providerRequestId:null};
    }}});
  assert.equal(calls,4);assert.equal(reads,3);assert.equal(result.output?.text,'Answer from the selected original.');
});
