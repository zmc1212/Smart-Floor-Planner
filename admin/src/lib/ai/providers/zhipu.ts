export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

// Official text/vision API tariffs checked on 2026-10-20:
// https://docs.bigmodel.cn/cn/guide/start/pricing
// Exact IDs only: Flash/FlashX names and free trial credits do not imply a free API.
const ZHIPU_MODEL_FREE: Readonly<Record<string, boolean>> = {
  'glm-4.7-flash': true,
  'glm-4-flash-250414': true,
  'glm-z1-flash': true,
  'glm-4.6v-flash': true,
  'glm-4v-flash': true,
  'glm-4.1v-thinking-flash': true,
  'glm-5.3': false,
  'glm-5.3-flash': false,
  'glm-5.3-flashx': false,
  'glm-5.2': false,
  'glm-5.1': false,
  'glm-5-turbo': false,
  'glm-5': false,
  'glm-4.7': false,
  'glm-4.5-air': false,
  'glm-4.7-flashx': false,
  'glm-4-plus': false,
  'glm-4-air-250414': false,
  'glm-4-airx': false,
  'glm-4-long': false,
  'glm-4-assistant': false,
  'glm-z1-air': false,
  'glm-z1-airx': false,
  'glm-z1-flashx': false,
  'glm-4-flashx-250414': false,
  'glm-ocr': false,
  'glm-5v-turbo': false,
  'glm-4.6v': false,
  'glm-4.6v-flashx': false,
  'glm-4.5v': false,
  'glm-4v-plus-0111': false,
  'glm-4.1v-thinking-flashx': false,
};

export function isZhipuOfficialBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return url.origin === 'https://open.bigmodel.cn'
      && url.pathname.replace(/\/+$/, '') === '/api/paas/v4';
  } catch {
    return false;
  }
}

export function getZhipuModelFree(baseUrl: string, model: string): boolean | null {
  if (!isZhipuOfficialBaseUrl(baseUrl)) return null;
  const id = model.trim().toLowerCase();
  return Object.hasOwn(ZHIPU_MODEL_FREE, id) ? ZHIPU_MODEL_FREE[id] : null;
}
