/** Local trajectory evaluation inspired by agentevals; no external tracing or customer data. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { getPlatformLlmRuntimeConfig, normalizeLlmProviderRuntimeBaseUrl } from '@/lib/platform-llm-config';
import { executeAgentChat } from '@/lib/ai/providers/agent-chat';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { closePostgresPool } from '@/lib/postgresql';
import { buildAgentContext, parseAgentReply, agentPromptVersion } from '@/lib/assistant/agent/context';
import { runRenovationAgent } from '@/lib/assistant/agent/runtime';
import { applyNeedDelta, parseNeedDelta, needWriteFeedback, type NeedMemory } from '@/lib/assistant/agent/memory';
import { visionContext, withVisionObservations } from '@/lib/assistant/agent/vision';
import { finalTool, agentToolsForMessage } from '@/lib/assistant/agent/worker';
import { scenarios } from './assistant-p2m-scenarios';
import { INSUFFICIENT_TEXT, parseSelection } from '@/lib/assistant/knowledge/answer';

loadEnvConfig(process.cwd(), true);
async function main() {
  if (process.env.ASSISTANT_P2M_DEEPSEEK_PROBE !== '1') throw Error('Explicit DeepSeek evaluation flag required');
  const config = await getPlatformLlmRuntimeConfig();
  if (!config.enabled || config.providerKey !== 'deepseek' || config.model !== 'deepseek-flash' || new URL(config.baseUrl).origin !== 'https://api.deepseek.com') throw Error('Official configured deepseek-flash required');
  const runtime = { id: 'scenario-eval', key: 'scenario-eval', name: 'public-fixture-evaluation', adapterType: 'openai_compatible', baseUrl: normalizeLlmProviderRuntimeBaseUrl(config.baseUrl), apiKey: config.apiKey, capabilities: ['chat'], modelMappings: {}, timeoutMs: 45000 } as AiProviderRuntimeConfig;
  const directory = path.resolve('../tmp/xiaok-vector/renovation-photos');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as Array<{ id: string; sha256: string; source: string; license: string }>;
  const images = new Map(manifest.map(p => {
    const bytes = fs.readFileSync(path.join(directory, p.id + '.jpg'));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), p.sha256);
    return [p.id, { type: 'image' as const, mediaId: p.id, hash: p.sha256, mimeType: 'image/jpeg' as const, data: bytes.toString('base64') }];
  }));
  // Deterministic corruptions of public fixtures, not generated replacement photographs.
  const variants = [
    { id: 'bathroom-blur', source: 'bathroom', mode: 'blur' },
    { id: 'demolition-pixels', source: 'demolition', mode: 'pixels' },
    { id: 'window-occluded', source: 'window', mode: 'occluded' },
  ];
  const variantManifest: Array<{ id: string; source: string; mode: string; sha256: string; bytes: number }> = [];
  for (const variant of variants) {
    const original = Buffer.from(images.get(variant.source)!.data, 'base64');
    let data: Buffer;
    if (variant.mode === 'blur') data = await sharp(original).resize(640,480).blur(8).jpeg({ quality: 40 }).toBuffer();
    else if (variant.mode === 'pixels') data = await sharp(await sharp(original).resize(8,6).jpeg({ quality: 10 }).toBuffer()).resize(640,480,{ kernel:'nearest' }).jpeg().toBuffer();
    else data = await sharp(original).resize(418,524).composite([{ input: Buffer.from('<svg width="418" height="524"><rect x="20" y="20" width="378" height="484" fill="#444"/></svg>') }]).jpeg().toBuffer();
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    images.set(variant.id, { type:'image', mediaId:variant.id, hash, mimeType:'image/jpeg', data:data.toString('base64') });
    fs.writeFileSync(path.join(directory,variant.id+'.jpg'),data);
    variantManifest.push({ ...variant, sha256:hash, bytes:data.length });
  }
  const outputs: Array<Record<string, unknown>> = [];
  const sourceHashes = Object.fromEntries(['scripts/assistant-p2m-scenarios.ts','scripts/assistant-p2m-scenario-evaluate.ts','src/lib/assistant/agent/worker.ts','src/lib/assistant/agent/context.ts','src/lib/assistant/agent/memory.ts','src/lib/assistant/agent/vision.ts'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  const filter = process.env.ASSISTANT_P2M_SCENARIO_FILTER || '';
  const selected = scenarios.filter(s => !filter || s.id.includes(filter));
  assert.ok(selected.length, 'No matching scenarios');
  const started = new Date().toISOString();
  const target = path.resolve('../tmp/xiaok-vector/p2m-scenarios-' + agentPromptVersion + '-' + started.replace(/[:.]/g,'-') + '.json');
  const save = () => fs.writeFileSync(target, JSON.stringify({ agentPromptVersion, model: config.model, started, filter, sourceHashes, scenarioIds: selected.map(s=>s.id), scope: 'Public CC0 photos and deterministic corruptions; fixed multi-turn trajectories; in-memory tools, not database acceptance. Keyword checks plus final fact/trajectory invariants, not independent human quality grading.', manifest, variantManifest, passed: outputs.length === selected.length * 2 && outputs.every(o => o.pass), outputs }, null, 2));
  for (let repeat = 0; repeat < 2; repeat++) for (const scenario of selected) {
    let memory: NeedMemory = { version: 0, facts: [] };
    let history: Array<{ id: string; role: 'user' | 'assistant'; text: string }> = [];
    const pictureMessages = new Map<string, string[]>();
    const turns: Array<Record<string, unknown>> = [];
    for (const [index, turn] of scenario.turns.entries()) {
      const id = String(100 + index * 2), trace: Array<Record<string, unknown>> = [];
      const before = JSON.stringify(memory);
      let reply = '', error = '';
      try {
        if (turn.reenter) history = []; // force retrieval from durable-shaped memory, not previous answer text
        history.push({ id, role: 'user', text: turn.text });
        if (turn.images) pictureMessages.set(id, turn.images);
        let messages = buildAgentContext(history, memory);
        for (const message of messages) if (message.role === 'user') {
          const source = JSON.parse(message.content.find(p => p.type === 'text')!.text).sourceMessageId;
          for (const key of pictureMessages.get(source) || []) message.content.push(images.get(key)!);
        }
        const perception = visionContext(messages);
        if (perception) {
          const output = await executeAgentChat(runtime, { model: config.model, messages: perception, tools: [], maxTokens: 2048, enableThinking: false });
          trace.push({ stage: 'perception', output });
          assert.ok(output.text.trim() && output.text.length <= 4000 && !output.toolCalls.length);
          messages = withVisionObservations(messages, output.text);
        }
        const result = await runRenovationAgent({ messages, tools: agentToolsForMessage(turn.text, true), ports: {
          authorize: async () => {}, checkpoint: async () => {},
          model: async (round, context, tools) => {
            const output = await executeAgentChat(runtime, { model: config.model, messages: context, tools: [...tools,finalTool], maxTokens: 2048, enableThinking: false, requireTool: true });
            trace.push({ stage: 'reasoning', round, output });
            const final = output.toolCalls.find(t => t.name === 'final_response');
            if (final) { assert.equal(output.toolCalls.length, 1); return { ...output, text: final.arguments, toolCalls: [] }; }
            return output;
          },
          tool: async (round, slot, name, args) => {
            trace.push({ stage: 'tool', round, slot, name, args });
            if (name === 'search_knowledge') return { content: '{"evidence":[]}' };
            assert.equal(name, 'record_need', 'unexpected business mutation');
            try {
              memory = applyNeedDelta(memory, parseNeedDelta({ ...JSON.parse(args), sourceMessageId: id, expectedVersion: memory.version }), { id, text: turn.text }, scenario.id + ':' + id + ':' + round + ':' + slot, started);
            } catch (e) {
              const feedback = needWriteFeedback(e, turn.text);
              if (!feedback) throw e;
              return { content: JSON.stringify(feedback) };
            }
            return { content: JSON.stringify({ status: 'saved', memoryVersion: memory.version, formalApproval: false }) };
          },
        } });
        const final = JSON.parse(result.output?.text || '{}');
        if (final.kind === 'knowledge') {
          assert.ok(trace.some(t=>t.stage==='tool' && t.name==='search_knowledge'), 'unbacked knowledge reply');
          assert.equal(parseSelection(JSON.stringify({ selections: final.selections }), []).answerKind,'insufficient_evidence');
          // Match production delivery: never grade the model's discarded free-form knowledge text.
          reply = INSUFFICIENT_TEXT;
        } else reply = parseAgentReply(result.output?.text || '');
        history.push({ id: String(Number(id)+1), role: 'assistant', text: reply });
        if (turn.unchanged) assert.equal(JSON.stringify(memory), before, 'discussion mutated memory');
        if (scenario.group === 'photos') assert.equal(memory.facts.length, 0, 'image observations must not become customer needs');
        for (const [room,field,value] of turn.facts || []) assert.ok(memory.facts.some(f => f.status === 'current' && f.room === room && new RegExp('^(?:'+field+')$').test(f.field) && f.value.includes(value)), 'missing current fact: '+[room,field,value].join('/'));
        for (const pattern of turn.words || []) assert.match(reply, new RegExp(pattern), 'missing response concept: '+pattern);
        for (const f of memory.facts.filter(f => f.status === 'current')) assert.equal(memory.facts.filter(g => g.status === 'current' && g.room === f.room && g.field === f.field).length, 1);
        for (const old of (JSON.parse(before) as NeedMemory).facts) {
          const retained = memory.facts.find(f => f.id === old.id);
          assert.ok(retained, 'correction deleted history');
          assert.deepEqual(retained, { ...old, status: retained.status }, 'correction rewrote immutable provenance');
        }
        for (const f of memory.facts.filter(f => f.supersedes)) {
          const prior = memory.facts.find(p => p.id === f.supersedes);
          assert.ok(prior && prior.room === f.room && prior.field === f.field && prior.status === 'superseded', 'invalid correction chain');
        }
      } catch (e) { error = e instanceof Error ? e.message.slice(0,500) : 'unknown'; }
      turns.push({ index, input: turn, reply, error, pass: !error, trace, memory: JSON.parse(JSON.stringify(memory)) });
    }
    outputs.push({ id: scenario.id, group: scenario.group, repeat, pass: turns.every(t => t.pass), turns });
    save();
    console.log(JSON.stringify({ completed: outputs.length, total: selected.length*2, failures: outputs.filter(o=>!o.pass).length }));
  }
  console.log(JSON.stringify({ target, passed: outputs.every(o=>o.pass) }));
  if (outputs.some(o=>!o.pass)) process.exitCode = 1;
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Scenario evaluation failed'); process.exitCode = 1; }).finally(closePostgresPool);
