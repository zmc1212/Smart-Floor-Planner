import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaultGuidance as defaultGuidance, guidanceProgress, validateGuidance } from '../requirements/guidance';
import { guidanceView } from '../requirements/guidance';
import { version2DefaultGuidance as detailed, defaultGuidance as current } from '../requirements/guidance-defaults';
const turns = (...texts: string[]) => texts.map((text, i) => ({ id: String(i + 1), text }));
test('P2A.1 confirmation overrides replay at its boundary; later corrections remain unconfirmed', () => {
  const input = turns('旧房90平米，预算还没定');
  const checkpoint = { after: 1, fields: { housing: '90平米旧房', household: '', style: '', budget: '25万元', timeline: '' } };
  const view = guidanceView(current, input, checkpoint)!;
  assert.match(view.confirmed, /预算/); assert.doesNotMatch(view.pending, /预算/);
  assert.equal(guidanceProgress(current, input, checkpoint).fields.budget.text, '25万元');
  const corrected = guidanceProgress(current, [...input, ...turns('预算改成30万元')], checkpoint);
  assert.equal(corrected.fields.budget.text, '预算改成30万元');
  assert.doesNotMatch(guidanceView(current, [...input, ...turns('预算改成30万元')], checkpoint)!.confirmed, /预算/);
});
test('P2A.1 room facts remain traceable and equipment multi-select binds only after confirmation', () => {
  const inputs = turns('书房的书桌靠窗，偶尔两人办公，电脑和台灯');
  const result = guidanceProgress(current, inputs);
  assert.match(result.fields.room.text, /书房/);
  assert.match(result.fields.space.text, /靠窗/);
  assert.match(result.fields.frequency.text, /偶尔/);
  assert.match(result.fields.devices.text, /电脑和台灯/);
  assert.equal(result.fields.devices.sourceMessageId, '1');
  assert.equal(guidanceView(current, inputs)!.summaryReady, true);
  assert.equal(validateGuidance(current).schemaVersion, 3);
  const devicesFirst = { ...current, questions: [...current.questions].reverse() };
  assert.equal(guidanceView(devicesFirst, [])!.answerType, 'multiple');
  assert.equal(guidanceProgress(devicesFirst, turns('显示器、手机充电')).fields.devices.text, '显示器、手机充电');
  assert.throws(() => validateGuidance({ ...current, questions: current.questions.map(q => ({ ...q, answerType: 'unknown' })) }));
});
test('PPT interview asks atomic questions, keeps unknown pending and resumes from durable replies', () => {
  assert.equal(guidanceView(detailed, [])?.questionKey, 'housingType');
  assert.equal(guidanceView(detailed, turns('新房'))?.questionKey, 'area');
  const texts = ['新房', '90平米', '三室两厅', '2人', '居家办公', '现代简约', '还没确定', '3个月内'];
  const p = guidanceProgress(detailed, turns(...texts));
  assert.equal(p.next, undefined);
  assert.match(p.fields.housing.text, /新房；90平米；三室两厅/);
  assert.equal(p.fields.budget.text, '还没确定');
  assert.equal(guidanceView(detailed, turns(...texts))?.pending, '预算');
  assert.equal(guidanceView(detailed, turns(...texts, '预算改成25万元'))?.pending, '暂无');
});
test('multi-fact answers skip only known subfields, interruptions and pause preserve position', () => {
  const facts = '90平旧房，两个人住，都需要办公，喜欢现代简约，预算还没定';
  assert.equal(guidanceView(detailed, turns(facts))?.questionKey, 'layout');
  assert.equal(guidanceView(detailed, turns('新房', '水电验收怎么做？'))?.questionKey, 'area');
  assert.deepEqual(guidanceView(detailed, turns('新房', '先暂停'))?.options, []);
  assert.equal(guidanceView(detailed, turns('新房', '先暂停', '继续整理'))?.questionKey, 'area');
});
test('atomic config accepts custom choices/reordering and rejects duplicate keys or invalid options', () => {
  const config = validateGuidance({ ...detailed, questions: detailed.questions.map(q => ({ ...q, options: ['自定义选项'] })).reverse() });
  assert.equal(guidanceView(config, [])?.questionKey, 'timeline');
  assert.equal(guidanceProgress(config, turns('自定义选项')).fields.timeline.text, '自定义选项');
  assert.throws(() => validateGuidance({ ...detailed, questions: detailed.questions.map(q => ({ ...q, options: ['重复', '重复'] })) }), /invalid_message/);
  assert.throws(() => validateGuidance({ ...detailed, questions: detailed.questions.map(q => ({ ...q, key: 'housingType' })) }), /invalid_message/);
});
test('guided short replies retain context, uncertainty and source IDs across five turns', () => {
  const result = guidanceProgress(defaultGuidance, turns('新房90平米', '三位', '还没想好', '30以下', '3个月'));
  assert.equal(result.fields.household.text, '三位');
  assert.equal(result.fields.style.text, '还没想好');
  assert.equal(result.fields.budget.text, '30以下');
  assert.equal(result.fields.timeline.sourceMessageId, '5');
  assert.equal(result.next, undefined); assert.match(result.reply, /核对、修改并确认/);
});
test('questions and greetings never become requirements; paused replies do not fill an active field', () => {
  let result = guidanceProgress(defaultGuidance, turns('你好', '水电验收怎么做？'));
  assert.equal(result.next?.field, 'housing'); assert.equal(result.interrupt, true);
  for (const question of ['水电开工前，我需要确认什么', '装修报价里，哪些项目要问清楚', '帮我解释水电验收流程']) {
    const interrupted = guidanceProgress(defaultGuidance, turns(question));
    assert.equal(interrupted.next?.field, 'housing'); assert.equal(interrupted.interrupt, true);
  }
  result = guidanceProgress(defaultGuidance, turns('先暂停', '114'));
  assert.equal(result.paused, true); assert.equal(result.fields.housing.text, '');
  result = guidanceProgress(defaultGuidance, turns('先暂停', '继续整理', '114'));
  assert.equal(result.fields.housing.text, '114'); assert.equal(result.next?.field, 'household');
});
test('already stated fields are skipped and later explicit corrections replace only that field', () => {
  const result = guidanceProgress(defaultGuidance, turns('90平米旧房。两个人住。喜欢现代简约。预算20万元。半年内入住。', '预算改成25万元'));
  assert.equal(result.next, undefined); assert.equal(result.fields.budget.text, '预算改成25万元');
  assert.equal(result.fields.housing.text, '90平米旧房');
});
test('configuration can reorder fields but rejects duplicates, extra keys and oversized scripts', () => {
  const ordered = validateGuidance({ ...defaultGuidance, questions: [...defaultGuidance.questions].reverse() });
  assert.equal(guidanceProgress(ordered, []).next?.field, 'timeline');
  assert.throws(() => validateGuidance({ ...defaultGuidance, questions: Array(5).fill(defaultGuidance.questions[0]) }), /invalid_message/);
  assert.throws(() => validateGuidance({ ...defaultGuidance, enterpriseId: '2' }), /invalid_message/);
  assert.throws(() => validateGuidance({ ...defaultGuidance, opening: 'a'.repeat(601) }), /invalid_message/);
});
