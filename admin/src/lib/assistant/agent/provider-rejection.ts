import { AiProviderError } from '@/lib/ai/provider-types';

type Row = Record<string, unknown>;
const rejectionStatuses = new Set([400, 401, 402, 403, 404, 405, 406, 413, 415, 422, 429]);
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

/** A complete HTTP rejection establishes execution failure, never a zero bill. */
export function isDefiniteAgentRejection(error: unknown): error is AiProviderError {
  if (!(error instanceof AiProviderError)) return false;
  const diagnostic = error.diagnostic;
  return error.disposition === 'safe_fallback' && rejectionStatuses.has(Number(error.status))
    && error.code === `HTTP_${error.status}` && diagnostic?.protocol === 'provider-http-diagnostic-v1'
    && diagnostic.httpStatus === error.status && /^[a-f0-9]{64}$/.test(diagnostic.responseHash);
}

/** Require the durable audit for this dispatch; an earlier/foreign rejection
 * cannot resolve a running call. Previous ambiguous calls remain blocking. */
export function agentRejectionAudited(error: unknown, dispatch: Row | undefined, attempts: Row[]): boolean {
  if (!isDefiniteAgentRejection(error) || dispatch?.status !== 'running' || !attempts.length) return false;
  const summary = object(dispatch.input_summary), latest = attempts.at(-1)!;
  const metadata = object(latest.metadata), failure = object(metadata.providerFailure);
  if (!Number.isInteger(summary.turn) || typeof summary.purpose !== 'string'
    || metadata.turn !== summary.turn || metadata.purpose !== summary.purpose
    || latest.status !== 'failed' || latest.accepted !== false || latest.error_code !== error.code
    || failure.protocol !== error.diagnostic!.protocol || failure.httpStatus !== error.status
    || failure.responseHash !== error.diagnostic!.responseHash) return false;
  return attempts.slice(0, -1).every(attempt => {
    if (attempt.status === 'succeeded' && attempt.accepted === true) return true;
    const prior = object(object(attempt.metadata).providerFailure);
    return attempt.status === 'failed' && attempt.accepted === false
      && rejectionStatuses.has(Number(prior.httpStatus)) && attempt.error_code === `HTTP_${prior.httpStatus}`
      && prior.protocol === 'provider-http-diagnostic-v1' && /^[a-f0-9]{64}$/.test(String(prior.responseHash));
  });
}
