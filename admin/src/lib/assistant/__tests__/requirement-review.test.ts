import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRequirementChanges, requirementItems } from '../requirements/items';
import { requirementReview } from '../requirements/review';

const messages = [{ id: '1', text: '我家90平，预算12万，客厅想铺木地板，地暖不做。' },
  { id: '2', text: '预算改成10万，客厅换瓷砖，其余照旧。' }];
const first = applyRequirementChanges(messages, null, [
  { operation: 'add', field: 'housing', sourceId: 'c1.0' }, { operation: 'add', field: 'budget', sourceId: 'c1.1' },
  { operation: 'add', field: 'room', sourceId: 'c1.2' }, { operation: 'add', field: 'room', sourceId: 'c1.3' }]);
const items = requirementItems(messages, first);
const second = applyRequirementChanges(messages, first, [
  { operation: 'replace', targetId: items.find(i => i.field === 'budget')!.id, sourceId: 'c2.0' },
  { operation: 'replace', targetId: items.find(i => i.text.includes('木地板'))!.id, sourceId: 'c2.1' }]);

describe('requirement proposal review', () => {
  it('existing drafts accept empty and repeated exact additions without a different state', () => {
    assert.equal(requirementReview(messages, first, []).unchanged, true);
    assert.equal(requirementReview(messages, first, [{ operation: 'add', field: 'budget', sourceId: 'c1.1' }]).unchanged, true);
    assert.throws(() => requirementReview(messages, first, [{ operation: 'add', field: 'budget', sourceId: 'c1.1', consent: true }]), /invalid_requirement_changes/);
  });
  it('does not let a repeated-add no-op bypass invalid target, field, or source validation', () => {
    assert.throws(() => requirementReview(messages, first, [{ operation: 'add', targetId: null, field: 'budget', sourceId: 'c1.1' }]), /requirement_target_changed/);
    assert.throws(() => requirementReview(messages, first, [{ operation: 'add', field: 'unknown', sourceId: 'c1.1' }]), /invalid_requirement_evidence/);
    assert.throws(() => requirementReview(messages, first, [{ operation: 'add', field: 'budget', sourceId: 'missing-source' }]), /invalid_requirement_evidence/);
  });
  it('history restore exposes only the actual affected before/after and separate consent', () => {
    const budget = requirementItems(messages, second).find(i => i.field === 'budget')!;
    const review = requirementReview(messages, second, [{ operation: 'replace', targetId: budget.id, sourceId: 'c1.1' }]);
    assert.equal(review.requiresRestoreConsent, true);
    assert.deepEqual(review.diff.map(d => [d.field, d.before, d.after]), [['budget', '预算改成10万', '预算12万']]);
    assert.equal(review.fields.room.text, second.room.text);
  });
  it('two replacements in the same field bind each historical source to its own target', () => {
    const floor = requirementItems(messages, second).find(i => i.text === '客厅换瓷砖')!;
    const review = requirementReview(messages, second, [{ operation: 'replace', targetId: floor.id, sourceId: 'c1.2' }]);
    assert.equal(review.requiresRestoreConsent, true);
    assert.match(review.diff[0].before, /瓷砖.*地暖不做|地暖不做.*瓷砖/);
    assert.match(review.diff[0].after, /木地板.*地暖不做|地暖不做.*木地板/);
    assert.equal(second.room.text.includes('木地板'), false);
  });
  it('current statements produce reviewable changes without an old-source restoration flag', () => {
    const review = requirementReview(messages, first, [{ operation: 'replace', targetId: items.find(i => i.field === 'budget')!.id, sourceId: 'c2.0' }]);
    assert.equal(review.requiresRestoreConsent, false);
    assert.equal(review.unchanged, false);
    assert.equal(first.budget.text, '预算12万');
  });
  it('history restore also requires consent when encoded as remove plus add', () => {
    const budget = requirementItems(messages, second).find(i => i.field === 'budget')!;
    const review = requirementReview(messages, second, [
      { operation: 'remove', targetId: budget.id },
      { operation: 'add', field: 'budget', sourceId: 'c1.1' },
    ]);
    assert.equal(review.requiresRestoreConsent, true);
    assert.deepEqual(review.diff.map(d => [d.field, d.before, d.after, d.restoresHistory]), [['budget', '预算改成10万', '预算12万', true]]);
  });
});
