import { getWechatAccessToken } from '@/lib/wechat-access-token';

export const PROMOTION_SERVICE_PAGE =
  'packages/business/free-design-service/free-design-service';
export const ENTERPRISE_ONBOARDING_PAGE =
  'packages/business/onboarding/onboarding';

export function buildPromotionServicePath(token: string) {
  const normalized = token.trim();
  if (!/^rp_[A-Za-z0-9_-]{24,}$/.test(normalized)) {
    throw new Error('Invalid referrer promotion token');
  }
  const path = `${PROMOTION_SERVICE_PAGE}?token=${encodeURIComponent(normalized)}`;
  if (Buffer.byteLength(path, 'utf8') > 128) {
    throw new Error('Promotion service path exceeds the WeChat code limit');
  }
  return path;
}

export function buildEnterpriseOnboardingPath(token: string) {
  const normalized = token.trim();
  if (!/^ej_[A-Za-z0-9_-]{32}$/.test(normalized)) {
    throw new Error('Invalid enterprise onboarding token');
  }
  const path = `${ENTERPRISE_ONBOARDING_PAGE}?token=${encodeURIComponent(normalized)}`;
  if (Buffer.byteLength(path, 'utf8') > 128) {
    throw new Error('Enterprise onboarding path exceeds the WeChat code limit');
  }
  return path;
}

async function createMiniProgramCode(
  path: string,
  options: { fetchImpl?: typeof fetch } = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = await getWechatAccessToken({ fetchImpl });
  const response = await fetchImpl(
    `https://api.weixin.qq.com/wxa/getwxacode?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        width: 430,
        auto_color: false,
        line_color: { r: 8, g: 137, b: 57 },
        is_hyaline: false,
      }),
    }
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || contentType.includes('application/json')) {
    let message = 'Unable to generate Mini Program code';
    try {
      const error = JSON.parse(new TextDecoder().decode(bytes));
      message = error.errmsg || message;
    } catch {
      // Preserve the stable client-facing fallback for non-JSON provider errors.
    }
    throw new Error(message);
  }
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error('WeChat returned an invalid Mini Program code image');
  }
  return bytes;
}

export async function createPromotionServiceCode(
  token: string,
  options: { fetchImpl?: typeof fetch } = {}
) {
  return createMiniProgramCode(buildPromotionServicePath(token), options);
}

export async function createEnterpriseOnboardingCode(
  token: string,
  options: { fetchImpl?: typeof fetch } = {}
) {
  return createMiniProgramCode(buildEnterpriseOnboardingPath(token), options);
}
