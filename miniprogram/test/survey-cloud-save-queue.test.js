const test = require('node:test');
const assert = require('node:assert/strict');
const { createPriorityCloudSaveQueue } = require('../packages/surveying/utils/cloudSaveQueue.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('cloud save queue serializes requests and prioritizes queued completed', async () => {
  const calls = [];
  const gates = [];
  const queue = createPriorityCloudSaveQueue(async (status) => {
    calls.push(status);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    return `${status}-saved`;
  });

  const draft = queue.enqueue('draft');
  const queuedDraft = queue.enqueue('draft');
  const completed = queue.enqueue('completed');
  await Promise.resolve();
  assert.deepEqual(calls, ['draft']);
  gates[0].resolve();
  assert.deepEqual(await draft, { response: 'draft-saved', status: 'draft' });
  while (gates.length < 2) await new Promise((resolve) => setImmediate(resolve));
  gates[1].resolve();
  assert.deepEqual(await queuedDraft, { response: 'completed-saved', status: 'completed' });
  assert.deepEqual(await completed, { response: 'completed-saved', status: 'completed' });
  assert.deepEqual(calls, ['draft', 'completed']);
});

test('cloud save queue continues after a failed save', async () => {
  const calls = [];
  const queue = createPriorityCloudSaveQueue(async (status) => {
    calls.push(status);
    if (status === 'draft') throw new Error('network');
    return 'ok';
  });
  await assert.rejects(queue.enqueue('draft'), /network/);
  assert.equal((await queue.enqueue('completed')).response, 'ok');
  assert.deepEqual(calls, ['draft', 'completed']);
});
