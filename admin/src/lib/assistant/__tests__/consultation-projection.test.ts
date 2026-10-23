import test from 'node:test';
import assert from 'node:assert/strict';
import {publicDiscoveryQuery} from '../agent/public-research';
import {focusedSynthesisMessages,knowledgeSynthesisSources} from '../agent/synthesis';
import type {ModelMessage,ModelTool} from '../contracts/model';
import {agentBasePolicy,agentOpeningMemoryPrefix,buildAgentContext} from '../agent/context';
import {readMemory} from '../agent/memory';
import {synthesisModelInstructions,synthesisQuestionPrefix} from '../agent/model-policy';
import {projectConsultationModelView} from '../agent/consultation-model-view';
import {compileModelRequest} from '../agent/model-request';
import {consultationLongProfile} from '../contracts/consultation';
import {assertToolPairs} from '../agent/context-budget';
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
  assert.equal(compile(consultationLongProfile.id).contentProjection,'tool-content-artifact-v1');
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
