import type { AiProviderRuntimeConfig } from '../provider-types';
import { AiProviderError } from '../provider-types';
import { bailianBinding, bailianSearchBinding, type BailianTaskBinding, type BailianSearchBinding } from './bailian-capabilities';
import { parseJson, providerFetch } from './http';
import { parseWebQuery, publicWebUrl, type WebQuery } from '@/lib/assistant/agent/web';
import type { WebSearchProvider } from '@/lib/assistant/agent/web';
import { parseAgentChat, parseAgentUsage } from './agent-chat';
import { fingerprint } from '@/lib/assistant/contracts';
import type { partialBody } from '@/lib/assistant/agent/draft-continuation';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

export type BatchRemote = { id: string; status: string; input_file_id: string; output_file_id: string | null;
  error_file_id: string | null; metadata: Record<string, string> };
export interface BailianOfflineTransport {
  upload(jsonl: string): Promise<string>;
  submit(fileId: string, metadata: Record<string, string>): Promise<BatchRemote>;
  retrieve(batchId: string): Promise<BatchRemote>;
  cancel(batchId: string): Promise<BatchRemote>;
  content(fileId: string): Promise<string>;
  search(query: WebQuery): Promise<{ payload: Record<string, unknown>; requestId: string | null }>;
  continueDraft(body: ReturnType<typeof partialBody>): Promise<ModelTurnOutput>;
}
const identifier = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw Error('invalid_bailian_identifier');
  return value;
};
export const batchStates = ['validating','in_progress','finalizing','completed','failed','expired','cancelling','cancelled'] as const;
export function parseBatchRemote(value: Record<string, unknown>): BatchRemote {
  if (!batchStates.includes(value.status as typeof batchStates[number])) throw Error('invalid_batch_response');
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || Object.values(metadata).some(v => typeof v !== 'string')) throw Error('invalid_batch_response');
  return { id: identifier(value.id), status: String(value.status), input_file_id: identifier(value.input_file_id),
    output_file_id: value.output_file_id == null ? null : identifier(value.output_file_id),
    error_file_id: value.error_file_id == null ? null : identifier(value.error_file_id), metadata: metadata as Record<string,string> };
}

/** One HTTP call per operation, no SDK retries, redirects or alternate regions.
 * The durable service owns approval, reservations and indeterminate outcomes. */
