import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseSynthesis, type SynthesisSource} from '../agent/synthesis';
import {modelCitationCatalog,sourceReferenceText} from '../agent/citation-catalog';
import {compileModelRequest} from '../agent/model-request';
import {agentToolsForTurn} from '../agent/worker';
import {buildAgentContext} from '../agent/context';
import {assertToolPairs} from '../agent/tool-protocol';
import {businessToolDefinitions} from '../agent/business-tools';
import {ancestorSourceMessages,selectedAncestorSources} from '../agent/ancestor-sources';
import {finalAnswerRepairControl} from '../agent/synthesis-repair';
import {finalAnswerRepairTask} from '../agent/synthesis';
import {minimalFinalCarrier} from '../agent/minimal-dialogue';
import {agentChatBody,executeAgentChat,agentResponseDiagnostic} from '@/lib/ai/providers/agent-chat';
import {privateAgentFailureFrame} from '@/lib/ai/postgres-workflow-chat';
import {AiProviderError,isSafeProviderFallback,type AiProviderRuntimeConfig} from '@/lib/ai/provider-types';
import {projectFinalToolOutput} from '../agent/final-output';
import {readWebTool} from '../agent/public-research';
import {minimalSourceInstructions} from '../agent/minimal-dialogue';

const sources: SynthesisSource[] = [
  {sourceId:'W-first',kind:'web',title:'基层准备',text:'涂刷前先检查旧基层，清除松动的涂层。'},
  {sourceId:'W-second',kind:'web',title:'施工条件',text:'潮湿或低温条件下不宜施工。'},
];
const citations=sources.map(source=>({citationId:modelCitationCatalog(source)[0].citationId}));
const raw=(text:string,refs:unknown[]=citations)=>JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text,citations:refs}]});

test('verified citation ordinals are presentation; raw prose and quoted originals remain unchanged',()=>{
  const text='涂刷前应检查并清理旧基层，潮湿或低温时不宜施工[1][2]。';
  const before=JSON.stringify(sources),input=raw(text);
  const answer=parseSynthesis(input,sources,{generalKnowledge:true});
  assert.equal(answer.segments[0].text,text);
  assert.deepEqual(answer.segments[0].citations.map(c=>c.quote),sources.map(s=>s.text));
  assert.equal(JSON.stringify(sources),before);
});

test('only actually selected catalog markers leave the quantity/display view; raw drafts and originals stay exact',()=>{
  const text=`先检查并清理旧基层[${citations[0].citationId}]，潮湿或低温时不宜施工[${citations[1].citationId}]。`;
  const before=JSON.stringify(sources),input=raw(text),answer=parseSynthesis(input,sources,{generalKnowledge:true});
  assert.equal(answer.segments[0].text,text);assert.equal(JSON.stringify(sources),before);
  const visible=sourceReferenceText(text,answer.segments[0].citations,sources);
  assert.ok(!visible.includes('[C'));assert.ok(visible.includes('先检查并清理旧基层'));
  assert.equal(sourceReferenceText(`原始代码 \`[${citations[0].citationId}]\``,answer.segments[0].citations,sources),`原始代码 \`[${citations[0].citationId}]\``);
  assert.equal(sourceReferenceText(`> [${citations[0].citationId}]`,answer.segments[0].citations,sources),`> [${citations[0].citationId}]`);
  for(const unsafe of [`需要7天[${citations[0].citationId}]。`,'基层厚度[Cforged9]。',`先清理[${citations[0].citationId}]，基层厚度7毫米。`])
    assert.throws(()=>parseSynthesis(raw(unsafe),sources,{generalKnowledge:true}),{code:'unsupported_model_commitment'},unsafe);
  assert.ok(sourceReferenceText(`厚度1[${citations[0].citationId}]2毫米`,answer.segments[0].citations,sources).includes(citations[0].citationId));
});

test('reference-like syntax cannot hide quantities, ranges, decimals or unbound ordinals',()=>{
  for(const text of ['涂刷[2]遍。','厚度[1]毫米。','温度[2]℃。','工期为[1]–[2]。','厚度[1.2]。','施工要求[3]。','厚度为：\n[2]。','基层处理要等7天[1][2]。'])
    assert.throws(()=>parseSynthesis(raw(text),sources,{generalKnowledge:true}),{code:'unsupported_model_commitment'},text);
  assert.throws(()=>parseSynthesis(raw('施工条件见[1][2]。',[citations[0]]),sources,{generalKnowledge:true}),{code:'unsupported_model_commitment'});
  assert.throws(()=>parseSynthesis(raw('施工条件见[1][2]。',[citations[0],{citationId:'forged'}]),sources,{generalKnowledge:true}),{code:'invalid_model_citation'});
  assert.throws(()=>parseSynthesis(raw('施工条件见[1][2]。'),[sources[0]],{generalKnowledge:true}),{code:'invalid_model_citation'});
});

