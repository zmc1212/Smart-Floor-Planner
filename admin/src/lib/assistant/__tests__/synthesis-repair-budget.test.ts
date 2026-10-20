import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';

const manual = '强、弱电管线平行布置，间距不得小于300mm；交叉屏蔽两侧延伸长度各超过150mm。不得同槽、不得共用线盒。防水完毕保养48小时再做蓄水试验，蓄水时间不少于24小时。';
const rule: SynthesisSource = { sourceId: 'Krule', kind: 'knowledge', title: '参考手册', text: manual,
  evidence: { ref: { type: 'knowledge_chunk', id: 'rule', version: 'v1' }, text: manual, hash: 'synthetic', file: {
    format: 'pdf', kind: 'paragraph', name: 'synthetic.pdf', assetId: 'synthetic', sourceHash: 'synthetic', parser: 'synthetic',
    blockId: 'b1', page: 1, paragraph: 1, section: [], label: '合成单元测试段落',
  } } };
const site: SynthesisSource = { sourceId: 'Bsite', kind: 'project', title: '已发布观察', text:
  '现场记录平行间距200mm，局部同槽并共用线盒。交叉屏蔽两侧延伸长度未量测。' };
const citation = (source: SynthesisSource) => ({ citationId: sourceCitationCatalog(source)[0].citationId });
const answer = (text: string, basis = 'evidence', selected = [rule]) => JSON.stringify({ kind: 'synthesis',
  segments: [{ basis, text, citations: selected.map(citation) }] });

test('run954 Chinese-unit conversions cannot bypass the existing same-quote numerical guard', () => {
  for (const basis of ['evidence', 'advice', 'uncertainty']) {
    const raw = answer('从涂刷完成到蓄水本身就要等两天，蓄水还要再占一天。', basis);
    assert.throws(() => parseSynthesis(raw, [rule, site]), /unsupported_model_commitment/);
    const feedback = synthesisRepairFeedback(raw, [rule, site])!;
    assert.match(feedback.feedback, /两天/); assert.match(feedback.feedback, /一天/);
    assert.match(feedback.feedback, /汉字/);
  }
  const original = { ...rule, text: '维护窗口两天，具体起点需核实。' };
  assert.doesNotThrow(() => parseSynthesis(answer('原文给出的维护窗口为两天，起点仍需核实。', 'evidence', [original]), [original]));
  assert.doesNotThrow(() => parseSynthesis(answer('手册要求保养48小时再做蓄水试验，试验不少于24小时。'), [rule]));
  assert.doesNotThrow(() => parseSynthesis(answer('如果只看到一小段包裹，应核实延伸长度。', 'advice', []), [rule, site]));
});

test('Chinese-unit claims need this segment original, not a matching word in an uncited source', () => {
  const original = { ...rule, sourceId: 'Kdays', text: '备用维护窗口两天。' };
  assert.throws(() => parseSynthesis(answer('可用维护窗口为两天。'), [rule, original]), /unsupported_model_commitment/);
});

test('run956 the single repair includes every unsupported mechanism and the original segment budget', () => {
  const texts = [
    '间距不足时，强电对弱电的干扰会随并行长度累积，弱电信号更容易出现杂波、串扰。',
    '同槽共盒意味着强弱电在同一个腔体里走，后期检修时也难分辨回路归属。',
    '包裹长度不够，交叉点附近的干扰抑制就不完整。',
  ];
  const raw = JSON.stringify({ kind: 'synthesis', segments: texts.map(text => ({ basis: 'evidence', text, citations: [citation(rule), citation(site)] })) });
  const feedback = synthesisRepairFeedback(raw, [rule, site])!;
  for (const index of [0, 1, 2]) assert.ok(feedback.feedback.includes(`segments[${index}].text`));
  assert.match(feedback.feedback, /最多6段/); assert.match(feedback.feedback, /合并/);
  const repaired = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '记录中的平行间距200mm低于手册要求的300mm。',
    citations: [citation(rule), citation(site)] }, { basis: 'advice', text: texts.join(''), citations: [] },
  { basis: 'uncertainty', text: '交叉屏蔽长度未量测，本次无法判断其是否符合要求。', citations: [citation(site)] }] });
  assert.doesNotThrow(() => parseSynthesis(repaired, [rule, site]));
});

