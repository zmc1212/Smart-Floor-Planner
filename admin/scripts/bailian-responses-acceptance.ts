import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { getPlatformLlmOverrideRuntime } from '../src/lib/platform-llm-config';
import { closePostgresPool } from '../src/lib/postgresql';
import { AiProviderError, type AiProviderRuntimeConfig } from '../src/lib/ai/provider-types';
import type { ModelTool, ModelTurnOutput } from '../src/lib/assistant/contracts/model';
import type { NativeToolName } from '../src/lib/assistant/contracts/native-tools';
import {
  bailianResponsesBinding, bailianResponsesModelProfile,
} from '../src/lib/ai/providers/bailian-responses-capabilities';
import { executeBailianResponses } from '../src/lib/ai/providers/bailian-responses-client';
import { executeAgentChat } from '../src/lib/ai/providers/agent-chat';

/**
 * Real-model acceptance for the Bailian Responses adapter.
 *
 * Every case performs one real provider request with the provider credential
 * already configured for this environment. No mocks, no retries, no fallback.
 * Actual cost is reported as unavailable: the provider does not expose a
 * per-request settled amount on this wire.
 */

const root = path.resolve(process.cwd(), '..');
const outDir = path.join(root, 'tmp/bailian-responses');
const rawDir = path.join(outDir, 'raw');

type NativeSummary = {
  tools: NativeToolName[];
  counts: Record<string, number>;
  calls: Array<{ tool: string; status: string; queries?: string[]; sourceHosts?: string[];
    documents?: Array<{ host: string; chars: number; hash: string; injectionSignals: string[] }>;
    code?: string; logs?: string; outputKinds?: string[] }>;
  provenance: string;
  rejectedSources: number;
};

type CaseResult = {
  case: string; model: string; wire: 'responses' | 'chat-completions'; tools: NativeToolName[];
  status: 'passed' | 'failed' | 'inconclusive' | 'skipped';
  requestId: string | null; responseId: string | null; latencyMs: number;
  usage: ModelTurnOutput['usage'] | null;
  toolCounts: Record<string, number>;
  native: NativeSummary | null;
  finishReason: string | null; textHash: string | null; textExcerpt: string | null;
  actualCost: 'unavailable'; costNote: string;
  errorCode?: string; errorMessage?: string; note?: string;
  rawFile?: string;
};

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const prefix = `--${name}=`;
  const hit = args.find(item => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};
const only = argValue('only')?.split(',').map(item => item.trim()).filter(Boolean);
const models = (argValue('models') || 'qwen3.7-flash,deepseek-v4.1-flash-1017').split(',').map(item => item.trim()).filter(Boolean);
const toolModel = argValue('tool-model') || 'qwen3.7-flash';
const timeoutMs = Number(argValue('timeout-ms') || '0');
const label = argValue('label');
const importFile = argValue('import');
const wants = (name: string) => !only || only.includes(name);

function textSummary(output: ModelTurnOutput) {
  const text = output.text || '';
  return { textHash: createHash('sha256').update(text).digest('hex'),
    textExcerpt: Array.from(text).slice(0, 400).join('') };
}

function nativeSummary(output: ModelTurnOutput): NativeSummary | null {
  const evidence = output.nativeTools;
  if (!evidence) return null;
  const host = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
  return {
    tools: evidence.tools,
    counts: evidence.counts as Record<string, number>,
    provenance: evidence.provenance,
    rejectedSources: evidence.rejectedSources.length,
    calls: evidence.calls.map(call => call.tool === 'web_search'
      ? { tool: call.tool, status: call.status, queries: call.queries, sourceHosts: call.sources.map(source => host(source.url)) }
      : call.tool === 'web_extractor'
        ? { tool: call.tool, status: call.status, documents: call.documents.map(document => ({ host: host(document.url),
          chars: document.chars, hash: document.hash, injectionSignals: document.injectionSignals })) }
        : { tool: call.tool, status: call.status, code: call.code, logs: call.logs, outputKinds: call.outputKinds }),
  };
}

