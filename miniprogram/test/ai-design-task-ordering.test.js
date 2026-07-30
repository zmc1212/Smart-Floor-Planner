const test = require('node:test');
const assert = require('node:assert/strict');
const { prioritizeProcessingTasks } = require('../utils/aiDesignTaskOrdering.js');

test('recent AI tasks put every non-terminal task first and preserve relative order', () => {
  const tasks = [
    { id: 'completed-newest', status: 'succeeded' },
    { id: 'created-newest', status: 'created' },
    { id: 'processing-newest', status: 'processing' },
    { id: 'failed', status: 'failed' },
    { id: 'pending-older', status: 'pending' },
    { id: 'processing-older', status: 'processing' },
    { id: 'completed-older', status: 'succeeded' },
  ];

  assert.deepEqual(
    prioritizeProcessingTasks(tasks).map((item) => item.id),
    [
      'created-newest',
      'processing-newest',
      'pending-older',
      'processing-older',
      'completed-newest',
      'failed',
      'completed-older',
    ],
  );
  assert.deepEqual(tasks.map((item) => item.id), [
    'completed-newest',
    'created-newest',
    'processing-newest',
    'failed',
    'pending-older',
    'processing-older',
    'completed-older',
  ]);
});

test('recent AI task ordering handles missing data', () => {
  assert.deepEqual(prioritizeProcessingTasks(), []);
});
