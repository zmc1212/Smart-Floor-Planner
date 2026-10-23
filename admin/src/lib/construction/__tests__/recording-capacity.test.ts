import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capacityFromSamples, capacityGB, retentionCapacity } from '../recording-capacity';

const sample = (bytes: string, seconds: number, start = '2026-10-23T00:00:00.000Z') => ({ bytes, durationMs: String(seconds * 1000), startedAt: start, endedAt: new Date(Date.parse(start) + seconds * 1000).toISOString() });
test('sealed samples estimate decimal bitrate/day/retention with a separate25-percent reserve', () => {
  const result = capacityFromSamples([sample('15000000', 120)]);
  assert.equal(result.averageMbps, 1);
  assert.equal(result.bytesPerDay, '10800000000');
  assert.deepEqual(retentionCapacity(result.bytesPerDay, 3), { bytes: '32400000000', withReserve: '40500000000' });
  assert.equal(capacityGB('40500000000'), '40.5 GB');
});
test('gaps are not treated as recording time and high-rate short files are weighted by actual duration', () => {
  const result = capacityFromSamples([sample('7500000', 60), sample('30000000', 120, '2026-10-23T06:00:00.000Z')]);
  assert.equal(result.sample.seconds, 180);
  assert.equal(result.averageMbps, 1.666);
  assert.equal(result.bytesPerDay, '18000000000');
});
test('missing or insufficient sealed samples stay unknown rather than claiming zero consumption', () => {
  assert.equal(capacityFromSamples([]).bytesPerDay, null);
  assert.equal(capacityFromSamples([sample('7500000', 59)]).averageMbps, null);
  assert.equal(retentionCapacity(null, 3), null);
});
test('invalid samples and retention inputs cannot produce NaN or an off/forever interpretation', () => {
  for (const bytes of ['-1', 'NaN', '1.2', '0']) assert.equal(capacityFromSamples([sample(bytes, 120)]).bytesPerDay, null);
  for (const days of [0, -1, 1.5, 31, NaN]) assert.equal(retentionCapacity('10800000000', days), null);
  assert.equal(capacityGB('NaN'), '未知');
});
test('sample-byte totals and capacity formatting preserve integers above Number safe precision', () => {
  const bytes = '9007199254740993', result = capacityFromSamples([sample(bytes, 86400)]);
  assert.equal(result.bytesPerDay, bytes);
  assert.equal(result.sample.bytes, bytes);
  assert.equal(capacityGB('9007199254740993000000'), '9007199254741.0 GB');
});
