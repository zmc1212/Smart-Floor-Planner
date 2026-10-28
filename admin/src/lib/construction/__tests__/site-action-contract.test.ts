import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSiteAction, siteActionConfirmation } from '../site-action-contract';
const candidates = { records: ['11'], issues: ['22'] };
const output = (value: unknown) => ({ text: JSON.stringify(value), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null });
test('native schema validation keeps actions and target namespaces bounded with no parameter coercion', async () => {
  assert.deepEqual(await parseSiteAction(output({ action: 'open', target: '11' }), candidates), { action: 'open', target: '11' });
  assert.deepEqual(await parseSiteAction(output({ action: 'reply', target: '22' }), candidates), { action: 'reply', target: '22' });
  assert.deepEqual(await parseSiteAction(output({ action: 'report', target: '' }), candidates), { action: 'report', target: '' });
  for (const value of [{ action: 'open', target: 11 }, { action: 'open', target: '22' }, { action: 'reply', target: '11' },
    { action: 'approve', target: '22' }, { action: 'none', target: '11' }, { action: 'none', target: '', text: '已执行' }])
    await assert.rejects(parseSiteAction(output(value), candidates), /invalid_model_answer/);
  await assert.rejects(parseSiteAction({ ...output({ action: 'open', target: '11' }), finishReason: 'length' }, candidates));
});
test('a deliberate action confirmation is separate from acknowledgements, questions, quotes and conditions', () => {
  assert.equal(siteActionConfirmation('确认跟进。'), 'open'); assert.equal(siteActionConfirmation('确认接手'), 'claim');
  assert.equal(siteActionConfirmation('确认回复'), 'reply'); assert.equal(siteActionConfirmation('取消这次操作'), 'cancel');
  for (const text of ['可以', '收到', '能确认跟进吗？', '不要确认跟进', '“确认跟进”', '确认回复，但不要发这段', '如果确认跟进']) assert.equal(siteActionConfirmation(text), null);
});
