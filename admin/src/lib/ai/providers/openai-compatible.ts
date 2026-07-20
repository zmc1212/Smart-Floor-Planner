import type { AiProviderAdapter } from '@/lib/ai/provider-types';
import { AiProviderError } from '@/lib/ai/provider-types';
import { bearerHeaders, extractChatContent, extractImage, listOpenAiModels, parseJson, providerFetch, providerUrl } from './http';

export const openAiCompatibleAdapter: AiProviderAdapter = {
  type: 'openai_compatible',
  async chat(runtime, input) {
    const response = await providerFetch(
      providerUrl(runtime.baseUrl, '/v1/chat/completions'),
      {
        method: 'POST',
        headers: bearerHeaders(runtime.apiKey),
        body: JSON.stringify({ model: input.model, messages: input.messages, temperature: input.temperature ?? 0.7, max_tokens: input.maxTokens }),
      },
      runtime.timeoutMs,
      `${runtime.name} chat`
    );
    return extractChatContent(await parseJson(response, `${runtime.name} chat`), `${runtime.name} chat`);
  },
  async submitImage(runtime, input) {
    const isEdit = Boolean(input.images?.length);
    const response = await providerFetch(
      providerUrl(runtime.baseUrl, isEdit ? '/v1/images/edits' : '/v1/images/generations'),
      {
        method: 'POST',
        headers: bearerHeaders(runtime.apiKey),
        body: JSON.stringify({
          model: input.model,
          prompt: input.negativePrompt ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}` : input.prompt,
          size: input.size || '1024x1024',
          quality: input.quality || 'high',
          response_format: 'url',
          ...(isEdit ? { image: input.images?.[0] } : {}),
          ...(input.user ? { user: input.user } : {}),
        }),
      },
      runtime.timeoutMs,
      `${runtime.name} image`
    );
    const image = extractImage(await parseJson(response, `${runtime.name} image`));
    if (!image) throw new AiProviderError(`${runtime.name} returned no image`, 'INVALID_PROVIDER_RESPONSE', 'unknown', 502);
    return { status: 'succeeded', image };
  },
  async pollImage() {
    return { status: 'unknown', error: 'This provider does not expose an asynchronous image status endpoint' };
  },
  async testConnection(runtime) {
    const startedAt = Date.now();
    try {
      await listOpenAiModels(runtime, runtime.name);
      return { ok: true, message: '连接成功', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '连接失败', latencyMs: Date.now() - startedAt };
    }
  },
  listModels(runtime) {
    return listOpenAiModels(runtime, runtime.name);
  },
};
