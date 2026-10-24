import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';
import { modelCitationCatalog, engineeringClaimText } from '../agent/citation-catalog';
import { numericCatalogIndex, numericCitationCandidates } from '../agent/citation-coverage';
import { publicPdfSource } from '../agent/source-document';
import { searchPublicResearch, publicDirectoryQuery, publicReaderParser, type PublicReadDocument } from '../agent/public-research';
import { consultationRuntimeBudget } from '../agent/consultation-profile';
import { synthesisRepairTool, resolveSynthesisRepair } from '../agent/synthesis-repair';
import { agentChatBody, executeAgentChat } from '@/lib/ai/providers/agent-chat';
import { consultationFinalSchemaProtocol } from '@/lib/ai/providers/consultation-final-schema';
import { consultationLongProfile } from '../contracts/consultation';
import type { ModelMessage, ModelTurnInput } from '../contracts/model';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

const output = (text: string) => ({ text, toolCalls: [], usage: null, finishReason: null, providerRequestId: null });

test('summary and perception consume primary allowance within the same five-call schedule',()=>{
  for(const [summaries,perceptions]of [[0,0],[1,0],[0,1],[1,1]]){
    const budget=consultationRuntimeBudget({summaries,perceptions});
    assert.equal(budget.primaryModelTurns+budget.reservedValidationRepairs+budget.auxiliaryCalls,5);
    assert.equal(budget.primaryModelTurns,4-summaries-perceptions);
  }
  assert.throws(()=>consultationRuntimeBudget({summaries:2,perceptions:0}),/assistant_quota_exceeded/);
});

test('durable auxiliary calls reduce graph work and keep the final repair inside five dispatches',async()=>{
  const tool={name:'search_web',description:'public read',parameters:{}};
  for(const summaries of [0,1])for(const perceptions of [0,1]){
    const allocation=consultationRuntimeBudget({summaries,perceptions}),seen:number[]=[],saved:AgentCheckpoint[]=[];
    const ports:AgentRuntimePorts={authorize:async()=>{},checkpoint:async state=>{saved.push(structuredClone(state));},
      tool:async()=>({content:'{}'}),model:async(turn,_messages,available)=>{
        seen.push(turn);
        if(turn<allocation.primaryModelTurns-1)return{...output(''),toolCalls:[{id:'read-'+turn,name:tool.name,arguments:'{}'}]};
        assert.deepEqual(available,[]);
        return output(turn===allocation.primaryModelTurns?'corrected final':'rejected draft');
      },validateFinal:async text=>text==='corrected final'?null:{code:'invalid_model_citation',feedback:'existing catalog coverage'}};
    const input={messages:[],tools:[tool],ports,reservedValidationRepairs:allocation.reservedValidationRepairs,primaryModelTurns:allocation.primaryModelTurns};
    assert.equal((await runRenovationAgent(input)).output?.text,'corrected final');
    assert.equal(seen.length+allocation.auxiliaryCalls,allocation.maxScheduledCalls);
    const repair=saved.find(state=>state.turn===allocation.primaryModelTurns&&!state.output)!;
    assert.equal(repair.primaryModelTurns,allocation.primaryModelTurns);
    if(allocation.primaryModelTurns<4)await assert.rejects(runRenovationAgent({...input,resume:repair,primaryModelTurns:4}),/invalid_agent_checkpoint/);
  }
});

