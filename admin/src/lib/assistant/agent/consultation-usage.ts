import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail } from '../contracts';
import type { ModelMessage, ModelTool } from '../contracts/model';
import { estimateAgentRequest } from './context-budget';
import { consultationDispatchBudget, type ConsultationBinding } from './consultation-profile';
import { consultationCashAuthorization, consultationLongProfile } from '../contracts/consultation';
import { confirmedUsageReview, unresolvedProviderOutcome } from '../core/usage-review';

/** UTF-8 byte ceiling plus explicit template/output reserve, not a tokenizer
 * accuracy claim. Unknown image token budgets cannot enter the text profile. */
export function consultationRequestReservation(messages: ModelMessage[], tools: ModelTool[], maxOutputTokens: number) {
  const estimate = estimateAgentRequest(messages, tools);
  if (estimate.images) fail('agent_image_limit', 422);
  return estimate.textBytes + 256 * (messages.length + tools.length + 1) + maxOutputTokens;
}

/** Existing settings/reservation rows remain the single serialization point.
 * No new quota table, tenant resolver, ledger or cross-tenant lookup. */
export async function reserveConsultationDispatch(tx: PostgresTransaction, input: {
  enterpriseId: string; runId: string; binding: ConsultationBinding; createdAt: string;
  estimatedRequestTokens: number; purpose: 'answer' | 'vision' | 'summary';
}) {
  const settings = await one(tx, sql`select daily_tokens,daily_cost_micros,extract(epoch from clock_timestamp())*1000 now_ms
    from app.assistant_enterprise_settings where enterprise_id=${input.enterpriseId} and enabled=true for update`);
  if (!settings) fail('assistant_disabled', 403);
  const own = await one(tx, sql`select reserved_tokens,reserved_cost_micros from app.assistant_quota_reservations
    where enterprise_id=${input.enterpriseId} and run_id=${input.runId} and status='held' for update`);
  if (!own) fail('assistant_quota_exceeded', 409);
  if ('metered' in input.binding && input.estimatedRequestTokens > consultationLongProfile.maxRequestTokens) fail('assistant_quota_exceeded', 429);
  const usage = await consultationBudgetSnapshot(tx, input);
  const calls = await one(tx, sql`select count(*)::int calls,
    count(*) filter(where input_summary->>'purpose'='summary')::int summaries,
    count(*) filter(where input_summary->>'purpose'='vision')::int perceptions
    from app.assistant_run_steps where enterprise_id=${input.enterpriseId} and run_id=${input.runId} and kind='agent_model'`);
  const result = consultationDispatchBudget({ ...input, ...usage, now: Number(settings.now_ms), calls: Number(calls?.calls || 0),
    summaries: Number(calls?.summaries || 0), perceptions: Number(calls?.perceptions || 0) });
  const current = await one(tx, sql`select coalesce(sum(quantity),0)::text observed,
    coalesce(ceil(sum(input_tokens)*1.2+sum(output_tokens)*4.8),0)::text cost from app.assistant_usage_records
    where enterprise_id=${input.enterpriseId} and run_id=${input.runId} and category='tokens' and measurement_kind='observed'`);
  const next = BigInt(String(current?.observed || 0)) + BigInt(input.estimatedRequestTokens);
  const nextCost = 'metered' in input.binding ? BigInt(String(current?.cost || 0)) + BigInt(result.reservedCostMicros) : BigInt(0);
  const daily = await one(tx, sql`select coalesce(sum(case when status='settled' then coalesce(settled_tokens,reserved_tokens) else reserved_tokens end),0)::text tokens,
    coalesce(sum(case when status='settled' then coalesce(settled_cost_micros,reserved_cost_micros) else reserved_cost_micros end),0)::text cost
    from app.assistant_quota_reservations where enterprise_id=${input.enterpriseId} and status!='released'
    and (budget_date=(now() at time zone 'UTC')::date or status in ('held','reconciling'))`);
  if (BigInt(String(daily?.tokens || 0)) - BigInt(String(own.reserved_tokens)) + next > BigInt(String(settings.daily_tokens))) fail('assistant_quota_exceeded', 429);
  if (BigInt(String(daily?.cost || 0)) - BigInt(String(own.reserved_cost_micros)) + nextCost > BigInt(String(settings.daily_cost_micros))) fail('assistant_quota_exceeded', 429);
  const held = await one(tx, sql`update app.assistant_quota_reservations set reserved_tokens=${String(next)},
    reserved_cost_micros=${String(nextCost)},version=version+1,updated_at=now()
    where enterprise_id=${input.enterpriseId} and run_id=${input.runId} and status='held' returning id`);
  if (!held) fail('assistant_quota_exceeded', 409);
  return { ...result, reservedRequestTokens: input.estimatedRequestTokens,
    observedTokens: usage.observedTokens, heldTokensBefore: usage.heldTokens };
}

