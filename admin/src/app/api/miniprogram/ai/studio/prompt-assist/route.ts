import { NextResponse } from 'next/server';
import { executePostgresAdviceGeneration } from '@/lib/ai/postgres-advice-service';
import { isMiniStudioContext, requireMiniStudioContext } from '@/lib/ai/mini-ai-studio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const body = await request.json() as { prompt?: string; instruction?: string };
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return NextResponse.json({ success: false, error: '请输入需要优化的提示词' }, { status: 400 });
    const result = await executePostgresAdviceGeneration({
      enterpriseId: context.enterpriseId,
      operatorId: context.operatorId,
      generationInput: { style: 'prompt_assist', customPrompt: prompt },
      output: { promptUsed: prompt },
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
    return NextResponse.json({ success: true, data: { prompt: result.advice.trim() } });
  } catch (error) {
    console.error('[Mini AI Studio Prompt Assist POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '提示词优化失败' },
      { status: (error as { status?: number })?.status || 400 },
    );
  }
}
