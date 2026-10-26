import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRequirementChanges, requirementItems, requirementSources } from '../requirements/items';
import { requirementPlan } from '../requirements/plan';

const messages=[{id:'1',text:'我家90平，预算10万，客厅换瓷砖，地暖不做。'},{id:'2',text:'预算按12万，瓷砖留着。'}];
const base=applyRequirementChanges(messages.slice(0,1),undefined,[
  {operation:'add',field:'housing',sourceId:'c1.0'},{operation:'add',field:'budget',sourceId:'c1.1'},
  {operation:'add',field:'room',sourceId:'c1.2'},{operation:'add',field:'devices',sourceId:'c1.3'},
]);
const items=requirementItems(messages,base),sources=requirementSources(messages),budget=items.find(i=>i.field==='budget')!,room=items.find(i=>i.field==='room')!;
const retained=items.filter(i=>i.id!==budget.id).map(i=>i.id),edit={operation:'replace',targetId:budget.id,sourceId:'c2.0'};
test('budget change preserves full tile/area/negative-heating items and provenance',()=>{
  const changes=requirementPlan(items,sources,'2',{retainedIds:retained,changes:[edit]}),next=applyRequirementChanges(messages,base,changes);
  assert.match(next.budget.text,/12万/);for(const k of ['housing','room','devices'] as const)assert.deepEqual(next[k],base[k]);
});
test('unclassified targets and legacy raw patches cannot silently become a plan',()=>{
  assert.throws(()=>requirementPlan(items,sources,'2',{changes:[edit]}),/invalid_requirement_plan/);
  assert.throws(()=>requirementPlan(items,sources,'2',{retainedIds:[],changes:[edit]}),/requirement_scope_incomplete/);
});
test('retained tile cannot be replaced by its keep directive or deleted',()=>{
  for(const operation of ['replace','remove'])assert.throws(()=>requirementPlan(items,sources,'2',{
    retainedIds:retained,changes:[edit,{operation,targetId:room.id,sourceId:'c2.1'}],
  }),/requirement_retention_conflict/);
});
test('target partition rejects unknown, duplicate and multiply changed IDs',()=>{
  assert.throws(()=>requirementPlan(items,sources,'2',{retainedIds:[...retained,'other'],changes:[edit]}),/requirement_target_changed/);
  assert.throws(()=>requirementPlan(items,sources,'2',{retainedIds:[...retained,retained[0]],changes:[edit]}),/requirement_target_changed/);
  assert.throws(()=>requirementPlan(items,sources,'2',{retainedIds:retained,changes:[edit,edit]}),/requirement_target_changed/);
});
test('deletion needs a current customer clause and retains other facts',()=>{
  const current=[...messages,{id:'3',text:'把预算这一项删掉。'}],all=requirementSources(current);
  assert.throws(()=>requirementPlan(items,all,'3',{retainedIds:retained,changes:[{operation:'remove',targetId:budget.id}]}),/invalid_requirement_evidence/);
  assert.throws(()=>requirementPlan(items,all,'3',{retainedIds:retained,changes:[{operation:'remove',targetId:budget.id,sourceId:'c1.1'}]}),/invalid_requirement_evidence/);
  const changes=requirementPlan(items,all,'3',{retainedIds:retained,changes:[{operation:'remove',targetId:budget.id,sourceId:'c3.0'}]}),next=applyRequirementChanges(current,base,changes);
  assert.equal(next.budget.text,'');assert.deepEqual(next.room,base.room);
});
test('keeping everything compiles to an empty acknowledgement without new values',()=>{
  assert.deepEqual(requirementPlan(items,sources,'2',{retainedIds:items.map(i=>i.id),changes:[]}),[]);
});
test('company sources and extra authority fields remain invalid',()=>{
  assert.throws(()=>requirementPlan(items,sources,'2',{retainedIds:retained,changes:[{...edit,sourceId:'k-company'}]}),/invalid_requirement_evidence/);
  assert.throws(()=>requirementPlan(items,sources,'2',{retainedIds:retained,changes:[edit],execute:true}),/invalid_requirement_plan/);
});
