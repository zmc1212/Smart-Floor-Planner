import { isZhipuOfficialBaseUrl } from './zhipu';
import { isQiniuOfficialBaseUrl } from './qiniu';

/** Provider-specific wire shape; never infer a provider from the model name. */
export function thinkingBody(baseUrl: string, enabled?: boolean) {
  if (enabled === undefined) return {};
  return new URL(baseUrl).origin === 'https://api.deepseek.com' || isZhipuOfficialBaseUrl(baseUrl) || isQiniuOfficialBaseUrl(baseUrl)
    ? { thinking: { type: enabled ? 'enabled' : 'disabled' } }
    : { enable_thinking: enabled };
}

export function temperatureBody(baseUrl: string, temperature: number) {
  // Zhipu's compatibility API does not accept temperature=0; use its default.
  return isZhipuOfficialBaseUrl(baseUrl) && temperature === 0 ? {} : { temperature };
}
