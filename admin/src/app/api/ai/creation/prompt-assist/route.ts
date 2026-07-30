import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import {
  consumeGenerationCredits,
  ensureGenerationCreditHold,
  executeAiChat,
  releaseGenerationCredits,
} from '@/lib/ai/execution-service';

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json() as { prompt?: string; instruction?: string };
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return NextResponse.json({ success: false, error: '请输入需要优化的提示词' }, { status: 400 });
      const generation = await AiGeneration.create({
        enterpriseId: String(context.enterpriseId),
        operatorId: context.userId,
        type: 'advice',
        actionKey: 'text.design_advice',
        capability: 'chat',
        logicalModelKey: 'chat.general',
        status: 'processing',
        input: { style: 'prompt_assist', customPrompt: prompt },
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
            {
              role: 'system',
              content: 'You optimize Chinese image-generation prompts for architecture and interior design. Preserve the user intent, add concrete spatial, material, lighting, composition and camera details, remove vague filler, and return only one polished Chinese prompt without Markdown.',
            },
            {
              role: 'user',
              content: `${body.instruction ? `Optimization focus: ${String(body.instruction).trim()}\n` : ''}Original prompt: ${prompt}`,
            },
          ],
          temperature: 0.55,
          maxTokens: 900,
        });
        generation.output.adviceText = result.content.trim();
        generation.output.promptUsed = prompt;
        generation.provider = result.provider;
        generation.remoteModel = result.model;
        generation.status = 'succeeded';
        await consumeGenerationCredits(generation);
        await generation.save();
        return NextResponse.json({ success: true, data: { prompt: generation.output.adviceText } });
      } catch (error) {
        generation.status = 'failed';
        generation.errorMessage = error instanceof Error ? error.message : '提示词优化失败';
        await releaseGenerationCredits(generation, generation.errorMessage).catch(() => undefined);
        await generation.save();
        throw error;
      }
    });
  } catch (error) {
    console.error('[AI Creation Prompt Assist]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '提示词优化失败' },
      { status: (error as { status?: number })?.status || 400 }
    );
  }
}
