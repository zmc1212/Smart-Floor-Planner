import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseGeneralReport,generalReportMessages} from '@/lib/construction/report-general-advice';
import type {ComposedProject} from '@/lib/construction/report-composition';
import {parseSynthesis,synthesisRepairFeedback,synthesisModelMessages,type SynthesisSource} from '../agent/synthesis';
import {sourceCitationCatalog} from '../agent/citation-catalog';
import {runRenovationAgent} from '../agent/runtime';
import {synthesisRepairBase,finalAnswerRepairBase} from '../agent/synthesis-repair';
import type {ModelTurnOutput,ModelMessage} from '../contracts/model';
import {projectFinalToolOutput} from '../agent/final-output';

const projects=[{projectId:'one',selection:{},context:{version:1,knowledge:[],snapshots:[],sources:[]}}] as unknown as ComposedProject[];
const stage={projectId:'one',name:'水电'};
const reminder=JSON.stringify({P1:['当前阶段为水电（utilities），建议重点核对强弱电线路的绝缘电阻测试记录及水管打压试验结果，确保隐蔽工程无渗漏或断路隐患。','水电改造完成后、封槽前，请确认所有点位开关插座位置符合最终家具布局需求，避免后期因尺寸不符导致无法使用。']});
test('original rejected stage draft accepts only the matching server-bound current event; historical and other-project facts do not authorize it',()=>{
 assert.throws(()=>parseGeneralReport(reminder,projects),/ungrounded_response_scope/);
 const body=parseGeneralReport(reminder,projects,stage);
 assert.equal(body.projects[0].sections.standards.segments[0].text,JSON.parse(reminder).P1[0]);
 for(const authority of [{projectId:'other',name:'水电'},{projectId:'one',name:'安装'}])assert.throws(()=>parseGeneralReport(reminder,projects,authority),/ungrounded_response_scope/);
 const input=JSON.stringify(generalReportMessages({kind:'stage'},projects,stage));assert.match(input,/stageName.*水电/);
 assert.ok(!JSON.stringify(generalReportMessages({kind:'weekly'},projects)).includes('stageName'));
});
test('a current-stage field never authorizes contact configuration, construction quantities or formal receipts',()=>{
 for(const text of ['当前阶段为安装。','阶段联系电话已配置。','当前阶段为水电，压力必须达到8MPa。','当前阶段为水电，已经验收。'])
  assert.throws(()=>parseGeneralReport(JSON.stringify({P1:[text]}),projects,stage));
});

const source:SynthesisSource={sourceId:'Wfixture:1200:0',kind:'web',title:'公开基层处理原文',text:'旧墙面掉粉时，应先检查基层牢固程度，再根据基层情况处理松动和粉化部分。'};
const citationId=sourceCitationCatalog(source)[0].citationId;
const answer=(text:string,id=citationId)=>JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text,citations:[{citationId:id}]}]});
const invalid=answer('原文要求腻子厚度必须达到8mm。'),valid=answer('旧墙面掉粉时，先检查基层牢固程度，再处理松动和粉化部分。');
const context={generalKnowledge:true,currentQuestion:'卧室墙面摸着掉粉，想重新刷漆，通常先处理什么？'};
const output=(text:string):ModelTurnOutput=>({text,toolCalls:[],finishReason:'stop',providerRequestId:'fixture',usage:null});
test('a quoted web numeric error remains rejected but can use the original one complete-answer repair without an edit language',async()=>{
 assert.throws(()=>parseSynthesis(invalid,[source],context),/unsupported_model_commitment/);
 const issue=synthesisRepairFeedback(invalid,[source],context);assert.ok(issue);assert.ok(!issue.feedback.includes('有界编辑协议'));
 let calls=0,repairs=0;
 const result=await runRenovationAgent({messages:[{role:'user',content:[{type:'text',text:context.currentQuestion}]}],tools:[],ports:{
  authorize:async()=>{},checkpoint:async()=>{},tool:async()=>{throw Error('repair cannot execute a business tool');},
  model:async(_turn,messages,tools)=>{calls++;if(calls===2){repairs++;assert.equal(synthesisRepairBase(messages),null);assert.ok(finalAnswerRepairBase(messages));assert.equal(tools.length,0);}return output(calls===1?invalid:valid);},
  validateFinal:async raw=>synthesisRepairFeedback(raw,[source],context),
 }});
 assert.equal(calls,2);assert.equal(repairs,1);assert.doesNotThrow(()=>parseSynthesis(result.output!.text,[source],context));
 assert.throws(()=>parseSynthesis(invalid,[source],context),/unsupported_model_commitment/);
});
test('the complete-answer path never retries twice or invents an authorized citation',async()=>{
 let calls=0;
 await assert.rejects(()=>runRenovationAgent({messages:[{role:'user',content:[{type:'text',text:context.currentQuestion}]}],tools:[],ports:{
  authorize:async()=>{},checkpoint:async()=>{},tool:async()=>{throw Error('repair cannot execute a business tool');},model:async()=>{calls++;return output(invalid);},validateFinal:async raw=>synthesisRepairFeedback(raw,[source],context),
 }}),/unsupported_model_commitment/);
 assert.equal(calls,2);
 assert.throws(()=>synthesisRepairFeedback(answer('旧墙面先检查基层。','foreign-citation'),[source],context),/invalid_model_citation/);
});

test('preflight budgets the same full-source model view without counting the durable Evidence text twice',()=>{
 const original={...source,evidence:{ref:{type:'web_page',id:'fixture',version:'hash'},text:source.text,hash:'hash'}} as SynthesisSource;
 const messages:ModelMessage[]=[{role:'assistant',content:'',toolCalls:[{id:'restore',name:'restore_sources',arguments:'{}'}]},
  {role:'tool',callId:'restore',content:JSON.stringify({synthesisSources:[original]})}];
 const before=JSON.stringify(messages),view=synthesisModelMessages(messages),projected=JSON.parse((view[1] as {content:string}).content).synthesisSources[0];
 assert.equal(projected.text,source.text);assert.equal(projected.evidence.text,undefined);
 assert.deepEqual(projected.citationOptions.map((c:{citationId:string})=>c.citationId),sourceCitationCatalog(original).map(c=>c.citationId));
 assert.equal(JSON.stringify(messages),before);assert.ok(Buffer.byteLength(JSON.stringify(view))<Buffer.byteLength(before));
});

test('existing exact-ID carrier accepts both final channels without changing content, selections or foreign-ID rejection',()=>{
 const raw=JSON.parse(valid);raw.segments[0].citations=[citationId];const text=JSON.stringify(raw);
 for(const packet of [output(text),{...output(''),toolCalls:[{id:'final',name:'final_response',arguments:text}]}]){
  const before=JSON.stringify(packet),projected=projectFinalToolOutput(packet,true);
  const value=JSON.parse(projected.text);assert.equal(value.segments[0].text,raw.segments[0].text);
  assert.deepEqual(value.segments[0].citations,[{citationId}]);assert.equal(JSON.stringify(packet),before);
  assert.doesNotThrow(()=>parseSynthesis(projected.text,[source],context));
 }
 const unknown=JSON.parse(text);unknown.segments[0].citations=['foreign'];
 assert.throws(()=>parseSynthesis(projectFinalToolOutput(output(JSON.stringify(unknown)),true).text,[source],context),/invalid_model_citation/);
});
