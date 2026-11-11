import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '@/lib/assistant/contracts';
import type { TriggerEvent } from '../types';
import {
  parseFixedDailyPeriod,
  parseFixedPeriod,
  periodReportKey,
} from '../live/period-event';

/** Complete Shanghai week: Monday 2026-11-02 to Monday 2026-11-09, right-open. */
const weeklyEvent: TriggerEvent = {
  eventId: 'b5-weekly-20261109',
  eventType: 'period_report',
  occurredAt: '2026-11-09T02:00:00.000Z',
  periodKind: 'weekly',
  periodStart: '2026-11-02',
  periodEnd: '2026-11-09',
};

/** Exclusive end of the 2026-11-02..2026-11-09 Shanghai week (Monday 00:00). */
const WEEKLY_END = new Date('2026-11-08T16:00:00.000Z');

const dailyEvent: TriggerEvent = {
  eventId: 'b5-daily-20261102',
  eventType: 'period_report',
  occurredAt: '2026-11-03T02:00:00.000Z',
  periodKind: 'daily',
  periodStart: '2026-11-02',
  periodEnd: '2026-11-02',
};

function errorCode(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

test('a weekly period is a right-open Monday-to-Monday Shanghai week', () => {
  const period = parseFixedPeriod(weeklyEvent, WEEKLY_END);
  assert.equal(period.kind, 'weekly');
  assert.equal(period.periodStart, '2026-11-02');
  assert.equal(period.periodEnd, '2026-11-09');
  assert.equal(period.start.toISOString(), '2026-11-01T16:00:00.000Z');
  assert.equal(period.end.toISOString(), '2026-11-08T16:00:00.000Z');
  assert.equal(period.cutoff.toISOString(), period.end.toISOString());
  // occurredAt is only the schedule stamp.
  assert.equal(period.scheduledAt.toISOString(), weeklyEvent.occurredAt);
});

test('a weekly period rejects partial, cross-week and non-Monday spans', () => {
  const invalid = errorCode('period_event_invalid');
  const reject = (start: string, end: string) => {
    assert.throws(
      () => parseFixedPeriod(
        { ...weeklyEvent, periodStart: start, periodEnd: end },
        WEEKLY_END,
      ),
      invalid,
    );
  };

  // Tuesday start / Tuesday end.
  reject('2026-11-03', '2026-11-10');
  // End is not exactly seven days after the start.
  reject('2026-11-02', '2026-11-06');
  // Two weeks instead of one.
  reject('2026-11-02', '2026-11-16');
  // Start and end are the same day.
  reject('2026-11-02', '2026-11-02');
  // Wednesday start, Monday end.
  reject('2026-11-04', '2026-11-11');

  assert.throws(
    () => parseFixedPeriod(
      { ...weeklyEvent, periodStart: '2026-02-30', periodEnd: '2026-03-09' },
      WEEKLY_END,
    ),
    invalid,
  );
  assert.throws(
    () => parseFixedPeriod(
      { ...weeklyEvent, eventType: 'stage_changed' },
      WEEKLY_END,
    ),
    invalid,
  );
  assert.throws(
    () => parseFixedPeriod(
      { ...weeklyEvent, periodKind: 'monthly' } as unknown as TriggerEvent,
      WEEKLY_END,
    ),
    errorCode('period_kind_unsupported'),
  );
});

test('a weekly period may only run after its Shanghai week has ended', () => {
  const notEnded = errorCode('period_not_ended');
  assert.throws(
    () => parseFixedPeriod(weeklyEvent, new Date('2026-11-08T15:59:59.999Z')),
    notEnded,
  );
  assert.doesNotThrow(
    () => parseFixedPeriod(weeklyEvent, new Date('2026-11-08T16:00:00.000Z')),
  );
  assert.doesNotThrow(
    () => parseFixedPeriod(weeklyEvent, new Date('2026-11-08T16:00:00.001Z')),
  );

  // A forged future occurredAt cannot end the week early.
  assert.throws(
    () => parseFixedPeriod(
      { ...weeklyEvent, occurredAt: '2026-11-20T00:00:00.000Z' },
      new Date('2026-11-08T15:00:00.000Z'),
    ),
    notEnded,
  );
  // A past occurredAt still cannot end a week whose end is in the future.
  assert.throws(
    () => parseFixedPeriod(
      { ...weeklyEvent, occurredAt: '2026-11-01T00:00:00.000Z' },
      new Date('2026-11-08T15:00:00.000Z'),
    ),
    notEnded,
  );
});

test('parseFixedDailyPeriod stays a daily-only compatibility wrapper', () => {
  const daily = parseFixedDailyPeriod(dailyEvent, new Date('2026-11-03T00:00:00.000Z'));
  assert.equal(daily.kind, 'daily');
  assert.equal(daily.start.toISOString(), '2026-11-01T16:00:00.000Z');
  assert.equal(daily.end.toISOString(), '2026-11-02T16:00:00.000Z');

  assert.throws(
    () => parseFixedDailyPeriod(weeklyEvent, WEEKLY_END),
    errorCode('period_kind_unsupported'),
  );
});

test('a weekly report key never collides with a same-day daily key', () => {
  const weekly = parseFixedPeriod(weeklyEvent, WEEKLY_END);
  const daily = parseFixedPeriod(dailyEvent, new Date('2026-11-03T00:00:00.000Z'));

  const expected = fingerprint({
    kind: 'weekly',
    start: weekly.start.toISOString(),
    end: weekly.end.toISOString(),
    event: null,
  });
  assert.equal(periodReportKey(weekly, null), expected);
  assert.notEqual(periodReportKey(weekly, null), periodReportKey(daily, null));

  // The same week stays stable across runs, revisions and forged stamps.
  const sameWeek = parseFixedPeriod(
    { ...weeklyEvent, eventId: 'another-run', occurredAt: '2026-11-10T00:00:00.000Z' },
    new Date('2026-11-10T00:00:00.000Z'),
  );
  assert.equal(periodReportKey(sameWeek, null), expected);
  assert.equal(periodReportKey(weekly, { id: '7001' }), expected);

  // A retained self-resume generation is the only addition to the key.
  assert.notEqual(
    periodReportKey(weekly, { id: '7001', followupGeneration: 2 }),
    expected,
  );
  assert.equal(
    periodReportKey(weekly, { id: '7001', followupGeneration: 2 }),
    periodReportKey(weekly, { id: '7001', followupGeneration: 3 }),
  );
});
