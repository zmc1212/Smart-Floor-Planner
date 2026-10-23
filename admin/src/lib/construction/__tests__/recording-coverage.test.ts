import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordingCoverage, coverageDuration } from '../recording-coverage';

const from = new Date('2026-10-22T16:00:00Z'), to = new Date('2026-10-23T16:00:00Z');
const sample = (start: number, end: number) => ({ startedAt: new Date(from.getTime() + start), endedAt: new Date(from.getTime() + end) });
test('coverage merges reordered, overlapping, nested and adjacent sealed segments without double counting', () => {
  const result = recordingCoverage(from, to, [sample(5000, 7000), sample(1000, 3000), sample(2000, 6000), sample(3000, 4000), sample(7000, 8000)]);
  assert.equal(result.segments, 5); assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0].segments, 5); assert.equal(result.coveredMilliseconds, 7000); assert.deepEqual(result.gaps, []);
});
test('only internal gaps count, preserving even a one-millisecond gap', () => {
  const result = recordingCoverage(from, to, [sample(1000, 2000), sample(2001, 3001), sample(10000, 11000)]);
  assert.deepEqual(result.gaps.map(item => item.milliseconds), [1, 6999]);
  assert.equal(result.gapMilliseconds, 7000); assert.equal(result.coveredMilliseconds, 3000);
  assert.equal(coverageDuration(1), '1 毫秒'); assert.equal(coverageDuration(3661000), '1 小时 1 分 1 秒');
  assert.equal(coverageDuration(3661001), '1 小时 1 分 1.001 秒');
});
test('midnight clipping excludes day-boundary and invalid samples; empty or single ranges imply no gap', () => {
  const duration = to.getTime() - from.getTime();
  const result = recordingCoverage(from, to, [sample(-1000, 1000), sample(duration - 1000, duration + 1000), sample(-3000, 0), sample(duration, duration + 1000), sample(NaN, 1000)]);
  assert.equal(result.coveredMilliseconds, 2000); assert.equal(result.segments, 2);
  assert.equal(result.ranges[0].from, from.toISOString()); assert.equal(result.ranges[1].to, to.toISOString());
  assert.equal(recordingCoverage(from, to, []).gapMilliseconds, 0);
  assert.deepEqual(recordingCoverage(from, to, [sample(1000, 2000)]).gaps, []);
});
