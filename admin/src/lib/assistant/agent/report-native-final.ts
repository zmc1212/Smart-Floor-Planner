import { bailianStructuredOutput } from '@/lib/ai/providers/bailian-capabilities';
import { fail } from '../contracts';
import { agentModelLimits } from '../contracts/model';
import type { AgentConfig } from './config';
import { agentTurnScheduleProtocol, type AgentCheckpoint } from './runtime';

export const reportNativeFinalProtocol = 'report-native-final-v1';
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
