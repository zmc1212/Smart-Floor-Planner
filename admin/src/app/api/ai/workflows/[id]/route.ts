import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import {
  createPostgresAiWorkflowManualGeneration,
  getPostgresAiWorkflowContext,
  updatePostgresAiWorkflowState,
} from '@/lib/ai/postgres-workflow-service';

type WorkflowPatchBody = {
  action?: 'select-generation' | 'set-stage' | 'rename' | 'mock-generation';
  generationId?: string;
  nextStageKey?: AiWorkflowStageKey;
  stageKey?: AiWorkflowStageKey;
  title?: string;
  imageUrl?: string;
  parentGenerationId?: string;
  sourceAssetRole?: string;
  styleReferenceImage?: string;
};

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }
      const workflowContext = await getPostgresAiWorkflowContext({
        enterpriseId: context.enterpriseId!,
        workflowId: id,
      });
      return NextResponse.json({ success: true, data: workflowContext });
    });
  } catch (error) {
    console.error('[AI Workflow GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load workflow detail' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }
      const body = (await req.json()) as WorkflowPatchBody;
      if (body.action === 'mock-generation') {
        if (!body.stageKey || !body.imageUrl) {
          return NextResponse.json({ success: false, error: 'Missing stageKey or imageUrl' }, { status: 400 });
        }
        await createPostgresAiWorkflowManualGeneration({
          enterpriseId: context.enterpriseId!,
          operatorId: context.userId,
          workflowId: id,
          stageKey: body.stageKey,
          imageUrl: body.imageUrl,
          parentGenerationId: body.parentGenerationId,
          sourceAssetRole: body.sourceAssetRole,
          styleReferenceImage: body.styleReferenceImage,
          nextStageKey: body.nextStageKey,
        });
      } else if (body.action === 'rename' || body.action === 'set-stage' || body.action === 'select-generation') {
        await updatePostgresAiWorkflowState({
          enterpriseId: context.enterpriseId!,
          workflowId: id,
          action: body.action,
          title: body.title,
          stageKey: body.stageKey,
          generationId: body.generationId,
        });
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
      }
      const workflowContext = await getPostgresAiWorkflowContext({
        enterpriseId: context.enterpriseId!,
        workflowId: id,
      });
      return NextResponse.json({ success: true, data: workflowContext });
    });
  } catch (error) {
    console.error('[AI Workflow PATCH]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, code: (error as { code?: string })?.code, error: error instanceof Error ? error.message : 'Failed to update workflow' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
