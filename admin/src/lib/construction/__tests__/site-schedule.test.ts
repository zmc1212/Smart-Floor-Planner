import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleColor, scheduleNodesInput } from '../site-schedule';

const dates = { plannedStart: '2026-11-10', plannedEnd: '2026-11-12' };
const now = new Date('2026-11-12T11:00:00+08:00');

test('only actual evidence establishes normal in-period progress and a missing plan fact stays gray', () => {
  assert.equal(scheduleColor(dates, now, false).color, 'gray');
  assert.equal(scheduleColor(dates, now, true).color, 'yellow');
  assert.equal(scheduleColor(dates, new Date('2026-11-09T23:59:59+08:00'), false).color, 'gray');
  assert.equal(scheduleColor(dates, new Date('2026-11-13T00:00:00+08:00'), false).color, 'red');
});

test('the same completion is classified relative to the current plan and the Shanghai date', () => {
  const completed = '2026-11-11T17:00:00.000Z';
  assert.equal(scheduleColor(dates, now, true, completed).color, 'yellow');
  assert.equal(scheduleColor({ ...dates, plannedEnd: '2026-11-13' }, now, true, completed).color, 'green');
  assert.equal(scheduleColor({ ...dates, plannedEnd: '2026-11-11' }, now, true, completed).color, 'red');
});

test('schedule publication requires real dates, ordered windows and unique stable node keys', () => {
  const node = { ...dates, key: 'study_outlets', roomId: '12', stageKey: 'utilities' };
  assert.deepEqual(scheduleNodesInput([node]), [node]);
  for (const input of [[node, node], [{ ...node, plannedEnd: '2026-02-30' }], [{ ...node, plannedEnd: '2026-11-08' }]]) {
    assert.throws(() => scheduleNodesInput(input), /invalid_construction/);
  }
});
