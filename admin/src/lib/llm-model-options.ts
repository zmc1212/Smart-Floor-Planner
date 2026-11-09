import { getZhipuModelFree } from './ai/providers/zhipu';
import { getQiniuModelFree } from './ai/providers/qiniu';

export interface LlmModelOption {
  value: string;
  label: string;
}

export function resolveLlmModelFree(input: {
  baseUrl: string;
  model: string;
  catalogFree?: boolean | null;
  local?: boolean;
}) {
  if (typeof input.catalogFree === 'boolean') return input.catalogFree;
  if (input.local) return true;
  return getZhipuModelFree(input.baseUrl, input.model) ?? getQiniuModelFree(input.baseUrl, input.model);
}

export function llmModelPriceLabel(free: boolean | null) {
  return free === true ? '免费' : free === false ? '付费' : '价格未知';
}

export function isShorterModelPrefix(candidate: string, target: string) {
  const left = candidate.trim();
  const right = target.trim();
  return Boolean(left && right && left !== right && right.startsWith(left));
}

export function shouldShowLlmModelOption(
  input: string,
  option: LlmModelOption | undefined,
  options: LlmModelOption[],
) {
  const query = input.trim().toLowerCase();
  if (!query) return true;

  const isExactOption = options.some((item) => item.value.trim().toLowerCase() === query);
  if (isExactOption) return true;

  const haystack = `${option?.value ?? ''} ${option?.label ?? ''}`.toLowerCase();
  return haystack.includes(query);
}
