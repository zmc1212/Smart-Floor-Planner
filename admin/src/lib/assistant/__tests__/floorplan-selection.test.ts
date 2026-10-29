import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorplanContext } from '../media/floorplan-selection';
import { parseFloorplanChoice } from '../media/floorplan-context';

test('unselected and malformed persisted contexts never acquire a floorplan scope', () => {
  assert.deepEqual(floorplanContext({ kind: 'lead', id: '10' }), { revision: 0, selection: null });
  for (const selection of [{ leadId: '1 OR true', floorPlanId: '2', layoutHash: 'a'.repeat(64) }, { leadId: '1', floorPlanId: '2', layoutHash: null }])
    assert.equal(floorplanContext({ floorplanContext: { protocol: 'floorplan-context-v1', revision: 2, selection } }).selection, null);
});
test('the write contract requires an explicit revision and rejects tenant or user identity arguments', () => {
  const selection = { leadId: '10', floorPlanId: '11', layoutHash: 'a'.repeat(64) };
  assert.deepEqual(parseFloorplanChoice({ expectedVersion: 2, selection }), { expectedVersion: 2, selection });
  assert.deepEqual(parseFloorplanChoice({ expectedVersion: 3, selection: null }), { expectedVersion: 3, selection: null });
  for (const body of [{ selection }, { expectedVersion: -1, selection }, { expectedVersion: 2, selection, enterpriseId: '1' },
    { expectedVersion: 2, selection: { ...selection, userId: '2' } }, { expectedVersion: 2, selection: { ...selection, floorPlanId: '../2' } }])
    assert.throws(() => parseFloorplanChoice(body), /invalid_message/);
});
