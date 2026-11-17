import { bailianBinding } from '@/lib/ai/providers/bailian-capabilities';
import { specialistModel } from '../specialists/registry';

export const verifiedImageInputPolicy = 'verified-provider-v1';

const verifiedBailianModels = new Set([specialistModel.model, 'qwen3.7-flash', 'qwen3.8-flash']);

export function supportsChatImageInput(providerKey: string, baseUrl: string, model: string) {
  if (providerKey === 'dashscope' || providerKey === 'bailian') {
    return verifiedBailianModels.has(model) && bailianBinding(baseUrl, model)?.region === 'cn-beijing';
  }
  return providerKey === 'deepseek' && model === 'deepseek-flash'
    && ['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(baseUrl.replace(/\/$/, ''));
}
