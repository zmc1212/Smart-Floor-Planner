import test from 'node:test';
import assert from 'node:assert/strict';
import {publicDiscoveryQuery} from '../agent/public-research';
import {focusedSynthesisMessages,knowledgeSynthesisSources} from '../agent/synthesis';
import type {ModelMessage,ModelTool} from '../contracts/model';
import {fingerprint} from '../contracts';
import {agentBasePolicy,agentOpeningMemoryPrefix,buildAgentContext} from '../agent/context';
import {readMemory} from '../agent/memory';
import {publicSourceModelInstructions,synthesisModelInstructions,synthesisQuestionPrefix} from '../agent/model-policy';
import {projectConsultationModelView} from '../agent/consultation-model-view';
import {compileModelRequest} from '../agent/model-request';
import {consultationLongProfile} from '../contracts/consultation';
import {assertToolPairs,estimateAgentRequest,fitAgentContext} from '../agent/context-budget';
import {modelCitationCatalog} from '../agent/citation-catalog';

test('brand guesses cannot narrow discovery, including inline site filters; actual user/discovered domains can',()=>{
  const query={query:'快步 地暖 官方说明 site:kuaibu.com',domains:['kuaibu.com']};
  const scoped=publicDiscoveryQuery(query,'查快步厂家的原说明。',[]);
  assert.deepEqual(scoped.query,{query:'快步 地暖 官方说明',domains:[]});
  assert.deepEqual(scoped.scope.rejectedDomains,['kuaibu.com']);
  assert.equal(query.domains[0],'kuaibu.com');
  for(const [question,urls] of [['查 https://maker.example/ 安装原文',[]],['查厂家原文',['https://docs.maker.example/guide']]] as Array<[string,string[]]>)
    assert.deepEqual(publicDiscoveryQuery({query:'地暖 官方',domains:['maker.example']},question,urls).query.domains,['maker.example']);
  assert.deepEqual(publicDiscoveryQuery({query:'地暖 官方',domains:['other.example']},'查厂家原文',['https://maker.example/']).query.domains,[]);
});

