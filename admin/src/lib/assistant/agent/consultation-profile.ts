import { fail } from '@/lib/assistant/contracts';
import { consultationAcceptanceProfile as profile, consultationLongProfile, consultationCashAuthorization,
  consultationTariffVersion, consultationProfile, consultationUnknownIsolation } from '@/lib/assistant/contracts/consultation';

export type ConsultationStage = Exclude<keyof typeof profile.stageTokens, 'R0'>;
type BindingBase = { stage: ConsultationStage; budgetGroup: string };
export type FreeConsultationBinding = BindingBase & {
  profile: typeof profile.id;
  quota: { model: typeof profile.model; remainingTokens: number; quotaOnly: true; verifiedAt: string;
    observedTokensAtVerification: number };
};
export type MeteredConsultationBinding = BindingBase & {
  profile: typeof consultationLongProfile.id;
  metered: { authorization: typeof consultationCashAuthorization; cashLimitMicros: 5000000;
    tariff: typeof consultationTariffVersion; scenarioTokenLimit?: number;
    isolatedUnknownAuthorization?: typeof consultationUnknownIsolation.authorization };
};
export type ConsultationBinding = FreeConsultationBinding | MeteredConsultationBinding;
const stages = new Set(['R1', 'R2', 'R3', 'R4']);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Server-owned configuration only; clients/model arguments cannot authorize
 * billing. Strict named profiles prevent free-quota errors becoming fallback. */
export function consultationBinding(value: unknown): ConsultationBinding | null {
  if (!object(value)) return null;
  const input = value;
  if (!stages.has(String(input.stage)) || typeof input.budgetGroup !== 'string'
    || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.budgetGroup)) return null;
  const base = { stage: input.stage as ConsultationStage, budgetGroup: input.budgetGroup };
  if (input.profile === consultationLongProfile.id) {
    const metered = input.metered;
    if (Object.keys(input).some(key => !['profile','stage','budgetGroup','metered'].includes(key))
      || !object(metered) || Object.keys(metered).some(key => !['authorization','cashLimitMicros','tariff','scenarioTokenLimit','isolatedUnknownAuthorization'].includes(key))
      || metered.authorization !== consultationCashAuthorization || metered.cashLimitMicros !== 5000000
      || metered.tariff !== consultationTariffVersion
      || metered.scenarioTokenLimit !== undefined && (!integer(metered.scenarioTokenLimit)
        || metered.scenarioTokenLimit < consultationLongProfile.maxRequestTokens || metered.scenarioTokenLimit > consultationLongProfile.campaignTokens)
      || metered.isolatedUnknownAuthorization !== undefined && metered.isolatedUnknownAuthorization !== consultationUnknownIsolation.authorization) return null;
    return { ...base, profile: consultationLongProfile.id, metered: { authorization: consultationCashAuthorization,
      cashLimitMicros: 5000000, tariff: consultationTariffVersion,
      ...(metered.scenarioTokenLimit !== undefined ? { scenarioTokenLimit: metered.scenarioTokenLimit as number } : {}),
      ...(metered.isolatedUnknownAuthorization !== undefined ? { isolatedUnknownAuthorization: consultationUnknownIsolation.authorization } : {}) } };
  }
  const quota = input.quota;
  if (Object.keys(input).some(key => !['profile','stage','budgetGroup','quota'].includes(key))
    || input.profile !== profile.id || !object(quota)
    || Object.keys(quota).some(key => !['model','remainingTokens','quotaOnly','verifiedAt','observedTokensAtVerification'].includes(key))
    || quota.model !== profile.model || quota.quotaOnly !== true || !integer(quota.remainingTokens)
    || !integer(quota.observedTokensAtVerification) || typeof quota.verifiedAt !== 'string'
    || !Number.isFinite(Date.parse(quota.verifiedAt))) return null;
  return { ...base, profile: profile.id, quota: { model: profile.model, remainingTokens: quota.remainingTokens,
    quotaOnly: true, verifiedAt: quota.verifiedAt, observedTokensAtVerification: quota.observedTokensAtVerification } };
}

