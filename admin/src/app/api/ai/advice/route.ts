import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { executePostgresAdviceGeneration } from '@/lib/ai/postgres-advice-service';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json();
      const { roomName, style, width, height } = body;
      if (!roomName || !style) return NextResponse.json({ success: false, error: '缺少房间或风格参数' }, { status: 400 });
      const result = await executePostgresAdviceGeneration({
        enterpriseId: String(context.enterpriseId),
        operatorId: String(context.userId),
        generationInput: { style, roomName, width, height },
        messages: [
          { role: 'system', content: 'You are a professional interior design consultant. Provide concise expert advice in Chinese, focused on furniture layout, color palettes, and lighting. Keep it under 150 Chinese characters.' },
          { role: 'user', content: `Room: ${roomName}, Style: ${style}, Dimensions: ${Number(width || 0) / 10}m x ${Number(height || 0) / 10}m.` },
        ],
        temperature: 0.7,
      });
      return NextResponse.json({ success: true, advice: result.advice, generationId: result.generation.id.toString() });
    });
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'AI 建议生成失败' }, { status });
  }
}