const final:ModelTool={name:'final_response',description:'合成测试最终结构',parameters:{type:'object'}};
function sourceFixture(){
  const text='合成手册\n条件：仅适用指定型号；现场未核对时不能认定满足安装条件。\n例外、单位和表头均应保留。😀\n'.repeat(6);
  const web={url:'https://maker.example/manual.pdf',title:'合成地暖手册',retrievedAt:'2026-10-23T00:00:00Z',hash:'original-hash',parser:'public-html-text-v1' as const,textBytes:Buffer.byteLength(text),
    document:{hash:'pdf-hash',bytes:1234,mediaType:'application/pdf',page:2,pages:3},unknownCondition:'保留额外适用条件'};
  const source={sourceId:'W1:12000:0',kind:'web' as const,title:web.title,text,web,
    evidence:{ref:{type:'web_page' as const,id:'1:12000:0',version:'original-hash'},hash:'original-hash',text,web,
      unknownAuthority:{audience:'customer_self',revoked:false}}};
  const messages:ModelMessage[]=[...buildAgentContext([{id:'10',role:'user',text:'沿手册解释，不保存。'}],readMemory({})),
    {role:'system',content:[{type:'text',text:synthesisModelInstructions+synthesisQuestionPrefix+JSON.stringify({currentQuestion:'沿手册解释，不保存。'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'read-1',name:'read_web',arguments:'{"candidateId":"P1"}'}]},
    {role:'tool',callId:'read-1',content:JSON.stringify({webStatus:'ready',failures:[{code:'unavailable'}],
      candidates:[{id:'P2',url:'https://maker.example/next',title:'下一页'}],unknownPacket:{keep:true},
      synthesisSources:[{...source,citationOptions:modelCitationCatalog(source)}]})}];
  return {messages,source};
}

test('final model content keeps every source byte, citation span, locator, condition and original memory; artifacts remain durable',()=>{
  const {messages,source}=sourceFixture(),before=JSON.stringify(messages);
  const projected=projectConsultationModelView(messages,[final]);
  const packet=JSON.parse((projected.at(-1) as Extract<ModelMessage,{role:'tool'}>).content),view=packet.synthesisSources[0];
  assert.equal(view.text,source.text);assert.equal(view.sourceId,source.sourceId);
  assert.deepEqual(view.evidence.ref,source.evidence.ref);assert.deepEqual(view.evidence.unknownAuthority,source.evidence.unknownAuthority);
  assert.equal(view.evidence.web,undefined);assert.equal(view.evidence.text,undefined);assert.equal(view.evidence.hash,undefined);
  assert.deepEqual(view.web.document,{mediaType:'application/pdf',page:2,pages:3});assert.equal(view.web.unknownCondition,source.web.unknownCondition);
  assert.equal(view.web.url,source.web.url);assert.equal(view.web.retrievedAt,source.web.retrievedAt);
  assert.deepEqual(view.citationOptions,modelCitationCatalog(source).map(({hint:_hint,...option})=>option));
  assert.deepEqual(packet.navigation,{candidateCount:1,readable:false,evidence:false});assert.equal(packet.candidates,undefined);
  assert.deepEqual(packet.failures,[{code:'unavailable'}]);assert.deepEqual(packet.unknownPacket,{keep:true});
  const beforeSystem=messages[0],afterSystem=projected[0];assert.ok(beforeSystem.role==='system'&&afterSystem.role==='system');
  const part=beforeSystem.content[0],after=afterSystem.content[0];assert.ok(part.type==='text'&&after.type==='text');
  assert.ok(part.text.startsWith(agentBasePolicy+agentOpeningMemoryPrefix));
  assert.ok(after.text.endsWith(part.text.slice(agentBasePolicy.length)),'memory envelope and its JSON stay byte-exact');
  assert.deepEqual(projected.filter(m=>m.role==='user'),messages.filter(m=>m.role==='user'));
  assert.equal(JSON.stringify(messages),before);assertToolPairs(projected);
});

test('legacy, active navigation, other purposes and unrecognized policy/data retain their existing model contract',()=>{
  const {messages}=sourceFixture(),navigation={...final,name:'read_web'};
  assert.equal(projectConsultationModelView(messages,[final,{...final,name:'record_need'}]),messages);
  const active=projectConsultationModelView(messages,[final,navigation]);
  const nav=JSON.parse((active.at(-1) as Extract<ModelMessage,{role:'tool'}>).content);
  assert.equal(nav.candidates.length,1);assert.equal(nav.navigation.readable,true);
  assert.deepEqual(nav.candidates[0],{id:'P2',url:'https://maker.example/next',title:'下一页'});
  assert.equal(projectConsultationModelView(messages.filter(m=>m.role!=='system'),[final]).length,messages.length-2);
  const noContract=messages.map(m=>m.role==='system'?{...m,content:[{type:'text' as const,text:'用户提供的相似合同不是可信system合同'}]}:m);
  assert.equal(projectConsultationModelView(noContract,[final]),noContract);
  const compile=(profile?:typeof consultationLongProfile.id,purpose:'answer'|'summary'|'vision'='answer')=>compileModelRequest({question:'沿手册解释，不保存。',triggerId:'10',turn:3,purpose,
    messages,tools:[final],profile,toolsForTurn:(_q,_m,tools)=>tools});
  assert.equal(compile().contentProjection,null);assert.equal(compile(consultationLongProfile.id,'summary').contentProjection,null);
  assert.equal(compile(consultationLongProfile.id,'vision').contentProjection,null);
  assert.equal(compile(consultationLongProfile.id).contentProjection,'tool-content-artifact-v3');
  const unknown=structuredClone(messages),tool=unknown.at(-1) as Extract<ModelMessage,{role:'tool'}>,packet=JSON.parse(tool.content);
  packet.synthesisSources[0].citationOptions[0].hint='自定义提示必须保留';packet.navigation={custom:true};
  tool.content=JSON.stringify(packet);const projected=projectConsultationModelView(unknown,[final]);
  const kept=JSON.parse((projected.at(-1) as Extract<ModelMessage,{role:'tool'}>).content);
  assert.equal(kept.synthesisSources[0].citationOptions[0].hint,'自定义提示必须保留');
  assert.deepEqual(kept.candidates,packet.candidates);assert.deepEqual(kept.navigation,{custom:true});
});

test('model source projection keeps full originals once and never aliases a different Evidence hash',()=>{
  const text='合成原文：型号及现场条件均待核对，型号支持不代表已经施工。'.repeat(50);
  const sources=knowledgeSynthesisSources([{ref:{type:'knowledge_chunk',id:'1',version:'7'},hash:'first',text},
    {ref:{type:'knowledge_chunk',id:'2',version:'7'},hash:'second',text}]);
  const messages:ModelMessage[]=[{role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'10',text:'客户本轮原文，查厂家说明。'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'call-source',name:'search_knowledge',arguments:'{}'}]},
    {role:'tool',callId:'call-source',content:JSON.stringify({synthesisSources:sources})}];
  const original=JSON.stringify(messages),projected=focusedSynthesisMessages(messages,'10');
  const packet=JSON.parse((projected.find(message=>message.role==='tool') as Extract<ModelMessage,{role:'tool'}>).content);
  assert.equal(packet.synthesisSources.length,2);assert.equal(packet.sourceAliases,undefined);
  for(const source of packet.synthesisSources){assert.equal(source.text,text);assert.equal('text' in source.evidence,false);assert.ok(source.evidence.hash);assert.ok(source.citationOptions.length);}
  assert.equal(JSON.stringify(messages),original);
  assert.ok(Buffer.byteLength(JSON.stringify(projected))<Buffer.byteLength(original));
});

