import type { ModelTurnInput } from '@/lib/assistant/contracts/model';

export const bailianCapabilityProtocol = 'bailian-platform-capabilities-v2';
export type BailianRegion = 'cn-beijing' | 'ap-southeast-1';
export type BailianBinding = { model: string; region: BailianRegion;
  api: 'chat-completions'; thinking: boolean; baseUrl: string };
export type BailianSearchBinding = Omit<BailianBinding,'api'> & {api:'dashscope-generation'};
export type BailianTaskBinding = BailianBinding | BailianSearchBinding;

/** Provider IDs are exact wire identifiers, never capability claims. */
const bailianModelId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Platform transport binding: official DashScope endpoint, safe model ID and
 * explicit thinking flag. Any model available on the platform may connect
 * through the same compatible-mode transport; what it supports is decided by
 * the per-model capability table, not by this binding. */
export function bailianBinding(baseUrl: string, model: string, thinking?: boolean): BailianBinding | null {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  if (!bailianModelId.test(model) || url.protocol !== 'https:' || url.username || url.password
    || url.port || url.search || url.hash || !/^\/compatible-mode(?:\/v1)?\/?$/.test(url.pathname)) return null;
  const region = url.hostname === 'dashscope.aliyuncs.com' ? 'cn-beijing'
    : url.hostname === 'dashscope-intl.aliyuncs.com' ? 'ap-southeast-1' : null;
  return region ? { model, region, api: 'chat-completions', thinking: thinking ?? true, baseUrl: url.origin + '/compatible-mode/v1' } : null;
}

type DocumentedCapability = 'documented' | 'unknown';
export type BailianModelProfile = {
  functionCalling: DocumentedCapability; jsonObject: DocumentedCapability; jsonSchema: DocumentedCapability;
  nativeSearch: 'documented_dashscope_generation' | 'unknown';
  implicitCache: DocumentedCapability; explicitCache: 'documented' | 'opt_in_unmeasured' | 'unknown';
  partial: 'documented' | 'documentation_conflict' | 'unknown';
  batch: DocumentedCapability; thinkingControl: DocumentedCapability;
};

/** A model without its own recorded evidence still connects, but every
 * advanced capability stays off: no native final schema, explicit cache,
 * native search, Batch or prefix continuation. */
const bailianUnknownProfile: BailianModelProfile = { functionCalling: 'unknown', jsonObject: 'unknown',
  jsonSchema: 'unknown', nativeSearch: 'unknown', implicitCache: 'unknown', explicitCache: 'unknown',
  partial: 'unknown', batch: 'unknown', thinkingControl: 'unknown' };

/** Capability table keyed by exact provider model ID. A new model is a data and
 * documentation change backed by that model's own wire evidence; capabilities
 * are never copied from another model or inferred from the platform. */
const bailianProfiles: Readonly<Record<string, BailianModelProfile>> = {
  // Exact-model image/tool/non-thinking wire evidence: 2026-10-30 queue incident.
  // Official exact-model JSON Object/Schema support, checked 2026-11-02:
  // https://help.aliyun.com/en/model-studio/qwen-structured-output
  // Search/cache/Partial/Batch retain their independent unverified gates.
  'qwen3.7-flash': { ...bailianUnknownProfile, functionCalling: 'documented', thinkingControl: 'documented',
    jsonObject: 'documented', jsonSchema: 'documented' },
  // Beijing Chat Completions tool round trips with thinking disabled were
  // recorded in the 2026-10-23 consultation trial.
  'deepseek-v4.1-flash-1017': { ...bailianUnknownProfile, functionCalling: 'documented', thinkingControl: 'documented' },
  // The exact mainline ID independently documents Function Calling and the
  // enable_thinking switch; verified 2026-11-07, not inferred from the1017 ID.
  // https://help.aliyun.com/en/model-studio/deepseek-api
  'deepseek-v4.1-flash': { ...bailianUnknownProfile, functionCalling: 'documented', thinkingControl: 'documented' },
  'qwen3.8-flash': { functionCalling: 'documented', jsonObject: 'documented', jsonSchema: 'documented',
    nativeSearch: 'documented_dashscope_generation', implicitCache: 'documented', explicitCache: 'opt_in_unmeasured',
    partial: 'documentation_conflict', batch: 'documented', thinkingControl: 'documented' },
  // Exact model documented for tools, thinking control and JSON Object/Schema:
  // https://help.aliyun.com/zh/model-studio/qwen-function-calling
  // https://help.aliyun.com/zh/model-studio/qwen-structured-output
  // Other capabilities retain their independent unverified gates.
  'qwen3.8-max': { ...bailianUnknownProfile, functionCalling: 'documented', thinkingControl: 'documented',
    jsonObject: 'documented', jsonSchema: 'documented' },
  // The same official pages document this exact Plus model independently.
  'qwen3.7-plus': { ...bailianUnknownProfile, functionCalling: 'documented', thinkingControl: 'documented',
    jsonObject: 'documented', jsonSchema: 'documented' },
};
export function bailianModelProfile(model: unknown): BailianModelProfile {
  return typeof model === 'string' && bailianModelId.test(model) ? bailianProfiles[model] ?? bailianUnknownProfile : bailianUnknownProfile;
}
export function bailianStructuredOutput(model: unknown, mode: 'json_object' | 'json_schema') {
  return bailianModelProfile(model)[mode === 'json_object' ? 'jsonObject' : 'jsonSchema'] === 'documented';
}
export function bailianNativeSearchCapable(model: unknown) {
  return bailianModelProfile(model).nativeSearch === 'documented_dashscope_generation';
}
export function bailianExplicitCacheCapable(model: unknown) {
  const state = bailianModelProfile(model).explicitCache;
  return state === 'documented' || state === 'opt_in_unmeasured';
}
export function bailianPartialCapable(model: unknown) {
  const state = bailianModelProfile(model).partial;
  return state === 'documented' || state === 'documentation_conflict';
}
export function bailianBatchCapable(model: unknown) {
  return bailianModelProfile(model).batch === 'documented';
}
export function bailianThinkingCapable(model: unknown) {
  return bailianModelProfile(model).thinkingControl === 'documented';
}

