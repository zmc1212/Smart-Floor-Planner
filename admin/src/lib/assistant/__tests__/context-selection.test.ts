import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectContextCandidates } from '../knowledge/context-selection';

test('ranked table preview leaves room for another original table without losing the top detail rows', () => {
  const ranked = ['e1','e2','e3','e4','e5','f1','f2','c1'].map(id => ({ id, document_id: 'same-pdf', table: id[0] }));
  const group = (row: typeof ranked[number]) => row.table;
  assert.deepEqual(selectContextCandidates(ranked, new Map(), 5, new Set(), 'ranked').map(r => r.id), ['e1','e2','e3','e4','e5']);
  assert.deepEqual(selectContextCandidates(ranked, new Map(), 5, new Set(), 'ranked', group).map(r => r.id), ['e1','e2','f1','f2','c1']);
  assert.deepEqual(selectContextCandidates(ranked.slice(0, 5), new Map(), 5, new Set(), 'ranked', group).map(r => r.id), ['e1','e2','e3','e4','e5']);
});
import type { Applicability } from '../contracts/professional';
import { anchorKnowledgeQuery, requestedKnowledgeTitles } from '../knowledge/query-context';

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
  assert.equal(selected[2],other); assert.equal(selected.length,5); assert.equal(selected[0],first[0]);
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

test('saved1608 named-source question keeps its third needed clause instead of diversifying into another manual',()=>{
  const rows=[{id:'pipe',document_id:'named'},{id:'other-a',document_id:'other'},
    {id:'backfill',document_id:'named'},{id:'base',document_id:'named'},{id:'other-b',document_id:'other'},{id:'other-c',document_id:'third'}];
  assert.ok(!selectContextCandidates(rows,new Map()).some(r=>r.id==='base'));
  const selected=selectContextCandidates(rows,new Map(),5,new Set(['named']));
  assert.ok(selected.some(r=>r.id==='base'));assert.equal(selected.length,5);
  const conditions=new Map([['base',state('not_applicable')]]);
  assert.equal(selectContextCandidates(rows,conditions,5,new Set(['named'])).at(-1)?.id,'other-c');
});

test('document preference comes from the current quoted source, never model-added search terms',()=>{
  assert.deepEqual(requestedKnowledgeTitles(anchorKnowledgeQuery('《别的手册》','请解释《精艺》里的管根处理。')),['精艺']);
  assert.deepEqual(requestedKnowledgeTitles(anchorKnowledgeQuery('《模型添加的手册》','管根怎么处理？')),[]);
});

test('natural follow-up retains saved2205 tiling prerequisites instead of lower-ranked photo records',()=>{
  const ranked=[
    {id:'2841',document_id:'405'}, {id:'2844',document_id:'405'}, {id:'2837',document_id:'405'},
    {id:'2842',document_id:'405'}, {id:'2848',document_id:'405',text:'保护层干透后施工面层防水，二次闭水合格后贴砖。'},
    {id:'2835',document_id:'405'}, {id:'2833',document_id:'404'}, {id:'2828',document_id:'404'}, {id:'7',document_id:'7'},
  ];
  assert.ok(!selectContextCandidates(ranked,new Map()).some(c=>c.id==='2848'));
  const selected=selectContextCandidates(ranked,new Map(),5,new Set(),'ranked');
  assert.equal(selected.length,5);assert.equal(selected[4],ranked[4]);assert.ok(!selected.some(c=>c.id==='7'));
});

test('natural ranking preserves applicability and explicit-source precedence without changing legacy coverage',()=>{
  const rows=[{id:'wrong-stage',document_id:'named'},{id:'top',document_id:'other'},
    {id:'named',document_id:'named'},{id:'unknown',document_id:'other'}];
  const conditions=new Map([['wrong-stage',state('not_applicable')],['unknown',state('unknown')]]);
  assert.deepEqual(selectContextCandidates(rows,conditions,3,new Set(['named']),'ranked').map(c=>c.id),['named','top','unknown']);
  assert.equal(selectContextCandidates(rows,conditions,5,new Set(['named']),'ranked').at(-1)?.id,'wrong-stage');
});
