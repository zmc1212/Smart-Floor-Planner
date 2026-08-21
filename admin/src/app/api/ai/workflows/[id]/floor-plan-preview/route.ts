import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { getPostgresAiWorkflowFloorPlanPreview } from '@/lib/ai/postgres-workflow-service';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
      }
      const roomId = new URL(req.url).searchParams.get('roomId') || undefined;
      const buffer = await getPostgresAiWorkflowFloorPlanPreview({
        enterpriseId: context.enterpriseId!,
        workflowId: id,
        roomId,
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    });
  } catch (error) {
    console.error('[AI Workflow Floor Plan Preview GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '加载户型对照图失败' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