test('consultation reserves one final-only repair after four primary turns and recovers without replaying tools', async () => {
  const tool = { name: 'search_web', description: 'public read', parameters: {} };
  const checkpoints: AgentCheckpoint[] = [], seen: number[] = [];
  const ports: AgentRuntimePorts = {
    authorize: async () => {}, checkpoint: async state => { checkpoints.push(structuredClone(state)); },
    tool: async () => ({ content: '{"status":"ready"}' }),
    model: async (turn, _messages, tools) => {
      seen.push(turn);
      if (turn < 3) return { ...output(''), toolCalls: [{ id: 'read-' + turn, name: tool.name, arguments: JSON.stringify({ query: 'public-' + turn }) }] };
      assert.deepEqual(tools, []);
      return output(turn === 3 ? 'first rejected draft' : 'corrected final');
    },
    validateFinal: async text => text === 'corrected final' ? null : ({ code: 'invalid_model_citation', feedback: 'authorized citation coverage diagnostic' }),
  };
  const request = { messages: [], tools: [tool], ports, reservedValidationRepairs: 1 as const };
  assert.equal((await runRenovationAgent(request)).output?.text, 'corrected final');
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  const saved = checkpoints.find(state => state.turn === 4 && !state.output)!;
  assert.ok(saved); assert.equal(saved.validationRepairs, 1);
  const replayed: number[] = [];
  const resumed = await runRenovationAgent({ ...request, resume: saved,
    ports: { ...ports, model: async (turn, _messages, tools) => { replayed.push(turn); assert.deepEqual(tools, []); return output('corrected final'); } } });
  assert.equal(resumed.output?.text, 'corrected final'); assert.deepEqual(replayed, [4]);
  await assert.rejects(runRenovationAgent({ ...request, resume: { ...saved, validationRepairs: 0 } }), /invalid_agent_checkpoint/);
  await assert.rejects(runRenovationAgent({ ...request, resume: { ...saved, messages: [] } }), /invalid_agent_checkpoint/);
  await assert.rejects(runRenovationAgent({ ...request, reservedValidationRepairs: undefined }), /invalid_model_citation/);
  await assert.rejects(runRenovationAgent({ ...request, ports: { ...ports, validateFinal: async () => ({ code: 'invalid_model_citation', feedback: 'still wrong' }) } }), /invalid_model_citation/);
  let attempts = 0;
  await assert.rejects(runRenovationAgent({ ...request, resume: saved,
    ports: { ...ports, model: async () => { attempts++; throw Error('unknown outcome'); } } }), /unknown outcome/);
  assert.equal(attempts, 1);
});

const original: SynthesisSource = { sourceId: 'W77:1220:0', kind: 'web', title: 'Public installation original',
  text: 'General original conditions.\n' + 'Original introduction and applicability. '.repeat(12) + '\nMoisture maximum 1.5% and 0.3%.\nContact temperature maximum 27°C; gradual change 5°C per day.',
  web: { url: 'https://manufacturer.example.org/install.pdf', title: 'Public installation original', retrievedAt: '2026-10-24T00:00:00Z',
    parser: 'crawl4ai-static-0.9.2+pypdf-6.21.2-v1', textBytes: 800, hash: 'a'.repeat(64),
    document: { mediaType: 'application/pdf', hash: 'b'.repeat(64), bytes: 800, page: 1, pages: 1 } } };

test('web PDF gaps use existing bounded repair; original draft, real quantities and commitments stay rejected', () => {
  const first = modelCitationCatalog(original)[0];
  const raw = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '原文要求含水率不超过1.5%与0.3%，接触温度最高27°C，每天逐步改变5°C。', citations: [{ citationId: first.citationId }] }] });
  assert.throws(() => parseSynthesis(raw, [original]), /unsupported_model_commitment/);
  const issue = synthesisRepairFeedback(raw, [original]);
  assert.ok(issue); assert.match(issue.feedback, /numericSourceCandidates/);
  for (const n of ['1.5', '0.3', '27', '5']) assert.ok(issue.feedback.includes(n));
  assert.throws(() => parseSynthesis(raw, [original]), /unsupported_model_commitment/);
  assert.throws(() => synthesisRepairFeedback(raw.replace('原文要求', '已付款，原文要求'), [original]), /unsupported_model_commitment/);
  assert.equal(publicPdfSource(original), true);
  const forged = structuredClone(original); forged.web!.url = 'http://127.0.0.1/original.pdf';
  assert.equal(publicPdfSource(forged), false);
  assert.equal(engineeringClaimText('见第1页，现场27℃。', [original]), '见原文页，现场27℃。');
  assert.match(engineeringClaimText('见第2页，现场27℃。', [original]), /第2页/);
});

test('numeric span coverage is bounded, literal and candidate-only, rather than four duplicate values', () => {
  const distractors: SynthesisSource[] = Array.from({ length: 8 }, (_, i) => ({ sourceId: 'K' + i, kind: 'knowledge', title: 'Other original', text: 'Other conditions mention 1.5% only.' }));
  const candidates = numericCitationCandidates(['1.5', '0.3', '27', '5'], [...distractors, original]);
  assert.ok(candidates.length <= 4);
  assert.deepEqual(new Set(candidates.flatMap(c => c.valuesInOriginal)), new Set(['1.5', '0.3', '27', '5']));
  for (const candidate of candidates) { assert.equal(candidate.candidateOnly, true); assert.ok(candidate.quote.includes(candidate.valuesInOriginal[0])); }
  assert.deepEqual(numericCitationCandidates(['999999'], [original]), []);
  for (const value of numericCatalogIndex(original).values()) { assert.equal(value.complete, true); assert.ok(value.values.every(n => original.text.includes(n))); }
});

