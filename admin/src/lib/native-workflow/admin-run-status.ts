/** Pure client-side helpers for the read-only period-report run status tab.
 *
 * These functions never call the network or execute a workflow; they only
 * decide when the admin page may keep polling and how a failed read merges
 * with the last trusted observation.
 *
 * `createPeriodRunStatusController` owns the page's read lifecycle: the active
 * runId, request generation (so a late response can never overwrite a newer
 * run), loading, the poll timer, halt reasons and the difference between a
 * transient failure (keep the last snapshot) and an authorization failure
 * (drop it). The page only wires React state to it.
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
  'stopped',
  'failed',
  'unknown',
  'unavailable',
]);

const OVERALL_LABELS: Readonly<Record<PeriodOverallState, string>> = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  stopped: '已停止投递',
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

// ---------------------------------------------------------------------------
// Read lifecycle controller
// ---------------------------------------------------------------------------

/** Why automatic reads are not running right now. */
export type PeriodRunHalt = 'idle' | 'terminal' | 'limit' | 'error' | 'restricted';

/** `restricted` clears the whole snapshot; `transient` keeps it. */
export type PeriodRunFailureKind = 'restricted' | 'transient';

export interface PeriodRunReadError {
  readonly kind: PeriodRunFailureKind;
  readonly status: number | null;
  readonly message: string;
  /** Client clock when the failed read returned. */
  readonly at: string;
}

export interface PeriodRunStatusControllerState {
  readonly runId: string;
  readonly observation: PeriodReportRunObservation | null;
  readonly error: PeriodRunReadError | null;
  readonly loading: boolean;
  /** Completed read attempts for the current runId (success or failure). */
  readonly reads: number;
  readonly halt: PeriodRunHalt;
  /** True while the status UI is visible and reads are allowed. */
  readonly active: boolean;
}

export const INITIAL_PERIOD_RUN_STATUS_STATE: PeriodRunStatusControllerState = {
  runId: '',
  observation: null,
  error: null,
  loading: false,
  reads: 0,
  halt: 'idle',
  active: false,
};

/**
 * The page's fetch adapter normalizes the API response; classification stays
 * here so a page can never accidentally show a forbidden snapshot.
 */
export type PeriodRunObservationResult =
  | { readonly ok: true; readonly observation: PeriodReportRunObservation }
  | { readonly ok: false; readonly status: number | null; readonly message: string };

export type PeriodRunObservationFetcher = (
  runId: string,
) => Promise<PeriodRunObservationResult>;

export interface PeriodRunStatusControllerOptions {
  readonly fetchObservation: PeriodRunObservationFetcher;
  readonly onChange: (state: PeriodRunStatusControllerState) => void;
  /** Wall clock for `error.at`; defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly intervalMs?: number;
  readonly maxReads?: number;
}

export interface PeriodRunStatusController {
  getState(): PeriodRunStatusControllerState;
  /** Read a run explicitly (manual button or a new URL runId). */
  start(runId: string): void;
  /** Enter the live tab: resume once when the previous cycle was interrupted. */
  activate(): void;
  /** Leave the live tab: stop the timer, drop in-flight responses, clear loading. */
  deactivate(): void;
  dispose(): void;
}

/** 401/403/404 are explicit denials; anything else is a transient failure. */
export function isRestrictedPeriodRunStatus(status: number | null): boolean {
  return status === 401 || status === 403 || status === 404;
}

