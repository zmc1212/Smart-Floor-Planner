import type { ModelTurnInput } from '@/lib/assistant/contracts/model';

export const bailianCapabilityProtocol = 'bailian-qwen38-capabilities-v1';
export type BailianBinding = { model: 'qwen3.8-flash'; region: 'cn-beijing' | 'ap-southeast-1';
  api: 'chat-completions'; thinking: boolean; baseUrl: string };
export type BailianSearchBinding = Omit<BailianBinding,'api'> & {api:'dashscope-generation'};
export type BailianTaskBinding = BailianBinding | BailianSearchBinding;

/** Exact provider/region binding, never inference from a model name alone. */
export function bailianBinding(baseUrl: string, model: string, thinking?: boolean): BailianBinding | null {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  if (model !== 'qwen3.8-flash' || url.protocol !== 'https:' || url.username || url.password
    || url.port || url.search || url.hash || !/^\/compatible-mode(?:\/v1)?\/?$/.test(url.pathname)) return null;
  const region = url.hostname === 'dashscope.aliyuncs.com' ? 'cn-beijing'
    : url.hostname === 'dashscope-intl.aliyuncs.com' ? 'ap-southeast-1' : null;
  return region ? { model, region, api: 'chat-completions', thinking: thinking ?? true, baseUrl: url.origin + '/compatible-mode/v1' } : null;
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
  return { protocol: bailianCapabilityProtocol, binding, functionCalling: 'documented',
    jsonObject: 'documented', jsonSchema: 'documented', nativeSearch: 'documented_dashscope_generation',
    chatCompletionsSearchSources:'unsupported_api', nativeSearchBinding:bailianSearchBinding(binding),
    implicitCache: 'documented', explicitCache: 'opt_in_unmeasured',
    // The model page and the dedicated API list disagree. No guessed probe.
    partial: binding.thinking ? 'thinking_not_applicable' : 'documentation_conflict',
    batch: binding.region === 'cn-beijing' ? 'documented' : 'unsupported_region',
    liveProtocolEvidence: 'unverified' } as const;
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
  if (!binding || !finalOnly) {
    if (input.outputMode) throw Error('native_output_mode_not_applicable');
    return null;
  }
  const mode = input.outputMode || 'json_schema';
  return mode === 'json_object' ? { type: 'json_object' as const }
    : { type: 'json_schema' as const, json_schema: { name: 'final_response', strict: true,
      schema: bailianSchema(input.tools[0].parameters) } };
}
