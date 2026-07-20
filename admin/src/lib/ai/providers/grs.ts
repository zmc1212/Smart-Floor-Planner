import type { AiProviderAdapter, AiImageProviderResult, AiProviderBalanceResult, AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { AiProviderError } from '@/lib/ai/provider-types';
import { asObject, bearerHeaders, extractChatContent, extractImage, listOpenAiModels, parseJson, providerFetch, providerUrl, type JsonObject } from './http';

function remoteId(payload: JsonObject) {
  const data = asObject(payload.data);
  const id = payload.id || payload.task_id || payload.taskId || data.id || data.task_id || data.taskId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function remoteStatus(payload: JsonObject) {
  const data = asObject(payload.data);
  const value = payload.status || data.status || payload.state || data.state;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function remoteError(payload: JsonObject) {
  const data = asObject(payload.data);
  const error = asObject(payload.error);
  return String(error.message || payload.error || payload.message || data.message || 'GRS image task failed');
}

function grsAspectRatio(model: string, size?: string) {
  const value = String(size || '').trim();
  if (!model.startsWith('nano-banana')) return value || '1024x1024';
  const supported = new Set(['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1']);
  if (supported.has(value)) return value;
  const dimensions = value.match(/^(\d+)x(\d+)$/i);
  if (!dimensions) return 'auto';
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (!width || !height) return 'auto';
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return supported.has(ratio) ? ratio : 'auto';
}

function parseDrawResult(payload: JsonObject, id?: string): AiImageProviderResult {
  const status = remoteStatus(payload);
  const image = extractImage(payload) || extractImage(asObject(payload.data));
  if (image || ['succeeded', 'success', 'completed'].includes(status)) {
    if (!image) return { status: 'unknown', remoteTaskId: id, remoteStatus: status, error: 'GRS succeeded without an image URL' };
    return { status: 'succeeded', image, remoteTaskId: id, remoteStatus: status || 'succeeded' };
  }
  if (['failed', 'failure', 'error', 'violation', 'cancelled', 'canceled'].includes(status)) {
    return { status: 'failed', remoteTaskId: id, remoteStatus: status, error: remoteError(payload), refunded: true };
  }
  return { status: 'processing', remoteTaskId: id || remoteId(payload), remoteStatus: status || 'running', nextPollMs: 5000 };
}

async function queryGrsBalance(runtime: AiProviderRuntimeConfig): Promise<AiProviderBalanceResult> {
  const response = await providerFetch(
    providerUrl(runtime.baseUrl, '/client/openapi/getAPIKeyCredits'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apiKey: runtime.apiKey }),
    },
    Math.min(runtime.timeoutMs, 30000),
    'GRS API Key balance'
  );
  const payload = await parseJson(response, 'GRS API Key balance');
  const data = asObject(payload.data);
  if (Number(payload.code) !== 0) {
    throw new AiProviderError(
      String(payload.msg || 'GRS API Key balance query failed'),
      'GRS_BALANCE_QUERY_FAILED',
      'definitive_failure',
      502
    );
  }
  const balance = Number(data.credits);
  if (!Number.isFinite(balance)) {
    throw new AiProviderError(
      'GRS API Key balance response did not contain valid credits',
      'INVALID_PROVIDER_RESPONSE',
      'unknown',
      502
    );
  }
  return { balance, unit: 'GRS 积分' };
}

export const grsAdapter: AiProviderAdapter = {
  type: 'grs',
  async chat(runtime, input) {
    const response = await providerFetch(
      providerUrl(runtime.baseUrl, '/v1/chat/completions'),
      {
        method: 'POST',
        headers: bearerHeaders(runtime.apiKey),
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.7,
          max_tokens: input.maxTokens,
        }),
      },
      runtime.timeoutMs,
      'GRS chat'
    );
    return extractChatContent(await parseJson(response, 'GRS chat'), 'GRS chat');
  },
  async submitImage(runtime, input) {
    const response = await providerFetch(
      providerUrl(runtime.baseUrl, '/v1/api/generate'),
      {
        method: 'POST',
        headers: bearerHeaders(runtime.apiKey),
        body: JSON.stringify({
          model: input.model,
          prompt: input.negativePrompt ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}` : input.prompt,
          images: input.images || [],
          aspectRatio: grsAspectRatio(input.model, input.size),
          replyType: 'async',
          ...(input.model.startsWith('nano-banana') && /^(1K|2K|4K)$/i.test(input.quality || '')
            ? { imageSize: String(input.quality).toUpperCase() }
            : {}),
        }),
      },
      runtime.timeoutMs,
      'GRS image generation'
    );
    const payload = await parseJson(response, 'GRS image generation');
    const id = remoteId(payload);
    const parsed = parseDrawResult(payload, id || undefined);
    if (parsed.status !== 'processing') return parsed;
    if (!id) {
      throw new AiProviderError('GRS accepted response did not contain a task id', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502);
    }
    return parsed;
  },
  async pollImage(runtime, remoteTaskId) {
    const response = await providerFetch(
      providerUrl(runtime.baseUrl, `/v1/api/result?id=${encodeURIComponent(remoteTaskId)}`),
      {
        method: 'GET',
        headers: bearerHeaders(runtime.apiKey),
      },
      runtime.timeoutMs,
      'GRS image result'
    );
    return parseDrawResult(await parseJson(response, 'GRS image result'), remoteTaskId);
  },
  async testConnection(runtime) {
    const startedAt = Date.now();
    try {
      const result = await queryGrsBalance(runtime);
      return {
        ok: true,
        message: `连接成功，上游余额 ${result.balance} ${result.unit}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '连接失败', latencyMs: Date.now() - startedAt };
    }
  },
  async listModels(runtime) {
    try {
      return await listOpenAiModels(runtime, 'GRS models');
    } catch (error) {
      if (error instanceof AiProviderError && error.code === 'HTTP_404') {
        return [...new Set(Object.values(runtime.modelMappings).filter((model): model is string => Boolean(model)))];
      }
      throw error;
    }
  },
  getBalance(runtime) {
    return queryGrsBalance(runtime);
  },
};