/** Called with the original usage insert, even if user/source revocation just
 * occurred. Unknown token consumption retains its full hold and null cost. */
export async function settleConsultationDispatch(tx: PostgresTransaction, enterpriseId: string, runId: string) {
  const usage = await one(tx, sql`select coalesce(sum(quantity) filter(where measurement_kind='observed'),0)::text observed,
    coalesce(ceil(sum(input_tokens)*1.2+sum(output_tokens)*4.8),0)::text cost,
    count(*) filter(where quantity is null or input_tokens is null or output_tokens is null)::int unknown from app.assistant_usage_records
    where enterprise_id=${enterpriseId} and run_id=${runId} and category='tokens'`);
  if (Number(usage?.unknown)) return false;
  // reserved_cost_micros holds a tariff upper bound. settled_cost_micros stays
  // null until real bill reconciliation; usage is never labelled a cash bill.
  await tx.execute(sql`update app.assistant_quota_reservations set reserved_tokens=${String(usage?.observed || '0')},
    settled_tokens=${String(usage?.observed || '0')},reserved_cost_micros=case when exists(select 1 from app.assistant_runs r
      where r.enterprise_id=${enterpriseId} and r.id=${runId}
        and r.policy_snapshot#>>'{agent,consultation,metered,authorization}'=${consultationCashAuthorization})
      then ${String(usage?.cost || '0')}::bigint else reserved_cost_micros end,version=version+1,updated_at=now()
    where enterprise_id=${enterpriseId} and run_id=${runId} and status in ('held','reconciling')`);
  return true;
}

/** Read-only projection of the original tenant ledger for whole-scenario preflight.
 * Callers acquire the same settings row lock before starting serial acceptance. */
export async function consultationBudgetSnapshot(tx: PostgresTransaction, input: { enterpriseId: string; binding: ConsultationBinding }) {
  const totals = await one(tx, sql`select coalesce(sum(u.observed),0)::text observed,
    coalesce(sum(case when ${confirmedUsageReview(sql`u.observed`)} then q.settled_tokens else u.observed end),0)::text accounted,
    coalesce(sum(case when ${confirmedUsageReview(sql`u.observed`)} then 0 else greatest(q.reserved_tokens-u.observed,0) end),0)::text held,
    coalesce(bool_or(not ${confirmedUsageReview(sql`u.observed`)} and ${unresolvedProviderOutcome()}),false) unknown
    from app.assistant_runs r join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
    cross join lateral(select coalesce(sum(quantity) filter(where measurement_kind='observed'),0) observed,
      count(*) filter(where quantity is null) unknown from app.assistant_usage_records
      where enterprise_id=r.enterprise_id and run_id=r.id and category='tokens') u
    where r.enterprise_id=${input.enterpriseId}
      and ${'metered' in input.binding
        ? sql`r.policy_snapshot#>>'{agent,consultation,metered,authorization}'=${consultationCashAuthorization}`
        : sql`r.policy_snapshot#>>'{agent,consultation,budgetGroup}'=${input.binding.budgetGroup}
          and r.policy_snapshot#>>'{agent,consultation,stage}'=${input.binding.stage}
          and r.policy_snapshot#>>'{agent,consultation,profile}'=${input.binding.profile}`}
      and (q.status!='released' or u.observed>0)`);
  // Every paid stage/group within this test enterprise shares one approval.
  // The serial acceptance driver also binds all trials to this same enterprise;
  // neither a new stage nor a new run can reset the campaign's cash ceiling.
  const cash = 'metered' in input.binding ? await one(tx, sql`select coalesce(sum(case when ${confirmedUsageReview()} then q.settled_cost_micros else u.cost end),0)::text known,
    coalesce(sum(case when ${confirmedUsageReview()} then 0 else greatest(q.reserved_cost_micros-u.cost,0) end),0)::text held,
    coalesce(bool_or(not ${confirmedUsageReview()} and (u.missing>0 or ${unresolvedProviderOutcome()})),false) unknown
    from app.assistant_runs r join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
    cross join lateral(select coalesce(ceil(sum(input_tokens)*1.2+sum(output_tokens)*4.8),0) cost,
      count(*) filter(where quantity is null or input_tokens is null or output_tokens is null) missing
      from app.assistant_usage_records where enterprise_id=r.enterprise_id and run_id=r.id and category='tokens') u
    where r.enterprise_id=${input.enterpriseId}
      and r.policy_snapshot#>>'{agent,consultation,metered,authorization}'=${consultationCashAuthorization}
      and (q.status!='released' or u.cost>0)`): null;
  return { observedTokens: Number(totals?.observed || 0), accountedTokens: Number(totals?.accounted || 0), heldTokens: Number(totals?.held || 0),
    unknownUsage: Boolean(totals?.unknown) || Boolean(cash?.unknown),
    ...('metered' in input.binding ? { knownCostMicros: Number(cash!.known), heldCostMicros: Number(cash!.held) } : {}) };
}
