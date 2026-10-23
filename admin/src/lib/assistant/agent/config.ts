import { fail, fingerprint } from '../contracts';
import { consultationProfile } from '../contracts/consultation';
import { consultationBinding, type ConsultationBinding } from './consultation-profile';
export type AgentConfig = { runtime: 'langgraph-v1'; model: string; providerKey: string; imageInput: boolean; tools: boolean; probeVersion: string; consultation?: ConsultationBinding };
/** Deliberately opt-in per enterprise; missing/incomplete capability evidence stays on the legacy executor. */
export function agentConfig(value: unknown): AgentConfig | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  const consultation = c.consultation === undefined ? undefined : consultationBinding(c.consultation);
  // An invalid opt-in must never silently dispatch through the legacy model.
  if (c.consultation !== undefined && (!consultation || c.model !== consultationProfile(consultation.profile)?.model || c.tools !== true)) fail('assistant_capability_forbidden', 403);
  if (c.runtime !== 'langgraph-v1' || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 240
    || typeof c.providerKey !== 'string' || !c.providerKey || typeof c.probeVersion !== 'string' || !c.probeVersion
    || typeof c.imageInput !== 'boolean' || typeof c.tools !== 'boolean') return null;
  return { runtime: c.runtime, model: c.model, providerKey: c.providerKey, imageInput: c.imageInput, tools: c.tools, probeVersion: c.probeVersion,
    ...(consultation ? { consultation } : {}) };
}

/** Protocol/quota rollout affects new runs. Existing runs retain their bound
 * protocol, while model, probe, tools and image capability changes still fence. */
export function agentCapabilityFingerprint(config: AgentConfig | null) {
  if (!config) return fingerprint(null);
  const capability = { ...config }; delete capability.consultation;
  return fingerprint(capability);
}
