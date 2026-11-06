import test from 'node:test';
import assert from 'node:assert/strict';
import { FastGPTReportWorkflow } from '../fastgpt-report-workflow';
import type { ModelMessage, ModelTool } from '@/lib/assistant/contracts/model';

const messages: ModelMessage[] = [{role:'system',content:[{type:'text',text:'原报告服务的权威模型指令。'}]},{role:'user',content:[{type:'text',text:JSON.stringify({scope:{kind:'weekly',audience:'customer'},projects:[{slot:'P1',records:[{text:'窗边收口待核对'}]}]})}]}];
const tools: ModelTool[]=[{name:'final_response',description:'报告',parameters:{type:'object'}}];
test('unknown tickets cannot read facts or submit report content',async()=>{
 const adapter=new FastGPTReportWorkflow({baseUrl:'http://127.0.0.1:18300',appId:'app',apiKey:'test-key',record:()=>{}});
 assert.equal((await adapter.handle(new Request('http://localhost/report-input'))).status,404);
 assert.throws(()=>new FastGPTReportWorkflow({baseUrl:'https://cloud.fastgpt.cn',appId:'app',apiKey:'test-key',record:()=>{}}));
});
test('workflow reauthorizes reads and submits, keeps tickets out of model data, records observed usage and prevents conflicting replay',async()=>{
 const original=globalThis.fetch;let calls=0,guards=0;const audit:unknown[]=[];
 const adapter=new FastGPTReportWorkflow({baseUrl:'http://127.0.0.1:18300',appId:'app',apiKey:'test-key',record:v=>audit.push(v)});
 try {
  let expired='';
  globalThis.fetch=async(_url,options)=>{
   calls++;const body=JSON.parse(String(options?.body));expired=body.variables.reportTicket;
   const headers={Authorization:'Bearer '+expired};
   const input=await adapter.handle(new Request('http://localhost/report-input',{headers}));assert.equal(input.status,200);
   const data=await input.json();assert.ok(!data.input.includes(expired));assert.ok(data.instructions.startsWith('原报告服务的权威模型指令。'));
   const raw=JSON.stringify({P1:['收口施工前与经理核对现场条件。']});
   const post=()=>adapter.handle(new Request('http://localhost/report-result',{method:'POST',headers,body:raw}));
   assert.equal((await post()).status,200);assert.equal((await post()).status,200);
   assert.equal((await adapter.handle(new Request('http://localhost/report-result',{method:'POST',headers,body:'{"P1":["不同内容"]}'}))).status,409);
   return Response.json({choices:[{message:{content:'\n'+raw+'\n'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:1},
     responseData:[{nodeId:'compose',inputTokens:123,outputTokens:45}]});
  };
  const result=await adapter.model(messages,tools,0,{enterpriseId:'1454',runId:'123',validate:raw=>{assert.ok(JSON.parse(raw).P1);},authorize:async()=>{guards++;}});
  assert.equal(calls,1);assert.ok(guards>=4);assert.equal(audit.length,1);assert.deepEqual(result.usage,{inputTokens:123,outputTokens:45});
  assert.equal((await adapter.handle(new Request('http://localhost/report-input',{headers:{Authorization:'Bearer '+expired}}))).status,404);
 }finally{globalThis.fetch=original;}
});
test('permission loss prevents callback data release and unknown transport is never retried',async()=>{
 const original=globalThis.fetch;let calls=0,revoked=false;
 const adapter=new FastGPTReportWorkflow({baseUrl:'http://127.0.0.1:18300',appId:'app',apiKey:'test-key',record:()=>{}});
 try{
  globalThis.fetch=async(_url,options)=>{
   calls++;revoked=true;const body=JSON.parse(String(options?.body));
   assert.equal((await adapter.handle(new Request('http://localhost/report-input',{headers:{Authorization:'Bearer '+body.variables.reportTicket}}))).status,409);
   throw new Error('Connection lost after dispatch');
  };
  await assert.rejects(()=>adapter.model(messages,tools,0,{enterpriseId:'1454',runId:'123',validate:()=>{},authorize:async()=>{if(revoked)throw Error('revoked');}}),/Connection lost/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('rejected model prose retains observed usage and guard reason without becoming a saved result',async()=>{
 const original=globalThis.fetch;const audit: Array<{response:unknown}>=[];let calls=0;
 const adapter=new FastGPTReportWorkflow({baseUrl:'http://127.0.0.1:18300',appId:'app',apiKey:'test-key',record:value=>audit.push(value)});
 try {
  globalThis.fetch=async(_url,options)=>{
   calls++;const request=JSON.parse(String(options?.body));
   const result=await adapter.handle(new Request('http://localhost/report-result',{method:'POST',headers:{Authorization:'Bearer '+request.variables.reportTicket},body:'{"P1":["混入未经授权的现场陈述"]}'}));
   assert.equal(result.status,422);assert.deepEqual(await result.json(),{error:'ungrounded_response_scope'});
   return Response.json({error:'HTTP422',choices:[{message:{content:''}}],responseData:[{nodeId:'compose',inputTokens:839,outputTokens:87}]});
  };
  const result=await adapter.model(messages,tools,0,{enterpriseId:'1454',runId:'failed-original',authorize:async()=>{},validate:()=>{throw Object.assign(Error('rejected'),{code:'ungrounded_response_scope'});}});
  assert.equal(calls,1);assert.deepEqual(result.toolCalls,[]);assert.deepEqual(result.usage,{inputTokens:839,outputTokens:87});
  assert.equal((audit[0].response as {pilotCallbackRejection:string}).pilotCallbackRejection,'ungrounded_response_scope');
 }finally {globalThis.fetch=original;}
});
