/** Pure client-side helpers for the read-only period-report run status tab.
 *
 * These functions never call the network or execute a workflow; they only
 * decide when the admin page may keep polling and how a failed read merges
 * with the last trusted observation.
 */
import type {
  PeriodOverallState,
  PeriodReportProgress,
  PeriodReportRunObservation,
} from './live/period-report-status';

/** Polling cadence for a processing run. */
export const PERIOD_RUN_POLL_INTERVAL_MS = 3000;
/** Hard cap so a page left open never polls forever. */
export const PERIOD_RUN_POLL_MAX_READS = 100;

export interface PeriodRunStatusState {
  readonly observation: PeriodReportRunObservation | null;
  readonly error: string | null;
}

export type PeriodRunObservationLoad =
  | { readonly observation: PeriodReportRunObservation }
  | { readonly error: string };

const TERMINAL_OVERALL: ReadonlySet<PeriodOverallState> = new Set([
  'completed',
  'failed',
  'unknown',
  'unavailable',
]);

const OVERALL_LABELS: Readonly<Record<PeriodOverallState, string>> = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  unknown: '未知',
  unavailable: '不可用',
};

/** Terminal means no further automatic read can change the outcome. */
export function isPeriodRunTerminal(observation: PeriodReportRunObservation | null): boolean {
  if (!observation) return false;
  if (!observation.bound) return true;
  if (!observation.progress) return true;
  return TERMINAL_OVERALL.has(observation.progress.overall);
}

/** Milliseconds until the next read, or null when polling must stop. */
export function nextPeriodRunPollDelay(
  observation: PeriodReportRunObservation | null,
  reads: number,
): number | null {
  if (!observation || !observation.bound) return null;
  const progress = observation.progress;
  if (!progress || !progress.processing || isPeriodRunTerminal(observation)) return null;
  if (reads >= PERIOD_RUN_POLL_MAX_READS) return null;
  return PERIOD_RUN_POLL_INTERVAL_MS;
}

/** A failed read keeps the last trusted observation and records the error. */
export function mergePeriodRunObservation(
  previous: PeriodRunStatusState,
  load: PeriodRunObservationLoad,
): PeriodRunStatusState {
  if ('observation' in load) {
    return { observation: load.observation, error: null };
  }
  return { observation: previous.observation, error: load.error };
}

/** Short Chinese label that keeps the contract's overall meaning unchanged. */
export function formatPeriodRunState(progress: PeriodReportProgress | null | undefined): string {
  if (!progress) return '未读取';
  return OVERALL_LABELS[progress.overall] ?? '未知';
}