export function bailianOfflineTransport(runtime: AiProviderRuntimeConfig, binding: BailianTaskBinding): BailianOfflineTransport {
  const chat = bailianBinding(runtime.baseUrl,runtime.modelMappings['chat.general']||'',binding.thinking);
  const actual=chat&&binding.api==='dashscope-generation'?bailianSearchBinding(chat):chat;
  if (!actual || fingerprint(actual) !== fingerprint(binding) || runtime.adapterType !== 'openai_compatible'
    || runtime.adapterConfig?.providerPreset !== 'dashscope') throw Error('bailian_binding_mismatch');
  const call = (path: string, method = 'GET', body?: BodyInit, multipart = false, nativeSearch = false) => {
    if(nativeSearch !== (binding.api==='dashscope-generation'))throw Error('bailian_api_mismatch');
    return providerFetch(binding.baseUrl + path,
    { method, body, redirect: 'error', headers: { Authorization: 'Bearer ' + runtime.apiKey,
      Accept: 'application/json', ...(!multipart ? { 'Content-Type': 'application/json' } : {}) } },
    Math.min(runtime.timeoutMs, 90000), 'Bailian capability', { redactErrorBody: true });
  };
  return {
    async upload(jsonl) {
      const form = new FormData(); form.set('purpose', 'batch');
      form.set('file', new Blob([jsonl], { type: 'application/jsonl' }), 'synthetic-evaluation.jsonl');
      return identifier((await parseJson(await call('/files','POST',form,true),'Batch file')).id);
    },
    async submit(fileId, metadata) { return parseBatchRemote(await parseJson(await call('/batches','POST',JSON.stringify({
      input_file_id: identifier(fileId), endpoint: '/v1/chat/completions', completion_window: '24h', metadata,
    })),'Batch submission')); },
    async retrieve(batchId) { return parseBatchRemote(await parseJson(await call('/batches/' + identifier(batchId)),'Batch status')); },
    async cancel(batchId) { return parseBatchRemote(await parseJson(await call('/batches/' + identifier(batchId) + '/cancel','POST'),'Batch cancel')); },
    async content(fileId) {
      const response = await call('/files/' + identifier(fileId) + '/content');
      if (!response.body) throw Error('batch_content_unavailable');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 4_000_000) throw Error('batch_content_too_large'); chunks.push(part.value);
      } } finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(chunks).toString('utf8');
    },
    async search(query) {
      const safe = parseWebQuery(query);
      if(binding.api!=='dashscope-generation')throw Error('bailian_search_api_mismatch');
      const response = await call('/services/aigc/text-generation/generation','POST',JSON.stringify(publicSearchBody(binding, safe)),false,true);
      return { payload: await parseJson(response,'Native public search'), requestId: response.headers.get('x-request-id') };
    },
    async continueDraft(body) {
      if (body.model !== binding.model || body.enable_thinking !== false) throw Error('bailian_binding_mismatch');
      const response = await call('/chat/completions','POST',JSON.stringify(body));
      return parseAgentChat(await parseJson(response,'Draft continuation'),response.headers.get('x-request-id'));
    },
  };
}
export function publicSearchBody(binding: BailianSearchBinding, query: WebQuery) {
  if(binding.api!=='dashscope-generation')throw Error('bailian_search_api_mismatch');
  const safe = parseWebQuery(query);
  // The provider receives exactly the validated public query. No transcript,
  // project facts, customer originals, cookies or business tools are included.
  return { model: binding.model, input:{messages: [{ role: 'user', content: safe.query }]}, parameters:{enable_thinking: false,
    enable_search: true, search_options: { enable_source: true, forced_search: true, search_strategy: 'turbo',
      ...(safe.domains.length ? { assigned_site_list: safe.domains } : {}) }, max_tokens: 512,result_format:'message'} };
}
/** Search evidence does not depend on generated prose or its finish reason.
 * Map the documented native usage into the same audited token contract. */
export function nativeSearchUsage(payload:Record<string,unknown>) {
  const value=payload.usage as Record<string,unknown>|undefined;
  if(!value)return null;
  return parseAgentUsage({...value,prompt_tokens:value.input_tokens??value.prompt_tokens,completion_tokens:value.output_tokens??value.completion_tokens});
}
export function nativeSearchCandidates(payload: Record<string, unknown>) {
  const output = payload.output && typeof payload.output === 'object' ? payload.output as Record<string,unknown> : payload;
  const info = (payload.search_info || output.search_info) as { search_results?: unknown } | undefined;
  if (!info || !Array.isArray(info.search_results)) throw Error('native_search_sources_unavailable');
  const seen = new Set<string>();
  return info.search_results.slice(0,20).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const value = raw as Record<string,unknown>;
    if (typeof value.url !== 'string' || typeof value.title !== 'string') return [];
    let url: string; try { url = publicWebUrl(value.url).href; } catch { return []; }
    if (seen.has(url)) return []; seen.add(url);
    return [{ url, title: value.title.slice(0,200) }];
  }).slice(0,8);
}
/** The model answer/snippets are deliberately discarded. searchWeb/read_web
 * must fetch the original and produce the existing Evidence locators. */
export function bailianPublicSearch(invoke: (query: WebQuery) => Promise<Record<string,unknown>>): WebSearchProvider {
  return { name: 'bailian-native', async search(query) { return nativeSearchCandidates(await invoke(parseWebQuery(query))); } };
}
export function definitiveCapabilityRejection(error: unknown) {
  return error instanceof AiProviderError && error.code.startsWith('HTTP_') && Number(error.status) >= 400
    && Number(error.status) < 500 && error.status !== 408;
}
