const POLLINATIONS_BASE_URL = process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai';
const POLLINATIONS_MEDIA_URL = process.env.POLLINATIONS_MEDIA_URL || 'https://media.pollinations.ai';

type PollinationsQuality = 'standard' | 'hd' | 'low' | 'medium' | 'high';

interface DataUriImage {
  mimeType: string;
  buffer: Buffer;
}

export interface PollinationsImageRequest {
  prompt: string;
  model: string;
  size: string;
  quality?: PollinationsQuality;
  negativePrompt?: string;
  referenceImageUrl?: string;
  user?: string;
  apiKey?: string;
}

function isPromptImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === 'gen.pollinations.ai' && url.pathname.startsWith('/image/');
  } catch {
    return false;
  }
}

function getApiKey(explicitApiKey?: string) {
  const apiKey = explicitApiKey?.trim() || process.env.POLLINATIONS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Pollinations authentication is not configured. Set POLLINATIONS_API_KEY.');
  }
  return apiKey;
}

function buildHeaders(apiKey?: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${getApiKey(apiKey)}`,
    ...extra,
  };
}

function parseDataUri(input: string): DataUriImage {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Only base64 image data URIs are supported.');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

async function parseImageResponse(response: Response, apiKey?: string) {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Pollinations request failed (${response.status}): ${errorText}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  if (contentType.includes('application/json')) {
    const json = await response.json();
    const imageData = Array.isArray(json?.data) ? json.data[0] : undefined;
    if (typeof imageData?.url === 'string' && imageData.url) {
      return isPromptImageUrl(imageData.url)
        ? await fetchImageAsDataUri(imageData.url, apiKey)
        : imageData.url;
    }

    if (typeof imageData?.b64_json === 'string' && imageData.b64_json) {
      return `data:image/png;base64,${imageData.b64_json}`;
    }

    if (typeof json?.url === 'string' && json.url) {
      return isPromptImageUrl(json.url)
        ? await fetchImageAsDataUri(json.url, apiKey)
        : json.url;
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = contentType.split(';')[0] || 'image/png';
  return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

async function fetchImageAsDataUri(url: string, apiKey?: string) {
  const response = await fetch(url, {
    headers: buildHeaders(apiKey, {
      Accept: 'image/*',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(
      `Pollinations image URL fetch failed (${response.status}): ${errorText}`
    );
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  const arrayBuffer = await response.arrayBuffer();
  return `data:${contentType.split(';')[0]};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

function combinePrompt(prompt: string, negativePrompt?: string) {
  if (!negativePrompt) {
    return prompt;
  }

  return `${prompt.trim()}\n\nNegative prompt: ${negativePrompt.trim()}`;
}

export async function uploadMedia(imageDataUri: string, apiKey?: string) {
  const { mimeType, buffer } = parseDataUri(imageDataUri);
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'bin';
  const body = new FormData();
  body.append(
    'file',
    new Blob([Uint8Array.from(buffer)], { type: mimeType }),
    `image.${extension}`
  );
  const response = await fetch(`${POLLINATIONS_MEDIA_URL}/upload`, {
    method: 'POST',
    headers: buildHeaders(apiKey, {
      Accept: 'application/json',
    }),
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Failed to upload media to Pollinations (${response.status}): ${errorText}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const json = await response.json();
  if (!json?.url) {
    throw new Error('Invalid upload response received from Pollinations.');
  }

  return json.url as string;
}

export async function generateImage(params: PollinationsImageRequest) {
  const response = await fetch(`${POLLINATIONS_BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: buildHeaders(params.apiKey, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify({
      prompt: combinePrompt(params.prompt, params.negativePrompt),
      model: params.model,
      size: params.size,
      quality: params.quality || 'medium',
      response_format: 'url',
      ...(params.referenceImageUrl ? { image: params.referenceImageUrl } : {}),
      ...(params.user ? { user: params.user } : {}),
    }),
  });

  return parseImageResponse(response, params.apiKey);
}

export async function editImage(params: PollinationsImageRequest) {
  if (!params.referenceImageUrl) {
    throw new Error('A reference image URL is required for image edits.');
  }

  const response = await fetch(`${POLLINATIONS_BASE_URL}/v1/images/edits`, {
    method: 'POST',
    headers: buildHeaders(params.apiKey, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify({
      prompt: combinePrompt(params.prompt, params.negativePrompt),
      image: params.referenceImageUrl,
      model: params.model,
      size: params.size,
      quality: params.quality || 'medium',
      response_format: 'url',
      ...(params.user ? { user: params.user } : {}),
    }),
  });

  return parseImageResponse(response, params.apiKey);
}

export interface PollinationsChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'low' | 'high' | 'auto';
    };
  }>;
}

export interface PollinationsChatRequest {
  model?: string;
  messages: PollinationsChatMessage[];
  temperature?: number;
  max_tokens?: number;
  apiKey?: string;
}

export async function generateChatCompletion(params: PollinationsChatRequest): Promise<string> {
  const model = params.model || process.env.POLLINATIONS_CHAT_MODEL || 'openai';
  const response = await fetch(`${POLLINATIONS_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(params.apiKey, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify({
      model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Pollinations chat completion failed (${response.status}): ${errorText}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Invalid chat completion response from Pollinations.');
  }

  return content;
}