export function createPeriodRunStatusController(
  options: PeriodRunStatusControllerOptions,
): PeriodRunStatusController {
  const now = options.now ?? (() => new Date().toISOString());
  const intervalMs = options.intervalMs ?? PERIOD_RUN_POLL_INTERVAL_MS;
  const maxReads = options.maxReads ?? PERIOD_RUN_POLL_MAX_READS;
  const schedule = options.setTimeout
    ?? ((handler: () => void, delay: number) => globalThis.setTimeout(handler, delay));
  const cancel = options.clearTimeout
    ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state = INITIAL_PERIOD_RUN_STATUS_STATE;
  let generation = 0;
  let timer: unknown = null;
  let disposed = false;

  function emit(next: PeriodRunStatusControllerState) {
    state = next;
    if (!disposed) options.onChange(state);
  }

  function clearTimer() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  /** Invalidate every in-flight response of the previous generation. */
  function invalidate() {
    generation += 1;
    clearTimer();
  }

  function pollDelay(observation: PeriodReportRunObservation | null, reads: number): number | null {
    if (!observation || !observation.bound) return null;
    const progress = observation.progress;
    if (!progress || !progress.processing || isPeriodRunTerminal(observation)) return null;
    if (reads >= maxReads) return null;
    return intervalMs;
  }

  function haltAfter(observation: PeriodReportRunObservation | null, reads: number): PeriodRunHalt {
    if (!observation) return 'terminal';
    if (isPeriodRunTerminal(observation)) return 'terminal';
    if (reads >= maxReads) return 'limit';
    return pollDelay(observation, reads) === null ? 'terminal' : 'idle';
  }

  function scheduleNext() {
    clearTimer();
    const delay = pollDelay(state.observation, state.reads);
    if (delay === null) return;
    const scheduledGeneration = generation;
    const runId = state.runId;
    timer = schedule(() => {
      timer = null;
      if (disposed || scheduledGeneration !== generation) return;
      void readOnce(runId, scheduledGeneration, false);
    }, delay);
  }

  async function readOnce(runId: string, requestGeneration: number, showLoading: boolean) {
    if (disposed || requestGeneration !== generation) return;
    if (showLoading) emit({ ...state, loading: true });

    let result: PeriodRunObservationResult;
    try {
      result = await options.fetchObservation(runId);
    } catch (error) {
      result = {
        ok: false,
        status: null,
        message: error instanceof Error ? error.message : '读取运行状态失败',
      };
    }

    // A tab switch, a new runId or a manual retry supersedes this response.
    if (disposed || requestGeneration !== generation) return;

    const reads = state.reads + 1;
    if (result.ok) {
      const observation = result.observation;
      const halt = haltAfter(observation, reads);
      emit({ ...state, observation, error: null, loading: false, reads, halt });
      if (halt === 'idle') scheduleNext();
      return;
    }

    const restricted = isRestrictedPeriodRunStatus(result.status);
    emit({
      ...state,
      // A denied read must never leave the previous restricted projection on
      // screen, including binding/progress/raw.
      observation: restricted ? null : state.observation,
      loading: false,
      reads,
      halt: restricted ? 'restricted' : 'error',
      error: {
        kind: restricted ? 'restricted' : 'transient',
        status: result.status,
        message: result.message || '读取运行状态失败',
        at: now(),
      },
    });
  }

  function start(rawRunId: string): void {
    const runId = rawRunId.trim();
    if (!runId || disposed) return;
    invalidate();
    const sameRun = state.runId === runId;
    emit({
      runId,
      observation: sameRun ? state.observation : null,
      error: null,
      loading: true,
      reads: 0,
      halt: 'idle',
      active: true,
    });
    void readOnce(runId, generation, false);
  }

  function activate(): void {
    if (disposed || state.active) return;
    emit({ ...state, active: true });
    // Only resume a cycle that was cut short (no observation yet, or still
    // processing). Explicit denials, transient failures and terminal states
    // stay stopped until the admin presses "读取状态" again.
    if (!state.runId || state.error || state.halt !== 'idle') return;
    invalidate();
    emit({ ...state, loading: true });
    void readOnce(state.runId, generation, false);
  }

  function deactivate(): void {
    if (disposed) return;
    invalidate();
    if (!state.active && !state.loading) return;
    emit({ ...state, active: false, loading: false });
  }

  function dispose(): void {
    invalidate();
    disposed = true;
  }

  return {
    getState: () => state,
    start,
    activate,
    deactivate,
    dispose,
  };
}
