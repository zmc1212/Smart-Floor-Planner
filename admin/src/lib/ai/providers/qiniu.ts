export const QINIU_BASE_URL = 'https://api.qnaigc.com/v1';
export const QINIU_CONATUS_MODEL = 'qiniu/conatus-free';
// Official campaign, checked 2026-10-30. These are Beijing-time boundaries.
// https://www.qiniu.com/ai/free-models/conatus-2026
export const QINIU_CONATUS_START = Date.parse('2026-10-24T00:00:00+08:00');
export const QINIU_CONATUS_END = Date.parse('2026-12-01T00:00:00+08:00');

export function isQiniuOfficialBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return url.origin === 'https://api.qnaigc.com'
      && ['', '/v1'].includes(url.pathname.replace(/\/+$/, ''))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function isQiniuConatusModel(baseUrl: string, model: string) {
  return isQiniuOfficialBaseUrl(baseUrl) && model === QINIU_CONATUS_MODEL;
}

/** A tariff hint, never proof of account verification or remaining quota.
 * Explicit upstream paid metadata still wins in the catalog/UI. */
export function getQiniuModelFree(baseUrl: string, model: string, now = Date.now()): boolean | null {
  return isQiniuConatusModel(baseUrl, model) && now >= QINIU_CONATUS_START && now < QINIU_CONATUS_END
    ? true : null;
}
