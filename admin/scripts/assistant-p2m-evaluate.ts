/** Synthetic, repeatable compatibility/behavior baseline. Human renovation-quality labels remain pending.
 * Model uses existing authorized provider; tool services here are fixtures, not database acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { getPlatformLlmRuntimeConfig, normalizeLlmProviderRuntimeBaseUrl } from '@/lib/platform-llm-config';
import { executeAgentChat } from '@/lib/ai/providers/agent-chat';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { closePostgresPool } from '@/lib/postgresql';
import { runRenovationAgent, type AgentCheckpoint } from '@/lib/assistant/agent/runtime';
import { buildAgentContext, parseAgentReply, agentPromptVersion } from '@/lib/assistant/agent/context';
import { applyNeedDelta, parseNeedDelta, needWriteFeedback, type NeedMemory } from '@/lib/assistant/agent/memory';
import { parseBusinessQuery } from '@/lib/assistant/agent/business-tools';
import { agentToolsForMessage, finalTool } from '@/lib/assistant/agent/worker';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { evaluationCases, evaluationVersion } from './assistant-p2m-cases';
import { visionContext, withVisionObservations } from '@/lib/assistant/agent/vision';

loadEnvConfig(process.cwd(), true);
const plain: ModelTurnOutput = { text: '{"kind":"general","text":"可以继续讨论布局。"}', toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
async function recovery(index: number) {
  let allowed = true, calls = 0, tools = 0;
  const call = { ...plain, text: '', toolCalls: [{ id: 'test', name: 'fixture', arguments: '{}' }] };
  const saved: AgentCheckpoint[] = [];
  const resume = [4,6].includes(index) ? { version: 1 as const, turn: 0, messages: [], output: plain } : undefined;
  if (index === 0) allowed = false;
  let error = '';
  try {
    const result = await runRenovationAgent({ messages: [], tools: [{ name: 'fixture', description: 'test', parameters: { type: 'object' } }], resume, ports: {
      authorize: async () => { if (!allowed) throw Error('revoked'); },
      model: async () => {
        calls++;
        if (index === 3) throw Error('unknown');
        if (index === 1) allowed = false;
        if (index === 8) return { ...call, toolCalls: [{ ...call.toolCalls[0], name: 'forbidden' }] };
        return [2,5,7,9].includes(index) ? call : plain;
      },
      checkpoint: async s => { saved.push(s); if (index === 2) allowed = false; },
      tool: async () => { tools++; if (index === 5 || index === 9) allowed = false; return { content: 'fixture', stop: index === 9 }; },
    } });
    if (index === 9) assert.equal(result.stop, true);
  } catch (e) { error = e instanceof Error ? e.message : 'error'; }
  if ([0,1,2,5].includes(index)) assert.match(error, /revoked/);
  if (index === 3) { assert.equal(error, 'unknown'); assert.equal(calls, 1); }
  if ([4,6].includes(index)) { assert.equal(error, ''); assert.equal(calls, 0); }
  if (index === 7) { assert.match(error, /iteration_limit/); assert.equal(calls, 4); }
  if (index === 8) { assert.match(error, /capability_forbidden/); assert.equal(tools, 0); }
  if (index === 9) { assert.equal(error, ''); assert.equal(calls, 1); }
  return { calls, tools, outcome: error || 'completed', fixtureOnly: true };
}
async function main() {
  if (process.env.ASSISTANT_P2M_SYNTHETIC_PROBE !== '1') throw Error('Explicit synthetic evaluation flag required');
  assert.equal(evaluationCases.length, 80);
  const config = await getPlatformLlmRuntimeConfig();
  const deepseek = process.env.ASSISTANT_P2M_DEEPSEEK_PROBE === '1';
  const model = deepseek ? 'deepseek-flash' : process.env.ASSISTANT_TEXT_MODEL?.trim();
  const authorized = deepseek
    ? config.providerKey === 'deepseek' && new URL(config.baseUrl).origin === 'https://api.deepseek.com'
    : config.providerKey === 'siliconflow' && model === 'Qwen/Qwen3.5-4B';
  if (!config.enabled || !authorized) throw Error('Evaluation restricted to explicitly authorized provider and model');
  const runtime: AiProviderRuntimeConfig = { id: 'evaluation', key: 'evaluation', name: 'synthetic-evaluation', adapterType: 'openai_compatible',
    baseUrl: normalizeLlmProviderRuntimeBaseUrl(config.baseUrl), apiKey: config.apiKey, capabilities: ['chat'], modelMappings: {}, timeoutMs: 45000 };
  const diagram = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="white"/><rect x="30" y="30" width="420" height="420" fill="none" stroke="black" stroke-width="6"/><path d="M120 30H340" stroke="blue" stroke-width="10"/><rect x="70" y="80" width="110" height="60" fill="#a67c52"/><rect x="280" y="80" width="110" height="60" fill="#a67c52"/><text x="85" y="115" font-size="20">DESK</text><text x="295" y="115" font-size="20">DESK</text><circle cx="240" cy="270" r="40" fill="#f5d52b"/><rect x="60" y="340" width="60" height="60" fill="red"/></svg>')).png().toBuffer();
  const outputs: Record<string, unknown>[] = [];
  const tasks = [0,1].flatMap(repeat => evaluationCases.map(c => ({ ...c, repeat })));
  async function consume() {
    for (;;) {
      const c = tasks.shift(); if (!c) break;
      const started = Date.now(), trace: Record<string, unknown>[] = [];
      let memory: NeedMemory = { version: 0, facts: [] }, queried = false;
      try {
        if (c.group === 'recovery') {
          outputs.push({ ...c, pass: true, ...await recovery(Number(c.id.split('-')[1]) - 1), ms: Date.now() - started }); continue;
        }
        let messages = buildAgentContext([{ id: '100', role: 'user', text: c.text }], memory);
        if (c.group === 'vision') {
          const last = messages.at(-1)!;
          if (last.role === 'user') last.content.push({ type: 'image', mediaId: 'synthetic-diagram', hash: evaluationVersion, mimeType: 'image/png', data: diagram.toString('base64') });
        }
        const perception = deepseek ? visionContext(messages) : null;
        if (perception) {
          const output = await executeAgentChat(runtime, { model: model!, messages: perception, tools: [], maxTokens: 2048, enableThinking: false });
          trace.push({ turn: -1, output });
          assert.equal(output.toolCalls.length, 0); assert.ok(output.text.trim() && output.text.length <= 4000);
          messages = withVisionObservations(messages, output.text);
        }
        const tools = agentToolsForMessage(c.text, true);
        const result = await runRenovationAgent({ messages, tools, ports: {
          authorize: async () => {}, checkpoint: async () => {},
          model: async (turn, context, availableTools) => {
            const output = await executeAgentChat(runtime, { model: model!, messages: context, tools: [...availableTools, finalTool], maxTokens: 2048, enableThinking: false, requireTool: true });
            trace.push({ turn, output });
            const final = output.toolCalls.find(t => t.name === 'final_response');
            if (final) { assert.equal(output.toolCalls.length, 1); return { ...output, text: final.arguments, toolCalls: [] }; }
            return output;
          },
          tool: async (turn, index, name, args) => {
            const input = JSON.parse(args);
            if (name === 'record_need') {
              assert.ok(['memory', 'conversation'].includes(c.group), 'unexpected memory mutation');
              try {
                memory = applyNeedDelta(memory, parseNeedDelta({ ...input, sourceMessageId: '100', expectedVersion: memory.version }), { id: '100', text: c.text }, `eval:${turn}:${index}`, new Date().toISOString());
              } catch (e) {
                const feedback = needWriteFeedback(e, c.text);
                if (!feedback) throw e;
                return { content: JSON.stringify(feedback) };
              }
              return { content: JSON.stringify({ status: 'saved', memoryVersion: memory.version, formalApproval: false }) };
            }
            if (name === 'query_business') {
              assert.ok(['tools','permission'].includes(c.group), 'unexpected business lookup');
              const query = parseBusinessQuery(input); assert.equal(query.leadId, ''); queried = true;
              return { content: JSON.stringify({ resultKey: 'fixture:0:0', query, data: [], displayText: '目前没有查到记录。', fixtureOnly: true }) };
            }
            if (name === 'search_knowledge') return { content: '{"evidence":[]}' };
            throw Error('unauthorized fixture mutation');
          },
        } });
        const reply = JSON.parse(result.output?.text || '');
        if (c.group === 'memory') assert.ok(memory.facts.length > 0, 'missing persisted memory');
        if (c.group === 'tools') { assert.ok(queried, 'missing real tool path'); assert.equal(reply.kind, 'business'); assert.equal(reply.resultKey, 'fixture:0:0'); }
        else if (reply.kind === 'business') { assert.equal(c.group, 'permission'); assert.ok(queried); assert.equal(reply.resultKey, 'fixture:0:0'); }
        else if (reply.kind === 'knowledge') assert.deepEqual(reply.selections, []);
        else parseAgentReply(result.output?.text || '');
        outputs.push({ ...c, pass: true, ms: Date.now() - started, trace, facts: memory.facts, humanQualityLabel: null, fixtureServices: true });
      } catch (e) {
        outputs.push({ ...c, pass: false, ms: Date.now() - started, trace, error: e instanceof Error ? e.message.slice(0,300) : 'unknown', humanQualityLabel: null, fixtureServices: true });
      }
      if (outputs.length % 10 === 0) console.log(JSON.stringify({ completed: outputs.length, total: 160, failures: outputs.filter(r => !r.pass).length }));
    }
  }
  await Promise.all([consume(), consume()]);
  const byGroup = Object.fromEntries([...new Set(evaluationCases.map(c => c.group))].map(group => {
    const data = outputs.filter(r => r.group === group), latency = data.map(r => Number(r.ms)).sort((a,b) => a-b);
    return [group, { total: data.length, structuralPass: data.filter(r => r.pass).length, p95ms: latency[Math.ceil(latency.length*0.95)-1], heldOutPass: data.filter(r => r.heldOut && r.pass).length, heldOutTotal: data.filter(r => r.heldOut).length }];
  }));
  const report = { evaluationVersion, agentPromptVersion, model, providerKey: config.providerKey, repeats: 2, caseCount: 80, generatedAt: new Date().toISOString(),
    scope: '70 live-model synthetic cases plus10 deterministic recovery fixtures, twice. Tool services are fixtures. Structural checks are not human renovation-quality acceptance.',
    humanQualityAcceptance: 'pending', costMicros: null, byGroup, outputs };
  const target = path.resolve(`../tmp/xiaok-vector/p2m-evaluation-${agentPromptVersion}${deepseek ? '-deepseek-flash' : ''}.json`); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ target, byGroup, humanQualityAcceptance: 'pending' }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Evaluation failed'); process.exitCode = 1; }).finally(closePostgresPool);
