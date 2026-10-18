import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSynthesis, focusedSynthesisMessages, type SynthesisSource } from '../agent/synthesis';

const sources: SynthesisSource[] = [{ sourceId: 'K1', kind: 'knowledge', title: '合成办公原则', text: '显示器避免直对窗户，先核对眩光和通道。净宽需现场核对，参考值为900毫米。' },
  { sourceId: 'B2', kind: 'project', title: '合成书房资料', text: '客户原话：书房靠窗，偶尔两人办公。正式户型含书房，缺少点位图。' }];
const parse = (segments: unknown[]) => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments }), sources);
test('synthesis explains across sources without equating generated text to an excerpt', () => {
  const answer = parse([{ basis: 'evidence', text: '靠窗的偏好可以保留，但双人使用还要同时考虑屏幕眩光和通道，不宜只按窗的位置定桌向。',
    citations: [{ sourceId: 'K1', quote: '显示器避免直对窗户，先核对眩光和通道。' }, { sourceId: 'B2', quote: '书房靠窗，偶尔两人办公。' }] },
  { basis: 'uncertainty', text: '当前缺少点位图，具体桌向需要设计师核对。', citations: [{ sourceId: 'B2', quote: '缺少点位图。' }] }]);
  assert.equal(answer.segments.length, 2);
  assert.ok(!sources.some(s => s.text.includes(answer.segments[0].text)));
});
test('forged sources, unrelated quotes and unsupported measurements fail closed', () => {
  for (const citation of [{ sourceId: 'foreign', quote: '缺少点位图。' }, { sourceId: 'K1', quote: '已经核对通过' }])
    assert.throws(() => parse([{ basis: 'evidence', text: '根据资料考虑桌向。', citations: [citation] }]), /invalid_model_citation/);
  assert.throws(() => parse([{ basis: 'advice', text: '你家通道宽800毫米。', citations: [] }]), /unsupported_model_commitment/);
  assert.throws(() => parse([{ basis: 'evidence', text: '可以使用参考值900毫米。', citations: [{ sourceId: 'K1', quote: '先核对眩光和通道。' }] }]), /unsupported_model_commitment/);
});
test('an advice or uncertainty label cannot bypass formal-action guards', () => {
  for (const text of ['已经批准方案', '已正式关闭', '已经验收合格', '保证明天完工'])
    assert.throws(() => parse([{ basis: 'advice', text, citations: [] }]), /unsupported_model_commitment/);
  assert.throws(() => parse([{ basis: 'evidence', text: '企业要求必须这样', citations: [] }]), /invalid_model_answer/);
  assert.equal(parse([{ basis: 'advice', text: '可以先比较侧向和正对窗的眩光感受。', citations: [] }]).segments.length, 1);
});
test('final model context retains current tool pairs and original but drops old topics', () => {
  const context = focusedSynthesisMessages([{role:'system',content:[{type:'text',text:'policy'}]},
    {role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'old',text:'旧的窗户问题'})}]},
    {role:'assistant',content:'旧问题的解释'},
    {role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'current',text:'能否仅据户型定点位？'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'call',name:'query_materials',arguments:'{}'}]},
    {role:'tool',callId:'call',content:JSON.stringify({synthesisSources:[]})}], 'current');
  assert.doesNotMatch(JSON.stringify(context),/旧的窗户|旧问题的解释/);assert.equal(context.at(-1)?.role,'user');
  assert.ok(context.some(m=>m.role==='tool'&&m.callId==='call'));assert.match(JSON.stringify(context.at(-1)),/能否仅据户型定点位/);
});
test('explicit unresolved source conflicts cannot open by selecting an enterprise priority',()=>{
  const conflict=[...sources,{sourceId:'K3',kind:'knowledge' as const,title:'冲突规则',text:'屏幕必须正对强光窗户，适用范围未核实。'}];
  assert.throws(()=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'主流做法为侧向。',citations:[{sourceId:'K1',quote:'显示器避免直对窗户，先核对眩光和通道。'}]}]}),conflict),/unresolved_evidence_conflict/);
});
