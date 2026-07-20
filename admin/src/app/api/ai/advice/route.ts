import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import { consumeGenerationCredits, ensureGenerationCreditHold, executeAiChat, releaseGenerationCredits } from '@/lib/ai/execution-service';

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json();
      const { roomName, style, width, height } = body;
      if (!roomName || !style) return NextResponse.json({ success: false, error: '缺少房间或风格参数' }, { status: 400 });
      const generation = await AiGeneration.create({
        enterpriseId: context.enterpriseId!,
        operatorId: context.userId,
        type: 'advice',
        actionKey: 'text.design_advice',
        capability: 'chat',
        logicalModelKey: 'chat.general',
        status: 'processing',
        input: { style, roomName, width, height },
        output: {},
        billing: { cycle: 0, actionKey: 'text.design_advice', status: 'unbilled' },
      });
      try {
        await ensureGenerationCreditHold(generation);
        const result = await executeAiChat({
          enterpriseId: String(context.enterpriseId),
          generationId: String(generation._id),
          logicalModelKey: 'chat.general',
          messages: [
            { role: 'system', content: 'You are a professional interior design consultant. Provide concise expert advice in Chinese, focused on furniture layout, color palettes, and lighting. Keep it under 150 Chinese characters.' },
            { role: 'user', content: `Room: ${roomName}, Style: ${style}, Dimensions: ${Number(width || 0) / 10}m x ${Number(height || 0) / 10}m.` },
          ],
          temperature: 0.7,
        });
        generation.provider = result.provider;
        generation.remoteModel = result.model;
        generation.output.adviceText = result.content;
        generation.status = 'succeeded';
        await consumeGenerationCredits(generation);
        await generation.save();
        return NextResponse.json({ success: true, advice: result.content, generationId: generation._id });
      } catch (error) {
        generation.status = 'failed';
        generation.errorMessage = error instanceof Error ? error.message : 'AI 建议生成失败';
        await releaseGenerationCredits(generation, generation.errorMessage).catch(() => undefined);
        await generation.save();
        throw error;
      }
    });
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'AI 建议生成失败' }, { status });
  }
}