test('original discovery decomposes checked public inputs inside one three-query budget without guessing domains', async () => {
  const queries: string[] = [];
  const query = { query: '苍岭地板 地暖 适用性 安装说明', domains: [] };
  const result = await searchPublicResearch(query, { name: 'searxng', search: async input => {
    queries.push(input.query);
    return input.query === query.query ? [{ url: 'https://directory.example.org/article', title: '通用安装资料' }]
      : [{ url: 'https://manufacturer.example.org/', title: '苍岭地板官方网站' }];
  } }, async () => { throw Error('discovery must not read'); }, undefined, Date.now() + 60000, { runId: '77', sequence: 1210, discoverOnly: true });
  assert.deepEqual(queries, [query.query, '苍岭地板 官网']);
  assert.equal(result.candidates?.[0].url, 'https://manufacturer.example.org/');
  assert.equal(result.pages.length, 0); assert.equal(result.research?.queries.length, 2);
  assert.equal(result.research?.queryPlans?.[0].kind, 'public-prefix-directory');
  assert.deepEqual(publicDirectoryQuery({ query: 'Acme Floors heating installation manual', domains: ['example.org'] }), { query: 'Acme Floors 官网', domains: ['example.org'] });
  assert.equal(publicDirectoryQuery({ query: '普通建议', domains: [] }), null);
  assert.equal(publicDirectoryQuery({ query: 'site:example.org 安装说明', domains: [] }), null);
});

test('a real language-directory link remains eligible ahead of unrelated search roots within existing read bounds',async()=>{
  const root='https://maker.example/',regional='https://region.example/zh-cn/',install=regional+'installation',pdf=regional+'installation.pdf';
  const fetched:string[]=[];
  const document=(url:string,links:PublicReadDocument['links']):PublicReadDocument=>{
    const raw=Buffer.from((url===pdf?'%PDF ':'')+'Clearly labelled synthetic original '+url);
    return{version:1,url,title:'Synthetic navigation original',parser:publicReaderParser,mediaType:url===pdf?'application/pdf':'text/html',
      pages:[{page:1,text:'Synthetic original installation conditions; actual site remains unknown.'}],links,redirects:[],
      original:{sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length,base64:raw.toString('base64')},
      egress:'upstream-v0.9.2-resolve-and-pin-proxy',tlsVerification:true};
  };
  const selected={id:'P77:1200:0',url:root,title:'Synthetic maker directory',parent:null,depth:0};
  const alternatives=[selected,...Array.from({length:6},(_,i)=>({id:'P77:1200:'+(i+1),url:'https://other'+i+'.example/',title:'一般地板资讯',parent:null,depth:0}))];
  const result=await searchPublicResearch({query:'苍岭地板 地暖 安装说明',domains:[]},null,async url=>{
    fetched.push(url);
    if(url===root)return document(url,[{url:regional,title:'中文'},{url:'https://other-language.example/en/',title:'English'}]);
    if(url===regional)return document(url,[{url:install,title:'安装说明'}]);
    if(url===install)return document(url,[{url:pdf,title:'Installation original'}]);
    if(url===pdf)return document(url,[]);
    throw Error('Unrelated branch consumed bounded reads');
  },undefined,Date.now()+60000,{runId:'77',sequence:1210,selected,alternatives});
  assert.deepEqual(fetched,[root,regional,install,pdf]);
  assert.equal(result.research?.reads,4);assert.equal(result.pages[0].document?.mediaType,'application/pdf');
  assert.ok(result.research!.navigation.every(item=>item.depth<=3));
  assert.equal(result.documents?.length,4);
});

function structuredRepairFixture(){
  const raw=JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'原文要求含水率不超过1.5%与0.3%，接触温度最高27°C，每天逐步改变5°C。',citations:[{citationId:modelCitationCatalog(original)[0].citationId}]}]});
  const issue=synthesisRepairFeedback(raw,[original]);assert.ok(issue);
  const messages:ModelMessage[]=[{role:'assistant',content:raw},{role:'system',content:[{type:'text',text:issue.feedback}]}];
  const tool=synthesisRepairTool(messages,modelCitationCatalog(original).map(c=>c.citationId));assert.ok(tool);
  const input:ModelTurnInput={model:consultationLongProfile.model,profile:consultationLongProfile.id,maxTokens:8192,enableThinking:false,requireTool:true,messages,tools:[tool]};
  const baseHash=(tool.parameters.properties as {baseHash:{enum:string[]}}).baseHash.enum[0];
  const edits=[{segment:0,addCitationIds:numericCitationCandidates(['1.5','0.3','27','5'],[original]).map(c=>c.citationId)}];
  return{raw,messages,input,tool,reply:JSON.stringify({kind:'synthesis_repair',baseHash,edits})};
}

