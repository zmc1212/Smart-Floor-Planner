import { NextResponse } from 'next/server';
import { listActivePromptCategories } from '@/lib/ai/prompt-library-query';
import { isMiniStudioContext, requireMiniStudioContext } from '@/lib/ai/mini-ai-studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const data = await listActivePromptCategories();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Mini AI Studio Prompt Categories GET]', error);
    return NextResponse.json({ success: false, error: '读取提示词分类失败' }, { status: 500 });
  }
}
