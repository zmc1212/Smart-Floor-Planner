/** Pure weekly-schedule arithmetic for the B5.9 claim.
 *
 * The claim advances the existing `construction_report_settings.next_weekly_at`
 * so the legacy weekly scheduler cannot process the same Monday-to-Monday week
 * after the B scheduler has taken it. It reuses the existing report calendar
 * formula; it does not invent a second cadence.
 *
 * A finished Monday-to-Monday week is not the same instant as the enterprise's
 * configured weekly execution time. `weeklyExecutionAt()` maps a fixed
 * Monday-to-Monday period to the first `weekly_day`/`weekly_time` instant at or
 * after its end, which is the real gate before the first report of that week.
 */

import { latestReportPeriod, nextReportAt } from '@/lib/construction/report-calendar';

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const WEEKLY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface WeeklyExecutionConfig {
  readonly weeklyDay: number;
  readonly weeklyTime: string;
}

/**
 * Validate the persisted weekly plan values before they decide a gate.
 * The existing report service only stores 1..7 and `HH:MM`; a corrupt or
 * manually edited row must block dispatch instead of being normalized.
 */
export function parseWeeklyExecutionConfig(
  weeklyDay: unknown,
  weeklyTime: unknown,
): WeeklyExecutionConfig | null {
  const day = typeof weeklyDay === 'number' ? weeklyDay : Number(weeklyDay);
  const time = typeof weeklyTime === 'string' ? weeklyTime : '';
  if (!Number.isInteger(day) || day < 1 || day > 7) return null;
  if (!WEEKLY_TIME_PATTERN.test(time)) return null;
  return { weeklyDay: day, weeklyTime: time };
}

/**
 * First configured weekly execution instant at or after `periodEnd`.
 *
 * `periodEnd` is the exclusive end of a complete Shanghai Monday-to-Monday
 * week. For `weekly_day=1` this is the same Monday; any other day is later in
 * the same Shanghai calendar week. Shanghai has no DST, so UTC arithmetic is
 * exact and independent of the host timezone.
 */
export function weeklyExecutionAt(input: {
  readonly periodEnd: Date;
  readonly weeklyDay: number;
  readonly weeklyTime: string;
}): Date {
  const config = parseWeeklyExecutionConfig(input.weeklyDay, input.weeklyTime);
  if (!config) {
    throw new Error('weekly_day/weekly_time is not a valid report schedule');
  }
  const [hours, minutes] = config.weeklyTime.split(':').map(Number);
  const clock = (hours! * 60 + minutes!) * 60_000;
  const local = new Date(input.periodEnd.getTime() + SHANGHAI_OFFSET_MS);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ) - SHANGHAI_OFFSET_MS;
  // 0 = Sunday in UTC; the stored weekly_day uses 1 = Monday ... 7 = Sunday.
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const daysAhead = (config.weeklyDay - weekday + 7) % 7;
  let at = localMidnight + daysAhead * DAY_MS + clock;
  if (at < input.periodEnd.getTime()) at += 7 * DAY_MS;
  return new Date(at);
}

export function nextWeeklyClaimAt(input: {
  readonly now: Date;
  readonly weeklyTime: string;
  readonly weeklyDay: number;
  readonly periodStart: Date;
}): Date {
  let next = nextReportAt('weekly', input.now, input.weeklyTime, input.weeklyDay);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const legacy = latestReportPeriod(
      'weekly',
      next,
      input.weeklyTime,
      input.weeklyDay,
    );
    if (legacy.start.getTime() !== input.periodStart.getTime()) break;
    next = new Date(next.getTime() + 7 * 86_400_000);
  }
  return next;
}