test('bound Qwen final dispatch uses its exact dynamic JSON schema without mutating local constraints',()=>{
  const fixture=structuredRepairFixture(),before=JSON.stringify(fixture.input);
  const body=agentChatBody(fixture.input,'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(consultationFinalSchemaProtocol,'qwen37-final-json-schema-v1');
  assert.ok('response_format'in body);assert.equal(body.response_format?.type,'json_schema');
  assert.equal('tools'in body,false);assert.equal('tool_choice'in body,false);assert.equal('parallel_tool_calls'in body,false);
  const format=body.response_format as {json_schema:{strict:boolean;schema:Record<string,unknown>}};
  assert.equal(format.json_schema.strict,true);assert.equal(JSON.stringify(format.json_schema.schema).includes('uniqueItems'),false);
  assert.match(JSON.stringify(fixture.tool.parameters),/uniqueItems/);assert.equal(JSON.stringify(fixture.input),before);
  assert.ok(JSON.stringify(format.json_schema.schema).includes(JSON.parse(fixture.reply).baseHash));
  for(const candidate of numericCitationCandidates(['1.5','0.3','27','5'],[original]))assert.ok(JSON.stringify(format.json_schema.schema).includes(candidate.citationId));
  const business=agentChatBody({...fixture.input,tools:[...fixture.input.tools,{name:'search_web',description:'read',parameters:{type:'object'}}]},'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal('response_format'in business,false);assert.equal(business.tools?.length,2);
  const legacy=agentChatBody({...fixture.input,profile:undefined,maxTokens:128},'https://example.org/v1');
  assert.equal('response_format'in legacy,false);assert.deepEqual(legacy.tool_choice,{type:'function',function:{name:'final_response'}});
});

test('strict-wire output retains local edit-array, hash, unique-ID and numerical guards without coercion',()=>{
  const fixture=structuredRepairFixture(),valid=JSON.parse(fixture.reply);
  const resolved=resolveSynthesisRepair(fixture.reply,fixture.messages,[original],1);
  assert.doesNotThrow(()=>parseSynthesis(resolved,[original]));
  for(const [bad,error] of [[{...valid,edits:JSON.stringify(valid.edits)},/invalid_model_answer/],[{...valid,baseHash:'wrong'},/invalid_model_answer/],
    [{...valid,edits:[{segment:0,addCitationIds:[valid.edits[0].addCitationIds[0],valid.edits[0].addCitationIds[0]]}]},/invalid_model_citation/]] as const)
    assert.throws(()=>resolveSynthesisRepair(JSON.stringify(bad),fixture.messages,[original],1),error);
  assert.throws(()=>parseSynthesis(fixture.raw,[original]),/unsupported_model_commitment/);
});

test('final JSON Schema dispatch makes one mock HTTP call and preserves usage even for a malformed edit payload',async()=>{
  const fixture=structuredRepairFixture(),previous=globalThis.fetch;let calls=0;
  const bad=JSON.stringify({...JSON.parse(fixture.reply),edits:'[]'});
  const runtime={baseUrl:'https://dashscope.aliyuncs.com/compatible-mode',apiKey:'synthetic-only',timeoutMs:1000}as AiProviderRuntimeConfig;
  try{for(const raw of [fixture.reply,bad]){
    const start=calls;
    globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(body.response_format.type,'json_schema');assert.equal('tools'in body,false);
      return new Response(JSON.stringify({id:'synthetic-only',choices:[{message:{content:raw},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:50}}));};
    const output=await executeAgentChat(runtime,fixture.input);assert.equal(calls-start,1);assert.equal(output.text,raw);assert.deepEqual(output.usage,{inputTokens:200,outputTokens:50});assert.deepEqual(output.toolCalls,[]);
    if(raw===bad)assert.throws(()=>resolveSynthesisRepair(output.text,fixture.messages,[original],1),/invalid_model_answer/);
  }}finally{globalThis.fetch=previous;}
});
