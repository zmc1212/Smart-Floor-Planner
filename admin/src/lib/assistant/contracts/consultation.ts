import { agentModelLimits } from './model';
import type { Evidence } from './index';

/** Versioned checkpoint contracts, not new persistence/authorization services.
 * R1/R2 activate these incrementally; legacy checkpoints keep their reader. */
export const consultationProtocol = 'consultation-evidence-v1';
export type ConsultationTaskContext = {
  protocol: typeof consultationProtocol;
  runId: string; conversationId: string; triggerMessageId: string; throughSeq: string;
  objective: string; preferences: string[]; projectId: string | null;
  prohibitedActions: string[]; sources: Evidence[]; unresolved: string[];
  budget: { observedTokens: number; reservedTokens: number; limitTokens: number };
};
export type ConsultationToolStatus = 'ready' | 'partial' | 'empty' | 'unavailable' | 'denied';
export type DrawingDimensionType = 'net' | 'axis' | 'overall' | 'unspecified';
export type DrawingObservation = {
  mediaId: string; hash: string; page: number; versionLabel: string | null;
  coordinates: { width: number; height: number; rotation: number; unit: 'pixel' };
  labels: Array<{ text: string; bbox: [number, number, number, number]; ocrConfidence: number | null;
    value: number | null; unit: string | null; dimensionType: DrawingDimensionType; typeEvidence: string | null }>;
  objects: Array<{ id: string; label: string; bbox: [number, number, number, number] }>;
  relations: Array<{ subject: string; relation: string; object: string; uncertain: boolean }>;
  ambiguities: string[];
};

/** Explicitly different from the delivered 2048-token profile. This contract
 * alone cannot enable dispatch or prove the configured provider's capability. */
export const consultationAcceptanceProfile = {
  id: 'bailian-deepseek-flash-consultation-v1', model: 'deepseek-v4.1-flash-1017',
  enableThinking: false, maxOutputTokens: 8192, legacyMaxOutputTokens: agentModelLimits.maxOutputTokens,
  maxModelTurns: 4, maxCalls: 6, maxSummaryCalls: 1, maxPerceptionCalls: 1, runTimeoutMs: 180000,
  stageTokens: { R0: 0, R1: 60000, R2: 80000, R3: 100000, R4: 1000000 },
  cashLimitYuan: 0, paidFallback: false,
} as const;

/** Selected before a complete long-conversation trial, never an automatic
 * fallback. The 2026-10-23 authorization is CNY5 for the entire test campaign. */
export const consultationLongProfile = {
  ...consultationAcceptanceProfile,
  id: 'bailian-qwen37-flash-long-v1', model: 'qwen3.7-flash', cashLimitYuan: 5,
  campaignTokens: 1000000, maxRequestTokens: 60000,
} as const;
export const consultationCashAuthorization = 'xiaok-20261023-qwen-long-cny5';
export const consultationTariffVersion = 'qwen37-beijing-20261023-upper-v1';
/** Explicit development-campaign exception approved on 2026-10-24. This is
 * isolation, not reconciliation: the original attempt and full hold remain. */
export const consultationUnknownIsolation = {
  authorization: 'xiaok-20261024-isolate-2369-v1', enterpriseId: '4536', runId: '9216', attemptId: '2369',
  requestFingerprint: '84b3c12d95d3726f41e5302569dd2cbefb5a25d40a0dc78ac1dedae10fadd0c9',
  reservationVersion: 11, reservedTokens: 89596, reservedCostMicros: 323790,
  observedTokens: 30099, knownCostMicros: 38204, heldTokens: 59497, heldCostMicros: 285586,
} as const;
export function consultationProfile(id: unknown) {
  return id === consultationAcceptanceProfile.id ? consultationAcceptanceProfile
    : id === consultationLongProfile.id ? consultationLongProfile : null;
}