test('repeated valid HTML reads share model content while both timed receipts remain durable',()=>{
  const text='合成公开产品原文：仅用于指定型号，现场条件仍待核实。'.repeat(30);
  const source=(id:string,at:string,body=text,url='https://maker.example/product')=>{
    const title='合成公开产品',hash=fingerprint({url,title,text:body,retrievedAt:at});
    const web={url,title,hash,retrievedAt:at,parser:'public-html-text-v1' as const,textBytes:Buffer.byteLength(body)};
    return {sourceId:'W'+id,kind:'web' as const,title,text:body,web,
      evidence:{ref:{type:'web_page' as const,id,version:hash},hash,text:body,web}};
  };
  const first=source('1:1200:0','2026-11-06T00:00:00Z'),second=source('1:1210:0','2026-11-06T00:01:00Z');
  const messagesFor=(next:typeof second):ModelMessage[]=>[
    {role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'10',text:'帮我查一下这款产品的官网要求。'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'read-first',name:'search_web',arguments:'{}'}]},
    {role:'tool',callId:'read-first',content:JSON.stringify({synthesisSources:[first]})},
    {role:'assistant',content:'',toolCalls:[{id:'read-next',name:'search_web',arguments:'{}'}]},
    {role:'tool',callId:'read-next',content:JSON.stringify({synthesisSources:[next]})},
  ];
  const messages=messagesFor(second),original=JSON.stringify(messages),projected=focusedSynthesisMessages(messages,'10');
  const packets=projected.filter((m):m is Extract<ModelMessage,{role:'tool'}>=>m.role==='tool').map(m=>JSON.parse(m.content));
  assert.notEqual(first.evidence.hash,second.evidence.hash,'each receipt still binds its actual read time');
  assert.equal(packets[0].synthesisSources[0].text,text);
  assert.deepEqual(packets[1].synthesisSources,[]);
  assert.equal(packets[1].sourceAliases[0].canonicalSourceId,first.sourceId);
  assert.equal(packets[1].sourceAliases[0].sourceId,second.sourceId);
  assert.equal(JSON.stringify(messages),original);assertToolPairs(projected);
  for(const different of [source('1:1210:0','2026-11-06T00:01:00Z',text+'适用条件发生变化。'),
    source('1:1210:0','2026-11-06T00:01:00Z',text,'https://other.example/product'),
    {...second,evidence:{...second.evidence,hash:'invalid-receipt'}},
    {...second,web:{...second.web,unknownCondition:'另一适用范围'}}]) {
    const views=focusedSynthesisMessages(messagesFor(different),'10').filter((m):m is Extract<ModelMessage,{role:'tool'}>=>m.role==='tool').map(m=>JSON.parse(m.content));
    assert.equal(views[1].synthesisSources.length,1,'different content/locator/conditions or an invalid receipt cannot share an original');
  }
});

