const test = require('node:test');
const assert = require('node:assert/strict');
const { prioritizeProcessingTasks } = require('../utils/aiDesignTaskOrdering.js');

test('recent AI tasks put processing tasks first and preserve relative order', () => {
  const tasks = [
    { id: 'completed-newest', status: 'succeeded' },
    { id: 'processing-newest', status: 'processing' },
    { id: 'failed', status: 'failed' },
    { id: 'processing-older', status: 'processing' },
    { id: 'completed-older', status: 'succeeded' },
  ];

  assert.deepEqual(
    prioritizeProcessingTasks(tasks).map((item) => item.id),
    ['processing-newest', 'processing-older', 'completed-newest', 'failed', 'completed-older'],
  );
  assert.deepEqual(tasks.map((item) => item.id), [
    'completed-newest',
    'processing-newest',
    'failed',
    'processing-older',
    'completed-older',
  ]);
});

test('recent AI task ordering handles missing data', () => {
  assert.deepEqual(prioritizeProcessingTasks(), []);
});
