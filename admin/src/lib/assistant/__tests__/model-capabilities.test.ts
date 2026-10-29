import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentChatBody, parseAgentChat, executeAgentChat } from '@/lib/ai/providers/agent-chat';
import { bailianBinding, bailianCapabilities, bailianSearchBinding } from '@/lib/ai/providers/bailian-capabilities';
import { bailianOfflineTransport, bailianPublicSearch, nativeSearchCandidates, nativeSearchUsage, publicSearchBody } from '@/lib/ai/providers/bailian-offline';
import { cacheObservation, modelPrefixObservation } from '@/lib/ai/providers/model-observation';
import { AiProviderError } from '@/lib/ai/provider-types';
import { explicitCacheControl } from '@/lib/ai/postgres-workflow-chat';
import { nativeSearchAttemptValues, nativeSearchBindingFor, nativeSearchFailure, nativeSearchSucceeded, resolveNativeSearch, selectedNativeSearch } from '../agent/native-search';
import { assertToolPairs, toolSchemaIssue } from '../agent/tool-protocol';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import { partialBody, joinDraft, validateDraft, type ApprovedDraft } from '../agent/draft-continuation';
import { searchWeb } from '../agent/web';
import { fingerprint } from '../contracts';
import type { ModelTool, ModelTurnInput, ModelTurnOutput } from '../contracts/model';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

const base='https://dashscope.aliyuncs.com/compatible-mode';
const binding=bailianBinding(base,'qwen3.8-flash',false)!;
const final:ModelTool={name:'final_response',description:'JSON final packet',parameters:{type:'object',properties:{text:{type:'string'},ids:{type:'array',items:{type:'string'},uniqueItems:true}},required:['text','ids'],additionalProperties:false}};
const input:ModelTurnInput={model:binding.model,enableThinking:false,maxTokens:512,requireTool:true,tools:[final],messages:[{role:'system',content:[{type:'text',text:'Return the final JSON packet.'}]},{role:'user',content:[{type:'text',text:'卫生间准备铺砖前需要注意什么？'}]}]};
const payload=(usage:unknown={prompt_tokens:100,completion_tokens:20})=>({id:'chat-test',choices:[{message:{content:'{"text":"建议","ids":[]}'},finish_reason:'stop'}],...(usage===undefined?{}:{usage})});
const answer:ModelTurnOutput={text:'可以先核对基层和平整度。',toolCalls:[],finishReason:'stop',providerRequestId:'test',usage:null};
const runtime:AiProviderRuntimeConfig={id:'1',key:'test-p0',name:'Synthetic P0',capabilities:['chat'],adapterType:'openai_compatible',baseUrl:base,apiKey:'synthetic-not-a-key',timeoutMs:1000,adapterConfig:{providerPreset:'dashscope'},modelMappings:{'chat.general':binding.model}};

