import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import type { AiWorkflowSourceAssetRole } from '@/lib/ai/workflow-stages';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  createPostgresAiWorkflow,
  listPostgresAiWorkflows,
} from '@/lib/ai/postgres-workflow-service';
import { serializeAiWorkflow } from '@/lib/ai/workflow-utils';

interface CreateWorkflowBody {
  leadId?: string;
  title?: string;
  workflowLabel?: string;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
}

export async function GET(req: Request) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const url = new URL(req.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const leadId = url.searchParams.get('leadId');
      const q = url.searchParams.get('q')?.trim();
      const requestedStatus = url.searchParams.get('status');
      const result = await listPostgresAiWorkflows({
        enterpriseId: context.enterpriseId!,
        leadId: leadId || undefined,
        query: q,
        status: requestedStatus === 'archived' ? 'archived' : 'active',
        page,
        limit,
      });
      return NextResponse.json({
        success: true,
        ...result,
      });
    });
  } catch (error) {
    console.error('[AI Workflows GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load workflows' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const body = (await req.json()) as CreateWorkflowBody;
      let workflow;
      try {
        workflow = await createPostgresAiWorkflow(
          {
            enterpriseId: context.enterpriseId!,
            operatorId: parsePostgresId(context.userId, 'userId'),
            leadId: body.leadId || '',
            title: body.title,
            workflowLabel: body.workflowLabel,
            sourceImage: body.sourceImage,
            sourceFloorPlanId: body.sourceFloorPlanId,
            sourceAssetRole: body.sourceAssetRole,
          }
        );
      } catch (error) {
        return NextResponse.json(
          { success: false, error: error instanceof Error ? error.message : 'Failed to create workflow' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: serializeAiWorkflow({ ...workflow, _id: workflow.id }),
      });
    });
  } catch (error) {
    console.error('[AI Workflows POST]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create workflow' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
