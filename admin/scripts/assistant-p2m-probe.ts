/** Opt-in synthetic capability probe against an explicitly authorized assistant model.
 * Credentials stay in process. No customer data, business mutations, or automatic retries.
 */
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { getPlatformLlmRuntimeConfig, normalizeLlmProviderRuntimeBaseUrl } from '@/lib/platform-llm-config';
import { executeAgentChat } from '@/lib/ai/providers/agent-chat';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { closePostgresPool } from '@/lib/postgresql';
import type { ModelMessage } from '@/lib/assistant/contracts/model';

loadEnvConfig(process.cwd(), true);
async function main() {
  if (process.env.ASSISTANT_P2M_SYNTHETIC_PROBE !== '1') throw Error('Explicit synthetic probe flag required');
  const config = await getPlatformLlmRuntimeConfig();
  const deepseekProbe = process.env.ASSISTANT_P2M_DEEPSEEK_PROBE === '1';
  const model = deepseekProbe ? 'deepseek-flash' : process.env.ASSISTANT_TEXT_MODEL?.trim();
  const authorized = deepseekProbe
    ? config.providerKey === 'deepseek' && new URL(config.baseUrl).origin === 'https://api.deepseek.com'
    : config.providerKey === 'siliconflow' && model === 'Qwen/Qwen3.5-4B';
  if (!config.enabled || !authorized) throw Error('Probe restricted to explicitly authorized provider and model');
  console.log(JSON.stringify({ scope: 'three synthetic requests; no retries or business writes', provider: config.providerKey,
    configuredModel: config.model, probeModel: model, temporaryOverride: deepseekProbe }));
  const runtime: AiProviderRuntimeConfig = { id: 'probe', key: 'probe', name: 'synthetic-probe', adapterType: 'openai_compatible',
    baseUrl: normalizeLlmProviderRuntimeBaseUrl(config.baseUrl), apiKey: config.apiKey, capabilities: ['chat'], modelMappings: {}, timeoutMs: 45000 };
  const image = await sharp({ create: { width: 448, height: 448, channels: 3, background: '#ed2222' } }).png().toBuffer();
  const cases: Array<{ id: string; messages: ModelMessage[]; tool?: boolean }> = [
    { id: 'text', messages: [{ role: 'user', content: [{ type: 'text', text: '用一句话说明小书房怎样兼顾办公和采光。' }] }] },
    { id: 'image', messages: [{ role: 'user', content: [{ type: 'text', text: '这张图的主要颜色是什么？只回答颜色。' },
      { type: 'image', mediaId: 'synthetic', hash: 'synthetic-red', mimeType: 'image/png', data: image.toString('base64') }] }] },
    { id: 'tool', tool: true, messages: [{ role: 'user', content: [{ type: 'text', text: '调用 lookup_booking 查询我的预约。不要猜测。' }] }] },
  ];
  for (const c of cases) {
    const started = Date.now();
    try {
      const result = await executeAgentChat(runtime, { model: model!, messages: c.messages,
        tools: c.tool ? [{ name: 'lookup_booking', description: '查询当前客户的真实预约', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }] : [],
        maxTokens: 512, enableThinking: false, requireTool: c.tool });
      console.log(JSON.stringify({ case: c.id, model, ms: Date.now() - started, ...result }));
    } catch (e) { console.log(JSON.stringify({ case: c.id, model, ms: Date.now() - started, error: e instanceof AiProviderError ? e.code : 'probe_failed' })); }
  }
}
main().catch(() => { console.error('P2M probe unavailable; no fallback invoked'); process.exitCode = 1; }).finally(closePostgresPool);
