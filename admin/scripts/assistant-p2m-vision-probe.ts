/** Opt-in semantic regression for the actual short-perception + Agent reply pipeline. */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { getPlatformLlmRuntimeConfig, normalizeLlmProviderRuntimeBaseUrl } from '@/lib/platform-llm-config';
import { executeAgentChat } from '@/lib/ai/providers/agent-chat';
import { closePostgresPool } from '@/lib/postgresql';
import { buildAgentContext, parseAgentReply, agentPromptVersion } from '@/lib/assistant/agent/context';
import { visionContext, withVisionObservations } from '@/lib/assistant/agent/vision';
import { finalTool } from '@/lib/assistant/agent/worker';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

loadEnvConfig(process.cwd(), true);
async function main() {
  if (process.env.ASSISTANT_P2M_DEEPSEEK_PROBE !== '1') throw Error('Explicit DeepSeek probe flag required');
  const config = await getPlatformLlmRuntimeConfig();
  if (!config.enabled || config.providerKey !== 'deepseek' || new URL(config.baseUrl).origin !== 'https://api.deepseek.com') throw Error('Official DeepSeek configuration required');
  const runtime = { id: 'probe', key: 'probe', name: 'synthetic-vision', adapterType: 'openai_compatible', baseUrl: normalizeLlmProviderRuntimeBaseUrl(config.baseUrl), apiKey: config.apiKey, capabilities: ['chat'], modelMappings: {}, timeoutMs: 45000 } as AiProviderRuntimeConfig;
  const cases = [
    { id: 'red-png', colors: ['#dd2233'], format: 'png', width: 320, height: 320, expected: ['红'] },
    { id: 'red-jpeg', colors: ['#dd2233'], format: 'jpeg', width: 320, height: 320, expected: ['红'] },
    { id: 'blue-small', colors: ['#2255dd'], format: 'png', width: 160, height: 160, expected: ['蓝'] },
    { id: 'green-tall', colors: ['#22aa44'], format: 'jpeg', width: 160, height: 320, expected: ['绿'] },
    { id: 'white', colors: ['#ffffff'], format: 'png', width: 320, height: 320, expected: ['白'] },
    { id: 'yellow-wide', colors: ['#ffdd22'], format: 'png', width: 640, height: 160, expected: ['黄'] },
    { id: 'two-images', colors: ['#dd2233','#2255dd'], format: 'jpeg', width: 320, height: 320, expected: ['红','蓝'] },
    { id: 'colored-shapes', colors: ['#ffffff'], format: 'png', width: 480, height: 480, expected: ['红','蓝','圆','方'] },
  ];
  const outputs = [];
  for (let repeat = 0; repeat < 2; repeat++) for (const c of cases) {
    const started = Date.now();
    try {
      const messages = buildAgentContext([{ id: '100', role: 'user', text: c.id === 'colored-shapes' ? '请描述图片中的颜色和形状。' : '请按图片顺序分别说出主要颜色。' }], { version: 0, facts: [] });
      const current = messages.at(-1)!;
      if (current.role !== 'user') throw Error('Missing current user message');
      for (const [index, color] of c.colors.entries()) {
        const source = c.id === 'colored-shapes'
          ? sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="white"/><circle cx="120" cy="240" r="80" fill="red"/><rect x="280" y="160" width="160" height="160" fill="blue"/></svg>'))
          : sharp({ create: { width: c.width, height: c.height, channels: 3, background: color } });
        const data = await (c.format === 'png' ? source.png() : source.jpeg({ quality: 88 })).toBuffer();
        current.content.push({ type: 'image', mediaId: String(index + 1), hash: 'synthetic-' + c.id, mimeType: c.format === 'png' ? 'image/png' : 'image/jpeg', data: data.toString('base64') });
      }
      const perception = await executeAgentChat(runtime, { model: 'deepseek-flash', messages: visionContext(messages)!, tools: [], maxTokens: 2048, enableThinking: false });
      if (perception.toolCalls.length) throw Error('Unexpected perception tool');
      const answer = await executeAgentChat(runtime, { model: 'deepseek-flash', messages: withVisionObservations(messages, perception.text), tools: [finalTool], maxTokens: 2048, enableThinking: false, requireTool: true });
      const final = answer.toolCalls[0];
      if (answer.toolCalls.length !== 1 || final.name !== 'final_response') throw Error('Missing final response');
      const text = parseAgentReply(final.arguments);
      const pass = c.expected.every(word => text.includes(word));
      outputs.push({ id: c.id, repeat, pass, ms: Date.now() - started, observations: perception.text, text, usage: [perception.usage, answer.usage] });
    } catch (e) { outputs.push({ id: c.id, repeat, pass: false, ms: Date.now() - started, error: e instanceof Error ? e.message.slice(0,300) : 'unknown' }); }
    console.log(JSON.stringify({ completed: outputs.length, failures: outputs.filter(o => !o.pass).length }));
  }
  const report = { model: 'deepseek-flash', providerKey: 'deepseek', agentPromptVersion, generatedAt: new Date().toISOString(), scope: '16 synthetic semantic image checks; not real renovation quality acceptance', passed: outputs.every(o => o.pass), outputs };
  const target = path.resolve('../tmp/xiaok-vector/p2m-vision-' + agentPromptVersion + '-deepseek-flash.json');
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ target, passed: report.passed, total: outputs.length }));
  if (!report.passed) process.exitCode = 1;
}
main().catch(() => { console.error('Synthetic vision diagnostic failed; no automatic retry'); process.exitCode = 1; }).finally(closePostgresPool);
