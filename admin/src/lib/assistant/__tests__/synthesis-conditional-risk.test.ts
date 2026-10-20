import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';

const text = '强弱电管线平行间距不得小于300mm，交叉屏蔽两侧延伸各超过150mm。';
const rule: SynthesisSource = { sourceId: 'Krule', kind: 'knowledge', title: '合成工艺条款', text,
  evidence: { ref: { type: 'knowledge_chunk', id: 'rule', version: 'v1' }, text, hash: 'synthetic', file: {
    format: 'pdf', kind: 'paragraph', name: 'synthetic.pdf', assetId: 'synthetic', sourceHash: 'synthetic', parser: 'synthetic',
    blockId: 'b1', page: 1, paragraph: 1, section: [], label: '合成单元测试段落',
  } } };
const site: SynthesisSource = { sourceId: 'Bsite', kind: 'project', title: '合成现场观察',
  text: '现场记录平行间距100mm，交叉屏蔽两侧延伸长度未量测。' };
const raw = (text: string, basis = 'advice', selected = [rule, site]) => JSON.stringify({ kind: 'synthesis',
  segments: [{ basis, text, citations: selected.map(source => ({ citationId: sourceCitationCatalog(source)[0].citationId })) }] });

test('run971 generic conditional-risk advice is not a finding of insufficient unmeasured shielding', () => {
  for (const text of [
    '从一般原理看，交叉处屏蔽包裹不连续或延伸不足，同样会削弱屏蔽效果。',
    '一般风险是包裹范围不够时干扰抑制效果可能下降；这不说明现场长度不足。',
  ]) assert.doesNotThrow(() => parseSynthesis(raw(text), [rule, site]));
});

test('a general-risk lead-in cannot hide a current site finding in the same or adjacent clause', () => {
  const generic = '从一般原理看，交叉屏蔽延伸不足会削弱效果';
  for (const text of [generic + '；现场交叉屏蔽两侧延伸长度不足。', generic + '，记录显示交叉屏蔽长度不够。',
    '从一般原理看，现场交叉屏蔽两侧延伸长度不足。'])
    assert.throws(() => parseSynthesis(raw(text), [rule, site]), /ungrounded_response_scope/);
});

test('run967/968 coating-pass quantities require their actual clause in this paragraph', () => {
  const preparation: SynthesisSource = { ...rule, sourceId: 'Kprep', text: '施工前核对基层，先除尘并处理阴阳角。' };
  const coats: SynthesisSource = { ...rule, sourceId: 'Kcoats', text: '两遍涂层应垂直交叉涂刷，表面平整无开裂。' };
  for (const text of ['手册还要求两遍涂层垂直交叉涂刷。', '手册要求涂刷两遍。']) {
    const answer = raw(text, 'evidence', [preparation]);
    assert.throws(() => parseSynthesis(answer, [preparation, coats]), /unsupported_model_commitment/);
    const feedback = synthesisRepairFeedback(answer, [preparation, coats])!;
    assert.match(feedback.feedback, /两遍/);
    assert.ok(feedback.feedback.includes(sourceCitationCatalog(coats)[0].citationId));
    assert.doesNotThrow(() => parseSynthesis(raw(text, 'evidence', [coats]), [preparation, coats]));
  }
});

test('ordinary repetition is not a new engineering quantity or a reason to require a source', () => {
  for (const text of ['这句话可以再说两遍，先确认你指的对象。', '建议把问题再核对两遍。'])
    assert.doesNotThrow(() => parseSynthesis(raw(text, 'advice', []), []));
});

test('a newly observed covering-and-rework-cost mechanism also retains advice identity', () => {
  const text = '贴砖会把防水层盖住，后面再发现问题代价更大。';
  assert.throws(() => parseSynthesis(raw(text, 'evidence', [rule]), [rule]), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, 'advice', []), [rule]));
  const feedback = synthesisRepairFeedback(raw(text, 'evidence'), [rule, site])!.feedback;
  assert.doesNotMatch(feedback, /below_minimum|quoted_values_only_not_project_acceptance/);
  const explanation = { ...rule, text: '贴砖会把防水层盖住，后面再发现问题代价更大。' };
  assert.doesNotThrow(() => parseSynthesis(raw(text, 'evidence', [explanation]), [explanation]));
});

test('unmeasured extension cannot prove an ineffective-shielding conclusion', () => {
  for (const basis of ['evidence', 'advice', 'uncertainty']) for (const text of [
    '交叉屏蔽只包一小段等于没形成有效屏蔽。',
    '交叉屏蔽的关键在包裹是否连续、两侧是否都超出足够长度，只包一小段等于没形成有效屏蔽。',
  ]) assert.throws(() => parseSynthesis(raw(text, basis), [rule, site]), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw('交叉屏蔽两侧延伸长度未量测，不能据此判断有效或无效。', 'uncertainty'), [rule, site]));
});

test('repeated comparison evidence is represented once while repair retains every affected path', () => {
  const answer = JSON.stringify({ kind: 'synthesis', segments: Array.from({ length: 6 }, () => ({ basis: 'evidence',
    text: '现场记录的平行间距100mm符合手册不小于300mm的要求。',
    citations: [rule, site].map(source => ({ citationId: sourceCitationCatalog(source)[0].citationId })) })) });
  const feedback = synthesisRepairFeedback(answer, [rule, site])!.feedback;
  assert.equal((feedback.match(/below_minimum/g) || []).length, 1);
  for (const index of [0, 1, 2, 3, 4, 5]) assert.ok(feedback.includes(`segments[${index}].text`));
  assert.match(feedback, /100/); assert.match(feedback, /300/);
});
