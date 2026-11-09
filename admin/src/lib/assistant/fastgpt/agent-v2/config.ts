import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fail } from '../../contracts';
import { parseAgentV2Skills, type AgentV2SkillSelection } from './skills';

export const fastGPTAgentV2Protocol = 'fastgpt-agent-v2-v1';
export type AgentV2Runtime = 'fastgpt-agent-v2' | 'langgraph-v1';
export type AgentV2Configuration = { protocol: typeof fastGPTAgentV2Protocol; enterpriseId: string;
  appId: string; model: string; bridgeKey: string; runtime?: AgentV2Runtime;
  welcome?: string; presets?: string[]; suggestionAppId?: string; skills?: AgentV2SkillSelection };

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
export function fastGPTAgentV2Configuration(enterpriseId: string): { configuration: AgentV2Configuration; binding: string } | undefined {
  const file = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  if (!file) return;
  const bytes = fs.readFileSync(file), configuration = parseAgentV2Configuration(JSON.parse(bytes.toString('utf8')).agentV2);
  if (configuration.enterpriseId !== enterpriseId || configuration.runtime === 'langgraph-v1') return;
  return { configuration, binding: createHash('sha256').update(bytes).digest('hex') };
}
