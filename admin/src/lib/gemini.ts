export async function generateAIPrompt(style: string, roomType: string, details?: string) {
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

  // 调用 LongCat API
  const apiKey = process.env.LONGCAT_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API Key for LongCat AI");
  }

  const apiUrl = 'https://api.longcat.chat/openai/v1/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  const body = {
    model: "LongCat-Flash-Chat",
    messages: [
      { role: "system", content: "You are an expert interior design prompt engineer for Stable Diffusion." },
      { role: "user", content: prompt }
    ],
    stream: false,
    max_tokens: 1500,
    temperature: 0.7
  };

  // 打印完整的请求信息供 Postman 测试
  console.log("========== API REQUEST START ==========");
  console.log("URL:", apiUrl);
  console.log("Headers:", JSON.stringify(headers, null, 2));
  console.log("Body:", JSON.stringify(body, null, 2));
  console.log("=======================================");

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[LongCat API Error]", errText);
    throw new Error(`LongCat API failed with status ${response.status}`);
  }

  const result = await response.json();
  const text = result.choices[0].message.content;

  // Extract JSON from the response (sometimes it wraps it in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("Failed to parse JSON from LongCat:", text);
    }
  }

  throw new Error("Failed to generate valid prompt JSON from LongCat");
}
