import { randomUUID } from 'node:crypto';

type Phase = 'headers' | 'body' | 'authorization' | 'validation';
type Failure = 'transport_error' | 'authorization_denied' | 'authorization_error' | 'invalid_media';
export type LiveMediaDiagnostic = {
  traceId: string;
  resource: 'playlist' | 'segment';
  phase: Phase;
  outcome: 'ok' | 'upstream_http' | 'missing_body' | 'caller_abort' | 'timeout'
    | 'downstream_cancel' | 'complete' | Failure;
  abort: 'none' | 'caller' | 'timeout' | 'local';
  upstreamStatus: number | null;
  elapsedMs: number;
  bytes: number;
};
export type LiveMediaObserver = (event: LiveMediaDiagnostic) => void;

function developmentObserver(): LiveMediaObserver | undefined {
  if (process.env.NODE_ENV === 'production' || process.env.PUBLIC_LIVE_MEDIA_DIAGNOSTICS !== '1') return;
  return event => console.info('[public-live-media]', JSON.stringify(event));
}

/** Diagnostic metadata only. Never inspect/log a URL, body, token or error message. */
export function liveMediaDiagnostics(
  resource: string,
  signals: { combined: AbortSignal; caller: AbortSignal; timeout: AbortSignal },
  observer = developmentObserver(),
) {
  const traceId = randomUUID(), started = performance.now();
  let upstreamStatus: number | null = null, bytes = 0;
  const abortCause = () => !signals.combined.aborted ? 'none'
    : signals.caller.aborted && signals.combined.reason === signals.caller.reason ? 'caller'
      : signals.timeout.aborted && signals.combined.reason === signals.timeout.reason ? 'timeout' : 'local';
  const emit = (phase: Phase, outcome: LiveMediaDiagnostic['outcome']) => {
    try {
      observer?.({ traceId, resource: resource.endsWith('.m3u8') ? 'playlist' : 'segment',
        phase, outcome, abort: abortCause(), upstreamStatus, elapsedMs: Math.max(0, Math.round(performance.now() - started)), bytes });
    } catch { /* Diagnostics cannot change delivery or authorization. */ }
  };
  const failure = (phase: Phase, fallback: Failure = 'transport_error') => {
    // The combined signal keeps the first abort reason, even if another signal
    // aborts later while the response/authorization checks unwind.
    const cause=abortCause();
    const outcome = fallback!=='transport_error' ? fallback : cause==='caller' ? 'caller_abort' : cause==='timeout' ? 'timeout' : fallback;
    emit(phase, outcome);
  };
  return {
    headers(response: Response) {
      upstreamStatus = response.status;
      emit('headers', !response.ok ? 'upstream_http' : !response.body ? 'missing_body' : 'ok');
    },
    addBytes(count: number) { bytes += count; },
    complete() { emit('body', 'complete'); },
    cancel() { emit('body', 'downstream_cancel'); },
    failure,
  };
}
