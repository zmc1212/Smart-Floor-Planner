import type { ModelTurnInput } from '@/lib/assistant/contracts/model';
import type { NativeToolName } from '@/lib/assistant/contracts/native-tools';

export const bailianResponsesCapabilityProtocol = 'bailian-responses-capabilities-v1';

/** Eight independent states per model. Chat Completions, Responses API and each
 * native tool are recorded separately and never inferred from another row. */
export type BailianResponsesCapabilityState = 'documented' | 'live_verified' | 'unsupported' | 'unknown';

export type BailianResponsesModelProfile = {
  responses: BailianResponsesCapabilityState;
  functionCalling: BailianResponsesCapabilityState;
  webSearch: BailianResponsesCapabilityState;
  webExtractor: BailianResponsesCapabilityState;
  codeInterpreter: BailianResponsesCapabilityState;
  streaming: BailianResponsesCapabilityState;
  usageReporting: BailianResponsesCapabilityState;
  /** Documented provider requirement; never applied to a model not listed. */
  thinkingRequiredForCodeInterpreter: boolean;
  /** Exact official pages this row was read from, kept for re-verification. */
  documentedAt: string | null;
};

const unknownProfile: BailianResponsesModelProfile = {
  responses: 'unknown', functionCalling: 'unknown', webSearch: 'unknown', webExtractor: 'unknown',
  codeInterpreter: 'unknown', streaming: 'unknown', usageReporting: 'unknown',
  thinkingRequiredForCodeInterpreter: false, documentedAt: null,
};

/**
 * Keyed by exact provider model ID. Source pages checked 2026-11-12:
 * - https://docs.bailian.console.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api
 * - https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-api-via-openai-responses
 * - https://docs.bailian.console.aliyun.com/zh/model-studio/web-search
 * - https://docs.bailian.console.aliyun.com/zh/model-studio/web-extractor
 * - https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-code-interpreter
 * A row is only upgraded to live_verified by that exact model/tool wire evidence.
 */
const profiles: Readonly<Record<string, BailianResponsesModelProfile>> = {
  'qwen3.7-flash': {
    responses: 'documented', functionCalling: 'documented', webSearch: 'documented',
    webExtractor: 'documented', codeInterpreter: 'documented', streaming: 'documented',
    usageReporting: 'documented', thinkingRequiredForCodeInterpreter: false, documentedAt: '2026-11-12',
  },
  'qwen3.8-flash': {
    responses: 'documented', functionCalling: 'documented', webSearch: 'documented',
    webExtractor: 'documented', codeInterpreter: 'documented', streaming: 'documented',
    usageReporting: 'documented', thinkingRequiredForCodeInterpreter: true, documentedAt: '2026-11-12',
  },
  'qwen3.8-max': {
    responses: 'documented', functionCalling: 'documented', webSearch: 'documented',
    webExtractor: 'documented', codeInterpreter: 'documented', streaming: 'documented',
    usageReporting: 'documented', thinkingRequiredForCodeInterpreter: true, documentedAt: '2026-11-12',
  },
  // The official pages list this exact snapshot for web_search, web_extractor and
  // code_interpreter. The mainline alias below is not listed for those tools.
  'deepseek-v4.1-flash-1017': {
    responses: 'documented', functionCalling: 'documented', webSearch: 'documented',
    webExtractor: 'documented', codeInterpreter: 'documented', streaming: 'documented',
    usageReporting: 'documented', thinkingRequiredForCodeInterpreter: false, documentedAt: '2026-11-12',
  },
  'deepseek-v4.1-flash': {
    responses: 'documented', functionCalling: 'documented', webSearch: 'unknown',
    webExtractor: 'unknown', codeInterpreter: 'unknown', streaming: 'documented',
    usageReporting: 'documented', thinkingRequiredForCodeInterpreter: false, documentedAt: '2026-11-12',
  },
};

const modelId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function bailianResponsesModelProfile(model: unknown): BailianResponsesModelProfile {
  return typeof model === 'string' && modelId.test(model) ? profiles[model] ?? unknownProfile : unknownProfile;
}

/** Explicit, reviewable upgrade path: only a recorded live acceptance run may
 * turn documented/unknown into live_verified for that same model and tool. */
export function withLiveVerified(
  profile: BailianResponsesModelProfile,
  verified: Partial<Pick<BailianResponsesModelProfile, 'responses' | 'webSearch' | 'webExtractor' | 'codeInterpreter' | 'streaming' | 'usageReporting' | 'functionCalling'>>,
): BailianResponsesModelProfile {
  const next = { ...profile };
  for (const [key, state] of Object.entries(verified) as Array<[keyof typeof verified, BailianResponsesCapabilityState]>) {
    if (state === 'live_verified') next[key] = 'live_verified';
  }
  return next;
}

