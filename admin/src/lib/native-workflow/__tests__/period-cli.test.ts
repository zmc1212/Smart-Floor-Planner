import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addCalendarDays,
  parsePeriodKind,
  PERIOD_DEFINITION_ID,
  resolveCliPeriod,
} from '../live/period-cli';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? '';
  }
  assert.fail('expected the period helper to throw');
}

test('period kind defaults to daily and accepts weekly', () => {
  assert.equal(parsePeriodKind(undefined), 'daily');
  assert.equal(parsePeriodKind('daily'), 'daily');
  assert.equal(parsePeriodKind('weekly'), 'weekly');
  const invalid = ['monthly', 'Daily', '', 'daily '];
  for (const kind of invalid) {
    assert.equal(codeOf(() => parsePeriodKind(kind)), 'period_kind_invalid');
  }
});

test('daily keeps the original single-day command', () => {
  const resolved = resolveCliPeriod({ kind: 'daily', periodStart: '2026-11-03' });
  assert.deepEqual(resolved, {
    kind: 'daily',
    periodStart: '2026-11-03',
    periodEnd: '2026-11-03',
    definitionId: PERIOD_DEFINITION_ID.daily,
    eventId: 'b5-period-daily-2026-11-03',
  });
  assert.equal(resolveCliPeriod({ kind: 'daily', periodStart: '2026-11-03', periodEnd: '2026-11-03' })
    .periodEnd, '2026-11-03');
});

test('daily rejects a span that is not one calendar day', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'daily', periodStart: '2026-11-03', periodEnd: '2026-11-04' })),
    'period_end_invalid',
  );
});

test('weekly derives the exclusive Monday-to-Monday window', () => {
  const resolved = resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02' });
  assert.deepEqual(resolved, {
    kind: 'weekly',
    periodStart: '2026-11-02',
    periodEnd: '2026-11-09',
    definitionId: PERIOD_DEFINITION_ID.weekly,
    eventId: 'b5-period-weekly-2026-11-02',
  });
  assert.equal(addCalendarDays('2026-10-26', 7), '2026-11-02');
  assert.equal(addCalendarDays('2026-12-28', 7), '2027-01-04');
});

test('weekly accepts an explicit matching period end', () => {
  const resolved = resolveCliPeriod({
    kind: 'weekly',
    periodStart: '2026-11-02',
    periodEnd: '2026-11-09',
  });
  assert.equal(resolved.periodEnd, '2026-11-09');
});

test('weekly rejects a non-Monday start', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-03' })),
    'period_start_not_monday',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-08' })),
    'period_start_not_monday',
  );
});

test('weekly rejects a partial or over-long week', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-06' })),
    'period_end_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-16' })),
    'period_end_invalid',
  );
});

test('invalid calendar dates are rejected for both kinds', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'daily', periodStart: '2026-02-30' })),
    'periodStart_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-13-01' })),
    'periodStart_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-31' })),
    'periodEnd_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'daily', periodStart: '2026-1-03' })),
    'periodStart_invalid',
  );
});