const question='结合我家现在的施工进度，接下来有什么要注意的？';
function conversation(){
  const messages=buildAgentContext([
    {id:'1',role:'user',text:'卧室旧墙掉粉，是住人的老房。'},
    {id:'2',role:'assistant',text:'先检查旧涂层，施工时保护家具并控制粉尘。'},
    {id:'3',role:'user',text:question},
  ],{version:0,facts:[]},false,true,true);
  messages.push(...ancestorSourceMessages({version:1,knowledge:[],snapshots:[],sources}));
  messages.push({role:'assistant',content:'',toolCalls:[{id:'current-stage',name:'query_business',arguments:'{"domain":"construction"}'}]},
    {role:'tool',callId:'current-stage',content:JSON.stringify({resultKey:'stage',query:{domain:'construction'},synthesisSources:[{
      sourceId:'B-current',kind:'project',title:'本人项目',text:'团队标记的当前节点：水电。',
    }]})});
  return messages;
}

test('final-only source answer keeps history and tools while anchoring the actual current question last',()=>{
  const messages=conversation(),before=JSON.stringify(messages);
  const compiled=compileModelRequest({question,triggerId:'3',turn:2,purpose:'answer',messages,tools:[],minimalDialogue:true,difyDialogue:true,toolsForTurn:agentToolsForTurn});
  const last=compiled.modelMessages.at(-1)!;
  assert.equal(last.role,'user');
  assert.deepEqual(last.content,[{type:'text',text:question}]);
  assert.ok(JSON.stringify(compiled.modelMessages).includes('住人的老房'));
  assert.ok(JSON.stringify(compiled.modelMessages).includes('当前节点：水电'));
  assert.equal(compiled.modelMessages.filter(m=>m.role==='tool').length,2);
  assertToolPairs(compiled.modelMessages);
  assert.equal(JSON.stringify(messages),before);
});

test('planning retains the standard message order and does not repeat a business request',()=>{
  const messages=conversation();
  const compiled=compileModelRequest({question,triggerId:'3',turn:1,purpose:'answer',messages,tools:businessToolDefinitions,minimalDialogue:true,difyDialogue:true,toolsForTurn:agentToolsForTurn});
  assert.equal(compiled.modelMessages.at(-1)?.role,'tool');
  assert.equal(compiled.modelMessages.filter(m=>m.role==='user'&&JSON.stringify(m.content).includes(question)).length,1);
  assertToolPairs(compiled.modelMessages);
});

test('final question anchoring preserves exactly one trusted repair task and its bound draft',()=>{
  const messages=conversation(),draft=raw('不支持的施工表述。');
  messages.push({role:'assistant',content:draft},{role:'system',content:[finalAnswerRepairControl(draft)]});
  const compiled=compileModelRequest({question,triggerId:'3',turn:3,purpose:'answer',messages,tools:[],minimalDialogue:true,difyDialogue:true,toolsForTurn:agentToolsForTurn});
  const tasks=compiled.modelMessages.filter(m=>m.role==='user'&&m.content.some(p=>p.type==='text'&&p.text===finalAnswerRepairTask));
  assert.equal(tasks.length,1);assert.equal(compiled.modelMessages.at(-1),tasks[0]);
  assert.ok(compiled.modelMessages.some(m=>m.role==='assistant'&&m.content===draft));
  assertToolPairs(compiled.modelMessages);
});

test('public history restores the complete cited original and never an unused research page',()=>{
  const context={version:1 as const,knowledge:[],snapshots:[],sources};
  const before=JSON.stringify(context);
  const selected=selectedAncestorSources(context,{kind:'synthesis',segments:[{citations:[{sourceId:sources[1].sourceId,quote:'低温条件'}]}]});
  assert.deepEqual(selected,[sources[1]]);assert.equal(selected[0].text,sources[1].text);
  assert.equal(JSON.stringify(context),before);
  assert.deepEqual(selectedAncestorSources(context,{kind:'synthesis',segments:[{citations:[{sourceId:'another-conversation'}]}]}),[]);
  assert.deepEqual(selectedAncestorSources(context,{kind:'general',text:'Earlier advice.'}),[]);
});

