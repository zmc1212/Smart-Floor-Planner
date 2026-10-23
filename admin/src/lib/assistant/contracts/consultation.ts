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
