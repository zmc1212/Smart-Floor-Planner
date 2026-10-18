import { listProviderRuntimes } from './provider-registry';
import { getPlatformLlmOverrideRuntime, isPlatformLlmOverrideModelKey } from '../platform-llm-config';
import { capabilityForLogicalModel, type AiLogicalModelKey, type AiProviderRuntimeConfig } from './provider-types';

export type WorkflowChatModelKey = Extract<AiLogicalModelKey, 'chat.general' | 'vision.reference_analysis'>;

/** One resolver for preparation and the actual invocation; credentials stay in this private runtime. */
export async function workflowTextRuntimes(logicalModelKey: WorkflowChatModelKey) {
  const override = isPlatformLlmOverrideModelKey(logicalModelKey) ? await getPlatformLlmOverrideRuntime() : null;
  return override ? [override] : listProviderRuntimes(capabilityForLogicalModel(logicalModelKey), logicalModelKey);
}

export function workflowTextModel(runtime: AiProviderRuntimeConfig, logicalModelKey: WorkflowChatModelKey, assistant: boolean) {
  return assistant && process.env.ASSISTANT_TEXT_MODEL?.trim() ? process.env.ASSISTANT_TEXT_MODEL.trim() : runtime.modelMappings[logicalModelKey];
}

export function workflowTextThinking(runtime: AiProviderRuntimeConfig, assistant: boolean) {
  const thinking = assistant && process.env.ASSISTANT_TEXT_DISABLE_THINKING === '1' ? false : undefined;
  if (thinking !== undefined && (runtime.adapterType !== 'openai_compatible'
    || !(runtime.adapterConfig?.providerPreset === 'siliconflow'
      || (runtime.adapterConfig?.providerPreset === 'deepseek' && new URL(runtime.baseUrl).origin === 'https://api.deepseek.com')))) {
    throw new Error('Assistant thinking override requires an approved SiliconFlow or official DeepSeek runtime');
  }
  return thinking;
}
