import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { parseImageDataUri } from '@/lib/ai/postgres-media-assets';
import { getPostgresAiWorkflowSourceImage } from '@/lib/ai/postgres-workflow-service';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: 'Workflow source image not found' }, { status: 404 });
      }
      const sourceImage = await getPostgresAiWorkflowSourceImage({ enterpriseId: context.enterpriseId!, workflowId: id });
      const parsed = parseImageDataUri(sourceImage);
      return new NextResponse(new Uint8Array(parsed.buffer), {
        headers: {
          'Content-Type': parsed.mimeType,
          'Content-Length': String(parsed.buffer.length),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    });
  } catch (error) {
    console.error('[AI Workflow Source Image GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load workflow source image' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
