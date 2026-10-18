import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerExcerpts, parseAnswer, parseSelection } from '../knowledge/answer';
import type { Evidence } from '../contracts';
const evidence:Evidence[]=[{ref:{type:'knowledge_chunk',id:'41',version:'7'},hash:'h',text:'腻子干燥打磨后按底漆和面漆工艺施工。具体项目验收须现场确认。'}];
test('selection renders only complete authorized source sentences and server-owned citations',()=>{
  const answer=parseSelection('{"selections":["E1"]}',evidence);
  assert.deepEqual(answer.segments,[{text:'腻子干燥打磨后按底漆和面漆工艺施工。',citations:[{sourceId:'41',quote:'腻子干燥打磨后按底漆和面漆工艺施工。'}]}]);
  assert.equal(parseSelection('{"selections":[]}',evidence).answerKind,'insufficient_evidence');
});
test('valid citations cannot authorize extra explanations, external facts or removed qualifiers',()=>{
  for(const text of ['未干腻子附着力不足，会导致起皮气泡。','项目验收合格。','腻子干燥打磨后按底漆和面漆工艺施工。因为这是施工规范。']) {
    assert.throws(()=>parseAnswer(JSON.stringify({answerKind:'grounded',segments:[{text,citations:[{sourceId:'41',quote:evidence[0].text}]}]}),evidence),/invalid_model_answer/);
  }
});
test('forged or duplicate selections and free model prose fail closed',()=>{
  for(const raw of ['{"selections":["E999"]}','{"selections":["E1","E1"]}','{"selections":[1]}','{"selections":["E1"],"explanation":"extra"}','建议立即入住 {"selections":["E1"]}'])assert.throws(()=>parseSelection(raw,evidence),/invalid_model_/);
  assert.equal(answerExcerpts([{...evidence[0],text:'长'.repeat(401)+'。'}]).length,0);
});

const faqAnswer='水电开工前，先和施工负责人完成现场勘测及交底，把施工图纸、工程项目和施工费用确认清楚。具体项目验收须现场确认。';
const faqEvidence:Evidence[]=[{...evidence[0],text:`问：水电开工前，我需要确认什么？\n答：${faqAnswer}`}];
test('FAQ selects one complete answer without echoing its question or answer label',()=>{
  const excerpts=answerExcerpts(faqEvidence);
  assert.equal(excerpts.length,1);
  assert.equal(excerpts[0].question,'水电开工前，我需要确认什么？');
  assert.equal(excerpts[0].text,faqAnswer);
  const answer=parseSelection('{"selections":["E1"]}',faqEvidence);
  assert.deepEqual(answer.segments,[{text:faqAnswer,citations:[{sourceId:'41',quote:faqAnswer}]}]);
  assert.ok(faqEvidence[0].text.includes(answer.segments[0].citations[0].quote));
});

test('multiple FAQs in one chunk keep exact citation spans without reintroducing question labels',()=>{
  const second='开工前还应确认成品保护。';
  const sources=[{...faqEvidence[0],text:faqEvidence[0].text+`\n\n问：成品怎么保护？\n答：${second}`}];
  const answer=parseSelection('{"selections":["E1","E2"]}',sources);
  assert.equal(answer.segments.length,1);
  assert.equal(answer.segments[0].text,faqAnswer+'\n\n'+second);
  assert.ok(sources[0].text.includes(answer.segments[0].citations[0].quote));
  assert.match(answer.segments[0].citations[0].quote,/问：成品怎么保护/);
});

test('identical selected answers across sources appear once; distinct necessary supplements remain',()=>{
  const sources=[...faqEvidence,{...faqEvidence[0],ref:{...evidence[0].ref,id:'42'}},{...evidence[0],ref:{...evidence[0].ref,id:'43'},text:'施工过程中还应保留检查记录。'}];
  const answer=parseSelection('{"selections":["E1","E2","E3"]}',sources);
  assert.deepEqual(answer.segments.map(s=>s.text),[faqAnswer,'施工过程中还应保留检查记录。']);
  assert.deepEqual(answer.segments.map(s=>s.citations[0].sourceId),['41','43']);
});

test('an unanswered FAQ question is never offered as an answer; chunk-start answer labels are omitted',()=>{
  assert.deepEqual(answerExcerpts([{...evidence[0],text:'问：水电开工前，需要确认什么？'}]),[]);
  assert.deepEqual(answerExcerpts([{...evidence[0],text:'问：水电开工前，需要确认什么？费用如何交底？'}]),[]);
  const sources=[{...evidence[0],text:'答：开工前应确认施工图纸。'}];
  assert.equal(parseSelection('{"selections":["E1"]}',sources).segments[0].text,'开工前应确认施工图纸。');
});

test('FAQ framing cleanup cannot authorize invented text or removal of an answer qualification',()=>{
  for(const text of [faqAnswer.replace('具体项目验收须现场确认。',''),faqAnswer+'保证验收通过。']) {
    assert.throws(()=>parseAnswer(JSON.stringify({answerKind:'grounded',segments:[{text,citations:[{sourceId:'41',quote:faqAnswer}]}]}),faqEvidence),/invalid_model_answer/);
  }
});
