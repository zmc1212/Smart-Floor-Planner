import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { listActivePromptCategories } from '@/lib/ai/prompt-library-query';

export async function GET(req: Request) {
  try {
    return await withTenantRoute(req, {}, async () => {
      const data = await listActivePromptCategories();
      return NextResponse.json({ success: true, data });
    });
  } catch (error) {
    console.error('[AI Prompt Categories GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load prompt categories' }, { status: 500 });
  }
}
