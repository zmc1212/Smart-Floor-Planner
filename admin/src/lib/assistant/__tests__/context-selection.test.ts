import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectContextCandidates } from '../knowledge/context-selection';
import type { Applicability } from '../contracts/professional';
import { anchorKnowledgeQuery } from '../knowledge/query-context';

const state = (status: Applicability['status']): Applicability => ({ status, matched: [], missing: [], mismatched: [] });
test('K01/04/09 wrong-stage top five cannot crowd out current and unknown-condition sources', () => {
  const ranked = Array.from({length:8},(_,i)=>({id:String(i),document_id:String(i)}));
  const conditions = new Map(ranked.map((c,i)=>[c.id,state(i<6?'not_applicable':i===6?'applicable':'unknown')]));
  assert.ok(ranked.slice(0,5).every(c=>conditions.get(c.id)?.status==='not_applicable'), 'Recorded old fusion-first failure');
  const selected = selectContextCandidates(ranked,conditions);
  assert.deepEqual(selected.slice(0,2),ranked.slice(6)); assert.equal(selected.length,5);
});
test('K03/04 document coverage retains a second required document and leaves its original text/locator intact', () => {
  const first = Array.from({length:6},(_,i)=>({id:String(i),document_id:'1',text:'original '+i,locator:{row:i}}));
  const other = {id:'9',document_id:'2',text:'other original',locator:{row:1}};
  const selected = selectContextCandidates([...first,other],new Map());
  assert.ok(selected.includes(other)); assert.equal(selected.length,5); assert.equal(selected[0],first[0]);
});
test('K04 incompatible rules remain available to explain a mismatch when there is room', () => {
  const ranked=[{id:'1',document_id:'1'}];
  assert.deepEqual(selectContextCandidates(ranked,new Map([['1',state('not_applicable')]])),ranked);
});
test('K01 explicit room and current question survive a model query that omitted them',()=>{
  const query=anchorKnowledgeQuery('电气点位图 底盒定位','书房没有点位图，能只按户型定位吗？');
  assert.match(query,/书房没有点位图/);assert.match(query,/电气点位图 底盒定位/);
  assert.equal(anchorKnowledgeQuery('仅模型检索词','  '),'仅模型检索词');
});
test('K01 query context is bounded without splitting supplementary Unicode',()=>{
  const query=anchorKnowledgeQuery('点位😀'.repeat(500),'书房😀'.repeat(500));assert.ok(query.length<=1000);
  assert.doesNotMatch(query,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
});
