import { GoogleGenAI } from "@google/genai";
import { StyleType, AIProvider } from "../types";

let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Please configure it in your environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

const generateWithGemini = async (prompt: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts: [{ text: prompt }] },
    config: { imageConfig: { aspectRatio: "16:9" } },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Gemini did not return an image.");
};

const generateWithDoubao = async (prompt: string): Promise<string> => {
  const apiKey = process.env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error("请先在环境变量中配置 DOUBAO_API_KEY");

  // 豆包 (字节跳动) 图像生成 API
  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "cv_high_fidelity_v2", // 示例模型
      prompt: prompt,
      size: "1024x1024",
      n: 1
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`豆包 API 错误: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].url || data.data[0].b64_json;
};

const generateWithQwen = async (prompt: string): Promise<string> => {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new Error("请先在环境变量中配置 QWEN_API_KEY");

  // 通义万相 (阿里 DashScope) 图像生成 API
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable' // 异步调用
    },
    body: JSON.stringify({
      model: "wanx-v1",
      input: { prompt: prompt },
      parameters: { size: "1024*1024", n: 1 }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`通义万相 API 错误: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  // 注意：DashScope 通常是异步的，这里简化处理，实际可能需要轮询任务状态
  // 为了演示，我们假设它直接返回了结果（或者用户需要配置同步模型）
  if (data.output?.task_id) {
    throw new Error("通义万相请求已提交，但该 API 是异步的，当前暂不支持轮询。请使用 Gemini 或豆包进行实时预览。");
  }
  
  return data.output?.results?.[0]?.url || "";
};

export const generateRendering = async (
  roomName: string, 
  style: StyleType, 
  width: number, 
  height: number, 
  provider: AIProvider = AIProvider.GEMINI,
  retries = 2
): Promise<string> => {
  const prompt = `Generate a high-quality, realistic interior design rendering for a room.
  Room Type: ${roomName}
  Dimensions: ${width / 10}m x ${height / 10}m
  Style: ${style}
  The image should be a wide-angle view showing the furniture, lighting, and textures consistent with the ${style} aesthetic.
  Professional photography, 8k resolution, cinematic lighting.`;

  try {
    switch (provider) {
      case AIProvider.DOUBAO:
        return await generateWithDoubao(prompt);
      case AIProvider.QWEN:
        return await generateWithQwen(prompt);
      case AIProvider.GEMINI:
      default:
        return await generateWithGemini(prompt);
    }
  } catch (error: any) {
    // Handle 429 Too Many Requests for Gemini
    if (provider === AIProvider.GEMINI && (error?.status === 429 || error?.message?.includes('429'))) {
      if (retries > 0) {
        console.log(`Rate limited. Retrying in 2 seconds... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return generateRendering(roomName, style, width, height, provider, retries - 1);
      }
      throw new Error("AI 渲染服务目前太忙了（触发频率限制），请稍等 1 分钟后再试。");
    }
    
    console.error(`Error generating rendering with ${provider}:`, error);
    throw error;
  }
};
