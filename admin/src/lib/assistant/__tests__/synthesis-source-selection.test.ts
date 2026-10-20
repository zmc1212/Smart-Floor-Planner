import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeSynthesisSources, parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';

const original='合成原件：高度不低于1800mm；须先核对基层，例外由负责人确认。原字词“锡铂”和 空格 保留。😀';
const sources=knowledgeSynthesisSources([{ref:{type:'knowledge_chunk',id:'1',version:'7'},hash:'original',text:original}]);
const answer=(citation:unknown,text='按合成参考资料，高度不低于1800mm，仍需核对基层及例外。')=>JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text,citations:[citation]}]});

test('explicit full-source selection persists the exact authorized original, not a guessed or corrected quote',()=>{
  assert.equal(sources[0].fullTextCitable,true);const saved=JSON.stringify(sources),raw=answer({sourceId:'K1',quoteFromSource:true});
  const parsed=parseSynthesis(raw,sources);assert.deepEqual(parsed.segments[0].citations,[{sourceId:'K1',quote:original}]);
  assert.equal(JSON.stringify(sources),saved);assert.match(raw,/quoteFromSource/);assert.doesNotMatch(JSON.stringify(parsed),/quoteFromSource/);
  assert.throws(()=>parseSynthesis(answer({sourceId:'K1',quote:original.replace('锡铂','锡箔')}),sources),/invalid_model_citation/);
});

test('unknown, ambiguous, unmarked, oversized and history sources cannot be selected through a full-text flag',()=>{
  const unmarked={...sources[0]};delete unmarked.fullTextCitable;
  const oversized=knowledgeSynthesisSources([{ref:{type:'knowledge_chunk',id:'1'},hash:'x',text:original.repeat(10)}]);assert.equal(oversized[0].fullTextCitable,undefined);
  for(const list of [[unmarked],oversized,[{...sources[0],kind:'history'} as SynthesisSource],[sources[0],{...sources[0]}]])
    assert.throws(()=>parseSynthesis(answer({sourceId:'K1',quoteFromSource:true}),list),/invalid_model_citation/);
  assert.throws(()=>parseSynthesis(answer({sourceId:'unknown',quoteFromSource:true}),sources),/invalid_model_citation/);
});

test('full selection requires exactly the explicit true flag and source identity; a supplied quote cannot be silently replaced',()=>{
  for(const citation of [{sourceId:'K1',quoteFromSource:false},{sourceId:'K1',quoteFromSource:'true'},
    {sourceId:'K1',quoteFromSource:true,quote:original},{sourceId:'K1',quoteFromSource:true,permission:'admin'},
    {sourceId:'K1',quoteFromSource:true,version:'other'},{quoteFromSource:true}])
    assert.throws(()=>parseSynthesis(answer(citation),sources),/invalid_model_citation/);
  assert.doesNotThrow(()=>parseSynthesis(answer({sourceId:'K1',quote:original}),sources),'Legacy exact-string citations remain valid');
});

test('source selection does not license computed quantities, unquoted edition numbers or formal completion',()=>{
  for(const text of ['这个高度还差200mm。','按手册2.0，高度不低于1800mm。','已经验收，可以贴砖。'])
    assert.throws(()=>parseSynthesis(answer({sourceId:'K1',quoteFromSource:true},text),sources),/unsupported_model_commitment/);
});

test('an invalid full-source mode for a known long source receives exact-quote feedback without being accepted',()=>{
  const text='合成工地当前节点是防水。\n'+original.repeat(8),source:SynthesisSource={sourceId:'B1',kind:'project',title:'合成项目',text};
  const raw=answer({sourceId:'B1',quoteFromSource:true},'当前项目为防水阶段，仍需核对检查记录。');
  assert.throws(()=>parseSynthesis(raw,[source]),/invalid_model_citation/);
  const feedback=synthesisRepairFeedback(raw,[source]);assert.ok(feedback);assert.match(feedback.feedback,/合成工地当前节点是防水/);
  assert.throws(()=>parseSynthesis(raw,[source]),/invalid_model_citation/,'Feedback does not promote an unmarked source to full selection');
  assert.doesNotThrow(()=>parseSynthesis(answer({sourceId:'B1',quote:'合成工地当前节点是防水。'},'当前项目为防水阶段，仍需核对检查记录。'),[source]));
  assert.throws(()=>synthesisRepairFeedback(answer({sourceId:'unknown',quoteFromSource:true}),[source]),/invalid_model_citation/);
});
