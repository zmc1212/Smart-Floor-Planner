import crypto from 'crypto';
import { alignedSignedUrlDeadline } from '@/lib/media-storage/operations';

function secret() {
  return process.env.JWT_SECRET || 'fallback_secret_random_123';
}

function resolveSignedExpires(ttlSeconds: number | undefined, alignDeadline?: boolean) {
  const ttl = ttlSeconds || 3600;
  if (alignDeadline) return alignedSignedUrlDeadline(ttl);
  return Math.floor(Date.now() / 1000) + ttl;
}

function signaturePayload(assetId: string, enterpriseId: string, expires: number) {
  return `${assetId}:${enterpriseId}:${expires}`;
}

function taskResultSignaturePayload(taskId: string, enterpriseId: string, expires: number) {
  return `task-result:${taskId}:${enterpriseId}:${expires}`;
}

function recipePreviewSignaturePayload(recipeId: string, enterpriseId: string, expires: number) {
  return `recipe-preview:${recipeId}:${enterpriseId}:${expires}`;
}

function studioGenerationSignaturePayload(generationId: string, enterpriseId: string, expires: number) {
  return `studio-generation:${generationId}:${enterpriseId}:${expires}`;
}

function studioFloorPlanPreviewSignaturePayload(workflowId: string, enterpriseId: string, expires: number) {
  return `studio-floor-plan:${workflowId}:${enterpriseId}:${expires}`;
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

export function createMiniAiTaskResultSignature(taskId: string, enterpriseId: string, expires: number) {
  return crypto.createHmac('sha256', secret()).update(taskResultSignaturePayload(taskId, enterpriseId, expires)).digest('hex');
}

export function verifyMiniAiTaskResultSignature(input: {
  taskId: string;
  enterpriseId: string;
  expires: number;
  signature: string;
}) {
  if (!Number.isFinite(input.expires) || input.expires < Math.floor(Date.now() / 1000)) return false;
  const expected = createMiniAiTaskResultSignature(input.taskId, input.enterpriseId, input.expires);
  if (expected.length !== input.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}

export function createMiniAiRecipePreviewSignature(recipeId: string, enterpriseId: string, expires: number) {
  return crypto.createHmac('sha256', secret()).update(recipePreviewSignaturePayload(recipeId, enterpriseId, expires)).digest('hex');
}

export function verifyMiniAiRecipePreviewSignature(input: {
  recipeId: string;
  enterpriseId: string;
  expires: number;
  signature: string;
}) {
  if (!Number.isFinite(input.expires) || input.expires < Math.floor(Date.now() / 1000)) return false;
  const expected = createMiniAiRecipePreviewSignature(input.recipeId, input.enterpriseId, input.expires);
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
    try {
      const origin = new URL(configuredOrigin);
      const isExampleOrigin = origin.hostname === 'example.com' || origin.hostname.endsWith('.example.com');
      if (!isExampleOrigin) {
        applyOrigin(requestUrl, origin);
        return requestUrl.toString();
      }
    } catch {
      // Invalid or placeholder configuration falls back to the actual request host.
    }
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
  /** When true, expires snaps to a TTL window so repeated responses share one cacheable URL. */
  alignDeadline?: boolean;
}) {
  const expires = resolveSignedExpires(input.ttlSeconds, input.alignDeadline);
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

export function getSignedMiniAiTaskResultUrl(input: {
  request: Request;
  taskId: string;
  enterpriseId: string;
  ttlSeconds?: number;
}) {
  const expires = Math.floor(Date.now() / 1000) + (input.ttlSeconds || 3600);
  const signature = createMiniAiTaskResultSignature(input.taskId, input.enterpriseId, expires);
  const url = new URL(
    `/api/miniprogram/ai/tasks/${input.taskId}/image`,
    getMiniAiPublicRequestUrl(input.request)
  );
  url.searchParams.set('tenant', input.enterpriseId);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
}

export function getSignedMiniAiRecipePreviewUrl(input: {
  request: Request;
  recipeId: string;
  enterpriseId: string;
  ttlSeconds?: number;
}) {
  const expires = Math.floor(Date.now() / 1000) + (input.ttlSeconds || 3600);
  const signature = createMiniAiRecipePreviewSignature(input.recipeId, input.enterpriseId, expires);
  const url = new URL(
    `/api/miniprogram/ai/recipes/${input.recipeId}/preview`,
    getMiniAiPublicRequestUrl(input.request)
  );
  url.searchParams.set('tenant', input.enterpriseId);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
}

export function createMiniAiStudioGenerationSignature(generationId: string, enterpriseId: string, expires: number) {
  return crypto.createHmac('sha256', secret()).update(studioGenerationSignaturePayload(generationId, enterpriseId, expires)).digest('hex');
}

export function verifyMiniAiStudioGenerationSignature(input: {
  generationId: string;
  enterpriseId: string;
  expires: number;
  signature: string;
}) {
  if (!Number.isFinite(input.expires) || input.expires < Math.floor(Date.now() / 1000)) return false;
  const expected = createMiniAiStudioGenerationSignature(input.generationId, input.enterpriseId, input.expires);
  if (expected.length !== input.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}

export function getSignedMiniAiStudioGenerationUrl(input: {
  request: Request;
  generationId: string;
  enterpriseId: string;
  ttlSeconds?: number;
  alignDeadline?: boolean;
}) {
  const expires = resolveSignedExpires(input.ttlSeconds, input.alignDeadline);
  const signature = createMiniAiStudioGenerationSignature(input.generationId, input.enterpriseId, expires);
  const url = new URL(
    `/api/miniprogram/ai/studio/generations/${input.generationId}/image`,
    getMiniAiPublicRequestUrl(input.request)
  );
  url.searchParams.set('tenant', input.enterpriseId);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
}

export function createMiniAiStudioFloorPlanPreviewSignature(workflowId: string, enterpriseId: string, expires: number) {
  return crypto.createHmac('sha256', secret()).update(studioFloorPlanPreviewSignaturePayload(workflowId, enterpriseId, expires)).digest('hex');
}

export function verifyMiniAiStudioFloorPlanPreviewSignature(input: {
  workflowId: string;
  enterpriseId: string;
  expires: number;
  signature: string;
}) {
  if (!Number.isFinite(input.expires) || input.expires < Math.floor(Date.now() / 1000)) return false;
  const expected = createMiniAiStudioFloorPlanPreviewSignature(input.workflowId, input.enterpriseId, input.expires);
  if (expected.length !== input.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}

export function getSignedMiniAiStudioFloorPlanPreviewUrl(input: {
  request: Request;
  workflowId: string;
  enterpriseId: string;
  ttlSeconds?: number;
}) {
  const expires = Math.floor(Date.now() / 1000) + (input.ttlSeconds || 3600);
  const signature = createMiniAiStudioFloorPlanPreviewSignature(input.workflowId, input.enterpriseId, expires);
  const url = new URL(
    `/api/miniprogram/ai/studio/workflows/${input.workflowId}/floor-plan-preview`,
    getMiniAiPublicRequestUrl(input.request)
  );
  url.searchParams.set('tenant', input.enterpriseId);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
}
