const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  requestFormalFloorPlanSave
} = require('../packages/surveying/utils/formalFloorPlanSave.js');

test('an existing floor plan issues exactly one PUT', async () => {
  const calls = [];
  const response = { success: true, data: { _id: 'plan-1' } };
  const result = await requestFormalFloorPlanSave({
    request: async (...args) => {
      calls.push(args);
      return response;
    },
    floorPlanId: 'plan-1',
    payload: { status: 'draft' },
    idempotencyKey: 'create-key'
  });

  assert.equal(result, response);
  assert.deepEqual(calls, [[
    '/floorplans/plan-1',
    'PUT',
    { status: 'draft' }
  ]]);
});

test('every PUT failure propagates unchanged and never falls back to POST', async () => {
  const failures = [
    { statusCode: 404, error: 'not found' },
    { statusCode: 401, error: 'unauthorized' },
    { statusCode: 403, error: 'forbidden' },
    { statusCode: 422, error: 'invalid topology' },
    { statusCode: 500, error: 'server error' },
    new Error('network failed')
  ];

  for (const failure of failures) {
    const calls = [];
    await assert.rejects(
      requestFormalFloorPlanSave({
        request: async (...args) => {
          calls.push(args);
          throw failure;
        },
        floorPlanId: 'plan-1',
        payload: { status: 'completed' },
        idempotencyKey: 'create-key'
      }),
      (error) => error === failure
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/floorplans/plan-1');
    assert.equal(calls[0][1], 'PUT');
  }
});

test('a new floor plan issues one POST with the existing idempotency key', async () => {
  const calls = [];
  await requestFormalFloorPlanSave({
    request: async (...args) => {
      calls.push(args);
      return { success: true, data: { _id: 'plan-new' } };
    },
    floorPlanId: '',
    payload: { status: 'draft' },
    idempotencyKey: 'create-key'
  });

  assert.deepEqual(calls, [[
    '/floorplans',
    'POST',
    { status: 'draft' },
    { headers: { 'Idempotency-Key': 'create-key' } }
  ]]);
});

test('the editor delegates saves without clearing an existing server draft ID on PUT failure', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../packages/surveying/editor/surveying-editor.js'),
    'utf8'
  );
  const start = source.indexOf('async saveFormalFloorPlan(status)');
  const end = source.indexOf('\n  scheduleFormalPersist()', start);
  const method = source.slice(start, end);
  assert.match(method, /await requestFormalFloorPlanSave\(\{/);
  assert.doesNotMatch(method, /clearStoredServerDraftId/);
  assert.doesNotMatch(method, /Update surveying draft failed/);
});
