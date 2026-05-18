import { generateChatCompletion } from '@/lib/ai/pollinations';

export async function generateAIPrompt(style: string, roomType: string, details?: string, apiKey?: string) {
  const prompt = `
    Task: Generate a high-quality, professional English prompt and a negative prompt for a ${style} style ${roomType}.
    
    Context:
    - Style: ${style}
    - Room Type: ${roomType}
    - Additional Details: ${details || 'None'}
    
    Requirements:
    - The positive prompt should focus on materials, lighting (cinematic, natural), textures, and specific ${style} characteristics.
    - CRITICAL SPATIAL LOGIC: You MUST parse the 'Architectural Data'. Pay extremely close attention to the coordinates (x, y) and dimensions (width, height) of 'openings' (DOOR, WINDOW) relative to the room's main polygon boundaries.
    - Convert coordinates into precise spatial descriptions. For example, if a window is on the far-left wall relative to the camera perspective, say "large window on the left wall illuminating the space". If a door is in the background, mention "a wooden door visible in the background".
    - The generated image MUST NOT contradict the structural layout. If there is a window on the right in the layout, the prompt must explicitly mention the window on the right. This is vital for user trust.
    - Use the room dimensions (width/height) to deduce the spatial feeling (e.g., cozy, expansive, long hallway) and describe the layout accordingly.
    - Include technical keywords like "8k resolution", "architectural photography", "photorealistic", "highly detailed".
    - Avoid any text, labels, or watermarks in the prompt.
    - Ensure the final prompt translates complex JSON geometry into natural, vivid visual descriptions for Stable Diffusion.
    - The output MUST be a JSON object with keys "prompt" and "negative_prompt".
    
    Format:
    {
      "prompt": "...",
      "negative_prompt": "..."
    }
  `;

  // 打印完整的请求信息
  console.log("========== POLLINATIONS PROMPT CHAT REQUEST START ==========");
  console.log("Prompt input:", prompt);
  console.log("=======================================");

  const text = await generateChatCompletion({
    apiKey,
    messages: [
      { role: "system", content: "You are an expert interior design prompt engineer for Stable Diffusion." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7
  });

  // Extract JSON from the response (sometimes it wraps it in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("Failed to parse JSON from Pollinations Chat:", text);
    }
  }

  throw new Error("Failed to generate valid prompt JSON from Pollinations Chat");
}
