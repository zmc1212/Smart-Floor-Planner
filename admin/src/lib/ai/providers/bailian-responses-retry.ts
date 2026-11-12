import { AiProviderError, type ProviderHttpDiagnostic } from '../provider-types';

/**
 * Retry policy for the Bailian Responses wire.
 *
 * Official guidance (https://help.aliyun.com/zh/model-studio/error-code):
 * 4xx other than throttling are not retried; 429 throttling is retried using
 * `Retry-After` or exponential backoff; 503 ServiceUnavailable is an explicit
 * platform-capacity rejection that may be retried later.
 *
 * This adapter deliberately stays narrower than "retry every 5xx": a timeout,
 * a dropped connection, a 500/502/504 gateway failure or an interrupted stream
 * leaves the acceptance state unknown, and the provider may already have run
 * billable provider-side tools. Those cases are never replayed automatically.
 */
export type BailianResponsesRetryPolicy = {
  /** Additional attempts after the first request. 0 disables retries. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const bailianResponsesRetryDefaults: BailianResponsesRetryPolicy = {
  maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 4000,
};

/** Retryable statuses: the request was rejected before model execution. */
export const bailianResponsesRetryableStatuses = [429, 503] as const;

function boundedInteger(value: string | undefined, fallback: number, max: number) {
  if (value === undefined || !/^\d{1,3}$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return parsed <= max ? parsed : fallback;
}

/** Deployment-owned retry budget. Defaults to one retry; the accepted range is
 * 0..2 so a single turn can never turn into a long automatic replay loop. */
export function bailianResponsesRetryPolicy(
  env: Record<string, string | undefined> = process.env,
): BailianResponsesRetryPolicy {
  return {
    ...bailianResponsesRetryDefaults,
    maxRetries: boundedInteger(env.ASSISTANT_RESPONSES_MAX_RETRIES, bailianResponsesRetryDefaults.maxRetries, 2),
  };
}

function retryAfterMs(error: AiProviderError): number | null {
  const diagnostic = error.diagnostic;
  if (!diagnostic || !('httpStatus' in diagnostic)) return null;
  const value = (diagnostic as ProviderHttpDiagnostic).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Delay before the next attempt, or null when the error must not be replayed. */
export function bailianResponsesRetryDelay(
  error: unknown,
  retriesDone: number,
  policy: BailianResponsesRetryPolicy,
): number | null {
  if (!(error instanceof AiProviderError)) return null;
  if (retriesDone >= policy.maxRetries) return null;
  const status = error.status;
  if (!status || !(bailianResponsesRetryableStatuses as readonly number[]).includes(status)) return null;
  // A status alone is not enough: only the provider's explicit rejection codes
  // are replayed, never a locally fabricated timeout/stream error.
  if (error.code !== `HTTP_${status}`) return null;
  const header = retryAfterMs(error);
  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retriesDone);
  return Math.min(policy.maxDelayMs, header ?? backoff);
}

export function bailianResponsesRetrySleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
