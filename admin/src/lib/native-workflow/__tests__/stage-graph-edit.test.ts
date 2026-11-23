import assert from 'node:assert/strict';
import test from 'node:test';
import { connectStageReturn, insertStageCondition } from '../stage-graph-edit';
import { createStageConsultationDefinition } from '../stage-consultation-template';
import { validateDefinition } from '../validate';

test('inserting a condition preserves the existing answer and supports filling its missing branch', () => {
  const original = createStageConsultationDefinition('stage-checklist');
  const inserted = insertStageCondition(original, original.edges[1])!;
  assert.equal(original.nodes.length, 3);
  const incomplete = validateDefinition(inserted.definition);
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.issues.some(issue => issue.code === 'condition_branch_required' && issue.path === '$.nodes[3]'));
  assert.equal(connectStageReturn(inserted.definition, inserted.id, 'true'), null);
  const linked = connectStageReturn(inserted.definition, inserted.id, 'false')!;
  assert.equal(validateDefinition(linked.definition).ok, true);
  assert.deepEqual(linked.definition.nodes.find(node => node.nodeId === linked.id)?.inputs?.text,
    { nodeId: 'guide', outputPath: 'nextStage' });
  assert.deepEqual(linked.definition.nodes.find(node => node.nodeId === 'reply')?.inputs?.text, original.nodes[2].inputs?.text);
  assert.equal(insertStageCondition(original, original.edges[0]), null);
});
