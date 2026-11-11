/** Pure CLI-side period selection for the B5.4 development entry points.
 *
 * The scripts must derive one fixed daily/weekly period before the live runner
 * starts. These helpers only validate the requested calendar window; the
 * trusted "has it ended?" check stays in `parseFixedPeriod` with its own clock.
 * Keeping the arithmetic here makes the CLI rules testable without a database.
 */

export const PERIOD_CLI_KINDS = ['daily', 'weekly'] as const;
export type PeriodCliKind = (typeof PERIOD_CLI_KINDS)[number];

export const PERIOD_DEFINITION_ID: Readonly<Record<PeriodCliKind, string>> = {
  daily: 'period-report-daily',
  weekly: 'period-report-weekly',
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class PeriodCliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PeriodCliError';
    this.code = code;
  }
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function calendarDate(value: string, field: string): CalendarDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new PeriodCliError(`${field}_invalid`, `${field} must be YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    throw new PeriodCliError(`${field}_invalid`, `${field} must be a real calendar date`);
  }
  return { year, month, day };
}

/** Shanghai has no DST, so calendar arithmetic on the date parts is exact. */
export function addCalendarDays(value: string, days: number): string {
  const { year, month, day } = calendarDate(value, 'period_date');
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekday(value: string): number {
  const { year, month, day } = calendarDate(value, 'period_date');
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function parsePeriodKind(value: string | undefined): PeriodCliKind {
  if (value === undefined || value === 'daily') return 'daily';
  if (value === 'weekly') return 'weekly';
  throw new PeriodCliError('period_kind_invalid', 'period kind must be daily or weekly');
}

export interface CliPeriodInput {
  readonly kind: PeriodCliKind;
  readonly periodStart: string;
  readonly periodEnd?: string;
}

export interface ResolvedCliPeriod {
  readonly kind: PeriodCliKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly definitionId: string;
  readonly eventId: string;
}

/**
 * Resolve the CLI window. A daily period is one Shanghai day; a weekly period
 * must start on a Monday and end exactly seven calendar days later (exclusive
 * end, the same Monday-to-Monday window the report settings use).
 */
export function resolveCliPeriod(input: CliPeriodInput): ResolvedCliPeriod {
  calendarDate(input.periodStart, 'periodStart');
  if (input.periodEnd !== undefined) calendarDate(input.periodEnd, 'periodEnd');

  if (input.kind === 'daily') {
    const periodEnd = input.periodEnd ?? input.periodStart;
    if (periodEnd !== input.periodStart) {
      throw new PeriodCliError(
        'period_end_invalid',
        'a daily period must start and end on the same calendar day',
      );
    }
    return {
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd,
      definitionId: PERIOD_DEFINITION_ID.daily,
      eventId: `b5-period-daily-${input.periodStart}`,
    };
  }

  if (weekday(input.periodStart) !== 1) {
    throw new PeriodCliError(
      'period_start_not_monday',
      'a weekly period must start on a Shanghai Monday',
    );
  }
  const expectedEnd = addCalendarDays(input.periodStart, 7);
  const periodEnd = input.periodEnd ?? expectedEnd;
  if (periodEnd !== expectedEnd) {
    throw new PeriodCliError(
      'period_end_invalid',
      'a weekly period must span exactly seven days (periodEnd = periodStart + 7)',
    );
  }
  return {
    kind: input.kind,
    periodStart: input.periodStart,
    periodEnd,
    definitionId: PERIOD_DEFINITION_ID.weekly,
    eventId: `b5-period-weekly-${input.periodStart}`,
  };
}
