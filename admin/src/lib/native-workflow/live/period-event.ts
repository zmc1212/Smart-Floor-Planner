import { fingerprint } from '@/lib/assistant/contracts';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent, WorkflowValue } from '../types';

/**
 * B5 period contract: one fixed daily period derived from the run event.
 *
 * The period is business data, never a workflow-run identity. `report_key`
 * follows the existing `enqueueReport` formula exactly (kind + start + end +
 * stage event + conversation generation), so a new runId or a new published
 * definition revision can never create a second report for the same day.
 */
export const PERIOD_KIND = 'daily' as const;
export type PeriodKind = typeof PERIOD_KIND;

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function calendarDate(value: unknown): { year: number; month: number; day: number } | null {
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

/**
 * Parse the fixed daily event. Only one partial day is allowed; a period span
 * with different start/end dates is rejected instead of being silently widened.
 */
export function parseFixedDailyPeriod(event: TriggerEvent): FixedPeriod {
  if (event.eventType !== 'period_report') {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'the period report adapter only executes period_report events',
    );
  }
  if (event.periodKind !== PERIOD_KIND) {
    throw new WorkflowOperationError(
      'period_kind_unsupported',
      409,
      `the B-line period adapter only supports ${PERIOD_KIND} reports`,
    );
  }
  const startDate = calendarDate(event.periodStart);
  const endDate = calendarDate(event.periodEnd);
  if (!startDate || !endDate) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'periodStart and periodEnd must be YYYY-MM-DD calendar dates',
    );
  }
  if (event.periodStart !== event.periodEnd) {
    throw new WorkflowOperationError(
      'period_event_invalid',
      409,
      'a daily period must start and end on the same calendar day',
    );
  }
  const occurredAt = new Date(String(event.occurredAt));
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new WorkflowOperationError('period_event_invalid', 409, 'period event occurredAt is invalid');
  }
  const start = new Date(
    Date.UTC(startDate.year, startDate.month - 1, startDate.day) - SHANGHAI_OFFSET_MS,
  );
  const end = new Date(start.getTime() + DAY_MS);
  return {
    kind: PERIOD_KIND,
    periodStart: event.periodStart!,
    periodEnd: event.periodEnd!,
    start,
    end,
    cutoff: end,
    scheduledAt: occurredAt,
  };
}

/** The fixed event is authoritative; a definition may not read another day. */
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
 * Same formula as `enqueueReport` in construction/report-store.ts. The daily
 * kind has no stage event, so `event` is always null; conversationId is only
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
