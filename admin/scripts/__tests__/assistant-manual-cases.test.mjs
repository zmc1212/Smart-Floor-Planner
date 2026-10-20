import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedManualRunCount, manualScenarioNames, manualBatchComplete } from '../assistant-manual-cases.mjs';
const successful = names => [1, 2].flatMap(round => names.map(name => ({ name, round, fixedChecksPassed: true, firstDraftPassed: true })));

test('default manual acceptance still requires all three original scenarios twice', () => {
  const names = ['waterproof-heights', 'water-test-followup', 'kitchen-electrical'];
  assert.deepEqual(manualScenarioNames(), names); assert.equal(expectedManualRunCount(), 6);
  assert.equal(manualBatchComplete(successful(names)), true);
  assert.equal(manualBatchComplete(successful(names).slice(1)), false);
});

test('repair subset completes at four actual runs and keeps first-draft policy separate', () => {
  const names = ['water-test-followup', 'kitchen-electrical'], runs = successful(names);
  assert.deepEqual(manualScenarioNames('repair'), names); assert.equal(expectedManualRunCount('repair'), 4);
  runs[0].firstDraftPassed = false;
  assert.equal(manualBatchComplete(runs, 'repair', false), true);
  assert.equal(manualBatchComplete(runs, 'repair', true), false);
  runs[0].fixedChecksPassed = false; assert.equal(manualBatchComplete(runs, 'repair', false), false);
});

test('matching totals cannot hide a duplicate/missing case or an unknown subset', () => {
  const runs = successful(['water-test-followup', 'kitchen-electrical']); runs[3] = { ...runs[0] };
  assert.equal(manualBatchComplete(runs, 'repair'), false);
  assert.throws(() => manualScenarioNames('unregistered'), /Unknown/);
  const copy = manualScenarioNames('repair'); copy.pop(); assert.equal(expectedManualRunCount('repair'), 4);
});
