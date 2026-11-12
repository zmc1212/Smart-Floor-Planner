import { sql, type SQL } from 'drizzle-orm';

/** Observed metered tokens for one run, counting each actual provider
 * operation once. The public opening writes intro_tokens and completeRun
 * writes the same provider call as run:{runId} tokens; both are one call.
 * Other calls dedupe by provider attempt, and unattributed rows stay separate. */
export function observedTokenTotal(enterpriseId: SQL, runId: SQL): SQL {
  return sql`(select coalesce(sum(quantity),0) from (
    select distinct on (op) quantity from (
      select case
        when category='intro_tokens' or (category='tokens' and operation_key like 'run:%') then 'run-call'
        when provider_attempt_id is not null then 'attempt:'||provider_attempt_id
        else 'row:'||id
      end as op, id, quantity
      from app.assistant_usage_records
      where enterprise_id=${enterpriseId} and run_id=${runId}
        and measurement_kind='observed' and category in ('tokens','suggestion_tokens','intro_tokens')
    ) normalized order by op, id
  ) deduped)`;
}

/** Read-only verification of the existing reservation alias q. A settled label
 * alone is not reconciliation. Original usage/attempt/run records stay intact. */
export function confirmedUsageReview(observedTokens?: SQL) {
  const observed = observedTokens ?? observedTokenTotal(sql`q.enterprise_id`, sql`q.run_id`);
  return sql`(q.status='settled' and q.settled_tokens is not null and q.settled_cost_micros is not null
    and q.settled_tokens>=${observed} and exists(select 1 from app.assistant_cost_reviews review
      where review.enterprise_id=q.enterprise_id and review.reservation_id=q.id and review.currency='CNY'
        and review.tokens=q.settled_tokens and review.cost_micros=q.settled_cost_micros))`;
}

/** Missing usage can mean no row at all (transport failed before insertion).
 * This predicate also protects immutable known subtotals during later review.
 * A null quantity with an attempt that explicitly failed without acceptance is
 * a known failure, not an unknown provider outcome. A created attempt was
 * dispatched but never finalized, so it is an unknown outcome too; created
 * rows default accepted=false and must not be confused with that definite
 * failed+accepted=false rejection. */
export function unresolvedProviderOutcome() {
  return sql`(r.status='indeterminate' or r.error_code in ('provider_outcome_unknown','provider_usage_unknown')
    or exists(select 1 from app.ai_provider_attempts a where a.enterprise_id=r.enterprise_id and a.assistant_run_id=r.id and a.status in ('unknown','created'))
    or exists(select 1 from app.assistant_usage_records u
      left join app.ai_provider_attempts a on a.enterprise_id=u.enterprise_id and a.id=u.provider_attempt_id
      where u.enterprise_id=r.enterprise_id and u.run_id=r.id
        and u.category in ('tokens','suggestion_tokens','intro_tokens') and u.quantity is null
        and (u.provider_attempt_id is null or a.status is distinct from 'failed' or a.accepted is distinct from false)))`;
}

export function runUsageReconciled() {
  return sql`exists(select 1 from app.assistant_quota_reservations q where q.enterprise_id=r.enterprise_id and q.run_id=r.id
    and ${confirmedUsageReview()})`;
}

/** A known model response followed by retrieval failure may be explicitly
 * retried with a new reservation. Keep the old cost hold and billing status;
 * cancellation, unknown responses and missing token observations still block. */
export function runRetryAwaitingReconciliation() {
  const knownRetrievalFailure = sql`(r.status='failed' and r.error_code='retrieval_unavailable'
    and not ${unresolvedProviderOutcome()}
    and exists(select 1 from app.ai_provider_attempts a where a.enterprise_id=r.enterprise_id and a.assistant_run_id=r.id)
    and not exists(select 1 from app.ai_provider_attempts a where a.enterprise_id=r.enterprise_id and a.assistant_run_id=r.id
      and (a.status is distinct from 'succeeded' or a.accepted is distinct from true
        or jsonb_typeof(a.metadata#>'{assistantResponse,usage,inputTokens}') is distinct from 'number'
        or jsonb_typeof(a.metadata#>'{assistantResponse,usage,outputTokens}') is distinct from 'number'
        or not coalesce(a.metadata#>>'{assistantResponse,usage,inputTokens}' ~ '^[0-9]+$',false)
        or not coalesce(a.metadata#>>'{assistantResponse,usage,outputTokens}' ~ '^[0-9]+$',false)))
    and exists(select 1 from app.assistant_usage_records u where u.enterprise_id=r.enterprise_id and u.run_id=r.id
      and u.category='tokens' and u.measurement_kind='observed' and u.quantity is not null))`;
  return sql`exists(select 1 from app.assistant_quota_reservations q where q.enterprise_id=r.enterprise_id and q.run_id=r.id
    and q.status='reconciling' and not ${knownRetrievalFailure})`;
}