test('capabilities bind exact model/API/region/thinking; partial conflict and Singapore Batch remain explicit',()=>{
  assert.equal(bailianCapabilities(binding).batch,'documented');assert.equal(bailianCapabilities(binding).partial,'documentation_conflict');
  assert.equal(bailianCapabilities(bailianBinding('https://dashscope-intl.aliyuncs.com/compatible-mode/v1',binding.model,false)!).batch,'unsupported_region');
  for(const endpoint of ['https://proxy.example/compatible-mode','https://dashscope.aliyuncs.com/other','http://dashscope.aliyuncs.com/compatible-mode','https://dashscope.aliyuncs.com/compatible-mode?key=secret'])assert.equal(bailianBinding(endpoint,binding.model,false),null);
});
test('native final Schema and Object are distinct wire channels; business rounds retain function tools',()=>{
  const strict=agentChatBody(input,base);assert.equal(strict.response_format?.type,'json_schema');assert.equal(strict.tools,undefined);
  assert.equal((strict.response_format as {json_schema:{strict:boolean}}).json_schema.strict,true);
  assert.doesNotMatch(JSON.stringify(strict.response_format),/uniqueItems/);assert.match(JSON.stringify(final.parameters),/uniqueItems/);
  assert.equal(agentChatBody({...input,outputMode:'json_object'},base).response_format?.type,'json_object');
  const business=agentChatBody({...input,tools:[{...final,name:'search_knowledge'}]},base);
  assert.equal(business.response_format,undefined);assert.equal(business.tools?.[0].function.name,'search_knowledge');
  assert.throws(()=>agentChatBody({...input,outputMode:'json_schema',tools:[]},base),/not_applicable/);
});
test('JSON syntax, complete local Schema and downstream business validation are separate',async()=>{
  assert.throws(()=>parseAgentChat({...payload(),choices:[{message:{content:''},finish_reason:'length'}]}),/Invalid/);
  assert.equal(await toolSchemaIssue(final,'{"text":"建议","ids":[]}'),null);
  assert.equal((await toolSchemaIssue(final,'{"text":3,"ids":[]}'))?.code,'invalid_tool_arguments');
  assert.ok(await toolSchemaIssue(final,'{"text":"建议","ids":["a","a"]}'));
  // Valid JSON/Schema does not establish a business receipt or valid citation.
  assert.equal(await toolSchemaIssue(final,'{"text":"已保存","ids":[]}'),null);
});
test('tool results pair only with pending IDs and reject missing/duplicate/orphan results',()=>{
  const call={role:'assistant' as const,content:'',toolCalls:[{id:'c',name:'lookup',arguments:'{}'}]};
  assert.doesNotThrow(()=>assertToolPairs([call,{role:'tool',callId:'c',content:'read'}]));
  assert.throws(()=>assertToolPairs([call]),/invalid_tool_pair/);
  assert.throws(()=>assertToolPairs([{role:'tool',callId:'c',content:'fake'}]),/invalid_tool_pair/);
  assert.throws(()=>assertToolPairs([call,{role:'tool',callId:'other',content:'fake'}]),/invalid_tool_pair/);
  assert.throws(()=>assertToolPairs([call,{role:'tool',callId:'c',content:'read'},{role:'tool',callId:'c',content:'duplicate'}]),/invalid_tool_pair/);
});
test('typed business parameters can be corrected once before dispatch without replaying unknown service errors',async()=>{
  const tool:ModelTool={name:'propose_requirement_changes',description:'propose only',parameters:{type:'object',properties:{budget:{type:'integer'}},required:['budget'],additionalProperties:false}};
  const checkpoints:AgentCheckpoint[]=[];let writes=0;
  const execute=(throws=false)=>runRenovationAgent({messages:[{role:'user',content:[{type:'text',text:'预算改成十五万，瓷砖先照旧。'}]}],tools:[tool],ports:{
    authorize:async()=>{},checkpoint:async s=>{checkpoints.push(s);},model:async(turn,messages)=>{
      if(turn===2)return answer;if(turn===1)assert.match(JSON.stringify(messages),/invalid_arguments/);
      return {...answer,text:'',toolCalls:[{id:'call-'+turn,name:tool.name,arguments:JSON.stringify({budget:turn?150000:'150000'})}]};
    },tool:async()=>{writes++;if(throws)throw Error('provider_outcome_unknown');return {content:'proposal only; no saved receipt'};},
  }});
  await execute();assert.equal(writes,1);assert.equal(checkpoints.at(-1)?.argumentFailures,1);
  writes=0;await assert.rejects(execute(true),/provider_outcome_unknown/);assert.equal(writes,1);
});
test('cache hit, miss, absent fields and invalid counters never become a fabricated zero fee',()=>{
  const hit=parseAgentChat(payload({prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:80}}));
  assert.equal(hit.usage?.cachedInputTokens,80);assert.equal(cacheObservation(hit.usage).status,'hit');
  assert.equal(cacheObservation(parseAgentChat(payload({prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:0}})).usage).status,'miss');
  const missing=cacheObservation(parseAgentChat(payload()).usage);assert.equal(missing.status,'unavailable');assert.equal(missing.cachedInputTokens,null);assert.equal(missing.actualCost,null);
  assert.throws(()=>parseAgentChat(payload({prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:101}})),/Invalid/);
});
test('stable prefix fingerprints change only for changed systems or tool schemas and contain no source text',()=>{
  const first=modelPrefixObservation(input.messages,input.tools);
  assert.deepEqual(first,modelPrefixObservation([...input.messages,{role:'user',content:[{type:'text',text:'后来呢？'}]}],input.tools));
  assert.notEqual(first.toolSchemaHash,modelPrefixObservation(input.messages,[]).toolSchemaHash);
  assert.doesNotMatch(JSON.stringify(first),/卫生间|JSON packet/);
});
test('one native HTTP dispatch records cache/latency and does not retry an ambiguous failure',async()=>{
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.response_format.type,calls===1?'json_schema':'json_object');return new Response(JSON.stringify(payload({prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:60}})),{status:200});};
    const result=await executeAgentChat(runtime,input);assert.equal(result.observation?.cache.cachedInputTokens,60);assert.ok(Number.isInteger(result.observation?.latencyMs));assert.equal(calls,1);
    assert.deepEqual(result.observation?.format,{mode:'json_schema',jsonValid:true,schemaValid:true});
    const object=await executeAgentChat(runtime,{...input,outputMode:'json_object'});assert.equal(object.observation?.format?.mode,'json_object');
    globalThis.fetch=async()=>{calls++;throw new Error('synthetic connection loss');};
    await assert.rejects(executeAgentChat(runtime,input));assert.equal(calls,3);
  }finally{globalThis.fetch=original;}
});
test('native search sends only public query; supplied history and search prose never become read evidence',async()=>{
  const query={query:'瓷砖执行标准',domains:['example.com']},body=publicSearchBody(bailianSearchBinding(binding),query);
  assert.deepEqual(body.input.messages,[{role:'user',content:[{text:query.query}]}]);assert.equal(body.parameters.enable_search,true);assert.equal(body.parameters.search_options.search_strategy,'turbo');
  assert.throws(()=>publicSearchBody(bailianSearchBinding(binding),{query:'客户姓名: 张三 手机号: 13800138000',domains:[]}),/private_web_query/);
  const response={...payload(),search_info:{search_results:[{title:'标准原文',url:'https://example.com/standard',snippet:'fake claims'}]}};
  assert.equal(nativeSearchCandidates(response).length,1);
  const snapshot=await searchWeb(query,bailianPublicSearch(async()=>response),async url=>({url,type:'text/plain',body:'这是实际读取的公开标准正文。适用条件必须以原文为准，搜索摘要本身不能证明客户现场或企业承诺。'}));
  assert.equal(snapshot.status,'ready');assert.equal(snapshot.pages.length,1);assert.doesNotMatch(snapshot.pages[0].text,/fake claims/);
  const empty=await searchWeb(query,bailianPublicSearch(async()=>({search_info:{search_results:[]}})));assert.equal(empty.status,'empty');
  const missing=await searchWeb(query,bailianPublicSearch(async()=>({choices:[]})));assert.equal(missing.status,'unavailable');
  const failed=await searchWeb(query,bailianPublicSearch(async()=>response),async()=>{throw Error('failed page');});assert.equal(failed.status,'unavailable');assert.equal(failed.failures.length,1);
});
test('Partial Mode preserves prefix and binds owner/version/expiry/epoch/consent; no tools or structured output',()=>{
  const prefix='厨房收纳草稿：',draft:ApprovedDraft={prefix,version:3,prefixHash:fingerprint(prefix),expiresAt:new Date(Date.now()+60000).toISOString(),enterpriseId:'1',ownerId:'2',knowledgeEpoch:4,consentVersion:1,status:'approved'};
  const current={enterpriseId:'1',ownerId:'2',version:3,knowledgeEpoch:4,consentVersion:1};validateDraft(draft,current);
  const body=partialBody(binding,prefix);assert.deepEqual(body.messages[1],{role:'assistant',content:prefix,partial:true});assert.equal(joinDraft(prefix,'先核对常用物品尺寸。'),prefix+'先核对常用物品尺寸。');
  for(const change of [{version:4},{ownerId:'3'},{knowledgeEpoch:5},{consentVersion:2}])assert.throws(()=>validateDraft(draft,{...current,...change}),/stale/);
  assert.throws(()=>validateDraft({...draft,status:'revoked'},current),/stale/);assert.throws(()=>validateDraft(draft,current,Date.now()+120000),/stale/);
  assert.throws(()=>partialBody({...binding,thinking:true},prefix),/invalid_draft_prefix/);
  assert.throws(()=>joinDraft(prefix,'已保存并通知设计师。'),/invalid_draft_continuation/);
});
test('real Batch wire uses upload, asynchronous batch, query, content and cancel with exact IDs',async()=>{
  const original=globalThis.fetch,requests:Array<{url:string;init?:RequestInit}>=[];
  const remote={id:'batch-test',status:'in_progress',input_file_id:'file-test',output_file_id:null,error_file_id:null,metadata:{sfp_task:'1',sfp_hash:'hash'}};
  try {
    globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});const path=new URL(String(url)).pathname;
      return new Response(path.endsWith('/files')?JSON.stringify({id:'file-test'}):path.endsWith('/content')?'synthetic-result':JSON.stringify(remote),{status:200});};
    // PostgreSQL jsonb returns keys in a different order. That cannot change
    // the identity of a persisted provider binding on reentry.
    const reordered=JSON.parse(JSON.stringify(binding,Object.keys(binding).reverse()));
    const transport=bailianOfflineTransport(runtime,reordered);
    const file=await transport.upload('{}\n');await transport.submit(file,remote.metadata);await transport.retrieve(remote.id);await transport.content(file);await transport.cancel(remote.id);
    assert.equal(requests.length,5);assert.ok(requests[0].init?.body instanceof FormData);
    const submission=JSON.parse(String(requests[1].init?.body));assert.equal(submission.endpoint,'/v1/chat/completions');assert.equal(submission.completion_window,'24h');
    assert.ok(requests.every(r=>r.url.startsWith(binding.baseUrl+'/')));assert.match(requests[4].url,/batches\/batch-test\/cancel$/);
  }finally{globalThis.fetch=original;}
});
test('main-path native search binds only the exact Agent runtime and an explicit provider choice never falls back',async()=>{
  const config={model:binding.model,providerKey:'dashscope'};
  assert.deepEqual(nativeSearchBindingFor(runtime,config),{...binding,api:'dashscope-generation',baseUrl:'https://dashscope.aliyuncs.com/api/v1'});
  assert.ok(nativeSearchBindingFor({...runtime,baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode'},config));
  assert.equal(nativeSearchBindingFor(runtime,{...config,model:'qwen3-max'}),null);
  assert.equal(nativeSearchBindingFor({...runtime,modelMappings:{'chat.general':'qwen3-max'}},config),null);
  assert.equal(nativeSearchBindingFor({...runtime,key:'other',adapterConfig:undefined},config),null);
  assert.equal(nativeSearchBindingFor({...runtime,key:'other',adapterConfig:undefined},{...config,providerKey:'other'}),null);
  assert.equal(nativeSearchBindingFor({...runtime,adapterType:'grs'},config),null);
  assert.equal(nativeSearchBindingFor({...runtime,adapterConfig:{providerPreset:'siliconflow'}},config),null);
  assert.equal(nativeSearchBindingFor({...runtime,baseUrl:'https://proxy.example/compatible-mode'},config),null);
  assert.equal(nativeSearchBindingFor(runtime,config,'Qwen/Qwen3.5-4B'),null);
  assert.ok(nativeSearchBindingFor(runtime,config,binding.model));
  // Consultation read_web needs the private discovery candidates, not this provider.
  assert.equal(await resolveNativeSearch({...config,consultation:{} as never}),null);
  const previous=process.env.ASSISTANT_WEB_SEARCH_PROVIDER;
  try {
    process.env.ASSISTANT_WEB_SEARCH_PROVIDER='searxng';
    assert.equal(await selectedNativeSearch({...config,consultation:undefined}),null);
    process.env.ASSISTANT_WEB_SEARCH_PROVIDER='bailian-native';
    assert.equal(await selectedNativeSearch({...config,consultation:{} as never}),null);
  } finally {
    if(previous===undefined)delete process.env.ASSISTANT_WEB_SEARCH_PROVIDER;else process.env.ASSISTANT_WEB_SEARCH_PROVIDER=previous;
  }
});
test('every main-path native search is an audited run attempt; unknown outcomes stay billable and are not retried',()=>{
  const query={query:'瓷砖执行标准',domains:['example.com']},searchBinding=bailianSearchBinding(binding);
  const values=nativeSearchAttemptValues({enterpriseId:1n,runId:2n,runtime,binding:searchBinding,query});
  assert.equal(values.assistantRunId,2n);assert.equal(values.generationId,null);assert.equal(values.status,'created');assert.equal(values.accepted,false);
  assert.equal(values.capability,'chat');assert.equal(values.logicalModelKey,'chat.general');assert.equal(values.remoteModel,binding.model);
  assert.match(String(values.requestFingerprint),/^[0-9a-f]{64}$/);
  // The audit keeps a hash and public domains, never the query transcript.
  assert.doesNotMatch(JSON.stringify(values.metadata),/瓷砖执行标准/);
  const payload={usage:{input_tokens:140,output_tokens:20,prompt_tokens_details:{cached_tokens:80}},request_id:'native'};
  const success=nativeSearchSucceeded({query,binding:searchBinding,payload,requestId:'native',durationMs:12});
  assert.equal(success.status,'succeeded');assert.equal(success.accepted,true);assert.deepEqual(success.actualCost,{measurementKind:'unavailable'});
  assert.equal((success.metadata.cache as {status:string}).status,'hit');assert.equal((success.metadata.usage as {inputTokens:number}).inputTokens,140);
  // A malformed counter is recorded as unavailable usage, not a fabricated zero or a lost acceptance.
  const malformed=nativeSearchSucceeded({query,binding:searchBinding,payload:{usage:{input_tokens:-1,output_tokens:1}},requestId:null,durationMs:1});
  assert.equal(malformed.status,'succeeded');assert.equal(malformed.metadata.usage,null);assert.equal((malformed.metadata.cache as {status:string}).status,'unavailable');
  const rejected=nativeSearchFailure({query,binding:searchBinding,error:new AiProviderError('bad request','HTTP_400','safe_fallback',400),durationMs:3});
  assert.equal(rejected.status,'failed');assert.equal(rejected.accepted,false);assert.equal(rejected.errorCode,'HTTP_400');
  for(const error of [new AiProviderError('deadline','PROVIDER_TIMEOUT','unknown',504),new AiProviderError('timeout','HTTP_408','safe_fallback',408),Error('stream truncated')]) {
    const unknown=nativeSearchFailure({query,binding:searchBinding,error,durationMs:3});
    assert.equal(unknown.status,'unknown');assert.equal(unknown.accepted,true);
  }
});
test('explicit cache is an opt-in exact-binding marker on the leading text system block only',()=>{
  const previous=process.env.ASSISTANT_TEXT_EXPLICIT_CACHE;
  try {
    delete process.env.ASSISTANT_TEXT_EXPLICIT_CACHE;
    assert.equal(explicitCacheControl(runtime,binding.model,false,{messages:input.messages},false),undefined);
    process.env.ASSISTANT_TEXT_EXPLICIT_CACHE='1';
    assert.equal(explicitCacheControl(runtime,binding.model,false,{messages:input.messages},false),'ephemeral_system');
    assert.equal(explicitCacheControl({baseUrl:'https://api.siliconflow.cn'},binding.model,false,{messages:input.messages},false),undefined);
    assert.equal(explicitCacheControl(runtime,binding.model,false,{messages:input.messages},true),undefined);
    assert.equal(explicitCacheControl(runtime,binding.model,false,{messages:[{role:'user',content:[{type:'text',text:'卫生间准备铺砖前需要注意什么？'}]}]},false),undefined);
    assert.equal(explicitCacheControl(runtime,binding.model,false,{messages:[]},false),undefined);
    const marked=agentChatBody({...input,cacheControl:'ephemeral_system'},base);
    const system=marked.messages[0].content as Array<Record<string,unknown>>;
    assert.deepEqual(system.at(-1)?.cache_control,{type:'ephemeral'});
    assert.equal((marked.messages[1].content as Array<Record<string,unknown>>)[0].cache_control,undefined);
    assert.throws(()=>agentChatBody({...input,cacheControl:'ephemeral_system'},'https://api.siliconflow.cn'),/cache_control_not_applicable/);
  } finally {
    if(previous===undefined)delete process.env.ASSISTANT_TEXT_EXPLICIT_CACHE;else process.env.ASSISTANT_TEXT_EXPLICIT_CACHE=previous;
  }
});
test('source-bearing native search binds DashScope Generation and parses its usage without trusting prose',async()=>{
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
      assert.equal((init?.headers as Record<string,string>)['X-DashScope-SSE'],'enable');
      const body=JSON.parse(String(init?.body));assert.equal(body.parameters.search_options.enable_source,true);assert.equal(body.parameters.result_format,'message');assert.equal(body.messages,undefined);
      return new Response('data: '+JSON.stringify({output:{choices:[{finish_reason:'length',message:{content:'这段模型正文不作为证据'}}],search_info:{search_results:[{url:'https://example.com/original',title:'原文'}]}},
        usage:{input_tokens:140,output_tokens:20,prompt_tokens_details:{cached_tokens:80}},request_id:'native-test'})+'\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}});};
    const transport=bailianOfflineTransport(runtime,bailianSearchBinding(binding));
    const response=await transport.search({query:'瓷砖执行标准',domains:[]});assert.equal(calls,1);
    assert.deepEqual(nativeSearchUsage(response.payload),{inputTokens:140,outputTokens:20,cachedInputTokens:80});assert.equal(nativeSearchCandidates(response.payload).length,1);
  }finally{globalThis.fetch=original;}
});
