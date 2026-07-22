import { AiProviderError } from '@/lib/ai/provider-types';

export function providerUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function providerFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 2000);
      const disposition = response.status >= 400 && response.status < 500 && response.status !== 408
        ? 'safe_fallback'
        : 'unknown';
      throw new AiProviderError(
        `${label} request failed (${response.status}): ${message}`,
        `HTTP_${response.status}`,
        disposition,
        response.status
      );
    }
    return response;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') {
      throw new AiProviderError(`${label} request timed out`, 'PROVIDER_TIMEOUT', 'unknown', 504);
    }
    throw new AiProviderError(
      `${label} connection failed: ${error instanceof Error ? error.message : String(error)}`,
      'PROVIDER_CONNECTION_FAILED',
      'safe_fallback',
      502
    );
  }
}

export function bearerHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' ? value as JsonObject : {};
}

export async function parseJson(response: Response, label: string): Promise<JsonObject> {
  const body = await response.text();
  try {
    return asObject(JSON.parse(body.replace(/^\uFEFF/, '')));
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content-type';
    const byteLength = Buffer.byteLength(body, 'utf8');
    throw new AiProviderError(
      `${label} returned invalid JSON (${contentType}, ${byteLength} bytes)`,
      'INVALID_PROVIDER_RESPONSE',
      'unknown',
      502
    );
  }
}

export function extractChatContent(payload: JsonObject, label: string) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const content = asObject(asObject(choices[0]).message).content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiProviderError(`${label} returned no chat content`, 'INVALID_PROVIDER_RESPONSE', 'unknown', 502);
  }
  return content;
}

export function extractImage(payload: JsonObject) {
  const data = asObject(Array.isArray(payload.data) ? payload.data[0] : payload.data);
  const payloadResults = Array.isArray(payload.results) ? payload.results : [];
  const dataResults = Array.isArray(data.results) ? data.results : [];
  const result = asObject(dataResults[0] || payloadResults[0] || data.result || payload.result);
  const url =
    data.url || data.image_url || data.imageUrl || result.url || result.image_url || result.imageUrl ||
    (Array.isArray(data.urls) ? data.urls[0] : undefined) || (Array.isArray(payload.urls) ? payload.urls[0] : undefined) ||
    payload.url || payload.image_url || payload.imageUrl;
  if (typeof url === 'string' && url) return url;
  const b64 = data.b64_json || data.base64 || payload.b64_json || payload.base64;
  return typeof b64 === 'string' && b64 ? `data:image/png;base64,${b64}` : undefined;
}

export async function listOpenAiModels(runtime: { baseUrl: string; apiKey: string; timeoutMs: number }, label: string) {
  const response = await providerFetch(
    providerUrl(runtime.baseUrl, '/v1/models'),
    { headers: bearerHeaders(runtime.apiKey) },
    Math.min(runtime.timeoutMs, 30000),
    label
  );
  const payload = await parseJson(response, label);
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((item) => (typeof asObject(item).id === 'string' ? asObject(item).id as string : ''))
    .filter(Boolean);
}
