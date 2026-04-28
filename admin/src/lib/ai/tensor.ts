import { v4 as uuidv4 } from 'uuid';

const TAMS_API_URL = 'https://ap-east-1.tensorart.cloud/v1';

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

/**
 * 辅助方法：上传 Base64 图片到 Tensor.art 资源库
 */
async function uploadImageResource(base64Image: string, apiKey: string): Promise<string> {
  // 1. 获取上传授权
  const initRes = await fetch(`${TAMS_API_URL}/resource/image/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Failed to init image upload: ${errText}`);
  }

  const uploadData = await initRes.json();
  const resourceId = uploadData.resourceId || uploadData.data?.resourceId;
  const putUrl = uploadData.putUrl || uploadData.data?.putUrl;
  const headers = uploadData.headers || uploadData.data?.headers || {};

  if (!putUrl || !resourceId) {
    throw new Error('Invalid upload configuration received from Tensor.art');
  }

  // 2. 转换 Base64 为 Buffer
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // 3. 上传到 S3/OSS
  const uploadRes = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Length': buffer.length.toString()
    },
    body: buffer
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload image binary: ${uploadRes.statusText}`);
  }

  return resourceId;
}

/**
 * 创建 Tensor.art 渲染任务 (TAMS 高级工作流 - 支持 ControlNet)
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

  // 检查是否使用了旧版的 ak_tensor_ 开头的 Key
  if (apiKey.startsWith('ak_tensor_') || apiKey.startsWith('ak_tusi_')) {
    throw new Error('当前使用的是 OpenWorks 简易 API Key。要使用高级 ControlNet 工作流，请前往 Tensor.art 开发者平台申请 TAMS App Token (Bearer Token)，并替换 .env.local 中的 TENSOR_API_KEY。');
  }

  // 1. 上传户型线稿图，获取 resourceId
  const resourceId = await uploadImageResource(params.image, apiKey);

  // 2. 组装 TAMS Jobs 载荷 (ControlNet 工作流)
  const body = {
    request_id: uuidv4(),
    stages: [
      {
        type: "INPUT_INITIALIZE",
        inputInitialize: {
          seed: "-1",
          count: 1
        }
      },
      {
        type: "DIFFUSION",
        diffusion: {
          width: params.width || 1024,
          height: params.height || 1024,
          prompts: [{ text: params.prompt }],
          negativePrompts: [{ text: params.negativePrompt || "low quality, bad resolution, text, watermark, blurry" }],
          
          // ==========================================
          // TODO: 替换为你需要的模型 Version ID
          // 你可以在 tensor.art 的模型页面获取大模型和 ControlNet 模型的 ID
          // ==========================================
          sdModel: "613045163490732233", // 示例: 某个默认的大模型 ID
          sampler: "Euler a",
          steps: 25,
          cfgScale: 7,
          controlnet: {
            args: [
              {
                inputImageResourceId: resourceId,
                preprocessor: "none", // 前端传入的已经是户型线稿，直接控制
                model: "YOUR_CONTROLNET_VERSION_ID", // TODO: 替换为实际的 ControlNet (MLSD/Canny) 模型 ID
                weight: 0.8,
                guidanceStart: 0,
                guidanceEnd: 1
              }
            ]
          }
        }
      }
    ]
  };

  const response = await fetch(`${TAMS_API_URL}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[Tensor.art TAMS API Error]', errText);
    throw new Error(`Tensor.art API failed with status ${response.status}`);
  }

  const result = await response.json();
  
  if (result.code && result.code !== 0) {
    throw new Error(`Tensor.art Error: ${result.message}`);
  }

  return { id: result.jobId || result.data?.jobId };
}

/**
 * 查询任务状态 (TAMS)
 */
export async function getTensorJobStatus(jobId: string) {
  const apiKey = process.env.TENSOR_API_KEY;
  const response = await fetch(`${TAMS_API_URL}/jobs/${jobId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to query Tensor.art job status: ${response.status}`);
  }

  return await response.json();
}
