import test from 'node:test';
import assert from 'node:assert/strict';
import { evidencedRequirements } from '../requirements/contract';

const messages = [
  { id: '11', text: '我家准备装修，预算12万，养了只猫，现在先做什么？' },
  { id: '12', text: '房子90平，在宜昌。客厅想铺木地板，地暖先不做。你们量房大概要多久？' },
  { id: '13', text: '预算还是压到10万吧，客厅改成瓷砖，其他先不变，帮我改一下。' },
];
test('natural requirements retain exact source excerpts including negation and corrections', () => {
  const result = evidencedRequirements(messages, [
    { field: 'housing', text: '房子90平，在宜昌', sourceMessageId: '12' },
    { field: 'household', text: '养了只猫', sourceMessageId: '11' },
    { field: 'budget', text: '预算还是压到10万吧', sourceMessageId: '13' },
    { field: 'room', text: '客厅改成瓷砖', sourceMessageId: '13' },
    { field: 'devices', text: '地暖先不做', sourceMessageId: '12' },
  ]);
  assert.equal(result.budget.sourceMessageId, '13');
  assert.equal(result.devices.text, '地暖先不做');
  assert.equal(result.housing.text, '房子90平，在宜昌');
});
test('fabricated text, foreign message IDs and duplicate fields cannot become saved facts', () => {
  for (const fields of [
    [{ field: 'budget', text: '预算8万', sourceMessageId: '11' }],
    [{ field: 'budget', text: '预算12万', sourceMessageId: 'foreign' }],
    [{ field: 'budget', text: '预算12万', sourceMessageId: '11' }, { field: 'budget', text: '预算还是压到10万吧', sourceMessageId: '13' }],
  ]) assert.throws(() => evidencedRequirements(messages, fields), /invalid_requirement_evidence/);
});