export type BailianResponsesRegion = 'cn-beijing' | 'ap-southeast-1' | 'maas-region';
export type BailianResponsesBinding = {
  model: string; region: BailianResponsesRegion;
  responsesUrl: string; chatBaseUrl: string;
};

const maasHost = /^[a-z0-9](?:[a-z0-9-]{0,61})\.(?:cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/;

/** Official transport binding only. Any other OpenAI-compatible endpoint keeps
 * using Chat Completions; a model name alone never selects the Responses wire. */
export function bailianResponsesBinding(baseUrl: string, model: string): BailianResponsesBinding | null {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  if (!modelId.test(model) || url.protocol !== 'https:' || url.username || url.password || url.port
    || url.search || url.hash || !/^\/compatible-mode(?:\/v1)?\/?$/.test(url.pathname)) return null;
  const host = url.hostname.toLowerCase();
  const region: BailianResponsesRegion | null = host === 'dashscope.aliyuncs.com' ? 'cn-beijing'
    : host === 'dashscope-intl.aliyuncs.com' ? 'ap-southeast-1'
      : maasHost.test(host) ? 'maas-region' : null;
  if (!region) return null;
  return { model, region, responsesUrl: `${url.origin}/compatible-mode/v1/responses`,
    chatBaseUrl: `${url.origin}/compatible-mode/v1` };
}

export type BailianNativeToolRejectionCode =
  | 'capability_unknown' | 'capability_unsupported' | 'responses_unsupported'
  | 'requires_web_search' | 'requires_thinking';

export type BailianResponsesToolPlan = {
  enabled: NativeToolName[];
  rejected: Array<{ tool: NativeToolName; code: BailianNativeToolRejectionCode }>;
  thinkingRequired: boolean;
};

/** web_extractor is documented as requiring web_search in the same request.
 * code_interpreter is documented as requiring thinking mode on specific models. */
export function planBailianResponsesTools(
  binding: BailianResponsesBinding,
  requested: readonly NativeToolName[],
  options: { thinking: boolean },
): BailianResponsesToolPlan {
  const profile = bailianResponsesModelProfile(binding.model);
  const rejected: BailianResponsesToolPlan['rejected'] = [];
  const states: Record<NativeToolName, BailianResponsesCapabilityState> = {
    web_search: profile.webSearch, web_extractor: profile.webExtractor, code_interpreter: profile.codeInterpreter,
  };
  const accepted = new Set<NativeToolName>();
  for (const tool of new Set(requested)) {
    const state = states[tool];
    if (state === 'unsupported') { rejected.push({ tool, code: 'capability_unsupported' }); continue; }
    if (state !== 'documented' && state !== 'live_verified') { rejected.push({ tool, code: 'capability_unknown' }); continue; }
    if (tool === 'code_interpreter' && profile.thinkingRequiredForCodeInterpreter && !options.thinking) {
      rejected.push({ tool, code: 'requires_thinking' }); continue;
    }
    accepted.add(tool);
  }
  if (accepted.has('web_extractor') && !accepted.has('web_search')) {
    accepted.delete('web_extractor');
    rejected.push({ tool: 'web_extractor', code: 'requires_web_search' });
  }
  return { enabled: [...accepted], rejected, thinkingRequired: profile.thinkingRequiredForCodeInterpreter };
}

/** Deployment opt-in. Default off so both business branches keep their current
 * Chat Completions wire until they explicitly integrate this adapter. */
export function bailianResponsesEnabled(
  runtime: { baseUrl: string; adapterType: string },
  model: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.ASSISTANT_RESPONSES_API !== '1') return false;
  if (runtime.adapterType !== 'openai_compatible') return false;
  const binding = bailianResponsesBinding(runtime.baseUrl, model);
  return !!binding && bailianResponsesModelProfile(binding.model).responses !== 'unsupported';
}

export function requestedNativeTools(env: Record<string, string | undefined> = process.env): NativeToolName[] {
  const raw = env.ASSISTANT_NATIVE_TOOLS?.trim();
  if (!raw) return [];
  const allowed: NativeToolName[] = ['web_search', 'web_extractor', 'code_interpreter'];
  return [...new Set(raw.split(',').map(item => item.trim()).filter((item): item is NativeToolName => allowed.includes(item as NativeToolName)))];
}

/** Report-final, forced-final, JSON-only and consultation turns are Chat
 * Completions contracts. They are never reinterpreted on the Responses wire. */
export function bailianResponsesApplies(input: ModelTurnInput) {
  return input.profile === undefined && input.reportFinalOutputTokens === undefined
    && input.outputMode === undefined && input.requireTool !== true && input.jsonOutput !== true;
}
