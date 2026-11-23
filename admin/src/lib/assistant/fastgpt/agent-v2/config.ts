import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fail } from '../../contracts';
import { parseAgentV2Skills, type AgentV2SkillSelection } from './skills';
import type { AgentConfig } from '../../agent/config';

export const fastGPTAgentV2Protocol = 'fastgpt-agent-v2-v1';
export type AgentV2Runtime = 'fastgpt-agent-v2' | 'langgraph-v1';
export type AgentV2Configuration = { protocol: typeof fastGPTAgentV2Protocol; enterpriseId: string;
  appId: string; model: string; bridgeKey: string; runtime?: AgentV2Runtime;
  welcome?: string; presets?: string[]; suggestionAppId?: string; skills?: AgentV2SkillSelection };
type NativeConfiguration = Pick<AgentV2Configuration, 'protocol' | 'enterpriseId' | 'presets'> & {
  runtime: 'langgraph-v1';
};
type DeploymentConfiguration = AgentV2Configuration | NativeConfiguration;

const validCopy = (value: unknown) => typeof value === 'string' && value.trim() === value
  && Array.from(value).length >= 1 && Array.from(value).length <= 120;
const validPresets = (value: unknown) => Array.isArray(value) && value.length >= 1 && value.length <= 6
  && value.every(item => typeof item === 'string' && item.trim() === item
    && Array.from(item).length >= 2 && Array.from(item).length <= 40)
  && new Set(value).size === value.length;

/** The private deployment binding, never accepted from chat input. `langgraph-v1`
 * disables the runtime without removing the FastGPT app or its tool set. */
export function parseAgentV2Configuration(value: unknown): AgentV2Configuration {
  const configuration = value as AgentV2Configuration;
  if (!configuration || configuration.protocol !== fastGPTAgentV2Protocol
    || !/^[1-9]\d{0,18}$/.test(configuration.enterpriseId)
    || !/^[a-f0-9]{24}$/.test(configuration.appId) || typeof configuration.model !== 'string' || !configuration.model
    || typeof configuration.bridgeKey !== 'string' || configuration.bridgeKey.length < 32
    || configuration.runtime !== undefined && !['fastgpt-agent-v2', 'langgraph-v1'].includes(configuration.runtime)
    || configuration.welcome !== undefined && !validCopy(configuration.welcome)
    || configuration.presets !== undefined && !validPresets(configuration.presets)
    || configuration.suggestionAppId !== undefined && !/^[a-f0-9]{24}$/.test(configuration.suggestionAppId)) fail('context_changed');
  configuration.skills = parseAgentV2Skills(configuration.skills);
  return configuration;
}
export type AgentV2Presentation = { welcome: string | null; presets: string[] };
/** Bootstrap copy stays additive: a malformed private file disables the
 * presentation rather than blocking the customer's entry context. */
export function fastGPTAgentV2Presentation(enterpriseId: string): AgentV2Presentation | undefined {
  try {
    const bound = fastGPTAgentV2Configuration(enterpriseId);
    if (!bound || !bound.configuration.welcome && !bound.configuration.presets?.length) return;
    return { welcome: bound.configuration.welcome ?? null, presets: bound.configuration.presets ?? [] };
  } catch { return; }
}
/** A native-only entry needs the enterprise switch and optional suggestion presets.
 * Legacy deployments retain their original validation and queued-run digest. */
function parseDeployment(value: unknown): DeploymentConfiguration {
  const native = value as NativeConfiguration | null;
  if (native?.runtime === 'langgraph-v1' &&
    Object.keys(native).every(key => ['protocol', 'enterpriseId', 'runtime', 'presets'].includes(key))) {
    if (native.protocol !== fastGPTAgentV2Protocol || typeof native.enterpriseId !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(native.enterpriseId) ||
      (native.presets !== undefined && !validPresets(native.presets))) fail('context_changed');
    return native;
  }
  return parseAgentV2Configuration(value);
}
/** Accept both the original single binding and one binding per enterprise. */
export function parseAgentV2Configurations(value: unknown): DeploymentConfiguration[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (list.length > 50) fail('context_changed');
  const configurations = list.map(parseDeployment);
  if (new Set(configurations.map(configuration => configuration.enterpriseId)).size !== configurations.length) fail('context_changed');
  return configurations;
}
/** Bind only the enterprise's own configuration: disabling another enterprise
 * in the same file must not invalidate this enterprise's queued runs. */
const bindingOf = (configuration: DeploymentConfiguration) =>
  createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
export function fastGPTAgentV2Configurations(): Array<{ configuration: DeploymentConfiguration; binding: string }> {
  const file = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  if (!file) return [];
  return parseAgentV2Configurations(JSON.parse(fs.readFileSync(file).toString('utf8')).agentV2)
    .map(configuration => ({ configuration, binding: bindingOf(configuration) }));
}
export function fastGPTAgentV2Configuration(enterpriseId: string): { configuration: AgentV2Configuration; binding: string } | undefined {
  const bound = fastGPTAgentV2Configurations().find(item => item.configuration.enterpriseId === enterpriseId);
  if (!bound || bound.configuration.runtime === 'langgraph-v1') return;
  return { configuration: bound.configuration, binding: bound.binding };
}
/** The per-enterprise executor switch. `runtime: 'langgraph-v1'` keeps the
 * FastGPT app, tool set and presentation copy intact but routes new reply runs
 * to the XiaoK native executor; `fastgpt-agent-v2` keeps the bridge selection. */
export function nativeAgentRuntimeBinding(enterpriseId: string): { configuration: DeploymentConfiguration; binding: string } | undefined {
  const bound = fastGPTAgentV2Configurations().find(item => item.configuration.enterpriseId === enterpriseId);
  return bound && bound.configuration.runtime === 'langgraph-v1' ? bound : undefined;
}

/** The dedicated consultation profile requires LangGraph's quota and
 * deadline contract. Keep the deployment binding intact when it is selected. */
export function nativeExecutorConfigurationIssue(agent: AgentConfig) {
  if (agent.consultation) return 'assistant_native_consultation_profile_unsupported';
  if (agent.structuredFinal) return 'assistant_native_structured_final_unsupported';
  return null;
}
