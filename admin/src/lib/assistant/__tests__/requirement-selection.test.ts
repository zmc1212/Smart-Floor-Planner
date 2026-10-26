import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRequirementChanges, requirementItems } from '../requirements/items';
import { selectedRequirementFields, selectedRequirementReview } from '../requirements/selection';

const messages = [{ id:'1',text:'我家90平，预算12万，客厅换瓷砖，地暖不做。' },
  { id:'2',text:'预算改为10万。' }, { id:'3',text:'预算还是12万，瓷砖留着。' }];
const base = applyRequirementChanges(messages, undefined, [
  {operation:'add',field:'housing',sourceId:'c1.0'}, {operation:'add',field:'budget',sourceId:'c2.0'},
  {operation:'add',field:'room',sourceId:'c1.2'}, {operation:'add',field:'devices',sourceId:'c1.3'},
]);
const items = requirementItems(messages,base), budget = items.find(i=>i.field==='budget')!, room = items.find(i=>i.field==='room')!;
const edit = { operation:'replace',targetId:budget.id,sourceId:'c3.0' };

test('customer budget-only selection excludes saved wrong tile replacement and removal',()=>{
  for (const wrong of [{operation:'replace',targetId:room.id,sourceId:'c3.1'}, {operation:'remove',targetId:room.id}]) {
    const result = selectedRequirementReview(messages,base,[edit,wrong],['budget']);
    assert.equal(result.fields.budget.text,'预算还是12万');
    for (const key of ['room','housing','devices'] as const) { assert.equal(result.fields[key],base[key]); assert.deepEqual(result.fields[key],base[key]); }
  }
});
test('adopting deletion is explicit and other fields retain original provenance',()=>{
  const result=selectedRequirementReview(messages,base,[edit,{operation:'remove',targetId:room.id}],['room']);
  assert.equal(result.fields.room.text,''); assert.equal(result.fields.budget,base.budget);
});
test('historical consent is required only when customer selects the historical field',()=>{
  const changes=[{...edit,sourceId:'c1.1'},{operation:'replace',targetId:room.id,sourceId:'c3.1'}];
  assert.equal(selectedRequirementReview(messages,base,changes,['room']).requiresRestoreConsent,false);
  assert.equal(selectedRequirementReview(messages,base,changes,['budget']).requiresRestoreConsent,true);
});
test('empty, duplicate, unknown and unchanged field selections cannot create a draft',()=>{
  for(const value of [[],['budget','budget'],['other'],null,'budget']) assert.throws(()=>selectedRequirementFields(value),/invalid_requirement_selection/);
  assert.throws(()=>selectedRequirementReview(messages,base,[edit],['housing']),/invalid_requirement_selection/);
});
test('invalid unselected proposal operations are still validated',()=>{
  assert.throws(()=>selectedRequirementReview(messages,base,[edit,{operation:'remove',targetId:'wrong'}],['budget']),/requirement_target_changed/);
});
test('selection order is canonical and omitted legacy selection preserves original protocol',()=>{
  assert.deepEqual(selectedRequirementFields(['room','budget']),['budget','room']);
  assert.equal(selectedRequirementFields(undefined),undefined);
  assert.equal(selectedRequirementReview(messages,base,[edit,{operation:'remove',targetId:room.id}],undefined).fields.room.text,'');
});
