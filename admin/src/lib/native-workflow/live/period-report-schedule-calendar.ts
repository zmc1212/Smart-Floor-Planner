/** Pure weekly-schedule arithmetic for the B5.9 claim.
 *
 * The claim advances the existing `construction_report_settings.next_weekly_at`
 * so the legacy weekly scheduler cannot process the same Monday-to-Monday week
 * after the B scheduler has taken it. It reuses the existing report calendar
 * formula; it does not invent a second cadence.
 */

import { latestReportPeriod, nextReportAt } from '@/lib/construction/report-calendar';

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