/** Source links are documented only for DashScope Generation, not the OpenAI
 * compatible Chat Completions search. This is a distinct explicit task binding. */
export function bailianSearchBinding(binding:BailianBinding):BailianSearchBinding {
  const actual=bailianBinding(binding.baseUrl,binding.model,binding.thinking);
  if(!actual)throw Error('bailian_binding_mismatch');
  return {...actual,api:'dashscope-generation',baseUrl:new URL(actual.baseUrl).origin+'/api/v1'};
}
export function normalizeBailianTaskBinding(binding:BailianTaskBinding):BailianTaskBinding|null {
  if(binding.api==='chat-completions')return bailianBinding(binding.baseUrl,binding.model,binding.thinking);
  if(binding.api!=='dashscope-generation')return null;
  let url:URL;try{url=new URL(binding.baseUrl);}catch{return null;}
  if(url.pathname!=='/api/v1'||url.username||url.password||url.search||url.hash||url.port)return null;
  const chat=bailianBinding(url.origin+'/compatible-mode',binding.model,binding.thinking);
  return chat?bailianSearchBinding(chat):null;
}

export function bailianCapabilities(binding: BailianBinding) {
  const profile = bailianModelProfile(binding.model);
  return { protocol: bailianCapabilityProtocol, binding, functionCalling: profile.functionCalling,
    jsonObject: profile.jsonObject, jsonSchema: profile.jsonSchema, nativeSearch: profile.nativeSearch,
    chatCompletionsSearchSources:'unsupported_api' as const,
    nativeSearchBinding: profile.nativeSearch === 'documented_dashscope_generation' ? bailianSearchBinding(binding) : null,
    implicitCache: profile.implicitCache, explicitCache: profile.explicitCache,
    // The model page and the dedicated API list disagree. No guessed probe.
    partial: binding.thinking && profile.partial !== 'unknown' ? 'thinking_not_applicable' as const : profile.partial,
    batch: profile.batch === 'documented' && binding.region !== 'cn-beijing' ? 'unsupported_region' as const : profile.batch,
    liveProtocolEvidence: 'unverified' as const };
}

/** Provider schema is a wire projection only. The original complete schema is
 * still enforced by LangChain and all business/source validators. */
export function bailianSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(bailianSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key,item]) => key !== 'uniqueItems' || typeof item !== 'boolean')
    .map(([key, item]) => [key, bailianSchema(item)]));
}
export function bailianFinalFormat(input: ModelTurnInput, baseUrl: string) {
  const binding = bailianBinding(baseUrl, input.model, input.enableThinking);
  const finalOnly = input.requireTool === true && input.tools.length === 1 && input.tools[0].name === 'final_response';
  if (input.outputMode === 'function_call') {
    if (!binding || !finalOnly || bailianModelProfile(binding.model).functionCalling !== 'documented') throw Error('native_output_mode_not_applicable');
    return null;
  }
  const mode = input.outputMode || 'json_schema';
  if (!binding || !finalOnly || !bailianStructuredOutput(binding.model, mode)) {
    if (input.outputMode) throw Error('native_output_mode_not_applicable');
    return null;
  }
  return mode === 'json_object' ? { type: 'json_object' as const }
    : { type: 'json_schema' as const, json_schema: { name: 'final_response', strict: true,
      schema: bailianSchema(input.tools[0].parameters) } };
}
