import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fingerprint} from '../contracts';
import {parseSynthesis,synthesisRepairFeedback,type SynthesisSource} from '../agent/synthesis';
import {sourceCitationCatalog} from '../agent/citation-catalog';
import {resolveSynthesisRepair} from '../agent/synthesis-repair';
import type {ModelMessage} from '../contracts/model';

const currentText='更正：预算改为18万元。',oldText='请记下：全屋预算20万元，客厅保留阅读角。';
const originalHash=fingerprint({version:1,blocks:[{type:'text',text:currentText}]});
const current:SynthesisSource={sourceId:'H10204',kind:'history',title:'客户历史原话',text:currentText,
  history:{messageId:'10204',hash:originalHash,memoryVersion:6,seq:'4'}};
const old:SynthesisSource={sourceId:'H10199',kind:'history',title:'客户历史原话',text:oldText,
  history:{messageId:'10199',hash:fingerprint(oldText),memoryVersion:6,seq:'2'}};
const id=(s:SynthesisSource)=>sourceCitationCatalog(s)[0].citationId;
const context={currentQuestion:'我当前预算记的是多少？',currentNeeds:{version:6,
  facts:[{sourceMessageId:'10204',sourceHash:originalHash,quote:'更正：预算改为18万元',value:'18万元'}]}};
const first=()=>JSON.stringify({kind:'synthesis',segments:[
  {basis:'evidence',text:'根据您在本咨询中的记录，当前预算为18万元。',citations:[{citationId:id(current)}]},
  {basis:'advice',text:'此前曾记录过20万元预算，后已更正为18万元。',citations:[{citationId:id(old)}]},
]});

test('current need numeric gap offers one explicit citation edit for an authorized prior original',()=>{
  const raw=first(),before=JSON.stringify([current,old]);
  assert.throws(()=>parseSynthesis(raw,[current,old],context),/unsupported_model_commitment/);
  const issue=synthesisRepairFeedback(raw,[current,old],context)!;
  assert.match(issue.feedback,/currentNeedNumericPaths/);assert.match(issue.feedback,/segments\[1\]\.text/);
  assert.ok(issue.feedback.includes(id(current)));assert.equal(JSON.stringify([current,old]),before);
  assert.throws(()=>parseSynthesis(raw,[current,old],context),/unsupported_model_commitment/);
});

test('current need numeric recovery lets only the model cite or remove its extra comparison',()=>{
  const raw=first(),issue=synthesisRepairFeedback(raw,[current,old],context)!;
  const messages:ModelMessage[]=[{role:'assistant',content:raw},{role:'system',content:[{type:'text',text:issue.feedback}]}];
  for(const edit of [{segment:1,addCitationIds:[id(current)]},{segment:1,remove:true}]){
    const fixed=resolveSynthesisRepair(JSON.stringify({kind:'synthesis_repair',baseHash:fingerprint(raw),edits:[edit]}),messages,[current,old],1);
    const answer=parseSynthesis(fixed,[current,old],context);assert.equal(answer.segments[0].text,'根据您在本咨询中的记录，当前预算为18万元。');
  }
  assert.throws(()=>resolveSynthesisRepair(JSON.stringify({kind:'synthesis_repair',baseHash:'wrong',edits:[{segment:1,remove:true}]}),messages,[current,old],1),/invalid_model_answer/);
});

test('current need numeric recovery requires matching identity hash memory version quote and value',()=>{
  for(const review of [{},{currentQuestion:context.currentQuestion},{...context,currentNeeds:{...context.currentNeeds,version:5}},
    ...[{sourceMessageId:'other'},{sourceHash:'changed'},{quote:'另一句18万元'},{value:'30万元'}].map(change=>({...context,currentNeeds:{version:6,facts:[{...context.currentNeeds.facts[0],...change}]}}))]){
    assert.throws(()=>synthesisRepairFeedback(first(),[current,old],review),/unsupported_model_commitment/);
  }
  for(const changed of [{...current,sourceId:'Hother'},{...current,kind:'project' as const},{...current,history:undefined}]){
    // Keep the rejected draft's catalog selection valid while invalidating its recovery authority.
    const raw=JSON.parse(first());raw.segments[0].citations=[{citationId:id(changed)}];
    assert.throws(()=>synthesisRepairFeedback(JSON.stringify(raw),[changed,old],context),/unsupported_model_commitment/);
  }
});

test('current need numeric recovery cannot use an unrelated number in a full original or positive commitments',()=>{
  const wider={...current,text:currentText+'另有未经量测的假设宽度30米。'};
  const raw=JSON.parse(first());raw.segments[0].citations=[{citationId:id(wider)}];raw.segments[1].text='建议宽度为30米。';raw.segments[1].citations=[];
  assert.throws(()=>synthesisRepairFeedback(JSON.stringify(raw),[wider,old],context),/unsupported_model_commitment/);
  for(const text of ['当前预算为18万元，已经正式验收。','已联系设计师，预算18万元。']){
    raw.segments[1].text=text;
    assert.throws(()=>synthesisRepairFeedback(JSON.stringify(raw),[wider,old],context),/unsupported_model_commitment/);
  }
});

test('current need numeric recovery keeps unknown and ambiguous catalog sources closed',()=>{
  const raw=JSON.parse(first());raw.segments[1].citations=[{citationId:'unknown'}];
  assert.throws(()=>synthesisRepairFeedback(JSON.stringify(raw),[current,old],context),/invalid_model_citation/);
  assert.throws(()=>synthesisRepairFeedback(first(),[current,{...current,text:'预算18万元的另一个来源'},old],context),/invalid_model_citation/);
});
