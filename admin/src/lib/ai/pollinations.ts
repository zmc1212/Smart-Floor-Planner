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

async function parseImageResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pollinations request failed (${response.status}): ${errorText}`);
  }

  if (contentType.includes('application/json')) {
    const json = await response.json();
    const imageData = Array.isArray(json?.data) ? json.data[0] : undefined;
    if (typeof imageData?.url === 'string' && imageData.url) {
      return imageData.url;
    }

    if (typeof imageData?.b64_json === 'string' && imageData.b64_json) {
      return `data:image/png;base64,${imageData.b64_json}`;
    }

    if (typeof json?.url === 'string' && json.url) {
      return json.url;
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = contentType.split(';')[0] || 'image/png';
  return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

function combinePrompt(prompt: string, negativePrompt?: string) {
  if (!negativePrompt) {
    return prompt;
  }

  return `${prompt.trim()}\n\nNegative prompt: ${negativePrompt.trim()}`;
}

export async function uploadMedia(imageDataUri: string, apiKey?: string) {
  const { mimeType, buffer } = parseDataUri(imageDataUri);
  const body = new Blob([Uint8Array.from(buffer)], { type: mimeType });
  const response = await fetch(`${POLLINATIONS_MEDIA_URL}/upload`, {
    method: 'POST',
    headers: buildHeaders(apiKey, {
      'Content-Type': mimeType,
      Accept: 'application/json',
    }),
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload media to Pollinations (${response.status}): ${errorText}`);
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

  return parseImageResponse(response);
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

  return parseImageResponse(response);
}
