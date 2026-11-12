import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantError } from '@/lib/assistant/contracts';
import {
  assertConfiguredProject,
  legacyScheduleDue,
} from '../live/period-report-ports';
import { nextWeeklyClaimAt } from '../live/period-report-schedule-calendar';

test('weekly_claimed allows a due daily schedule but still rejects a due weekly one', () => {
  const dueDaily = {
    enabled: true,
    stage_enabled: false,
    next_daily_at: '2020-01-01T00:00:00.000Z',
    next_weekly_at: '2099-01-01T00:00:00.000Z',
  };
  assert.equal(legacyScheduleDue(dueDaily), true);
  assert.equal(legacyScheduleDue(dueDaily, 'weekly_claimed'), false);
  assert.equal(legacyScheduleDue({ ...dueDaily, next_weekly_at: '2020-01-01T00:00:00.000Z' }), true);
  assert.equal(
    legacyScheduleDue({ ...dueDaily, next_weekly_at: '2020-01-01T00:00:00.000Z' }, 'weekly_claimed'),
    true,
  );
  assert.equal(legacyScheduleDue({ ...dueDaily, stage_enabled: true }, 'weekly_claimed'), true);
  assert.equal(legacyScheduleDue({ ...dueDaily, enabled: false }, 'weekly_claimed'), false);
});

test('plan scope accepts an empty or multi-project plan but keeps the single-project contract', () => {
  assert.doesNotThrow(() => assertConfiguredProject(
    { project_ids: [] },
    '1454000004',
    'worker',
    'plan',
  ));
  assert.doesNotThrow(() => assertConfiguredProject(
    { project_ids: ['1454000004', '1454000005'] },
    '1454000004',
    'designer',
    'plan',
  ));
  assert.throws(
    () => assertConfiguredProject({ project_ids: [] }, '1454000004', 'worker', 'single'),
    (error: unknown) => error instanceof AssistantError
      && error.code === 'period_report_project_scope_mismatch',
  );
  assert.throws(
    () => assertConfiguredProject(
      { project_ids: ['1454000005'] },
      '1454000004',
      'customer',
      'plan',
    ),
    (error: unknown) => error instanceof AssistantError
      && error.code === 'period_report_project_out_of_scope',
  );
  assert.throws(
    () => assertConfiguredProject(
      { project_ids: ['1454000004', '1454000005'] },
      '1454000004',
      'boss',
      'single',
    ),
    (error: unknown) => error instanceof AssistantError
      && error.code === 'period_report_project_scope_mismatch',
  );
});

test('the weekly claim skips a legacy occurrence that still processes the same week', () => {
  // Monday 2026-11-09 07:00 Shanghai, before the 08:00 weekly clock.
  const beforeClock = nextWeeklyClaimAt({
    now: new Date('2026-11-08T23:00:00.000Z'),
    weeklyTime: '08:00',
    weeklyDay: 1,
    periodStart: new Date('2026-11-01T16:00:00.000Z'),
  });
  assert.equal(beforeClock.toISOString(), '2026-11-16T00:00:00.000Z');
  // Monday 09:00 Shanghai, after the clock: the next occurrence already uses
  // the following week.
  const afterClock = nextWeeklyClaimAt({
    now: new Date('2026-11-09T01:00:00.000Z'),
    weeklyTime: '08:00',
    weeklyDay: 1,
    periodStart: new Date('2026-11-01T16:00:00.000Z'),
  });
  assert.equal(afterClock.toISOString(), '2026-11-16T00:00:00.000Z');
  // Wednesday: the next Monday already belongs to the following week.
  const midWeek = nextWeeklyClaimAt({
    now: new Date('2026-11-11T02:00:00.000Z'),
    weeklyTime: '08:00',
    weeklyDay: 1,
    periodStart: new Date('2026-11-01T16:00:00.000Z'),
  });
  assert.equal(midWeek.toISOString(), '2026-11-16T00:00:00.000Z');
});
