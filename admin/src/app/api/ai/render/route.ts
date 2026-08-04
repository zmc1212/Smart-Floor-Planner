import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  getPostgresDirectGenerationImageUrl,
  renderPostgresDirectGeneration,
} from '@/lib/ai/postgres-direct-generation-service';

function parseUpstreamStatus(error: unknown) {
  const maybe = error as Error & { status?: number };
  return maybe?.status || 500;
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json() as {
        generationId?: string;
        image?: string;
        prompt?: string;
        negativePrompt?: string;
      };
      if (!body.generationId) {
        return NextResponse.json({ success: false, error: 'Missing generationId' }, { status: 400 });
      }

      try {
        const generation = await renderPostgresDirectGeneration({
          enterpriseId: String(context.enterpriseId),
          generationId: body.generationId,
          image: body.image,
          prompt: body.prompt,
          negativePrompt: body.negativePrompt,
        });
        return NextResponse.json({
          success: true,
          data: {
            id: generation.id.toString(),
            status: generation.status,
            imageUrl: getPostgresDirectGenerationImageUrl(generation),
          },
        });
      } catch (error) {
        const status = parseUpstreamStatus(error);
        const message = status === 402
          ? '当前企业 AI 点数不足，请联系平台管理员调整。'
          : error instanceof Error ? error.message : '图片生成失败';
        return NextResponse.json({ success: false, error: message }, { status: status >= 400 ? status : 500 });
      }
    });
  } catch (error) {
    console.error('[AI Render Server Error]', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
