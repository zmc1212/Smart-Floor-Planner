import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSiteAction, siteActionConfirmation, siteActionInterpretationRequested } from '../site-action-contract';
const candidates = { records: ['11'], issues: ['22'], plans: ['33'] };
const output = (value: unknown) => ({ text: JSON.stringify(value), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null });

test('empty inactive provider slots carry no authority; any populated or malformed slot remains rejected', async () => {
  const empty = { plan: { title: '', costQuote: '', scheduleQuote: '' }, assigneeName: '', resolution: { planId: '', recordId: '', excerpt: '' } };
  for (const selection of [{ action: 'report', target: '' }, { action: 'none', target: '' }, { action: 'reply', target: '22' }]) {
    assert.deepEqual(await parseSiteAction(output({ ...selection, ...empty }), candidates), selection);
    for (const extra of [{ ...empty, plan: { ...empty.plan, title: '实际方案' } }, { ...empty, assigneeName: '测试师傅' },
      { ...empty, resolution: { ...empty.resolution, excerpt: '处理原话' } }, { ...empty, plan: null },
      { ...empty, resolution: { ...empty.resolution, unknown: '' } }]) {
      await assert.rejects(parseSiteAction(output({ ...selection, ...extra }), candidates), /invalid_model_answer/);
    }
  }
  const active = { action: 'plan', target: '22', ...empty };
  assert.deepEqual(await parseSiteAction(output(active), candidates), { action: 'plan', target: '22', plan: empty.plan });
});
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
  assert.equal(siteActionConfirmation('确认转交'), 'transfer'); assert.equal(siteActionConfirmation('确认落实'), 'implement');
  assert.equal(siteActionConfirmation('确认正式解决'), 'resolve'); assert.equal(siteActionConfirmation('确认正式关闭'), 'close');
  for (const text of ['可以', '收到', '能确认跟进吗？', '不要确认跟进', '“确认跟进”', '确认回复，但不要发这段', '如果确认跟进', '确认回传，但只给设计师', '核对图纸了吗']) assert.equal(siteActionConfirmation(text), null);
});
test('natural transfer and lifecycle selections remain typed, candidate-bound and separate from other actions', async () => {
  const resolution = { planId: '33', recordId: '11', excerpt: '' };
  for (const value of [{ action: 'transfer', target: '22', assigneeName: '测试师傅' }, { action: 'implement', target: '22', resolution },
    { action: 'resolve', target: '22', resolution: { planId: '', recordId: '', excerpt: '原文' } }]) assert.deepEqual(await parseSiteAction(output(value), candidates), value);
  for (const value of [{ action: 'transfer', target: '22' }, { action: 'reply', target: '22', assigneeName: '测试师傅' },
    { action: 'implement', target: '22', resolution: { ...resolution, planId: '999' } }, { action: 'implement', target: '22', resolution: { ...resolution, recordId: '999' } },
    { action: 'close', target: '22' }, { action: 'reply', target: '22', resolution }]) await assert.rejects(parseSiteAction(output(value), candidates), /invalid_model_answer/);
});