/** Published Beijing highest-tier uncached rates: input1.2/output4.8 CNY/M.
 * This is a conservative tariff upper bound, never a reconciled cash bill. */
export function consultationCostUpperMicros(inputTokens: number, outputTokens: number) {
  if (!integer(inputTokens) || !integer(outputTokens)) fail('assistant_quota_exceeded', 429);
  const micros = (BigInt(inputTokens) * BigInt(12) + BigInt(outputTokens) * BigInt(48) + BigInt(9)) / BigInt(10);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) fail('assistant_quota_exceeded', 429);
  return Number(micros);
}

export type ConsultationLedger = {
  observedTokens: number; accountedTokens?: number; heldTokens: number; unknownUsage: boolean;
  knownCostMicros?: number; heldCostMicros?: number;
  // Produced only by the tenant ledger after matching the exact unresolved
  // attempt/reservation. A config flag alone never authorizes dispatch.
  isolatedUnknownAuthorization?: typeof consultationUnknownIsolation.authorization;
  scenarioAccountedTokens?: number; scenarioHeldTokens?: number;
};

/** Uses original reservation/usage rows. Observed plus unobserved held usage
 * uses the authorized free-stage or Qwen-campaign cap. Qwen cash is campaign-wide. */
export function consultationDispatchBudget(input: ConsultationLedger & {
  binding: ConsultationBinding; createdAt: string; now: number; estimatedRequestTokens: number;
  calls: number; summaries: number; perceptions: number; purpose: 'answer' | 'summary' | 'vision' | 'grounding';
}) {
  const { binding, now } = input, createdAt = Date.parse(input.createdAt), accountedTokens = input.accountedTokens ?? input.observedTokens;
  if (![input.estimatedRequestTokens, input.observedTokens, accountedTokens, input.heldTokens, input.calls, input.summaries, input.perceptions].every(integer)
    || accountedTokens < input.observedTokens
    || !Number.isFinite(now) || !Number.isFinite(createdAt) || now < createdAt) fail('assistant_quota_exceeded', 429);
  if (input.unknownUsage && !('metered' in binding
    && binding.metered.isolatedUnknownAuthorization === consultationUnknownIsolation.authorization
    && input.isolatedUnknownAuthorization === consultationUnknownIsolation.authorization
    && input.heldTokens >= consultationUnknownIsolation.heldTokens
    && Number(input.heldCostMicros) >= consultationUnknownIsolation.heldCostMicros)) fail('provider_outcome_unknown');
  if (now - createdAt >= profile.runTimeoutMs) fail('agent_deadline_exceeded', 422);
  if (input.calls >= profile.maxCalls || input.purpose === 'summary' && input.summaries >= profile.maxSummaryCalls
    || input.purpose === 'vision' && input.perceptions >= profile.maxPerceptionCalls) fail('assistant_quota_exceeded', 429);
  const total = accountedTokens + input.heldTokens + input.estimatedRequestTokens;
  const limit = 'quota' in binding ? profile.stageTokens[binding.stage] : consultationLongProfile.campaignTokens;
  if (!Number.isSafeInteger(total) || total > limit) fail('assistant_quota_exceeded', 429);
  if ('metered' in binding && binding.metered.scenarioTokenLimit !== undefined) {
    if (!integer(input.scenarioAccountedTokens) || !integer(input.scenarioHeldTokens)
      || !Number.isSafeInteger(input.scenarioAccountedTokens + input.scenarioHeldTokens + input.estimatedRequestTokens)
      || input.scenarioAccountedTokens + input.scenarioHeldTokens + input.estimatedRequestTokens > binding.metered.scenarioTokenLimit)
      fail('assistant_quota_exceeded', 429);
  }
  let remainingTokens = limit - total, reservedCostMicros = 0, costUpperMicros = 0;
  if ('quota' in binding) {
    const verifiedAt = Date.parse(binding.quota.verifiedAt), sinceVerification = total - binding.quota.observedTokensAtVerification;
    if (binding.quota.quotaOnly !== true || !Number.isFinite(verifiedAt) || now < verifiedAt || now - verifiedAt > 15 * 60000
      || !Number.isSafeInteger(sinceVerification) || input.observedTokens < binding.quota.observedTokensAtVerification
      || sinceVerification > binding.quota.remainingTokens) fail('assistant_quota_exceeded', 429);
    remainingTokens = Math.min(remainingTokens, binding.quota.remainingTokens - sinceVerification);
  } else {
    if (!integer(input.knownCostMicros) || !integer(input.heldCostMicros)) fail('provider_usage_unknown', 502);
    // All request tokens use the higher output rate for the pre-dispatch hold.
    reservedCostMicros = consultationCostUpperMicros(0, input.estimatedRequestTokens);
    costUpperMicros = input.knownCostMicros + input.heldCostMicros + reservedCostMicros;
    if (!Number.isSafeInteger(costUpperMicros) || costUpperMicros > binding.metered.cashLimitMicros) fail('assistant_quota_exceeded', 429);
  }
  return { totalTokens: total, remainingTokens, reservedCostMicros, costUpperMicros,
    remainingMs: profile.runTimeoutMs - (now - createdAt), stageLimitTokens: limit };
}

