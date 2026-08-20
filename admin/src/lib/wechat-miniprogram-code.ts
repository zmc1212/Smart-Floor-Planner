import { getWechatAccessToken } from '@/lib/wechat-access-token';
import type { MiniProgramCodeEnvironment } from '@/lib/mini-program-code-environment';

export const PROMOTION_SERVICE_PAGE =
  'packages/business/free-design-service/free-design-service';
export const ENTERPRISE_ONBOARDING_PAGE =
  'packages/business/onboarding/onboarding';

export type { MiniProgramCodeEnvironment } from '@/lib/mini-program-code-environment';

export type MiniProgramCodeOptions = {
  fetchImpl?: typeof fetch;
  envVersion?: MiniProgramCodeEnvironment;
};

export function resolveMiniProgramCodeEnvironment(
  explicit?: string | null
): MiniProgramCodeEnvironment {
  const configured = (explicit ?? process.env.WECHAT_MINIPROGRAM_CODE_ENV ?? '').trim();
  if (configured === 'release' || configured === 'trial' || configured === 'develop') {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') return 'release';
  return 'develop';
}

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

export function buildStaffActivityServicePath(token: string) {
  const normalized = token.trim();
  if (!/^sa_[A-Za-z0-9_-]{24,}$/.test(normalized)) {
    throw new Error('Invalid staff activity token');
  }
  const path = `${PROMOTION_SERVICE_PAGE}?token=${encodeURIComponent(normalized)}`;
  if (Buffer.byteLength(path, 'utf8') > 128) {
    throw new Error('Staff activity service path exceeds the WeChat code limit');
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
  token: string,
  options: MiniProgramCodeOptions = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const envVersion = options.envVersion ?? resolveMiniProgramCodeEnvironment();
  const accessToken = await getWechatAccessToken({ fetchImpl });
  const isRelease = envVersion === 'release';
  const page = path.split('?')[0];
  const scene = token.slice(3);
  if (!isRelease && !/^[A-Za-z0-9_-]{32}$/.test(scene)) {
    throw new Error('Mini Program code token cannot be encoded into scene');
  }
  const response = await fetchImpl(
    `https://api.weixin.qq.com/wxa/${isRelease ? 'getwxacode' : 'getwxacodeunlimit'}?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isRelease
          ? {
              path,
              width: 430,
              auto_color: false,
              line_color: { r: 8, g: 137, b: 57 },
              is_hyaline: false,
            }
          : {
              scene,
              page,
              check_path: false,
              env_version: envVersion,
              width: 430,
              auto_color: false,
              line_color: { r: 8, g: 137, b: 57 },
              is_hyaline: false,
            }
      ),
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
  if (!getMiniProgramCodeContentType(bytes)) {
    throw new Error('WeChat returned an invalid Mini Program code image');
  }
  return bytes;
}

/**
 * WeChat's code endpoints can return JPEG or PNG bytes. Keep the signature check
 * independent of the provider's
 * Content-Type header, which has not been consistent across responses.
 */
export function getMiniProgramCodeContentType(
  bytes: Uint8Array
): 'image/png' | 'image/jpeg' | null {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (isPng) return 'image/png';

  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg ? 'image/jpeg' : null;
}

export async function createPromotionServiceCode(
  token: string,
  options: MiniProgramCodeOptions = {}
) {
  return createMiniProgramCode(buildPromotionServicePath(token), token, options);
}

export async function createStaffActivityServiceCode(
  token: string,
  options: MiniProgramCodeOptions = {}
) {
  return createMiniProgramCode(buildStaffActivityServicePath(token), token, options);
}

export async function createEnterpriseOnboardingCode(
  token: string,
  options: MiniProgramCodeOptions = {}
) {
  return createMiniProgramCode(buildEnterpriseOnboardingPath(token), token, options);
}
