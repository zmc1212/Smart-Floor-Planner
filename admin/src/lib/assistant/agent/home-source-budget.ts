import { fail } from '../contracts';
import { agentModelLimits, type ModelTool } from '../contracts/model';

export const homeSourceBudgetProtocol = 'home-read-four-call-reserve-v1';
const reads = new Set(['query_materials', 'query_followups', 'query_business', 'search_knowledge', 'search_web', 'read_web', 'recall_history', 'final_response']);
const homeReads = new Set(['query_materials', 'query_followups', 'query_business']);
/** Bound home reads reserve a final repair inside four total calls. Ordinary
 * dialogue uses the original loop, with one repair when a call remains; saved
 * reserved schedules, writes and native review keep their allocation. */
export function homeSourceRuntimeBudget(input: { policy: unknown; boundHome: boolean; ordinaryDialogue?: boolean; images: number; nativeFinalization: boolean; tools: ModelTool[];
  summaries: number; perceptions: number; resume?: { turnSchedule?: string; primaryModelTurns?: number }; scheduleProtocol: string }) {
  if (input.policy !== homeSourceBudgetProtocol || !(input.boundHome || input.ordinaryDialogue) || input.images || input.nativeFinalization
    || !(input.tools.some(t => homeReads.has(t.name)) || input.ordinaryDialogue && input.tools.some(t => ['search_web','read_web','recall_history'].includes(t.name)))
    || input.tools.some(t => !reads.has(t.name))) return undefined;
  // New ordinary turns use the original four-call tool loop: discovery may
  // need refinement before reading. Its existing single final repair uses a
  // remaining call. Already-bound reserved schedules resume unchanged.
  if (![input.summaries, input.perceptions].every(n => Number.isInteger(n) && n >= 0) || input.summaries > 1 || input.perceptions > 1) fail('assistant_quota_exceeded', 429);
  const auxiliaryCalls = input.summaries + input.perceptions;
  if (input.ordinaryDialogue && !input.resume?.turnSchedule && auxiliaryCalls === 0) return undefined;
  const primaryModelTurns = agentModelLimits.maxModelTurns - auxiliaryCalls - 1;
  if (primaryModelTurns < 1) fail('assistant_quota_exceeded', 429);
  if (input.resume && (input.resume.turnSchedule !== input.scheduleProtocol || input.resume.primaryModelTurns !== primaryModelTurns)) return undefined;
  return { primaryModelTurns, reservedValidationRepairs: 1 as const, auxiliaryCalls, maxScheduledCalls: agentModelLimits.maxModelTurns,
    sourceReadSchedule: homeSourceBudgetProtocol };
}
