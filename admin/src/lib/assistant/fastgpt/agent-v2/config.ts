import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fail } from '../../contracts';
import type { AgentConfig } from '../../agent/config';

/** The private deployment file keeps its historical protocol marker. FastGPT
 * Agent V2 was removed on 2026-11-19; the file now selects only the XiaoK
 * native executor (`runtime: 'langgraph-v1'`) and its suggestion presets.
 * Legacy `appId`/`model`/`bridgeKey`/`skills` fields may still be present and
 * are ignored, so an existing ACL-protected file does not need a rewrite. */
export const agentBindingProtocol = 'fastgpt-agent-v2-v1';
export type AgentRuntimeBinding = { protocol: typeof agentBindingProtocol; enterpriseId: string;
  runtime: 'langgraph-v1'; presets?: string[] };

const validPresets = (value: unknown) => Array.isArray(value) && value.length >= 1 && value.length <= 6
  && value.every(item => typeof item === 'string' && item.trim() === item
    && Array.from(item).length >= 2 && Array.from(item).length <= 40)
  && new Set(value).size === value.length;

/** The private deployment binding, never accepted from chat input. Only the
 * native executor is selectable now: an old `fastgpt-agent-v2` entry fails
 * closed instead of silently routing to a runtime that no longer exists. */
export function parseAgentRuntimeBinding(value: unknown): AgentRuntimeBinding {
  const configuration = value as AgentRuntimeBinding;
  if (!configuration || configuration.protocol !== agentBindingProtocol
    || !/^[1-9]\d{0,18}$/.test(configuration.enterpriseId)
    || configuration.runtime !== 'langgraph-v1'
    || configuration.presets !== undefined && !validPresets(configuration.presets)) fail('context_changed');
  return configuration;
}
/** One deployment file may bind several enterprises. The existing single-object
 * form stays valid, and every enterprise keeps its own binding. */
export function parseAgentRuntimeBindings(value: unknown): AgentRuntimeBinding[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (list.length > 50) fail('context_changed');
  const configurations = list.map(parseAgentRuntimeBinding);
  if (new Set(configurations.map(configuration => configuration.enterpriseId)).size !== configurations.length) fail('context_changed');
  return configurations;
}
/** Bind only the enterprise's own configuration: disabling another enterprise
 * in the same file must not invalidate this enterprise's queued runs. */
const bindingOf = (configuration: AgentRuntimeBinding) =>
  createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
export function agentRuntimeBindings(): Array<{ configuration: AgentRuntimeBinding; binding: string }> {
  const file = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  if (!file) return [];
  // A removed machine-local binding simply leaves this enterprise unbound; a
  // present but invalid file still fails validation below.
  let bytes: Buffer;
  try { bytes = fs.readFileSync(file); } catch { return []; }
  return parseAgentRuntimeBindings(JSON.parse(bytes.toString('utf8')).agentV2)
    .map(configuration => ({ configuration, binding: bindingOf(configuration) }));
}
export function nativeAgentRuntimeBinding(enterpriseId: string): { configuration: AgentRuntimeBinding; binding: string } | undefined {
  return agentRuntimeBindings().find(item => item.configuration.enterpriseId === enterpriseId);
}

/** The dedicated consultation profile requires LangGraph's quota and
 * deadline contract. Keep the deployment binding intact when it is selected. */
export function nativeExecutorConfigurationIssue(agent: AgentConfig) {
  if (agent.consultation) return 'assistant_native_consultation_profile_unsupported';
  if (agent.structuredFinal) return 'assistant_native_structured_final_unsupported';
  return null;
}
