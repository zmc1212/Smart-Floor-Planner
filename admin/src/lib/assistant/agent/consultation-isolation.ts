import { consultationUnknownIsolation as approval } from '../contracts/consultation';

/** Exact server-ledger proof for the one approved retained unknown. Any extra
 * unknown, changed receipt or reduced hold fails closed. No records are edited. */
export function matchesConsultationIsolation(enterpriseId: string, unknownRunIds: unknown, row: Record<string, unknown> | null | undefined) {
  if (enterpriseId !== approval.enterpriseId || !Array.isArray(unknownRunIds)
    || unknownRunIds.length !== 1 || String(unknownRunIds[0]) !== approval.runId || !row) return false;
  return String(row.run_id) === approval.runId && String(row.attempt_id) === approval.attemptId
    && row.run_status === 'indeterminate' && row.run_error === 'provider_outcome_unknown'
    && row.attempt_status === 'failed' && row.attempt_error === 'PROVIDER_CONNECTION_FAILED'
    && row.request_fingerprint === approval.requestFingerprint && row.remote_task_id === null && row.remote_status === null
    && row.reservation_status === 'reconciling' && Number(row.version) === approval.reservationVersion
    && Number(row.reserved_tokens) === approval.reservedTokens && Number(row.reserved_cost_micros) === approval.reservedCostMicros
    && Number(row.observed_tokens) === approval.observedTokens && Number(row.known_cost_micros) === approval.knownCostMicros
    && Number(row.settled_tokens) === approval.observedTokens && row.settled_cost_micros === null
    && Number(row.attempt_count) === 5 && Number(row.usage_count) === 4 && Number(row.review_count) === 0;
}
