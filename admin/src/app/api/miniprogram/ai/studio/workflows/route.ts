import { NextResponse } from 'next/server';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import {
  assertMiniStudioLeadAccess,
  isMiniStudioContext,
  requireMiniStudioContext,
} from '@/lib/ai/mini-ai-studio';
import {
  createPostgresAiWorkflow,
  listPostgresAiWorkflows,
} from '@/lib/ai/postgres-workflow-service';
import { serializeAiWorkflow } from '@/lib/ai/workflow-utils';

export const dynamic = 'force-dynamic';

interface CreateWorkflowBody {
  leadId?: string;
  title?: string;
  workflowLabel?: string;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  currentStageKey?: AiWorkflowStageKey;
}

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const leadId = url.searchParams.get('leadId') || undefined;
    const q = url.searchParams.get('q')?.trim();
    if (leadId) {
      const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
      const access = await withTenantTransaction(enterpriseId, (transaction) =>
        assertMiniStudioLeadAccess(transaction, context, parsePostgresId(leadId, 'leadId')),
      );
      if (access.kind !== 'ok') return access.response;
    }
    const result = await listPostgresAiWorkflows({
      enterpriseId: context.enterpriseId,
      leadId,
      query: q,
      status: 'active',
      page,
      limit,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Mini AI Studio Workflows GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取方案列表失败' },
      { status: status && status >= 400 ? status : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const body = (await request.json()) as CreateWorkflowBody;
    if (!body.leadId) {
      return NextResponse.json({ success: false, error: '请选择客户线索' }, { status: 400 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const access = await withTenantTransaction(enterpriseId, (transaction) =>
      assertMiniStudioLeadAccess(transaction, context, parsePostgresId(body.leadId!, 'leadId')),
    );
    if (access.kind !== 'ok') return access.response;
    let workflow;
    try {
      workflow = await createPostgresAiWorkflow({
        enterpriseId: context.enterpriseId,
        operatorId: parsePostgresId(context.operatorId, 'operatorId'),
        leadId: body.leadId,
        title: body.title,
        workflowLabel: body.workflowLabel,
        sourceImage: body.sourceImage,
        sourceFloorPlanId: body.sourceFloorPlanId,
        sourceAssetRole: body.sourceAssetRole,
        currentStageKey: body.currentStageKey,
      });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          code: (error as { code?: string }).code,
          error: error instanceof Error ? error.message : '创建方案失败',
        },
        { status: (error as { status?: number }).status || 400 },
      );
    }
    return NextResponse.json({
      success: true,
      data: serializeAiWorkflow({ ...workflow, _id: workflow.id }),
    });
  } catch (error) {
    console.error('[Mini AI Studio Workflows POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建方案失败' },
      { status: 500 },
    );
  }
}