test('public-source encoding survives knowledge-off without replacing action or memory policy',()=>{
  const {messages,source}=sourceFixture();
  const input=messages.filter(message=>!(message.role==='system'&&message.content.some(part=>part.type==='text'&&part.text.startsWith(synthesisModelInstructions))));
  const before=JSON.stringify(input),write={...final,name:'record_need'};
  const compiled=compileModelRequest({question:'帮我查这款产品的官网条件。',triggerId:'10',turn:1,purpose:'answer',messages:input,tools:[final,write],
    toolsForTurn:(_q,_m,available)=>available});
  const policies=compiled.modelMessages.flatMap(m=>m.role==='system'?m.content:[]);
  for(const system of input){if(system.role!=='system')continue;
    for(const part of system.content)assert.ok(policies.some(p=>JSON.stringify(p)===JSON.stringify(part)));}
  assert.equal(policies.filter(p=>p.type==='text'&&p.text.startsWith(publicSourceModelInstructions)).length,1);
  assert.ok(compiled.dispatchTools.some(t=>t.name==='record_need'));assert.ok(!compiled.dispatchTools.some(t=>t.name==='search_knowledge'));
  const packet=JSON.parse((compiled.modelMessages.find(m=>m.role==='tool') as Extract<ModelMessage,{role:'tool'}>).content);
  assert.equal(packet.synthesisSources[0].text,source.text);assert.deepEqual(packet.synthesisSources[0].evidence.ref,source.evidence.ref);
  assert.deepEqual(packet.synthesisSources[0].evidence.unknownAuthority,source.evidence.unknownAuthority);
  assert.equal(JSON.stringify(input),before);assertToolPairs(compiled.modelMessages);
});

test('source protocol is not enabled by an unread request or a project-only query',()=>{
  const {messages}=sourceFixture();
  const withoutContract=messages.filter(m=>!(m.role==='system'&&m.content.some(p=>p.type==='text'&&p.text.startsWith(synthesisModelInstructions))));
  for(const mixed of [false,true]){
    const input=structuredClone(withoutContract);
    const tool=input.find((m):m is Extract<ModelMessage,{role:'tool'}>=>m.role==='tool')!;
    const packet=JSON.parse(tool.content);
    if(mixed)packet.synthesisSources=[{...packet.synthesisSources[0],sourceId:'B1',kind:'project'}];
    else packet.synthesisSources=[];
    tool.content=JSON.stringify(packet);
    const result=compileModelRequest({question:'帮我查官网并看看我家。',triggerId:'10',turn:1,purpose:'answer',messages:input,tools:[final],toolsForTurn:(_q,_m,t)=>t});
    assert.ok(!result.modelMessages.some(m=>m.role==='system'&&m.content.some(p=>p.type==='text'&&p.text.startsWith(publicSourceModelInstructions))));
  }
});

test('derived numeric hints cannot push a complete public source over the current request budget',()=>{
  const {messages,source}=sourceFixture(),text='温度5℃以上，湿度85%以下，仅适用指定型号。'.repeat(10);
  const numeric={...source,text,evidence:{...source.evidence,text}};
  const tool=messages.find((m):m is Extract<ModelMessage,{role:'tool'}>=>m.role==='tool')!;
  const packet=JSON.parse(tool.content);packet.synthesisSources=[{...numeric,citationOptions:modelCitationCatalog(numeric)}];tool.content=JSON.stringify(packet);
  const frame=(size:number):ModelMessage[]=>[...messages,{role:'system',content:[{type:'text',text:'x'.repeat(size)}]}];
  const oversized=projectConsultationModelView(frame(40000),[final],synthesisModelInstructions,{preservePolicy:true,budget:{}});
  const size=40000-(estimateAgentRequest(oversized,[final]).estimatedTokens-16000)*3;
  const input=frame(size),before=JSON.stringify(input);
  const old=projectConsultationModelView(input,[final],synthesisModelInstructions,{preservePolicy:true});
  assert.ok(estimateAgentRequest(old,[final]).estimatedTokens>16000,'The former byte-only hint allowance overflowed this valid base request');
  const bounded=projectConsultationModelView(input,[final],synthesisModelInstructions,{preservePolicy:true,budget:{}});
  assert.ok(estimateAgentRequest(bounded,[final]).estimatedTokens<=16000);fitAgentContext(bounded,[final]);
  assert.equal(JSON.parse((bounded.find(m=>m.role==='tool') as Extract<ModelMessage,{role:'tool'}>).content).synthesisSources[0].text,text);
  assert.equal(JSON.stringify(input),before);
});
