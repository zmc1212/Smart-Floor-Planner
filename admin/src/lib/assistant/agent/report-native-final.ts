import { bailianModelProfile, bailianStructuredOutput } from '@/lib/ai/providers/bailian-capabilities';
import { fail } from '../contracts';
import { agentModelLimits, reportFinalOutputTokenLimit } from '../contracts/model';
import type { AgentConfig } from './config';
import { agentTurnScheduleProtocol, type AgentCheckpoint } from './runtime';

export const reportNativeFinalProtocol = 'report-native-final-v1';
export const reportFinalFunctionCarrier = 'forced-final-function-v1';
export const reportStructuralFinalSchema = 'report-structural-final-schema-v1';
export const reportBodyFinalProtocol = 'report-body-final-output-v1';
export const reportBodyProjectSlotsProtocol = 'report-body-project-slots-v1';
export const reportBodyFlatSegmentsProtocol = 'report-body-flat-segments-v1';
export const reportBodyQuotedSegmentsProtocol = 'report-body-quoted-segments-v1';
export const reportBodyCitationListProtocol = 'report-body-citation-list-v1';
export type ReportBodyWire = 'legacy' | 'slots' | 'flat' | 'quoted' | 'citation-list';
type ReportScope = { conversationPurpose: unknown; purpose: string; triggerKind: string; privateFollowup: boolean; selected: boolean };

/** A new private report reply binds its own final channel, independently of
 * enterprise review/image opt-ins. Ordinary replies and report bodies retain
 * their existing strategy. This never changes configuration or reservations. */
export function reportNativeAdmission(config: AgentConfig | null, scope: ReportScope) {
  return !!config && config.tools && config.providerKey === 'dashscope'
    && bailianStructuredOutput(config.model, 'json_schema') && !config.consultation
    && !config.structuredFinal && !config.knowledgeExplanation
    && scope.conversationPurpose === 'construction_followup' && scope.purpose === 'reply'
    && scope.triggerKind === 'user_message' && scope.privateFollowup && scope.selected;
}

export function boundReportNativeFinal(policy: unknown, config: AgentConfig, scope: ReportScope) {
  if (policy === undefined) return false; // Old runs never migrate during resume.
  if (policy !== reportNativeFinalProtocol || !reportNativeAdmission(config, scope)) fail('context_changed');
  return true;
}

/** Only newly admitted runs select the larger final share. An absent field on
 * an old run always means its original2048 allocation, including resume. */
export function boundReportFinalOutput(value: unknown, native: boolean) {
  if (value === undefined) return undefined;
  if (!native || value !== reportFinalOutputTokenLimit) fail('context_changed');
  return reportFinalOutputTokenLimit;
}

/** Scheduled composition has one final envelope and uses the existing
 * final-only allowance inside its original reservation. */
export function reportBodyFinalAdmission(config: AgentConfig | null) {
  return !!config && !config.consultation && config.providerKey === 'dashscope'
    && bailianStructuredOutput(config.model, 'json_schema');
}

export function reportBodyFinalPolicy(config: AgentConfig | null) {
  if (!config || !reportBodyFinalAdmission(config)) return {};
  return { reportBodyFinal: reportBodyFinalProtocol,
    ...(bailianModelProfile(config.model).functionCalling === 'documented' ? {
      reportBodyFinalCarrier: reportFinalFunctionCarrier, reportBodyProjectSlots: reportBodyCitationListProtocol } : {}) };
}

export function boundReportBodyWire(value: unknown, carrier: unknown): ReportBodyWire {
  if (value === undefined) return 'legacy';
  if (carrier !== reportFinalFunctionCarrier) fail('context_changed');
  if (value === reportBodyProjectSlotsProtocol) return 'slots';
  if (value === reportBodyFlatSegmentsProtocol) return 'flat';
  if (value === reportBodyQuotedSegmentsProtocol) return 'quoted';
  if (value === reportBodyCitationListProtocol) return 'citation-list';
  return fail('context_changed');
}

export function boundReportBodyFinal(value: unknown, config: AgentConfig) {
  if (value === undefined) return undefined;
  if (value !== reportBodyFinalProtocol || !reportBodyFinalAdmission(config)) fail('context_changed');
  return reportFinalOutputTokenLimit;
}

/** Carrier selection belongs to admission, never to resume or provider output.
 * Missing fields retain the original JSON path, including old failed runs. */
export function boundReportFinalCarrier(value: unknown, native: boolean, outputTokens: unknown) {
  if (value === undefined) return undefined;
  if (!native || value !== reportFinalFunctionCarrier || outputTokens !== reportFinalOutputTokenLimit) fail('context_changed');
  return reportFinalFunctionCarrier;
}

/** New runs share synthesis's existing prose/quantity parser. Old snapshots
 * retain their original digit-filtering schema, including on resume. */
export function boundReportFinalSchema(value: unknown, native: boolean, carrier: unknown) {
  if (value === undefined) return undefined;
  if (value !== reportStructuralFinalSchema || !native || carrier !== reportFinalFunctionCarrier) fail('context_changed');
  return reportStructuralFinalSchema;
}

/** Auxiliary work consumes the same four-call reservation. The last primary
 * turn is native final-only; one slot remains for the original final repair. */
export function reportNativeRuntimeBudget(input: { summaries: number; perceptions: number; resume?: AgentCheckpoint }) {
  if (![input.summaries, input.perceptions].every(n => Number.isInteger(n) && n >= 0 && n <= 1)) fail('assistant_quota_exceeded', 429);
  const auxiliaryCalls = input.summaries + input.perceptions;
  const primaryModelTurns = agentModelLimits.maxModelTurns - auxiliaryCalls - 1;
  if (primaryModelTurns < 1) fail('assistant_quota_exceeded', 429);
  if (input.resume && (input.resume.turnSchedule !== agentTurnScheduleProtocol
    || input.resume.primaryModelTurns !== primaryModelTurns)) fail('invalid_agent_checkpoint', 409);
  return { primaryModelTurns, reservedValidationRepairs: 1 as const, auxiliaryCalls,
    maxScheduledCalls: agentModelLimits.maxModelTurns, sourceReadSchedule: reportNativeFinalProtocol };
}
