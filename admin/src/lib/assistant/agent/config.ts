export type AgentConfig = { runtime: 'langgraph-v1'; model: string; providerKey: string; imageInput: boolean; tools: boolean; probeVersion: string };
/** Deliberately opt-in per enterprise; missing/incomplete capability evidence stays on the legacy executor. */
export function agentConfig(value: unknown): AgentConfig | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (c.runtime !== 'langgraph-v1' || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 240
    || typeof c.providerKey !== 'string' || !c.providerKey || typeof c.probeVersion !== 'string' || !c.probeVersion
    || typeof c.imageInput !== 'boolean' || typeof c.tools !== 'boolean') return null;
  return { runtime: c.runtime, model: c.model, providerKey: c.providerKey, imageInput: c.imageInput, tools: c.tools, probeVersion: c.probeVersion };
}
