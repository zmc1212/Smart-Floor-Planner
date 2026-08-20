import { NextResponse } from 'next/server';
import { listActivePromptTemplates } from '@/lib/ai/prompt-library-query';
import {
  isMiniStudioContext,
  requireMiniStudioContext,
  serializePromptTemplatesForMini,
} from '@/lib/ai/mini-ai-studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const url = new URL(request.url);
    const data = await listActivePromptTemplates({
      page: Number(url.searchParams.get('page') || 1),
      limit: Number(url.searchParams.get('limit') || 24),
      query: url.searchParams.get('q') || undefined,
      categorySourceId: url.searchParams.get('categorySourceId') || url.searchParams.get('categoryId') || undefined,
    });
    return NextResponse.json({
      success: true,
      data: serializePromptTemplatesForMini(request, context.enterpriseId, data),
    });
  } catch (error) {
    console.error('[Mini AI Studio Prompt Templates GET]', error);
    return NextResponse.json({ success: false, error: '读取提示词模板失败' }, { status: 500 });
  }
}
