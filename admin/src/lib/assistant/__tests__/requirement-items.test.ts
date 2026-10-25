import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRequirementChanges, requirementItems, requirementSources } from '../requirements/items';

const messages = [{ id: '1', text: '我家90平，预算12万，客厅想铺木地板，地暖不做。你们量房一般多久？' },
  { id: '2', text: '预算改成10万，客厅换瓷砖，其余照旧。也告诉我量房前要准备什么。' }];
const source = (text: string) => requirementSources(messages).find(s => s.text === text)!.id;
const legacy = { housing: { text: '90平', sourceMessageId: '1' }, budget: { text: '12万', sourceMessageId: '1' },
  room: { text: '客厅想铺木地板，地暖不做', sourceMessageId: '1' } };

test('a flooring correction retains the independent heating item even inside the same legacy field', () => {
  const items = requirementItems(messages, legacy);
  const changed = applyRequirementChanges(messages, legacy, [
    { operation: 'replace', targetId: items.find(i => i.field === 'budget')!.id, sourceId: source('预算改成10万') },
    { operation: 'replace', targetId: items.find(i => i.text === '客厅想铺木地板')!.id, sourceId: source('客厅换瓷砖') },
  ]);
  assert.equal(changed.room.text, '客厅换瓷砖；地暖不做');
  assert.equal(changed.housing.text, '90平');
  assert.equal(changed.budget.text, '预算改成10万');
  const reopened = requirementItems(messages, changed);
  assert.equal(reopened.find(i => i.text === '地暖不做')!.id, items.find(i => i.text === '地暖不做')!.id);
});

test('new drafts keep multiple facts in a category and retain exact Unicode customer evidence', () => {
  const initial = applyRequirementChanges(messages, null, [
    { operation: 'add', field: 'housing', sourceId: source('我家90平') },
    { operation: 'add', field: 'room', sourceId: source('客厅想铺木地板') },
    { operation: 'add', field: 'room', sourceId: source('地暖不做') },
  ]);
  assert.equal(initial.room.items!.length, 2);
  assert.equal(initial.room.text, '客厅想铺木地板；地暖不做');
  assert.equal(initial.housing.sourceMessageId, '1');
});

test('foreign references, whole-field targets and repeated destructive edits are rejected', () => {
  const targetId = requirementItems(messages, legacy).find(i => i.text === '客厅想铺木地板')!.id;
  for (const changes of [
    [{ operation: 'replace', targetId: 'room', sourceId: source('客厅换瓷砖') }],
    [{ operation: 'replace', targetId, sourceId: 'foreign' }],
    [{ operation: 'remove', targetId }, { operation: 'remove', targetId }],
    [{ operation: 'replace', targetId, sourceId: source('客厅换瓷砖'), field: 'budget' }],
  ]) assert.throws(() => applyRequirementChanges(messages, legacy, changes));
});

test('retained items are revalidated and removal affects only its explicit item', () => {
  const items = requirementItems(messages, legacy), heating = items.find(i => i.text === '地暖不做')!;
  const changed = applyRequirementChanges(messages, legacy, [{ operation: 'remove', targetId: heating.id }]);
  assert.equal(changed.room.text, '客厅想铺木地板');
  assert.throws(() => requirementItems(messages.filter(m => m.id !== '1'), changed), /invalid_requirement_evidence/);
});
