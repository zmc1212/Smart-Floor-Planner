import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { getMiniAiRecipe } from '@/lib/ai/mini-ai-recipes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以查看装修配方' }, { status: 403 });
    }
    const { id } = await params;
    const recipe = await getMiniAiRecipe({ request, enterpriseId: context.enterpriseId, recipeId: id });
    if (!recipe) return NextResponse.json({ success: false, error: '装修配方不存在或已下架' }, { status: 404 });
    const data = Object.fromEntries(
      Object.entries(recipe).filter(([key]) => key !== 'internalPrompt')
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Mini AI Recipe Detail]', error);
    return NextResponse.json({ success: false, error: '装修配方加载失败' }, { status: 500 });
  }
}
