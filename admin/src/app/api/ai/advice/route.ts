import { NextResponse } from 'next/server';

/**
 * Proxy AI Design Advice requests.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomName, style, width, height } = body;

    if (!roomName || !style) {
      return NextResponse.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    const systemPrompt = 'You are a professional interior design consultant. Provide concise, expert advice for a room based on its type, dimensions, and style. Focus on furniture layout, color palettes, and lighting. Use bullet points and keep it under 150 words. Respond in Chinese.';
    const userPrompt = `Room: ${roomName}, Style: ${style}, Dimensions: ${width / 10}m x ${height / 10}m!`;

    const url = 'https://gen.pollinations.ai/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gemini-fast',
        messages: [
          { role: 'user', content: systemPrompt + userPrompt }
        ]
      })
    });

    const data = await response.json();

    if (response.ok && data && data.choices) {
      const content = data.choices[0]?.message?.content;
      return NextResponse.json({ success: true, advice: content || '无法生成建议。' });
    } else {
      return NextResponse.json({ success: false, error: 'AI 建议接口返回异常' }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
