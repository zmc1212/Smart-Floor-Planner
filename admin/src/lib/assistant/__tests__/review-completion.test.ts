import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewCompletionTool, reviewCompletionPlan, requirementClauseWritable, reviewCompletionProtocol } from '../agent/review-completion';
import { contextReady } from '../agent/native-final';
import { toolSchemaIssue } from '../agent/tool-protocol';
import type { ModelMessage } from '../contracts/model';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import { agentConfig, agentCapabilityFingerprint } from '../agent/config';
import { nativeFinalProtocol } from '../agent/native-final';
import { reviewClaimProtocol } from '../agent/review-claims';
import { requirementPlan } from '../requirements/plan';
import { applyRequirementChanges, requirementItems, requirementSources } from '../requirements/items';

const sources = ['c10.0', 'c10.1'];
const messages = (value: unknown): ModelMessage[] => [{ role: 'assistant', content: '', toolCalls: [{ id: 'finish', name: 'finish_context', arguments: JSON.stringify(value) }] },
  { role: 'tool', callId: 'finish', content: contextReady }];
test('completion binds a remaining question to an exact current clause; receipt mode has no free-answer slot', async () => {
  const tool = reviewCompletionTool(sources);
  for (const value of [{ mode: 'answer', questionSourceIds: [sources[1]] }, { mode: 'receipt_only', questionSourceIds: [] }]) {
    assert.equal(await toolSchemaIssue(tool, JSON.stringify(value)), null);
    assert.deepEqual(reviewCompletionPlan(messages(value), sources), value);
  }
  for (const value of [{}, { mode: 'answer', questionSourceIds: [] }, { mode: 'receipt_only', questionSourceIds: [sources[0]] },
    { mode: 'answer', questionSourceIds: ['foreign'] }, { mode: 'receipt_only', questionSourceIds: [], text: '预算已修改' }]) {
    assert.ok(await toolSchemaIssue(tool, JSON.stringify(value)));
    assert.throws(() => reviewCompletionPlan(messages(value), sources), /invalid_model_answer/);
  }
});
test('saved withdrawal plan cannot replace a budget with the retention clause, while the other question stays available', () => {
  const messages = [{id:'1',text:'预算12万'}, {id:'2',text:'还是别用刚才那个数，预算先保持原来。量房时我要带哪些资料？'}];
  const all = requirementSources(messages), fields = applyRequirementChanges(messages,null,[{operation:'add',field:'budget',sourceId:all[0].id}]);
  const items = requirementItems(messages,fields), writable=all.filter(source=>requirementClauseWritable(source.text));
  const retention=all.find(source=>source.text==='预算先保持原来')!;
  assert.ok(!writable.includes(retention));
  assert.throws(()=>requirementPlan(items,writable,'2',{retainedIds:[],changes:[{operation:'replace',targetId:items[0].id,sourceId:retention.id}]}),/invalid_requirement_evidence/);
  assert.deepEqual(requirementPlan(items,writable,'2',{retainedIds:[items[0].id],changes:[]}),[]);
  assert.ok(all.some(source=>source.text.includes('量房')));
  assert.equal(requirementClauseWritable('预算还没想好'),false);
  assert.equal(requirementClauseWritable('预算提高到15万'),true);
});
test('typed receipt completion uses two planning calls and durable service reconstruction; reentry never repeats the proposal', async () => {
  const checkpoints:AgentCheckpoint[]=[],finish=reviewCompletionTool(sources);
  const proposal={name:'propose_requirement_changes',description:'proposal only',parameters:{type:'object',properties:{},additionalProperties:false}};
  let calls=0,writes=0,receipts=0;
  const ports={authorize:async()=>{},checkpoint:async(state:AgentCheckpoint)=>{checkpoints.push(structuredClone(state));},tool:async()=>{writes++;return {content:'actual pending proposal',exhausted:true};},
    model:async(turn:number)=>{calls++;return {text:'',toolCalls:[{id:String(turn),name:turn===0?proposal.name:finish.name,
      arguments:turn===0?'{}':JSON.stringify({mode:'receipt_only',questionSourceIds:[]})}],finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:0,outputTokens:0}};},
    resolveToolReply:async(state:AgentCheckpoint)=>{if(reviewCompletionPlan(state.messages,sources)?.mode!=='receipt_only')return null;receipts++;return '真实提案 · 尚未写入草稿';}};
  const result=await runRenovationAgent({messages:[],tools:[proposal],nativeFinalization:true,nativeFinishTool:finish,ports});
  assert.equal(result.output?.text,'真实提案 · 尚未写入草稿');assert.equal(calls,2);assert.equal(writes,1);
  const saved=checkpoints.find(state=>state.finalFromTools)!;assert.ok(saved);calls=0;
  await runRenovationAgent({messages:[],tools:[proposal],nativeFinalization:true,nativeFinishTool:finish,resume:saved,ports});
  assert.equal(calls,0);assert.equal(writes,1);assert.ok(receipts>=3);
});
test('a mixed question selects answer completion and retains its independent final model turn', async () => {
  const finish=reviewCompletionTool(sources);let calls=0;
  const result=await runRenovationAgent({messages:[],tools:[{name:'query_materials',description:'read',parameters:{type:'object'}}],nativeFinalization:true,nativeFinishTool:finish,
    ports:{authorize:async()=>{},checkpoint:async()=>{},tool:async()=>({content:'read'}),resolveToolReply:async(state)=>{
      assert.equal(reviewCompletionPlan(state.messages,sources)?.mode,'answer');return null;},model:async(turn)=>{calls++;return turn===0
      ?{text:'',toolCalls:[{id:'finish',name:finish.name,arguments:JSON.stringify({mode:'answer',questionSourceIds:[sources[1]]})}],finishReason:'tool_calls',providerRequestId:null,usage:null}
      :{text:'量房资料与老房检查建议',toolCalls:[],finishReason:'stop',providerRequestId:null,usage:null};}}});
  assert.equal(result.output?.text,'量房资料与老房检查建议');assert.equal(calls,2);
});
test('completion opt-in does not migrate an already-bound claim-only run', () => {
  const base={runtime:'langgraph-v1',model:'qwen3.8-flash',providerKey:'dashscope',imageInput:false,tools:true,probeVersion:'test',structuredFinal:nativeFinalProtocol,requirementClaims:reviewClaimProtocol};
  const old=agentConfig(base)!,current=agentConfig({...base,reviewCompletion:reviewCompletionProtocol})!;
  assert.equal(old.reviewCompletion,undefined);assert.equal(current.reviewCompletion,reviewCompletionProtocol);
  assert.equal(agentCapabilityFingerprint(old),agentCapabilityFingerprint(current));
  assert.throws(()=>agentConfig({...base,requirementClaims:undefined,reviewCompletion:reviewCompletionProtocol}),/forbidden/);
});
test('a proposal, stale original or unpaired call cannot select receipt completion', () => {
  const plan = messages({ mode: 'answer', questionSourceIds: [sources[0]] });
  assert.throws(() => reviewCompletionPlan(plan, ['new-original']), /invalid_model_answer/);
  assert.equal(reviewCompletionPlan(plan.slice(0, 1), sources), null);
  const foreign = structuredClone(plan); (foreign[1] as { callId: string }).callId = 'other';
  assert.equal(reviewCompletionPlan(foreign, sources), null);
  const proposal = structuredClone(plan); (proposal[0] as { toolCalls: Array<{ name: string }> }).toolCalls[0].name = 'propose_requirement_changes';
  assert.equal(reviewCompletionPlan(proposal, sources), null);
});
