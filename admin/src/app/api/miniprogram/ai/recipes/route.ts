import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { listMiniAiRecipes } from '@/lib/ai/mini-ai-recipes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以查看装修配方' }, { status: 403 });
    }
    const url = new URL(request.url);
    const data = await listMiniAiRecipes({
      request,
      enterpriseId: context.enterpriseId,
      page: Number(url.searchParams.get('page') || 1),
      limit: Number(url.searchParams.get('limit') || 24),
      query: url.searchParams.get('q') || undefined,
      categoryId: url.searchParams.get('categoryId') || undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Mini AI Recipes]', error);
    return NextResponse.json({ success: false, error: '装修配方加载失败' }, { status: 500 });
  }
}
