import { fingerprint } from '@/lib/assistant/contracts';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent, WorkflowValue } from '../types';

/**
 * B5 period contract: one fixed daily or weekly period derived from the run
 * event.
 *
 * The period is business data, never a workflow-run identity. `report_key`
 * follows the existing `enqueueReport` formula exactly (kind + start + end +
 * stage event + conversation generation), so a new runId or a new published
 * definition revision can never create a second report for the same period.
 * A daily and a weekly period never share a key even when their dates overlap,
 * because `kind` is part of the formula.
 */
export const PERIOD_KIND = 'daily' as const;
export const PERIOD_KINDS = ['daily', 'weekly'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONDAY = 1;

export interface FixedPeriod {
  readonly kind: PeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly start: Date;
  /** Exclusive end boundary; also the facts cutoff. */
  readonly end: Date;
  readonly cutoff: Date;
  readonly scheduledAt: Date;
}

export interface PeriodConversationGeneration {
  readonly id: string;
  readonly followupGeneration?: unknown;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function calendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Shanghai midnight for a calendar date. Shanghai has no DST. */
function shanghaiMidnight(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day) - SHANGHAI_OFFSET_MS);
}

/** Shanghai-local weekday of a calendar date, 0 = Sunday. */
function shanghaiWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function calendarDayNumber(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
}

function assertPeriodEvent(event: TriggerEvent): void {
  if (event.eventType !== 'period_report') {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'the period report adapter only executes period_report events',
    );
  }
}

function eventDates(event: TriggerEvent): { startDate: CalendarDate; endDate: CalendarDate } {
  const startDate = calendarDate(event.periodStart);
  const endDate = calendarDate(event.periodEnd);
  if (!startDate || !endDate) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'periodStart and periodEnd must be YYYY-MM-DD calendar dates',
    );
  }
  return { startDate, endDate };
}

function eventScheduleStamp(event: TriggerEvent): Date {
  const occurredAt = new Date(String(event.occurredAt));
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new WorkflowOperationError('period_event_invalid', 409, 'period event occurredAt is invalid');
  }
  return occurredAt;
}

function assertEnded(end: Date, now: Date, label: string): void {
  if (end.getTime() > now.getTime()) {
    throw new WorkflowOperationError(
      'period_not_ended',
      409,
      `the ${label} period has not ended in the Shanghai timezone yet`,
    );
  }
}

/**
 * A daily period is one Shanghai calendar day. Both dates must be the same
 * day; a span is rejected instead of being silently widened.
 */
function parseDailyEvent(event: TriggerEvent, now: Date): FixedPeriod {
  const { startDate } = eventDates(event);
  if (event.periodStart !== event.periodEnd) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'a daily period must start and end on the same calendar day',
    );
  }
  const occurredAt = eventScheduleStamp(event);
  const start = shanghaiMidnight(startDate);
  const end = new Date(start.getTime() + DAY_MS);
  assertEnded(end, now, 'daily');
  return {
    kind: 'daily',
    periodStart: event.periodStart!,
    periodEnd: event.periodEnd!,
    start,
    end,
    cutoff: end,
    scheduledAt: occurredAt,
  };
}

/**
 * A weekly period is a complete Monday-to-Monday Shanghai week, right-open.
 * Both dates must be Mondays and the end must be exactly seven days after the
 * start, so a partial week, a cross-week span or a non-Monday anchor is
 * rejected rather than silently normalized.
 */
function parseWeeklyEvent(event: TriggerEvent, now: Date): FixedPeriod {
  const { startDate, endDate } = eventDates(event);
  if (shanghaiWeekday(startDate) !== MONDAY) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'a weekly period must start on a Monday in the Shanghai timezone',
    );
  }
  if (shanghaiWeekday(endDate) !== MONDAY) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'a weekly period must end on a Monday in the Shanghai timezone',
    );
  }
  if (calendarDayNumber(endDate) - calendarDayNumber(startDate) !== 7) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'a weekly period must span exactly seven days from Monday to Monday',
    );
  }
  const occurredAt = eventScheduleStamp(event);
  const start = shanghaiMidnight(startDate);
  const end = shanghaiMidnight(endDate);
  assertEnded(end, now, 'weekly');
  return {
    kind: 'weekly',
    periodStart: event.periodStart!,
    periodEnd: event.periodEnd!,
    start,
    end,
    cutoff: end,
    scheduledAt: occurredAt,
  };
}

/**
 * Parse the fixed period event, dispatching on `periodKind`.
 *
 * `now` is the trusted server clock (or a test seam). A period may only run
 * after its Shanghai window has ended; `occurredAt` is the schedule stamp and
 * never decides whether the period is over.
 */
export function parseFixedPeriod(event: TriggerEvent, now: Date = new Date()): FixedPeriod {
  assertPeriodEvent(event);
  if (event.periodKind === 'daily') return parseDailyEvent(event, now);
  if (event.periodKind === 'weekly') return parseWeeklyEvent(event, now);
  throw new WorkflowOperationError(
    'period_kind_unsupported',
    409,
    'the B-line period adapter only supports daily or weekly reports',
  );
}

/**
 * Daily-only compatibility wrapper. A weekly event is still rejected with
 * `period_kind_unsupported` so callers that have not adopted
 * `parseFixedPeriod` cannot silently run a weekly period.
 */
export function parseFixedDailyPeriod(event: TriggerEvent, now: Date = new Date()): FixedPeriod {
  assertPeriodEvent(event);
  if (event.periodKind !== PERIOD_KIND) {
    throw new WorkflowOperationError(
      'period_kind_unsupported',
      409,
      `the B-line period adapter only supports ${PERIOD_KIND} reports`,
    );
  }
  return parseDailyEvent(event, now);
}

/** The fixed event is authoritative; a definition may not read another period. */
export function assertOperationPeriodMatches(
  input: Readonly<Record<string, WorkflowValue>>,
  period: FixedPeriod,
): void {
  if (
    input.periodKind !== period.kind
    || input.periodStart !== period.periodStart
    || input.periodEnd !== period.periodEnd
  ) {
    throw new WorkflowOperationError(
      'period_binding_mismatch',
      409,
      'operation period does not match the fixed run event',
    );
  }
}

/**
 * Same formula as `enqueueReport` in construction/report-store.ts. The period
 * has no stage event, so `event` is always null; conversationId is only
 * included after a retained self-resume starts a new generation.
 */
export function periodReportKey(
  period: FixedPeriod,
  conversation: PeriodConversationGeneration | null,
): string {
  return fingerprint({
    kind: period.kind,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    event: null,
    ...(conversation?.followupGeneration ? { conversationId: String(conversation.id) } : {}),
  });
}
