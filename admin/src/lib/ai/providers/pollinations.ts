import { AiProviderError, type AiProviderAdapter, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { openAiCompatibleAdapter } from './openai-compatible';

async function uploadDataUri(runtime: AiProviderRuntimeConfig, dataUri: string) {
  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return dataUri;
  const body = new FormData();
  body.append('file', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), 'image.png');
  try {
    const response = await fetch(`${(process.env.POLLINATIONS_MEDIA_URL || 'https://media.pollinations.ai').replace(/\/$/, '')}/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${runtime.apiKey}`, Accept: 'application/json' }, body,
      signal: AbortSignal.timeout(runtime.timeoutMs), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Pollinations media upload failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
    const payload = await response.json();
    if (typeof payload?.url !== 'string') throw new Error('Pollinations media upload returned no URL');
    return payload.url;
  } catch (error) {
    throw new AiProviderError(error instanceof Error ? error.message : 'Pollinations media upload failed', 'MEDIA_UPLOAD_FAILED', 'safe_fallback', 502);
  }
}

async function inlineProtectedImage(runtime: AiProviderRuntimeConfig, image: string) {
  let url: URL;
  try { url = new URL(image); } catch { return image; }
  if (url.hostname !== 'gen.pollinations.ai' || !url.pathname.startsWith('/image/')) return image;
  const response = await fetch(image, { headers: { Authorization: `Bearer ${runtime.apiKey}`, Accept: 'image/*' }, signal: AbortSignal.timeout(runtime.timeoutMs), cache: 'no-store' });
  if (!response.ok) throw new Error(`Pollinations image fetch failed (${response.status})`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  return `data:${mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}

export const pollinationsAdapter: AiProviderAdapter = {
  ...openAiCompatibleAdapter,
  type: 'pollinations',
  async submitImage(runtime, input) {
    const images = input.images?.length ? await Promise.all(input.images.map((image) => uploadDataUri(runtime, image))) : undefined;
    const result = await openAiCompatibleAdapter.submitImage(runtime, { ...input, images });
    if (result.status !== 'succeeded') return result;
    try {
      return { ...result, image: await inlineProtectedImage(runtime, result.image) };
    } catch (error) {
      return { status: 'failed', remoteStatus: 'succeeded', error: error instanceof Error ? error.message : 'Pollinations image fetch failed', refunded: false };
    }
  },
};