async function saveRaw(name: string, payload: unknown) {
  const file = path.join(rawDir, `${label ? `${label}_` : ''}${name.replace(/[^\w.-]+/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return path.relative(root, file);
}

function baseResult(name: string, model: string, wire: CaseResult['wire'], tools: NativeToolName[] = []): CaseResult {
  return { case: name, model, wire, tools, status: 'failed', requestId: null, responseId: null, latencyMs: 0,
    usage: null, toolCounts: {}, native: null, finishReason: null, textHash: null, textExcerpt: null,
    actualCost: 'unavailable', costNote: 'provider settled amount is not exposed on the Responses wire' };
}

async function record(name: string, model: string, wire: CaseResult['wire'], tools: NativeToolName[],
  run: () => Promise<ModelTurnOutput>, verify: (output: ModelTurnOutput) => string | null) {
  const result = baseResult(name, model, wire, tools);
  const started = Date.now();
  try {
    const output = await run();
    result.latencyMs = Date.now() - started;
    result.requestId = output.providerRequestId;
    result.responseId = output.nativeTools?.responseId ?? null;
    result.usage = output.usage;
    result.toolCounts = output.nativeTools?.counts ?? {};
    result.native = nativeSummary(output);
    result.finishReason = output.finishReason;
    Object.assign(result, textSummary(output));
    const failure = verify(output);
    result.status = failure ? 'failed' : 'passed';
    if (failure) result.note = failure;
    result.rawFile = await saveRaw(name, { wire, model, tools, observation: output.observation ?? null,
      nativeTools: output.nativeTools ?? null, text: output.text, toolCalls: output.toolCalls });
    return { result, output };
  } catch (error) {
    result.latencyMs = Date.now() - started;
    result.errorCode = error instanceof AiProviderError ? error.code : 'CASE_ERROR';
    result.errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 400);
    await saveRaw(name, { wire, model, tools, errorCode: result.errorCode, errorMessage: result.errorMessage });
    return { result, output: null };
  }
}

const addNumbers: ModelTool = {
  name: 'add_numbers',
  description: '把两个整数相加。只用于验证函数调用协议往返。',
  parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } },
    required: ['a', 'b'], additionalProperties: false },
};

async function main() {
  loadEnvConfig(process.cwd(), true);
  const configured = await getPlatformLlmOverrideRuntime('chat');
  if (!configured || !configured.apiKey) {
    console.log(JSON.stringify({ status: 'unavailable', reason: 'no configured DashScope runtime credential' }));
    process.exitCode = 2;
    return;
  }
  const runtime: AiProviderRuntimeConfig = timeoutMs > 0 ? { ...configured, timeoutMs } : configured;  const origin = bailianResponsesBinding(runtime.baseUrl, models[0]);
  console.log(JSON.stringify({ runtime: { baseUrl: runtime.baseUrl, keyLen: runtime.apiKey.length }, origin: origin?.responsesUrl ?? null }));

  fs.mkdirSync(rawDir, { recursive: true });
  const results: CaseResult[] = [];
  const forModel = (model: string): AiProviderRuntimeConfig => ({ ...runtime,
    modelMappings: { ...runtime.modelMappings, 'chat.general': model } });

  // 1/2. Basic Responses wire per model (DeepSeek and Qwen are both required).
  for (const model of models) {
    if (!wants('basic')) break;
    const { result } = await record(`basic:${model}`, model, 'responses', [],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'system', content: [{ type: 'text', text: '你是家庭装修顾问，回答保持一句话。' }] },
          { role: 'user', content: [{ type: 'text', text: '用一句话说明装修前为什么要做水电验收。' }] }],
        tools: [], maxTokens: 256, enableThinking: false }),
      output => output.text.trim().length >= 8 ? null : 'empty text');
    results.push(result);
  }

  // 3. Native web search on the exact model documented for it.
  if (wants('web_search')) {
    const model = toolModel;
    const { result } = await record('tool:web_search', model, 'responses', ['web_search'],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '搜索一下 2026 年瓷砖的国家标准编号，并给出来源。' }] }],
        tools: [], maxTokens: 512, enableThinking: true }, { nativeTools: ['web_search'] }),
      output => output.nativeTools?.calls.some(call => call.tool === 'web_search' && call.sources.length)
        ? null : 'no web_search sources returned');
    results.push(result);
  }

  // 4/5. Web search plus web extractor on one page.
  if (wants('web_extractor')) {
    const model = toolModel;
    const { result } = await record('tool:web_extractor', model, 'responses', ['web_search', 'web_extractor'],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '打开阿里云百炼代码解释器的官方文档页面，概括它能做什么。' }] }],
        tools: [], maxTokens: 700, enableThinking: true }, { nativeTools: ['web_search', 'web_extractor'] }),
      output => output.nativeTools?.calls.some(call => call.tool === 'web_extractor' && call.documents.length)
        ? null : 'no extracted documents returned');
    results.push(result);
  }

  // 6. Native code interpreter with a deterministic arithmetic check.
  if (wants('code_interpreter')) {
    const model = toolModel;
    const { result } = await record('tool:code_interpreter', model, 'responses', ['code_interpreter'],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '用代码计算 12 的 3 次方，只回答数字。' }] }],
        tools: [], maxTokens: 512, enableThinking: true }, { nativeTools: ['code_interpreter'] }),
      output => output.nativeTools?.calls.some(call => call.tool === 'code_interpreter' && call.code)
        && /1728/.test(output.text) ? null : 'code interpreter did not return 1728');
    results.push(result);
  }

  // 7. Several native tools in one turn.
  if (wants('multi_tool')) {
    const model = toolModel;
    const { result } = await record('tool:multi_tool', model, 'responses', ['web_search', 'web_extractor', 'code_interpreter'],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '查一下装修面积计算的公开说明，并用代码计算 12.5 乘 8.4 的结果。' }] }],
        tools: [], maxTokens: 900, enableThinking: true }, { nativeTools: ['web_search', 'web_extractor', 'code_interpreter'] }),
      output => (output.nativeTools?.calls.length ?? 0) >= 2 ? null : 'fewer than two native tool calls');
    results.push(result);
  }

  // 8/9. Custom function call round trip: tool result returned to the model.
  if (wants('function_round_trip')) {
    const model = toolModel;
    const first = await record('tool:function_call', model, 'responses', [],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '请调用 add_numbers 计算 3 加 4，然后告诉我结果。' }] }],
        tools: [addNumbers], maxTokens: 256, enableThinking: false }),
      output => output.toolCalls.some(call => call.name === 'add_numbers') ? null : 'model did not call add_numbers');
    results.push(first.result);
    const call = first.output?.toolCalls.find(item => item.name === 'add_numbers');
    if (call) {
      const second = await record('tool:function_result', model, 'responses', [],
        () => executeBailianResponses(forModel(model), { model,
          messages: [
            { role: 'user', content: [{ type: 'text', text: '请调用 add_numbers 计算 3 加 4，然后告诉我结果。' }] },
            { role: 'assistant', content: '', toolCalls: [call] },
            { role: 'tool', callId: call.id, content: JSON.stringify({ sum: 7 }) },
          ],
          tools: [addNumbers], maxTokens: 256, enableThinking: false }),
        output => /7/.test(output.text) ? null : 'final answer did not use the tool result');
      results.push(second.result);
    }
  }

  // 10. Streaming wire and a deliberate interruption.
  if (wants('streaming')) {
    const model = toolModel;
    let deltas = '';
    const { result } = await record('stream:completed', model, 'responses', [],
      () => executeBailianResponses(forModel(model), { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '用一句话说明装修预算的作用。' }] }],
        tools: [], maxTokens: 256, enableThinking: false }, { stream: true, onTextDelta: delta => { deltas += delta; } }),
      output => {
        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
        if (!output.text.trim()) return 'empty streamed text';
        if (!deltas) return 'no text delta events received';
        return normalize(deltas) === normalize(output.text) ? null
          : `delta text does not assemble into the terminal text (${deltas.length} vs ${output.text.length})`;
      });
    result.note = `delta chars=${deltas.length}`;
    results.push(result);

    const binding = bailianResponsesBinding(runtime.baseUrl, model)!;
    const controller = new AbortController();
    const started = Date.now();
    const interrupt: CaseResult = baseResult('stream:interrupted', model, 'responses');
    try {
      const response = await fetch(binding.responsesUrl, { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model, input: '写一段关于装修流程的说明。', max_tokens: 512, store: false, stream: true }) });
      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      await reader.read().catch(() => {});
      interrupt.status = 'passed';
      interrupt.note = `aborted after the first event; http=${response.status}`;
    } catch (error) {
      interrupt.status = (error as Error)?.name === 'AbortError' ? 'passed' : 'failed';
      interrupt.errorCode = (error as Error)?.name ?? 'INTERRUPT_ERROR';
    }
    interrupt.latencyMs = Date.now() - started;
    results.push(interrupt);
  }

  // 11. Timeout stays unknown and is never retried.
  if (wants('timeout')) {
    const model = toolModel;
    const tiny: AiProviderRuntimeConfig = { ...forModel(model), timeoutMs: 1 };
    const result = baseResult('timeout:unknown', model, 'responses');
    const started = Date.now();
    try {
      await executeBailianResponses(tiny, { model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '只回答 ok。' }] }],
        tools: [], maxTokens: 16, enableThinking: false });
      result.status = 'failed'; result.note = 'timeout case unexpectedly succeeded';
    } catch (error) {
      result.latencyMs = Date.now() - started;
      result.errorCode = error instanceof AiProviderError ? error.code : 'CASE_ERROR';
      result.errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      result.status = error instanceof AiProviderError && error.code === 'PROVIDER_TIMEOUT'
        && error.disposition === 'unknown' ? 'passed' : 'failed';
      result.note = 'single dispatch, unknown acceptance, no retry';
    }
    results.push(result);
  }

  // Diagnostic: distinguishes account/model access from a Responses-only failure.
  if (wants('access')) {
    const model = toolModel;
    const previous = process.env.ASSISTANT_RESPONSES_API;
    delete process.env.ASSISTANT_RESPONSES_API;
    try {
      const { result } = await record(`access:chat_completions:${model}`, model, 'chat-completions', [],
        () => executeAgentChat(forModel(model), { model,
          messages: [{ role: 'user', content: [{ type: 'text', text: '只回答 ok。' }] }],
          tools: [], maxTokens: 16, enableThinking: false }),
        () => null);
      results.push(result);
    } finally {
      if (previous !== undefined) process.env.ASSISTANT_RESPONSES_API = previous;
    }
  }

  // 12. Existing Chat Completions regression (adapter flag off).
  if (wants('chat_regression')) {
    const model = runtime.modelMappings['chat.general'] || 'qwen3.7-flash';
    const previous = process.env.ASSISTANT_RESPONSES_API;
    delete process.env.ASSISTANT_RESPONSES_API;
    try {
      const { result } = await record(`regression:chat_completions:${model}`, model, 'chat-completions', [],
        () => executeAgentChat(forModel(model), { model,
          messages: [{ role: 'user', content: [{ type: 'text', text: '用一句话说明装修前为什么要做预算。' }] }],
          tools: [], maxTokens: 128, enableThinking: false }),
        output => output.text.trim().length >= 4 ? null : 'empty chat text');
      results.push(result);
    } finally {
      if (previous !== undefined) process.env.ASSISTANT_RESPONSES_API = previous;
    }
  }

  // 13. Runtime integration path: the same assistant entry selects Responses.
  if (wants('integration')) {
    const model = toolModel;
    process.env.ASSISTANT_RESPONSES_API = '1';
    process.env.ASSISTANT_NATIVE_TOOLS = 'web_search';
    try {
      const { result } = await record('integration:execute_agent_chat', model, 'responses', ['web_search'],
        () => executeAgentChat(forModel(model), { model,
          messages: [{ role: 'user', content: [{ type: 'text', text: '搜索一条最新的家装行业公开新闻标题。' }] }],
          tools: [], maxTokens: 384, enableThinking: true }),
        output => output.observation?.protocol === 'responses'
          && (output.nativeTools?.calls.length ?? 0) > 0 ? null : 'runtime did not use the Responses wire with evidence');
      results.push(result);
    } finally {
      delete process.env.ASSISTANT_RESPONSES_API;
      delete process.env.ASSISTANT_NATIVE_TOOLS;
    }
  }

  // The master report keeps one current result per case/model plus every run.
  const masterPath = path.join(outDir, 'report.json');
  const rank = (status: CaseResult['status']) => status === 'passed' ? 3 : status === 'inconclusive' ? 2 : status === 'skipped' ? 1 : 0;
  const keyOf = (result: CaseResult) => `${result.case}|${result.model}`;
  let merged = results;
  let runs: Array<{ label: string | null; ranAt: string; cases: number }> = [];
  const imported: CaseResult[] = [];
  if (importFile) {
    const source = path.isAbsolute(importFile) ? importFile : path.resolve(root, importFile);
    if (fs.existsSync(source)) {
      const parsed = JSON.parse(fs.readFileSync(source, 'utf8')) as { cases?: CaseResult[] };
      imported.push(...(parsed.cases ?? []));
    }
  }
  if (fs.existsSync(masterPath)) {
    try {
      const previous = JSON.parse(fs.readFileSync(masterPath, 'utf8')) as { cases?: CaseResult[];
        runs?: Array<{ label: string | null; ranAt: string; cases: number }> };
      const byKey = new Map<string, CaseResult>();
      for (const result of [...imported, ...(previous.cases ?? []), ...results]) {
        const current = byKey.get(keyOf(result));
        if (!current || rank(result.status) >= rank(current.status)) byKey.set(keyOf(result), result);
      }
      merged = [...byKey.values()];
      runs = previous.runs ?? [];
    } catch { /* a corrupt master report is replaced by this run */ }
  }
  runs.push({ label: label ?? null, ranAt: new Date().toISOString(), cases: results.length });
  if (imported.length) {
    const byKey = new Map(merged.map(result => [keyOf(result), result]));
    for (const result of imported) {
      const current = byKey.get(keyOf(result));
      if (!current || rank(result.status) >= rank(current.status)) byKey.set(keyOf(result), result);
    }
    merged = [...byKey.values()];
  }

  // Capability ledger: only an exact model/tool combination with a passing
  // Responses-wire case may be marked live_verified, and never copied across models.
  const liveVerified: Record<string, Record<string, string>> = {};
  for (const result of merged) {
    if (result.status !== 'passed' || result.wire !== 'responses') continue;
    const row = liveVerified[result.model] ??= {};
    if (result.case.startsWith('basic:')) { row.responses = 'live_verified'; row.usageReporting = 'live_verified'; }
    for (const tool of result.tools) row[tool] = 'live_verified';
    if (result.case.startsWith('stream:')) row.streaming = 'live_verified';
    if (result.case.startsWith('tool:function_')) row.functionCalling = 'live_verified';
  }
  const ledgerModels = [...new Set(merged.map(result => result.model))];
  const capabilityLedger = Object.fromEntries(ledgerModels.map(model => [model, {
    documented: bailianResponsesModelProfile(model), liveVerified: liveVerified[model] ?? {},
  }]));

  const report = {
    protocol: 'bailian-responses-live-acceptance-v1',
    ranAt: new Date().toISOString(),
    runtime: { baseUrl: runtime.baseUrl, model: runtime.modelMappings['chat.general'] ?? null },
    billing: { actualCost: 'unavailable', note: 'provider does not expose a settled per-request amount on this wire' },
    models, runs,
    cases: merged,
  };
  fs.writeFileSync(masterPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'capabilities.json'), JSON.stringify(capabilityLedger, null, 2));
  if (label) {
    fs.writeFileSync(path.join(outDir, `report-${label}.json`), JSON.stringify({ ...report, cases: results, runs: undefined }, null, 2));
  }

  for (const result of results) {
    console.log(`${result.status.toUpperCase().padEnd(12)} ${result.case} [${result.model}] ${result.latencyMs}ms `
      + `${result.errorCode ?? ''} ${result.native ? `tools=${JSON.stringify(result.native.counts)}` : ''}`);
  }
  const failed = results.filter(result => result.status === 'failed');
  console.log(JSON.stringify({ cases: results.length, passed: results.filter(item => item.status === 'passed').length,
    failed: failed.length, report: path.relative(root, path.join(outDir, 'report.json')) }));
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(async error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }).finally(async () => { await closePostgresPool().catch(() => {}); });
}
