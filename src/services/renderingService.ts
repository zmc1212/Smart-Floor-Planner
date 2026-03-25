import { GoogleGenAI } from "@google/genai";
import { StyleType, AIProvider, OpeningData } from "../types";

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
  const modelId = process.env.DOUBAO_MODEL_ID || "doubao-t2i-v3";
  if (!apiKey) throw new Error("请先在环境变量中配置 DOUBAO_API_KEY");

  // 豆包 (字节跳动) 图像生成 API
  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      prompt: prompt,
      size: "1024x1024",
      n: 1,
      response_format: "b64_json"
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`豆包 API 错误: ${error.error?.message || error.message || response.statusText}`);
  }

  const data = await response.json();
  if (data.data && data.data[0]) {
    if (data.data[0].b64_json) {
      return `data:image/png;base64,${data.data[0].b64_json}`;
    }
    if (data.data[0].url) {
      return data.data[0].url;
    }
  }
  throw new Error("豆包 API 未返回图像数据");
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

const generateWithPollinations = async (prompt: string): Promise<string> => {
  // Now defined in vite.config.ts, so process.env.POLLINATIONS_API_KEY is available
  const apiKey = process.env.POLLINATIONS_API_KEY;
  const encodedPrompt = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const model = "flux";
  
  const params = `model=${model}&width=1024&height=1024&nologo=true&enhance=true&seed=${seed}`;
  const authUrl = `https://gen.pollinations.ai/image/${encodedPrompt}?${params}`;
  const anonUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}`;

  // Helper to convert Blob to Data URL to bypass ORB issues
  const blobToDataURL = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // 1. Try authenticated endpoint if key is available
  if (apiKey) {
    try {
      const response = await fetch(authUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (response.ok) {
        const blob = await response.blob();
        return await blobToDataURL(blob);
      }
    } catch (e) {
      console.warn("Pollinations Auth API failed, falling back to anonymous", e);
    }
  }

  // 2. Fallback to anonymous endpoint
  try {
    const response = await fetch(anonUrl);
    if (response.ok) {
      const blob = await response.blob();
      return await blobToDataURL(blob);
    }
  } catch (e) {
    console.warn("Pollinations Anonymous API failed", e);
  }

  return anonUrl;
};

export const generateDesignAdvice = async (
  roomName: string,
  style: StyleType,
  width: number,
  height: number
): Promise<string> => {
  const systemPrompt = "You are a professional interior design consultant. Provide concise, expert advice for a room based on its type, dimensions, and style. Focus on furniture layout, color palettes, and lighting. Use bullet points and keep it under 150 words. Respond in Chinese.";
  const userPrompt = `Room: ${roomName}, Style: ${style}, Dimensions: ${width / 10}m x ${height / 10}m!`;
  const apiKey = process.env.POLLINATIONS_API_KEY;

  try {
    const url = "https://gen.pollinations.ai/v1/chat/completions";
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: "gemini-fast",
        messages: [
          { role: "user", content: `${systemPrompt}${userPrompt}` }
        ]
      })
    });

    if (!response.ok) {
      throw new Error("Pollinations Chat API error");
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "无法生成建议。";
  } catch (error) {
    console.error("Error generating design advice with Pollinations:", error);
    throw new Error("无法获取 AI 装修建议，请稍后再试。");
  }
};

export const generateRendering = async (
  roomName: string, 
  style: StyleType, 
  width: number, 
  height: number, 
  openings: OpeningData[] = [],
  provider: AIProvider = AIProvider.GEMINI,
  retries = 2
): Promise<string> => {
  const doors = openings.filter(o => o.type === 'DOOR');
  const windows = openings.filter(o => o.type === 'WINDOW');

  const openingsDescription = openings.map((o) => {
    const type = o.type === 'DOOR' ? 'Door' : 'Window';
    const pos = o.rotation === 0 
      ? `${o.y < 5 ? 'Top' : 'Bottom'} wall (x=${(o.x / 10).toFixed(1)}m)` 
      : `${o.x < 5 ? 'Left' : 'Right'} wall (y=${(o.y / 10).toFixed(1)}m)`;
    return `${type} on ${pos}`;
  }).join(', ');

  const prompt = `Interior design collage: ${roomName}, ${style} style, ${width / 10}x${height / 10}m.
  Layout: ${openingsDescription || 'Standard enclosed space'}.
  Views: 3D top-down plan, entrance perspective, detail shot.
  Style: Photorealistic, 8k, architectural photography, cinematic lighting, white background.
  Strictly NO TEXT, NO LABELS, NO NUMBERS.`;

  try {
    switch (provider) {
      case AIProvider.DOUBAO:
        return await generateWithDoubao(prompt);
      case AIProvider.QWEN:
        return await generateWithQwen(prompt);
      case AIProvider.POLLINATIONS:
        return await generateWithPollinations(prompt);
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
        return generateRendering(roomName, style, width, height, openings, provider, retries - 1);
      }
      throw new Error("AI 渲染服务目前太忙了（触发频率限制），请稍等 1 分钟后再试。");
    }
    
    console.error(`Error generating rendering with ${provider}:`, error);
    throw error;
  }
};
