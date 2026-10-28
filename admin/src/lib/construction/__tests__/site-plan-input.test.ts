import assert from 'node:assert/strict';
import { test } from 'node:test';
import { naturalPlanInput } from '../site-plan-input';
const fields = { title: '书房插座调整', costQuote: '费用增加500.25元', scheduleQuote: '工期延长2天' };
const original = '请将书房底盒的正式方案发给业主，名称书房插座调整。按这张原图增加一组插座，仍须现场核对桌子摆位。费用增加500.25元，工期延长2天。';
test('a formal natural proposal preserves the entire author original and exact signed impacts without model arithmetic', () => {
  const result = naturalPlanInput(original, '22', fields, ['31']); assert.deepEqual(result.missing, []);
  assert.equal(result.command!.difference, original); assert.equal(result.command!.costDeltaCents, 50025); assert.equal(result.command!.scheduleDeltaDays, 2);
  const minus = naturalPlanInput('名称书房插座调整；费用减少100.25元，工期缩短1天。', '22', { ...fields, costQuote: '费用减少100.25元', scheduleQuote: '工期缩短1天' }, ['31']);
  assert.equal(minus.command!.costDeltaCents, -10025); assert.equal(minus.command!.scheduleDeltaDays, -1);
});
test('unknown impacts never default to zero, while explicit unchanged impacts remain a real decision input', () => {
  assert.equal(naturalPlanInput(original, '22', { ...fields, costQuote: '', scheduleQuote: '' }, ['31']).command, undefined);
  const result = naturalPlanInput('名称书房插座调整，费用不变，工期不变。', '22', { ...fields, costQuote: '费用不变', scheduleQuote: '工期不变' }, ['31']);
  assert.equal(result.command!.costDeltaCents, 0); assert.equal(result.command!.scheduleDeltaDays, 0);
  for (const [costQuote, scheduleQuote] of [['费用不增加', '工期不延长'], ['不加价', '不延长工期'], ['不增加费用', '工期不变']]) {
    const bounded = `名称书房插座调整，${costQuote}，${scheduleQuote}。`;
    assert.equal(naturalPlanInput(bounded, '22', { ...fields, costQuote, scheduleQuote }, ['31']).command, undefined);
  }
});
test('fabricated quotes, estimates, missing direction, changed titles and missing/multiple originals cannot create a publish command', () => {
  for (const patch of [{ title: '模型新名称' }, { costQuote: '费用增加600元' }, { costQuote: '500.25元' }, { scheduleQuote: '2天' }])
    assert.equal(naturalPlanInput(original, '22', { ...fields, ...patch }, ['31']).command, undefined);
  for (const ids of [[], ['31', '32']]) assert.equal(naturalPlanInput(original, '22', fields, ids).command, undefined);
  const estimated = '名称书房插座调整，预计费用增加500元，工期可能延长2天。';
  assert.equal(naturalPlanInput(estimated, '22', { ...fields, costQuote: '预计费用增加500元', scheduleQuote: '工期可能延长2天' }, ['31']).command, undefined);
  assert.equal(naturalPlanInput(estimated, '22', { ...fields, costQuote: '费用增加500元', scheduleQuote: '延长2天' }, ['31']).command, undefined);
});