test('ordinary final keeps the original tool history and uses one named terminal function with application citation validation',async()=>{
  const binding={providerKey:'dashscope',model:'qwen3.7-flash'};
  const compiled=compileModelRequest({question,triggerId:'3',turn:3,purpose:'answer',messages:conversation(),tools:[],minimalDialogue:true,difyDialogue:true,toolsForTurn:agentToolsForTurn});
  const input={...binding,messages:compiled.modelMessages,tools:compiled.dispatchTools,requireTool:true,maxTokens:2048,enableThinking:false,
    outputMode:minimalFinalCarrier(true,binding,compiled.dispatchTools)};
  const runtime:AiProviderRuntimeConfig={id:'synthetic',key:'dashscope',name:'synthetic',adapterType:'openai_compatible',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:'synthetic',capabilities:['chat'],modelMappings:{},timeoutMs:1000};
  const body=agentChatBody(input,runtime.baseUrl),before=JSON.stringify(input.messages);
  assert.equal(body.response_format,undefined);assert.deepEqual(body.tool_choice,{type:'function',function:{name:'final_response'}});
  assert.deepEqual(body.tools?.map(t=>t.function.name),['final_response']);assert.equal(body.max_tokens,2048);
  assert.deepEqual(body.messages.filter(m=>m.role==='tool').map(m=>m.content),input.messages.filter(m=>m.role==='tool').map(m=>m.content));
  const answer=raw('涂刷前先检查旧基层，潮湿或低温时不宜施工[1][2]。');
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,
      tool_calls:[{id:'terminal',type:'function',function:{name:'final_response',arguments:answer}}]}}],usage:{prompt_tokens:200,completion_tokens:50}}));};
    const packet=await executeAgentChat(runtime,input),projected=projectFinalToolOutput(packet,true);
    assert.equal(calls,1);assert.equal(packet.toolCalls[0].arguments,answer);assert.equal(projected.text,answer);
    assert.deepEqual(packet.observation?.format,{mode:'function_call',jsonValid:true,schemaValid:true,schemaValidation:'application'});
    assert.equal(parseSynthesis(projected.text,sources,{generalKnowledge:true}).segments[0].text,JSON.parse(answer).segments[0].text);
    assert.equal(JSON.stringify(input.messages),before);
  } finally {globalThis.fetch=original;}
  assert.equal(minimalFinalCarrier(false,binding,compiled.dispatchTools),undefined);
  assert.equal(minimalFinalCarrier(true,{...binding,model:'another'},compiled.dispatchTools),undefined);
  assert.equal(minimalFinalCarrier(true,binding,businessToolDefinitions),undefined);
});

test('an invalid ordinary provider frame is retained privately without settling or resubmitting an unknown attempt',()=>{
  const payload={choices:[{finish_reason:'tool_calls',message:{content:'已返回但不能作为有效回答',tool_calls:[{id:'invalid',type:'function',function:{name:'search_web',arguments:'broken'}}]}}],
    usage:{prompt_tokens:2074,completion_tokens:479}};
  const frame={protocol:'invalid-provider-frame-v1',payload},error=new AiProviderError('invalid','INVALID_PROVIDER_RESPONSE','unknown',502,agentResponseDiagnostic(payload),frame);
  const owner={kind:'assistant_run' as const,runId:1n},metadata={probeVersion:'minimal-dialogue-v3',purpose:'answer',turn:3};
  assert.equal(privateAgentFailureFrame(owner,metadata,error),frame);assert.equal(isSafeProviderFallback(error),false);
  for(const changed of [{probeVersion:'unknown'},{purpose:'summary'},{turn:4},{turn:-1}])
    assert.equal(privateAgentFailureFrame(owner,{...metadata,...changed},error),null);
  assert.equal(JSON.stringify(error).includes('已返回'),false);
});

test('failed public reads keep failure receipts while navigation uses the existing frontier and never becomes final evidence',()=>{
  const messages=buildAgentContext([{id:'1',role:'user',text:question}],{version:0,facts:[]},false,true,true);
  const candidates=Array.from({length:100},(_,i)=>({id:`P1:1200:${i}`,url:`https://example.com/${i}`,title:'未读导航链接'.repeat(30)}));
  const packet={webStatus:'unavailable',synthesisSources:[],candidates,failures:[{url:'https://example.com/old-wall',code:'web_context_limit'}]};
  messages.push({role:'assistant',content:'',toolCalls:[{id:'failed-read',name:'read_web',arguments:'{"candidateId":"P1:1200:0"}'}]},
    {role:'tool',callId:'failed-read',content:JSON.stringify(packet)});
  const before=JSON.stringify(messages),request={question,triggerId:'1',turn:3,purpose:'answer' as const,messages,minimalDialogue:true,difyDialogue:true,toolsForTurn:agentToolsForTurn};
  const final=compileModelRequest({...request,tools:[]}),finalPacket=JSON.parse(final.modelMessages.find(m=>m.role==='tool')!.content);
  assert.equal(finalPacket.candidates,undefined);assert.deepEqual(finalPacket.failures,packet.failures);assert.deepEqual(finalPacket.synthesisSources,[]);
  assert.deepEqual(finalPacket.navigation,{candidateCount:100,readable:false,evidence:false});
  assert.ok(!JSON.stringify(final.modelMessages).includes(minimalSourceInstructions));
  const planning=compileModelRequest({...request,turn:2,tools:[...businessToolDefinitions,readWebTool]});
  assert.equal(JSON.parse(planning.modelMessages.find(m=>m.role==='tool')!.content).candidates.length,8);
  assert.equal(JSON.stringify(messages),before);assertToolPairs(final.modelMessages);
});
