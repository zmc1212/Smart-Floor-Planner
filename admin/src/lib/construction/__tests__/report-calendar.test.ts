import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctedReportEnd, latestReportPeriod, nextReportAt, reportTime } from '../report-calendar';

test('daily cutoff uses Shanghai midnight even when the host timezone differs', () => {
  const p = latestReportPeriod('daily', new Date('2026-11-01T12:00:00Z'), '20:00');
  assert.equal(p.start.toISOString(), '2026-10-31T16:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-11-01T12:00:00.000Z');
  assert.equal(nextReportAt('daily', p.end, '20:00').toISOString(), '2026-11-02T12:00:00.000Z');
});
test('before the daily cutoff the last due occurrence belongs to yesterday', () => {
  const p = latestReportPeriod('daily', new Date('2026-11-01T11:59:59Z'), '20:00');
  assert.equal(p.scheduledAt.toISOString(), '2026-10-31T12:00:00.000Z');
});
test('Monday weekly report covers the preceding Monday to Monday, not seven daily summaries', () => {
  const p = latestReportPeriod('weekly', new Date('2026-11-02T00:00:00Z'), '08:00');
  assert.equal(p.start.toISOString(), '2026-10-25T16:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-11-01T16:00:00.000Z');
  assert.equal(p.cutoff.toISOString(), p.end.toISOString());
  assert.equal(p.scheduledAt.toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(nextReportAt('weekly', p.scheduledAt, '08:00').toISOString(), '2026-11-09T00:00:00.000Z');
});
test('weekly before Monday delivery remains the preceding due week', () => {
  assert.equal(latestReportPeriod('weekly', new Date('2026-11-01T23:59:59Z'), '08:00').end.toISOString(), '2026-10-25T16:00:00.000Z');
});
test('outage catch-up selects one latest period and advances directly past now', () => {
  const now = new Date('2027-01-03T15:00:00Z');
  assert.equal(latestReportPeriod('daily', now, '20:00').scheduledAt.toISOString(), '2027-01-03T12:00:00.000Z');
  assert.ok(nextReportAt('weekly', now, '08:00') > now);
  assert.ok(nextReportAt('daily', now, '20:00') > now);
});
test('invalid clocks and invalid controllable time are rejected', () => {
  for (const v of ['24:00', '20:60', '8:00', '08:0', '', null, 800]) assert.throws(() => reportTime(v));
  assert.throws(() => latestReportPeriod('daily', new Date('invalid'), '20:00'));
});

test('daily corrections extend the latest saved version, capped at Shanghai midnight', () => {
  const start = new Date('2026-11-10T16:00:00Z'), cutoff = new Date('2026-11-11T12:00:00Z');
  const supplemented = correctedReportEnd('daily', start, cutoff, new Date('2026-11-11T14:00:00Z'));
  assert.equal(supplemented.toISOString(), '2026-11-11T14:00:00.000Z');
  assert.equal(correctedReportEnd('daily', start, supplemented, cutoff).toISOString(), supplemented.toISOString());
  assert.equal(correctedReportEnd('daily', start, cutoff, new Date('2026-11-13T02:00:00Z')).toISOString(), '2026-11-11T16:00:00.000Z');
});

test('weekly corrections preserve the completed period even when requested next week', () => {
  const p = latestReportPeriod('weekly', new Date('2026-11-02T00:00:00Z'), '08:00');
  assert.equal(correctedReportEnd('weekly', p.start, p.end, new Date('2026-11-10T00:00:00Z')).toISOString(), p.end.toISOString());
  assert.throws(() => correctedReportEnd('daily', p.start, p.end, new Date('invalid')));
});
