/** Pure CLI-side period selection for the B5.4 development entry points.
 *
 * The scripts must derive one fixed daily/weekly period before the live runner
 * starts. These helpers only validate the requested calendar window; the
 * trusted "has it ended?" check stays in `parseFixedPeriod` with its own clock.
 * Keeping the arithmetic here makes the CLI rules testable without a database.
 */

import type { LivePeriodReceiver } from './types';

export const PERIOD_CLI_KINDS = ['daily', 'weekly'] as const;
export type PeriodCliKind = (typeof PERIOD_CLI_KINDS)[number];

export const PERIOD_RECEIVER_KINDS = ['customer', 'worker'] as const;
export type PeriodReceiverKind = (typeof PERIOD_RECEIVER_KINDS)[number];

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

export interface CliOption {
  /** True when the option name appears in argv at all. */
  readonly present: boolean;
  /** The option value; undefined when the option was provided without one. */
  readonly value?: string;
}

/**
 * Separate "--period-kind is absent" from "--period-kind has no value".
 * Both `--name` and `--name=value` spellings are accepted; an empty value and a
 * following `--flag` both count as "present but valueless" so an explicitly
 * provided flag can never silently fall back to a default.
 */
export function readCliOption(argv: readonly string[], name: string): CliOption {
  const index = argv.indexOf(name);
  if (index >= 0) {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) return { present: true };
    return { present: true, value };
  }
  const prefix = `${name}=`;
  const inline = argv.find((entry) => entry.startsWith(prefix));
  if (inline === undefined) return { present: false };
  const value = inline.slice(prefix.length);
  return value === '' ? { present: true } : { present: true, value };
}

/**
 * Resolve `--period-kind` for the CLI entry points. Only an absent flag
 * defaults to daily; a provided flag without a value and an unknown value are
 * rejected before the caller touches a database.
 */
export function parsePeriodKindArg(argv: readonly string[]): PeriodCliKind {
  const option = readCliOption(argv, '--period-kind');
  if (!option.present) return 'daily';
  if (option.value === undefined) {
    throw new PeriodCliError('period_kind_missing', '--period-kind requires a value (daily or weekly)');
  }
  if (!(PERIOD_CLI_KINDS as readonly string[]).includes(option.value)) {
    throw new PeriodCliError('period_kind_invalid', '--period-kind must be daily or weekly');
  }
  return option.value as PeriodCliKind;
}

/**
 * Resolve `--receiver-kind` for the CLI entry points. Only an absent flag
 * defaults to the existing owner/customer receiver; a provided flag without a
 * value and an unknown value are rejected before the caller touches a database.
 */
export function parseReceiverKindArg(argv: readonly string[]): PeriodReceiverKind {
  const option = readCliOption(argv, '--receiver-kind');
  if (!option.present) return 'customer';
  if (option.value === undefined) {
    throw new PeriodCliError('receiver_kind_missing', '--receiver-kind requires a value (customer or worker)');
  }
  if (!(PERIOD_RECEIVER_KINDS as readonly string[]).includes(option.value)) {
    throw new PeriodCliError('receiver_kind_invalid', '--receiver-kind must be customer or worker');
  }
  return option.value as PeriodReceiverKind;
}

/**
 * Resolve `--worker-id` against the selected receiver kind. A worker receiver
 * requires one positive admin id; a customer receiver must not carry one.
 */
export function parseWorkerIdArg(
  argv: readonly string[],
  kind: PeriodReceiverKind,
): string | undefined {
  const option = readCliOption(argv, '--worker-id');
  if (kind === 'customer') {
    if (option.present) {
      throw new PeriodCliError('worker_id_forbidden', '--worker-id is only valid for a worker receiver');
    }
    return undefined;
  }
  if (!option.present) {
    throw new PeriodCliError('worker_id_missing', '--worker-id is required for a worker receiver');
  }
  if (option.value === undefined || !/^[1-9]\d{0,18}$/.test(option.value)) {
    throw new PeriodCliError('worker_id_invalid', '--worker-id must be a positive integer admin id');
  }
  return option.value;
}

/** Host-owned receiver identity assembled from the validated CLI flags. */
export function parseReceiverArg(argv: readonly string[]): LivePeriodReceiver {
  const kind = parseReceiverKindArg(argv);
  const workerId = parseWorkerIdArg(argv, kind);
  return kind === 'worker'
    ? { kind: 'worker', adminId: workerId }
    : { kind: 'customer' };
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