test('run955 comparative feedback carries the actual metric, source values and unknown metric without changing source text', () => {
  const sources = [rule, site], before = JSON.stringify(sources);
  const raw = answer('平行间距按记录数值看是达标的，交叉屏蔽与手册要求不符。', 'evidence', sources);
  const feedback = synthesisRepairFeedback(raw, sources)!;
  assert.match(feedback.feedback, /200/); assert.match(feedback.feedback, /300/);
  assert.match(feedback.feedback, /below_minimum/); assert.match(feedback.feedback, /交叉屏蔽两侧延伸长度/);
  assert.match(feedback.feedback, /不能消除/);
  assert.equal(JSON.stringify(sources), before);
});

test('explicit sufficient wording cannot reverse a known minimum or turn an unmeasured quantity into failure', () => {
  for (const text of ['平行间距这一项按手册口径是够的。', '平行间距足够。', '交叉屏蔽长度不够。'])
    assert.throws(() => parseSynthesis(answer(text, 'evidence', [rule, site]), [rule, site]), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(answer('平行间距的记录值低于手册下限，不能据此判断全线质量。', 'evidence', [rule, site]), [rule, site]));
});

test('run962 a manual comparison needs the rule original in this segment, including a qualitative opening', () => {
  const title = { ...rule, sourceId: 'Ktitle', text: '施工工艺标准2.0' };
  for (const selected of [[site], [site, title]]) {
    const raw = answer('现场记录的平行间距低于手册下限。', 'evidence', selected);
    assert.throws(() => parseSynthesis(raw, [rule, site, title]), /ungrounded_response_scope/);
    assert.match(synthesisRepairFeedback(raw, [rule, site, title])!.feedback, /misattributed_rule_comparison/);
  }
  assert.doesNotThrow(() => parseSynthesis(answer('现场记录的平行间距低于手册下限。', 'evidence', [site, rule]), [site, rule]));
});

test('a collective negative summary cannot turn its explicitly unmeasured item into noncompliance', () => {
  const raw = answer('这三项都落在手册要求之外：平行间距偏低、同槽共盒，交叉屏蔽两侧延伸长度未量测。', 'evidence', [rule, site]);
  assert.throws(() => parseSynthesis(raw, [rule, site]), /ungrounded_response_scope/);
  assert.match(synthesisRepairFeedback(raw, [rule, site])!.feedback, /unmeasured_compliance_claim/);
});

test('run958 numeric repair offers an existing supporting source rather than requiring deletion of a correct site value', () => {
  const raw = answer('建议确认200mm从哪一侧起算。', 'advice', [rule]);
  const feedback = synthesisRepairFeedback(raw, [rule, site])!;
  assert.match(feedback.feedback, /numericSourceCandidates/);
  assert.ok(feedback.feedback.includes(sourceCitationCatalog(site)[0].citationId));
  assert.match(feedback.feedback, /正确数值/);
  assert.throws(() => parseSynthesis(raw, [rule, site]), /unsupported_model_commitment/);
  assert.doesNotThrow(() => parseSynthesis(answer('建议确认200mm从哪一侧起算。', 'advice', [site]), [rule, site]));
});

test('matching knowledge digits cannot exhaust all repair hints before the actual project original', () => {
  const decoys: SynthesisSource[] = Array.from({ length: 5 }, (_, i) => ({ ...rule, sourceId: 'Kother' + i, text: '另一部位的参考长度200mm。' }));
  const sources = [rule, ...decoys, site], before = JSON.stringify(sources);
  const feedback = synthesisRepairFeedback(answer('建议确认200mm从哪一侧起算。', 'advice', [rule]), sources)!;
  assert.ok(feedback.feedback.includes(sourceCitationCatalog(site)[0].citationId));
  assert.equal(JSON.stringify(sources), before);
});
