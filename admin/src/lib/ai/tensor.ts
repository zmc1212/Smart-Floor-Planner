import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createPrivateKey, createSign, KeyObject, randomBytes } from 'crypto';

const getTamsApiUrl = () => process.env.TENSOR_API_URL || 'https://ap-east-1.tensorart.cloud/v1';

export interface TensorJobResponse {
  jobId?: string;
  status?: string;
  successInfo?: {
    images?: Array<{ url: string }>;
  };
  failedInfo?: {
    reason?: string;
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resolvePrivateKey(): KeyObject | null {
  const rawValue = process.env.TENSOR_PRIVATE_KEY?.trim();

  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  const attempts: Array<() => KeyObject> = [];

  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(normalized)) {
    attempts.push(() => createPrivateKey({ key: normalized, format: 'pem' }));
  } else {
    const looksLikePath = /[\\/]/.test(normalized) || /\.(pem|key|der|pk8|p8)$/i.test(normalized);

    if (looksLikePath) {
      const candidatePaths = [
        path.resolve(process.cwd(), normalized),
        path.resolve(process.cwd(), 'admin', normalized),
      ];
      const existingPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

      if (!existingPath) {
        throw new Error(
          `TENSOR_PRIVATE_KEY points to a file that does not exist: ${normalized}. ` +
          `Checked: ${candidatePaths.join(', ')}`
        );
      }

      const keyFile = fs.readFileSync(existingPath, 'utf8').trim();
      attempts.push(() => createPrivateKey({ key: keyFile, format: 'pem' }));
    } else {
      attempts.push(
        () => createPrivateKey({ key: normalized, format: 'pem' }),
        () => createPrivateKey({ key: `-----BEGIN PRIVATE KEY-----\n${normalized}\n-----END PRIVATE KEY-----`, format: 'pem' }),
        () => createPrivateKey({ key: `-----BEGIN RSA PRIVATE KEY-----\n${normalized}\n-----END RSA PRIVATE KEY-----`, format: 'pem' }),
      );

      const derBuffer = Buffer.from(normalized, 'base64');
      if (derBuffer.length > 0) {
        attempts.push(
          () => createPrivateKey({ key: derBuffer, format: 'der', type: 'pkcs8' }),
          () => createPrivateKey({ key: derBuffer, format: 'der', type: 'pkcs1' }),
        );
      }
    }
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error: unknown) {
      errors.push(getErrorMessage(error));
    }
  }

  throw new Error(`Unable to parse TENSOR_PRIVATE_KEY. ${errors.join(' | ')}`);
}

