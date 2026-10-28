import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSiteAction, siteActionConfirmation, siteActionInterpretationRequested } from '../site-action-contract';
const candidates = { records: ['11'], issues: ['22'] };
const output = (value: unknown) => ({ text: JSON.stringify(value), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null });
test('native schema validation keeps actions and target namespaces bounded with no parameter coercion', async () => {
  assert.deepEqual(await parseSiteAction(output({ action: 'open', target: '11' }), candidates), { action: 'open', target: '11' });
  assert.deepEqual(await parseSiteAction(output({ action: 'reply', target: '22' }), candidates), { action: 'reply', target: '22' });
  assert.deepEqual(await parseSiteAction(output({ action: 'check', target: '22' }), candidates), { action: 'check', target: '22' });
  assert.deepEqual(await parseSiteAction(output({ action: 'return', target: '22' }), candidates), { action: 'return', target: '22' });
  assert.deepEqual(await parseSiteAction(output({ action: 'report', target: '' }), candidates), { action: 'report', target: '' });
  const plan = { action: 'plan', target: '22', plan: { title: '书房插座调整', costQuote: '费用不变', scheduleQuote: '工期不变' } };
  assert.deepEqual(await parseSiteAction(output(plan), candidates), plan);
  for (const value of [{ action: 'open', target: 11 }, { action: 'open', target: '22' }, { action: 'reply', target: '11' },
    { action: 'check', target: '11' }, { action: 'return', target: '11' },
    { action: 'plan', target: '22' }, { action: 'plan', target: '11', plan: plan.plan }, { ...plan, plan: { ...plan.plan, costQuote: 0 } },
    { action: 'reply', target: '22', plan: plan.plan }, { action: 'approve', target: '22' }, { action: 'none', target: '11' }, { action: 'none', target: '', text: '已执行' }])
    await assert.rejects(parseSiteAction(output(value), candidates), /invalid_model_answer/);
  await assert.rejects(parseSiteAction({ ...output({ action: 'open', target: '11' }), finishReason: 'length' }, candidates));
});
test('a natural formal adjustment that mentions the现场 still reaches interpretation without changing ordinary record/query routing', () => {
  assert.equal(siteActionInterpretationRequested('把书房底盒这个正式调整方案交给业主决定，现场仍需复核。', 'report'), true);
  assert.equal(siteActionInterpretationRequested('现场线管已经铺好了。', 'report'), false);
  assert.equal(siteActionInterpretationRequested('书房方案现在是什么情况？', 'query'), false);
});
test('a deliberate action confirmation is separate from acknowledgements, questions, quotes and conditions', () => {
  assert.equal(siteActionConfirmation('确认跟进。'), 'open'); assert.equal(siteActionConfirmation('确认接手'), 'claim');
  assert.equal(siteActionConfirmation('确认回复'), 'reply'); assert.equal(siteActionConfirmation('取消这次操作'), 'cancel');
  assert.equal(siteActionConfirmation('确认核对图纸'), 'check'); assert.equal(siteActionConfirmation('确认回传'), 'return');
  assert.equal(siteActionConfirmation('确认发布方案'), 'plan'); assert.equal(siteActionConfirmation('确认发布方案，但费用先别写'), null);
  for (const text of ['可以', '收到', '能确认跟进吗？', '不要确认跟进', '“确认跟进”', '确认回复，但不要发这段', '如果确认跟进', '确认回传，但只给设计师', '核对图纸了吗']) assert.equal(siteActionConfirmation(text), null);
});
