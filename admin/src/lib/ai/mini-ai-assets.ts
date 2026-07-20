import crypto from 'crypto';

function secret() {
  return process.env.JWT_SECRET || 'fallback_secret_random_123';
}

function signaturePayload(assetId: string, enterpriseId: string, expires: number) {
  return `${assetId}:${enterpriseId}:${expires}`;
}

export function createMiniAiAssetSignature(assetId: string, enterpriseId: string, expires: number) {
  return crypto.createHmac('sha256', secret()).update(signaturePayload(assetId, enterpriseId, expires)).digest('hex');
}

export function verifyMiniAiAssetSignature(input: {
  assetId: string;
  enterpriseId: string;
  expires: number;
  signature: string;
}) {
  if (!Number.isFinite(input.expires) || input.expires < Math.floor(Date.now() / 1000)) return false;
  const expected = createMiniAiAssetSignature(input.assetId, input.enterpriseId, input.expires);
  if (expected.length !== input.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

function applyOrigin(target: URL, origin: URL) {
  target.protocol = origin.protocol;
  target.hostname = origin.hostname;
  target.port = origin.port;
}

export function getMiniAiPublicRequestUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const configuredOrigin = process.env.MINIPROGRAM_API_PUBLIC_ORIGIN?.trim();

  if (configuredOrigin) {
    applyOrigin(requestUrl, new URL(configuredOrigin));
    return requestUrl.toString();
  }

  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const host = forwardedHost || request.headers.get('host')?.trim();
  const forwardedProtocol = firstHeaderValue(request.headers.get('x-forwarded-proto')).replace(/:$/, '');
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? forwardedProtocol
    : requestUrl.protocol.replace(/:$/, '');
  if (host) {
    applyOrigin(requestUrl, new URL(`${protocol}://${host}`));
  }

  return requestUrl.toString();
}

export function getSignedMiniAiAssetUrl(input: {
  request: Request;
  assetId: string;
  enterpriseId: string;
  ttlSeconds?: number;
}) {
  const expires = Math.floor(Date.now() / 1000) + (input.ttlSeconds || 3600);
  const signature = createMiniAiAssetSignature(input.assetId, input.enterpriseId, expires);
  const url = new URL(
    `/api/miniprogram/ai/assets/${input.assetId}/image`,
    getMiniAiPublicRequestUrl(input.request)
  );
  url.searchParams.set('tenant', input.enterpriseId);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
}