function generateTamsAuthHeaders(method: string, requestPath: string, bodyStr: string): Record<string, string> {
  const appId = process.env.TENSOR_APP_ID?.trim();
  const appIdHeaderKey = process.env.TENSOR_APP_ID_HEADER?.trim() || 'app_id';
  const apiKey = process.env.TENSOR_API_KEY?.trim();
  const authMode = process.env.TENSOR_AUTH_MODE?.trim() || 'bearer-first';
  const privateKey = resolvePrivateKey();

  if (authMode !== 'rsa' && apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  if (!appId || !privateKey) {
    if (apiKey) {
      return { Authorization: `Bearer ${apiKey}` };
    }

    throw new Error('Tensor authentication is not configured. Set TENSOR_API_KEY or both TENSOR_APP_ID and TENSOR_PRIVATE_KEY.');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const urlForSign = requestPath.startsWith('/v1')
    ? requestPath
    : `/v1${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;
  const stringToSign = `${method.toUpperCase()}\n${urlForSign}\n${timestamp}\n${nonce}\n${bodyStr}`;

  try {
    const sign = createSign('RSA-SHA256');
    sign.update(stringToSign);
    sign.end();

    return {
      Authorization: `TAMS-SHA256-RSA ${appIdHeaderKey}=${appId},nonce_str=${nonce},timestamp=${timestamp},signature=${sign.sign(privateKey, 'base64')}`,
    };
  } catch (error: unknown) {
    throw new Error(`Signature generation failed: ${getErrorMessage(error)}`);
  }
}

async function uploadImageResource(base64Image: string): Promise<string> {
  const requestPath = '/v1/resource/image';
  const method = 'POST';
  const bodyPayload = { expireSec: 3600 };
  const body = JSON.stringify(bodyPayload);

  const authHeaders = generateTamsAuthHeaders(method, requestPath, body);
  const baseUrl = getTamsApiUrl().replace(/\/v1$/, '');
  const url = `${baseUrl}${requestPath}`;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...authHeaders,
  };

  console.log('=============================================');
  console.log('[Tensor.art Upload Request] URL:', url);
  console.log('[Tensor.art Upload Request] Headers:', JSON.stringify(headers, null, 2));
  console.log('[Tensor.art Upload Request] Body:', body);
  console.log('=============================================');

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[Tensor.art Upload Error Response]:', errText);
    throw new Error(`Failed to init image upload (${response.status}): ${errText}`);
  }

  const uploadData = await response.json();
  const resourceId = uploadData.resourceId || uploadData.data?.resourceId;
  const putUrl = uploadData.putUrl || uploadData.data?.putUrl;
  const uploadHeaders = uploadData.headers || uploadData.data?.headers || {};

  if (!putUrl || !resourceId) {
    console.error('[Tensor.art Upload Invalid Response]:', uploadData);
    throw new Error('Invalid upload configuration received from Tensor.art');
  }

  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  const uploadRes = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      ...uploadHeaders,
      'Content-Length': buffer.length.toString(),
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const putErr = await uploadRes.text();
    console.error('[Tensor.art OSS PUT Error]:', putErr);
    throw new Error(`Failed to upload image binary: ${uploadRes.statusText}`);
  }

  return resourceId;
}

export async function createTensorJob(params: {
  prompt: string;
  negativePrompt?: string;
  image: string;
  width?: number;
  height?: number;
}) {
  const resourceId = await uploadImageResource(params.image);

  const jobPayload = {
    request_id: uuidv4(),
    stages: [
      {
        type: 'INPUT_INITIALIZE',
        inputInitialize: { seed: '-1', count: 1 },
      },
      {
        type: 'DIFFUSION',
        diffusion: {
          width: params.width || 1024,
          height: params.height || 1024,
          prompts: [{ text: params.prompt }],
          negativePrompts: [{ text: params.negativePrompt || 'low quality, bad resolution, text, watermark, blurry' }],
          sdModel: '613045163490732233',
          sampler: 'Euler a',
          steps: 25,
          cfgScale: 7,
          controlnet: {
            args: [
              {
                inputImageResourceId: resourceId,
                preprocessor: 'none',
                model: '619225630271212879',
                weight: 0.8,
                guidanceStart: 0,
                guidanceEnd: 1,
              },
            ],
          },
        },
      },
    ],
  };

  const requestPath = '/jobs';
  const method = 'POST';
  const body = JSON.stringify(jobPayload);

  const authHeaders = generateTamsAuthHeaders(method, requestPath, body);
  const url = `${getTamsApiUrl()}${requestPath}`;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...authHeaders,
  };

  console.log('=============================================');
  console.log('[Tensor.art Job Request] URL:', url);
  console.log('[Tensor.art Job Request] Headers:', JSON.stringify(headers, null, 2));
  console.log('[Tensor.art Job Request] Body (Truncated):', JSON.stringify(jobPayload).substring(0, 200) + '...');
  console.log('=============================================');

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[Tensor.art Job Error Response]:', errText);
    throw new Error(`Tensor.art API failed (${response.status}): ${errText}`);
  }

  const result = await response.json();
  if (result.code && result.code !== 0) {
    throw new Error(`Tensor.art Error: ${result.message}`);
  }

  return { id: result.jobId || result.data?.jobId };
}

export async function getTensorJobStatus(jobId: string) {
  const requestPath = `/jobs/${jobId}`;
  const method = 'GET';
  const body = '';

  const authHeaders = generateTamsAuthHeaders(method, requestPath, body);
  const url = `${getTamsApiUrl()}${requestPath}`;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to query Tensor.art job status: ${response.status}`);
  }

  return await response.json();
}
