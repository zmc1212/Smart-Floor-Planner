import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fail } from '../../contracts';

export const fastGPTAgentV2Protocol = 'fastgpt-agent-v2-v1';
export type AgentV2Runtime = 'fastgpt-agent-v2' | 'langgraph-v1';
export type AgentV2Configuration = { protocol: typeof fastGPTAgentV2Protocol; enterpriseId: string;
  appId: string; model: string; bridgeKey: string; runtime?: AgentV2Runtime };

/** The private deployment binding, never accepted from chat input. `langgraph-v1`
 * disables the runtime without removing the FastGPT app or its tool set. */
export function parseAgentV2Configuration(value: unknown): AgentV2Configuration {
  const configuration = value as AgentV2Configuration;
  if (!configuration || configuration.protocol !== fastGPTAgentV2Protocol
    || !/^[1-9]\d{0,18}$/.test(configuration.enterpriseId)
    || !/^[a-f0-9]{24}$/.test(configuration.appId) || typeof configuration.model !== 'string' || !configuration.model
    || typeof configuration.bridgeKey !== 'string' || configuration.bridgeKey.length < 32
    || configuration.runtime !== undefined && !['fastgpt-agent-v2', 'langgraph-v1'].includes(configuration.runtime)) fail('context_changed');
  return configuration;
}
export function fastGPTAgentV2Configuration(enterpriseId: string): { configuration: AgentV2Configuration; binding: string } | undefined {
  const file = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  if (!file) return;
  const bytes = fs.readFileSync(file), configuration = parseAgentV2Configuration(JSON.parse(bytes.toString('utf8')).agentV2);
  if (configuration.enterpriseId !== enterpriseId || configuration.runtime === 'langgraph-v1') return;
  return { configuration, binding: createHash('sha256').update(bytes).digest('hex') };
}
