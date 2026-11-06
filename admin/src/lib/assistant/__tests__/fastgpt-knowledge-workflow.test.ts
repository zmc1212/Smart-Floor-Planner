import test from 'node:test';
import assert from 'node:assert/strict';
import {FastGPTKnowledgeWorkflow} from '../fastgpt/knowledge-workflow';
import type {ModelTurnOutput} from '../contracts/model';

const input={enterpriseId:'1454',runId:'10',conversationId:'20',turn:0,question:'卧室墙面起粉，先怎么处理？',model:'configured-model',requestHash:'request-hash',toolNames:['search_web','final_response']};
const original:ModelTurnOutput={text:'',toolCalls:[{id:'provider-call',name:'search_web',arguments:'{"query":"旧墙起粉"}'}],finishReason:'tool_calls',providerRequestId:'provider-request',usage:{inputTokens:120,outputTokens:30}};
const config={baseUrl:'http://127.0.0.1:18300',appId:'test-app',apiKey:'test-key',record:()=>{}};
test('knowledge workflow preserves the original tool/provider packet and executes concurrent callback repeats once',async()=>{
 const prior=globalThis.fetch;let calls=0,expired='';const audit:unknown[]=[];
 const adapter=new FastGPTKnowledgeWorkflow({...config,record:e=>audit.push(e)});
 try{
  globalThis.fetch=async(_url,options)=>{
   const dispatch=JSON.parse(String(options?.body));expired=dispatch.variables.workflowTicket;const headers={Authorization:'Bearer '+expired};
   const context=await adapter.handle(new Request('http://localhost/knowledge-input',{headers}));assert.deepEqual(await context.json(),input);
   const invoke=()=>adapter.handle(new Request('http://localhost/knowledge-turn',{method:'POST',headers,body:JSON.stringify({requestHash:input.requestHash})}));
   const results=await Promise.all([invoke(),invoke()]);assert.equal(calls,1);
   const receipt=(await results[0].json()).receipt;assert.equal((await results[1].json()).receipt,receipt);
   const wrong=await adapter.handle(new Request('http://localhost/knowledge-result',{method:'POST',headers,body:'{"receipt":"foreign"}'}));assert.equal(wrong.status,409);
   assert.equal((await adapter.handle(new Request('http://localhost/knowledge-result',{method:'POST',headers,body:JSON.stringify({receipt})}))).status,200);
   return Response.json({choices:[{message:{content:'\n'+receipt}}],usage:{prompt_tokens:1,completion_tokens:1}});
  };
  const packet={agentOutput:original,attemptId:'501'};
  const result=await adapter.dispatch(input,{authorize:async()=>{}},async()=>{calls++;return packet;});
  assert.equal(result,packet);assert.equal(result.agentOutput,original);assert.equal(audit.length,1);
  assert.equal((await adapter.handle(new Request('http://localhost/knowledge-input',{headers:{Authorization:'Bearer '+expired}}))).status,404);
 }finally{globalThis.fetch=prior;}
});
test('unknown provider outcome is never re-executed by an HTTP callback repeat',async()=>{
 const prior=globalThis.fetch;let calls=0;
 const adapter=new FastGPTKnowledgeWorkflow(config);
 try{
  globalThis.fetch=async(_url,options)=>{
   const dispatch=JSON.parse(String(options?.body)),headers={Authorization:'Bearer '+dispatch.variables.workflowTicket};
   const invoke=()=>adapter.handle(new Request('http://localhost/knowledge-turn',{method:'POST',headers,body:JSON.stringify({requestHash:input.requestHash})}));
   assert.equal((await invoke()).status,502);assert.equal((await invoke()).status,409);
   return Response.json({error:'provider_outcome_unavailable'});
  };
  await assert.rejects(()=>adapter.dispatch(input,{authorize:async()=>{}},async()=>{calls++;throw Error('unknown transport');}),/fastgpt_workflow_unavailable/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=prior;}
});
test('revoked authorization blocks returned results and subsequent reads',async()=>{
 const prior=globalThis.fetch;let revoked=false,calls=0;
 const adapter=new FastGPTKnowledgeWorkflow(config);
 try{
  globalThis.fetch=async(_url,options)=>{
   const dispatch=JSON.parse(String(options?.body)),headers={Authorization:'Bearer '+dispatch.variables.workflowTicket};
   const output=await adapter.handle(new Request('http://localhost/knowledge-turn',{method:'POST',headers,body:JSON.stringify({requestHash:input.requestHash})}));
   assert.equal(output.status,409);assert.equal((await adapter.handle(new Request('http://localhost/knowledge-input',{headers}))).status,409);
   return Response.json({error:'context_unavailable'});
  };
  await assert.rejects(()=>adapter.dispatch(input,{authorize:async()=>{if(revoked)throw Error('revoked');}},async()=>{calls++;revoked=true;return{agentOutput:original,attemptId:'502'};}));
  assert.equal(calls,1);
 }finally{globalThis.fetch=prior;}
});
