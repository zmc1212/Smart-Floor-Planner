import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmedRequirements, excerptRequirements } from '../requirements/contract';

test('excerpts preserve uncertainty and customer wording; later explicit mentions replace candidates', () => {
  const draft = excerptRequirements([{ id:'1', text:'90平米旧房。两个人住，要办公。喜欢原木风格。预算还没定。半年内入住。' },
    { id:'2', text:'不喜欢原木，喜欢现代简约。' }]);
  assert.equal(draft.housing.text, '90平米旧房');
  assert.equal(draft.budget.text, '预算还没定');
  assert.equal(draft.household.sourceMessageId, '1');
  assert.equal(draft.style.text, '不喜欢原木，喜欢现代简约');
  assert.equal(draft.style.sourceMessageId, '2');
  assert.equal(draft.timeline.text, '半年内入住');
  assert.equal(excerptRequirements([{ id:'3', text:'你好' }]).budget.sourceMessageId, null);
});
test('excerpt length is bounded with explicit truncation, without splitting Unicode', () => {
  const value = excerptRequirements([{ id:'1', text:'预算'+'😀'.repeat(1200) }]).budget;
  assert.equal(Array.from(value.text).length,1000); assert.equal(value.truncated,true);
  assert.equal(value.text.endsWith('😀'),true);
});
test('confirmation requires all known fields, bounded customer text and some actual content', () => {
  const fields={housing:' 90平米 ',household:'',style:'',budget:'',timeline:''};
  assert.equal(confirmedRequirements(fields).housing,'90平米');
  for(const bad of [null,[],{}, {...fields,unknown:'x'}, {...fields,housing:3}, {...fields,housing:''}, {...fields,housing:'x'.repeat(1001)}]) {
    assert.throws(()=>confirmedRequirements(bad),/invalid_message/);
  }
});
