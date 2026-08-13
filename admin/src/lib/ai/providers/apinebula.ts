import type {
  AiImageProviderResult,
  AiProviderAdapter,
  AiProviderRuntimeConfig,
} from '@/lib/ai/provider-types';
import { AiProviderError } from '@/lib/ai/provider-types';
import {
  asObject,
  bearerHeaders,
  extractChatContent,
  listOpenAiModels,
  parseJson,
  providerFetch,
  providerUrl,
  type JsonObject,
} from './http';

function taskId(payload: JsonObject) {
  const value = payload.task_id || payload.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function apiRoot(baseUrl: string) {
  return baseUrl.replace(/\/$/, '').replace(/\/v1$/i, '');
}

function taskStatus(payload: JsonObject) {
  return typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
}

function taskError(payload: JsonObject) {
  const error = asObject(payload.error);
  return String(error.message || payload.message || 'API Nebula image task failed');
}

function taskImage(payload: JsonObject) {
  const detail = asObject(payload.detail);
  const data = Array.isArray(detail.data) ? detail.data : [];
  for (const item of data) {
    const row = asObject(item);
    const value = row.download_url || row.url || row.image_url;
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function parseTask(payload: JsonObject, fallbackId?: string): AiImageProviderResult {
  const id = taskId(payload) || fallbackId || '';
  const status = taskStatus(payload);
  if (status === 'completed' || status === 'succeeded') {
    const image = taskImage(payload);
    if (!image) {
      return {
        status: 'unknown',
        remoteTaskId: id || undefined,
        remoteStatus: status,
        error: 'API Nebula completed without a downloadable image URL',
      };
    }
    return { status: 'succeeded', image, remoteTaskId: id, remoteStatus: status };
  }
  if (['failed', 'cancelled', 'canceled'].includes(status)) {
    return {
      status: 'failed',
      remoteTaskId: id || undefined,
      remoteStatus: status,
      error: taskError(payload),
      refunded: true,
    };
  }
  if (['queued', 'waiting', 'in_progress', 'running'].includes(status)) {
    return { status: 'processing', remoteTaskId: id, remoteStatus: status, nextPollMs: 5000 };
  }
  return {
    status: 'unknown',
    remoteTaskId: id || undefined,
    remoteStatus: status || undefined,
    error: 'API Nebula returned an unknown image task status',
  };
}

async function fetchModels(runtime: AiProviderRuntimeConfig) {
  return listOpenAiModels({ ...runtime, baseUrl: apiRoot(runtime.baseUrl) }, 'API Nebula models');
}

export const apiNebulaAdapter: AiProviderAdapter = {
  type: 'apinebula',
  async chat(runtime, input) {
    const response = await providerFetch(
      providerUrl(apiRoot(runtime.baseUrl), '/v1/chat/completions'),
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
      'API Nebula chat'
    );
    return extractChatContent(await parseJson(response, 'API Nebula chat'), 'API Nebula chat');
  },
  async submitImage(runtime, input) {
    const isEdit = Boolean(input.images?.length);
    const response = await providerFetch(
      providerUrl(apiRoot(runtime.baseUrl), isEdit ? '/v1/image-tasks/edits' : '/v1/image-tasks/generations'),
      {
        method: 'POST',
        headers: bearerHeaders(runtime.apiKey),
        body: JSON.stringify({
          model: input.model,
          prompt: input.negativePrompt
            ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}`
            : input.prompt,
          quality: input.quality || 'high',
          response_format: 'url',
          ...(isEdit ? { images: input.images!.map((imageUrl) => ({ image_url: imageUrl })) } : {}),
        }),
      },
      runtime.timeoutMs,
      'API Nebula image task submission'
    );
    const payload = await parseJson(response, 'API Nebula image task submission');
    const id = taskId(payload);
    if (!id) {
      throw new AiProviderError(
        'API Nebula accepted response did not contain a task id',
        'INVALID_PROVIDER_RESPONSE',
        'unknown',
        502
      );
    }
    return parseTask(payload, id);
  },
  async pollImage(runtime, remoteTaskId) {
    const response = await providerFetch(
      providerUrl(apiRoot(runtime.baseUrl), `/v1/image-tasks/${encodeURIComponent(remoteTaskId)}?detail=true`),
      { method: 'GET', headers: bearerHeaders(runtime.apiKey) },
      runtime.timeoutMs,
      'API Nebula image task polling'
    );
    return parseTask(await parseJson(response, 'API Nebula image task polling'), remoteTaskId);
  },
  async testConnection(runtime) {
    const startedAt = Date.now();
    try {
      const models = await fetchModels(runtime);
      return {
        ok: true,
        message: `连接成功，可用模型 ${models.length} 个`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '连接失败',
        latencyMs: Date.now() - startedAt,
      };
    }
  },
  listModels(runtime) {
    return fetchModels(runtime);
  },
};
