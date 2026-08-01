import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { listActivePromptTemplates } from '@/lib/ai/prompt-library-query';

export async function GET(req: Request) {
  try {
    return await withTenantRoute(req, {}, async () => {
      const url = new URL(req.url);
      const data = await listActivePromptTemplates({
        page: Number(url.searchParams.get('page') || 1),
        limit: Number(url.searchParams.get('limit') || 24),
        query: url.searchParams.get('q') || undefined,
        categorySourceId: url.searchParams.get('categorySourceId') || url.searchParams.get('categoryId') || undefined,
      });
      return NextResponse.json({ success: true, data });
    });
  } catch (error) {
    console.error('[AI Prompt Templates GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load prompt templates' }, { status: 500 });
  }
}
