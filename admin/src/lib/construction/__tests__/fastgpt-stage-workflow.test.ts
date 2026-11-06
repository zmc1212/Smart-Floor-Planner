import test from 'node:test';
import assert from 'node:assert/strict';
import {FastGPTReportWorkflow} from '../fastgpt-report-workflow';
import type {ModelMessage,ModelTool} from '@/lib/assistant/contracts/model';

test('dedicated stage workflow cannot consume daily or weekly work and the report pilot cannot consume stage events',async()=>{
 const original=globalThis.fetch;let calls=0;
 const config={baseUrl:'http://127.0.0.1:18300',appId:'stage-app',apiKey:'test',record:()=>{}};
 const stage=new FastGPTReportWorkflow(config,['stage']),reports=new FastGPTReportWorkflow(config);
 const messages=(kind:string):ModelMessage[]=>[{role:'user',content:[{type:'text',text:JSON.stringify({scope:{kind},projects:[]})}]}];
 const tools:ModelTool[]=[{name:'final_response',description:'original final',parameters:{type:'object'}}];
 const guard={runId:'stage',enterpriseId:'1454',authorize:async()=>{},validate:()=>{}};
 try{
  globalThis.fetch=async(_url,options)=>{
   calls++;const packet=JSON.parse(String(options?.body)),headers={Authorization:'Bearer '+packet.variables.reportTicket};
   const result='{"P1":["封闭隐蔽部位前请与施工团队核对。"]}';
   assert.equal((await stage.handle(new Request('http://localhost/report-result',{method:'POST',headers,body:result}))).status,200);
   return Response.json({choices:[{message:{content:result}}],responseData:[{nodeId:'compose',inputTokens:20,outputTokens:10}]});
  };
  await assert.rejects(()=>reports.model(messages('stage'),tools,0,guard),/assistant_capability_forbidden/);
  for(const kind of ['daily','weekly'])await assert.rejects(()=>stage.model(messages(kind),tools,0,guard),/assistant_capability_forbidden/);
  assert.equal(calls,0);
  const result=await stage.model(messages('stage'),tools,0,guard);assert.equal(result.toolCalls[0].name,'final_response');assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
