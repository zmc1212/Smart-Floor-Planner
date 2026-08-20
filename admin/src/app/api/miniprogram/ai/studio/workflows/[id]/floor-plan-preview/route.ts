import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { verifyMiniAiStudioFloorPlanPreviewSignature } from '@/lib/ai/mini-ai-assets';
import { getPostgresAiWorkflowFloorPlanPreview } from '@/lib/ai/postgres-workflow-service';
import {
  assertMiniStudioLeadAccess,
  isMiniStudioContext,
  requireMiniStudioContext,
} from '@/lib/ai/mini-ai-studio';
import { AiWorkflowRepository } from '@/db/repositories';

export const dynamic = 'force-dynamic';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isPostgresWorkflowId(id)) {
      return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
    }
    const url = new URL(request.url);
    const tenant = url.searchParams.get('tenant') || '';
    const expires = Number(url.searchParams.get('expires') || 0);
    const signature = url.searchParams.get('signature') || '';
    const signedAccess = Boolean(
      tenant
      && signature
      && verifyMiniAiStudioFloorPlanPreviewSignature({ workflowId: id, enterpriseId: tenant, expires, signature }),
    );
    let enterpriseId: string;
    let contextRole: string | null = null;
    let operatorId: string | null = null;
    if (signedAccess) {
      enterpriseId = tenant;
    } else {
      const context = await requireMiniStudioContext(request);
      if (!isMiniStudioContext(context)) return context;
      enterpriseId = context.enterpriseId;
      contextRole = context.role;
      operatorId = context.operatorId;
    }
    const workflow = await withTenantTransaction(
      parsePostgresId(enterpriseId, 'enterpriseId'),
      (transaction) => new AiWorkflowRepository(transaction).findById(parsePostgresId(id, 'workflowId')),
    );
    if (!workflow || workflow.status !== 'active') {
      return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
    }
    if (!signedAccess && contextRole && operatorId) {
      const access = await withTenantTransaction(parsePostgresId(enterpriseId, 'enterpriseId'), (transaction) =>
        assertMiniStudioLeadAccess(transaction, {
          enterpriseId,
          operatorId,
          username: '',
          role: contextRole!,
        }, workflow.leadId),
      );
      if (access.kind !== 'ok') return access.response;
    }
    const buffer = await getPostgresAiWorkflowFloorPlanPreview({ enterpriseId, workflowId: id });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Cache-Control': signedAccess ? 'private, max-age=1800' : 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Mini AI Studio Floor Plan Preview GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '加载户型对照图失败' },
      { status: status && status >= 400 ? status : 500 },
    );
  }
}
