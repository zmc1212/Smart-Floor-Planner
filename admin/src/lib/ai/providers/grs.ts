import type { AiProviderAdapter, AiImageProviderResult, AiProviderBalanceResult, AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { AiProviderError } from '@/lib/ai/provider-types';
import { listGrsImageModelIds, resolveGrsImageParameters } from '@/lib/ai/grs-image-models';
import { asObject, bearerHeaders, extractChatContent, extractImage, listOpenAiModels, parseJson, providerFetch, providerUrl, type JsonObject } from './http';

/**
 * Classifies a GRS application-level response code into a human-readable
 * Chinese error message and an AiProviderError disposition.
 * Returns null when the code indicates success (0 or absent).
 */
function classifyGrsResponseCode(payload: JsonObject): {
  message: string;
  code: string;
  disposition: 'definitive_failure' | 'safe_fallback';
} | null {
  const rawCode = payload.code;
  if (rawCode === undefined || rawCode === null || rawCode === 0 || rawCode === '0') return null;
  const numCode = Number(rawCode);
  const msg = String(payload.msg || payload.message || '').trim();
  // Quota / balance exhausted — definitive failure, not worth retrying another runtime
  const isQuota =
    numCode === 402 ||
    /余额|额度|积分不足|insufficient.{0,20}(credit|balance|quota)|quota.{0,10}exceed/i.test(msg);
  if (isQuota) {
    return {
      message: `GRS 上游额度不足${msg ? `：${msg}` : '，请联系平台管理员充值'}`,
      code: 'GRS_QUOTA_EXHAUSTED',
      disposition: 'definitive_failure',
    };
  }
  // Auth errors — definitive failure
  const isAuth = numCode === 401 || /invalid.{0,10}(api.?key|token)|unauthorized|鉴权|认证/i.test(msg);
  if (isAuth) {
    return {
      message: `GRS API 鉴权失败${msg ? `：${msg}` : ''}，请检查供应商配置`,
      code: 'GRS_AUTH_FAILED',
      disposition: 'definitive_failure',
    };
  }
  // Content policy / violation — definitive failure
  const isViolation = /violation|违规|涉黄|涉政|审核/i.test(msg);
  if (isViolation) {
    return {
      message: `GRS 内容审核拒绝${msg ? `：${msg}` : ''}`,
      code: 'GRS_CONTENT_VIOLATION',
      disposition: 'definitive_failure',
    };
  }
  // Unknown non-zero code — safe fallback (may retry another runtime)
  return {
    message: `GRS 生图失败（code ${rawCode}）${msg ? `：${msg}` : ''}`,
    code: `GRS_ERROR_${rawCode}`,
    disposition: 'safe_fallback',
  };
}

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
    const parameters = resolveGrsImageParameters({
      model: input.model,
      aspectRatio: input.aspectRatio,
      resolutionTier: input.resolutionTier,
      width: input.width,
      height: input.height,
      legacySize: input.size,
      legacyQuality: input.quality,
    });
    const response = await providerFetch(
      providerUrl(runtime.baseUrl, '/v1/api/generate'),
      {
        method: 'POST',
        headers: bearerHeaders(runtime.apiKey),
        body: JSON.stringify({
          model: input.model,
          prompt: input.negativePrompt ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}` : input.prompt,
          images: input.images || [],
          aspectRatio: parameters.aspectRatio,
          replyType: 'async',
          ...(parameters.imageSize ? { imageSize: parameters.imageSize } : {}),
        }),
      },
      runtime.timeoutMs,
      'GRS image generation'
    );
    const payload = await parseJson(response, 'GRS image generation');
    // Detect application-level error codes before interpreting the task result.
    const classified = classifyGrsResponseCode(payload);
    if (classified) {
      throw new AiProviderError(classified.message, classified.code, classified.disposition, 502);
    }
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
      return [...new Set([
        ...listGrsImageModelIds(),
        ...await listOpenAiModels(runtime, 'GRS models'),
      ])];
    } catch (error) {
      if (error instanceof AiProviderError && error.code === 'HTTP_404') {
        return [...new Set([
          ...listGrsImageModelIds(),
          ...Object.values(runtime.modelMappings).filter((model): model is string => Boolean(model)),
        ])];
      }
      throw error;
    }
  },
  getBalance(runtime) {
    return queryGrsBalance(runtime);
  },
};