/** One five-dispatch allocation across primary work, auxiliary calls and the
 * existing single final repair. Auxiliary usage is read from durable steps;
 * it consumes primary allowance, never an extra slot beyond preflight. */
export function consultationRuntimeBudget(input: { summaries: number; perceptions: number }) {
  if (![input.summaries,input.perceptions].every(integer) || input.summaries > profile.maxSummaryCalls
    || input.perceptions > profile.maxPerceptionCalls) fail('assistant_quota_exceeded',429);
  return { primaryModelTurns: profile.maxModelTurns - input.summaries - input.perceptions,
    reservedValidationRepairs: 1 as const, auxiliaryCalls: input.summaries + input.perceptions, maxScheduledCalls: 5 };
}

/** Register every main/summary/perception/repair slot. A named scenario envelope
 * is a hard cumulative limit, not a promise that every slot can spend its peak.
 * The original per-request hold and campaign cap still apply on each dispatch. */
export function consultationScenarioPreflight(input: ConsultationLedger & {
  binding: ConsultationBinding; now: number; requestReservations: number[];
}) {
  if (!input.requestReservations.length || !input.requestReservations.every(integer)) fail('assistant_quota_exceeded', 429);
  if ('metered' in input.binding && input.requestReservations.some(value=>value>consultationLongProfile.maxRequestTokens)) fail('assistant_quota_exceeded',429);
  const requestCeilingTokens = input.requestReservations.reduce((sum, value) => sum + value, 0);
  const envelope = 'metered' in input.binding ? input.binding.metered.scenarioTokenLimit : undefined;
  if (envelope !== undefined && (input.scenarioAccountedTokens !== 0 || input.scenarioHeldTokens !== 0)) fail('assistant_quota_exceeded',429);
  const estimatedRequestTokens = envelope === undefined ? requestCeilingTokens : Math.min(envelope,requestCeilingTokens);
  return { ...consultationDispatchBudget({ ...input, estimatedRequestTokens, createdAt: new Date(input.now).toISOString(),
    calls: 0, summaries: 0, perceptions: 0, purpose: 'answer' }), model: consultationProfile(input.binding.profile)!.model,
    plannedCalls: input.requestReservations.length, requestCeilingTokens, fundedTokenEnvelope: estimatedRequestTokens,
    allocationMode: envelope === undefined ? 'all-request-ceilings' : 'hard-scenario-envelope', actualBilledMicros: null };
}
