import { v4 as uuidv4 } from 'uuid';

const TENSOR_API_URL = 'https://openapi.tensor.art/openworks/v1';

export interface TensorJobResponse {
  code: string;
  message: string;
  data?: {
    task?: {
      id: string;
      status: string;
      msg?: string;
      outputs?: Array<{
        type: string;
        url: string;
      }>;
    };
  };
}

/**
 * 创建 Tensor.art 渲染任务 (Txt2Img + ControlNet)
 */
export async function createTensorJob(params: {
  prompt: string;
  negativePrompt?: string;
  image: string; // Base64
  width?: number;
  height?: number;
}) {
  const apiKey = process.env.TENSOR_API_KEY;
  if (!apiKey) {
    throw new Error('TENSOR_API_KEY is not configured');
  }

  const toolName = 'photoreal_studio_z_image';
  const callbackUrl = process.env.TENSOR_WEBHOOK_URL;

  // 根据 photoreal_studio_z_image 的定义构建输入
  const body = {
    toolName: toolName,
    callbackUrl: callbackUrl || undefined,
    inputs: [
      { type: 'STRING', value: params.prompt },
      { type: 'INTEGER', value: params.width || 512 },
      { type: 'INTEGER', value: params.height || 512 },
      { type: 'INTEGER', value: 1 }
    ]
  };

  const response = await fetch(`${TENSOR_API_URL}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Echo-Access-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[Tensor.art API Error]', errText);
    throw new Error(`Tensor.art API failed with status ${response.status}`);
  }

  const result: TensorJobResponse = await response.json();
  
  if (result.code !== '0') {
    throw new Error(`Tensor.art Error: ${result.message}`);
  }

  return result.data?.job || result.data?.task;
}

/**
 * 查询任务状态
 */
export async function getTensorJobStatus(jobId: string) {
  const apiKey = process.env.TENSOR_API_KEY;
  const response = await fetch(`${TENSOR_API_URL}/task/${jobId}`, {
    method: 'GET',
    headers: {
      'Echo-Access-Key': apiKey!,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to query Tensor.art job status: ${response.status}`);
  }

  return await response.json();
}
