import { sql, type SQL } from 'drizzle-orm';

/** Read-only verification of the existing reservation alias q. A settled label
 * alone is not reconciliation. Original usage/attempt/run records stay intact. */
export function confirmedUsageReview(observedTokens?: SQL) {
  const observed = observedTokens ?? sql`(select coalesce(sum(quantity),0) from app.assistant_usage_records
    where enterprise_id=q.enterprise_id and run_id=q.run_id and category='tokens' and measurement_kind='observed')`;
  return sql`(q.status='settled' and q.settled_tokens is not null and q.settled_cost_micros is not null
    and q.settled_tokens>=${observed} and exists(select 1 from app.assistant_cost_reviews review
      where review.enterprise_id=q.enterprise_id and review.reservation_id=q.id and review.currency='CNY'
        and review.tokens=q.settled_tokens and review.cost_micros=q.settled_cost_micros))`;
}

/** Missing usage can mean no row at all (transport failed before insertion).
 * This predicate also protects immutable known subtotals during later review. */
export function unresolvedProviderOutcome() {
  return sql`(r.status='indeterminate' or r.error_code in ('provider_outcome_unknown','provider_usage_unknown')
    or exists(select 1 from app.ai_provider_attempts a where a.enterprise_id=r.enterprise_id and a.assistant_run_id=r.id and a.status='unknown')
    or exists(select 1 from app.assistant_usage_records u where u.enterprise_id=r.enterprise_id and u.run_id=r.id
      and u.category='tokens' and u.quantity is null))`;
}

export function runUsageReconciled() {
  return sql`exists(select 1 from app.assistant_quota_reservations q where q.enterprise_id=r.enterprise_id and q.run_id=r.id
    and ${confirmedUsageReview()})`;
}
