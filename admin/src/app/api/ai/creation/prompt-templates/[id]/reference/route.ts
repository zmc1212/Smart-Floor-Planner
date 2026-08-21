import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { cloneActivePromptTemplateCover } from '@/lib/ai/prompt-template-cover';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const data = await cloneActivePromptTemplateCover({
        enterpriseId: context.enterpriseId!,
        templateId: id,
      });
      return NextResponse.json({ success: true, data });
    });
  } catch (error) {
    console.error('[AI Prompt Template Cover Clone POST]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '模板参考图添加失败' },
      { status: status && status >= 400 ? status : 500 },
    );
  }
}
