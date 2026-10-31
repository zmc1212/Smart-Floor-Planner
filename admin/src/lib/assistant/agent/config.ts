import { fail, fingerprint } from '../contracts';
import { bailianStructuredOutput } from '@/lib/ai/providers/bailian-capabilities';
import { consultationProfile } from '../contracts/consultation';
import { consultationBinding, type ConsultationBinding } from './consultation-profile';
import {nativeFinalProtocol} from './native-final';
import { reviewClaimProtocol } from './review-claims';
import { reviewCompletionProtocol } from './review-completion';
import { conversationImageProtocol } from './image-context';
export type AgentConfig = { runtime: 'langgraph-v1'; model: string; providerKey: string; imageInput: boolean; tools: boolean; probeVersion: string; consultation?: ConsultationBinding; structuredFinal?:typeof nativeFinalProtocol; requirementClaims?: typeof reviewClaimProtocol; reviewCompletion?: typeof reviewCompletionProtocol; imageContext?: typeof conversationImageProtocol;
  knowledgeExplanation?: 'reviewed-knowledge-explanation-v1' };
/** Deliberately opt-in per enterprise; missing/incomplete capability evidence stays on the legacy executor. */
export function agentConfig(value: unknown): AgentConfig | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  const consultation = c.consultation === undefined ? undefined : consultationBinding(c.consultation);
  // Keep an unaccepted semantic path opt-in. It cannot silently replace the
  // established answer mode for ordinary enterprise users during development.
  if (c.knowledgeExplanation !== undefined && (c.knowledgeExplanation !== 'reviewed-knowledge-explanation-v1'
    || c.tools !== true || c.structuredFinal !== undefined)) fail('assistant_capability_forbidden', 403);
  // An invalid opt-in must never silently dispatch through the legacy model.
  if (c.consultation !== undefined && (!consultation || c.model !== consultationProfile(consultation.profile)?.model || c.tools !== true)) fail('assistant_capability_forbidden', 403);
  if (c.imageContext !== undefined && (c.imageContext !== conversationImageProtocol || c.imageInput !== true || c.structuredFinal !== nativeFinalProtocol)) fail('assistant_capability_forbidden', 403);
  if(c.structuredFinal!==undefined&&(c.structuredFinal!==nativeFinalProtocol||c.providerKey!=='dashscope'||!bailianStructuredOutput(c.model,'json_schema')||c.tools!==true||(c.imageInput!==false&&c.imageContext!==conversationImageProtocol)||consultation))fail('assistant_capability_forbidden',403);
  if (c.requirementClaims !== undefined && (c.requirementClaims !== reviewClaimProtocol || c.structuredFinal !== nativeFinalProtocol)) fail('assistant_capability_forbidden', 403);
  if (c.reviewCompletion !== undefined && (c.reviewCompletion !== reviewCompletionProtocol || c.requirementClaims !== reviewClaimProtocol)) fail('assistant_capability_forbidden', 403);
  if (c.runtime !== 'langgraph-v1' || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 240
    || typeof c.providerKey !== 'string' || !c.providerKey || typeof c.probeVersion !== 'string' || !c.probeVersion
    || typeof c.imageInput !== 'boolean' || typeof c.tools !== 'boolean') return null;
  return { runtime: c.runtime, model: c.model, providerKey: c.providerKey, imageInput: c.imageInput, tools: c.tools, probeVersion: c.probeVersion,
    ...(c.knowledgeExplanation ? { knowledgeExplanation: c.knowledgeExplanation as AgentConfig['knowledgeExplanation'] } : {}),
    ...(consultation ? { consultation } : {}),...(c.structuredFinal===nativeFinalProtocol?{structuredFinal:nativeFinalProtocol}:{}),
    ...(c.requirementClaims === reviewClaimProtocol ? { requirementClaims: reviewClaimProtocol } : {}),
    ...(c.reviewCompletion === reviewCompletionProtocol ? { reviewCompletion: reviewCompletionProtocol } : {}),
    ...(c.imageContext === conversationImageProtocol ? { imageContext: conversationImageProtocol } : {}) };
}

/** Protocol/quota rollout affects new runs. Existing runs retain their bound
 * protocol, while model, probe, tools and image capability changes still fence. */
export function agentCapabilityFingerprint(config: AgentConfig | null) {
  if (!config) return fingerprint(null);
  const capability = { ...config }; delete capability.consultation;
  delete capability.structuredFinal; // The run retains its policy-snapshot strategy across rollout changes.
  delete capability.requirementClaims;
  delete capability.reviewCompletion;
  delete capability.knowledgeExplanation; // Strategy is bound in the run snapshot.
  return fingerprint(capability);
}
