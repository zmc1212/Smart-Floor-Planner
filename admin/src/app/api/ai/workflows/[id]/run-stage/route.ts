import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { getAiWorkflowContext, runAiWorkflowStage } from '@/lib/ai/workflow-service';
import { getWorkflowStageDefinition, type AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import {
  getPostgresAiWorkflowContext,
  preparePostgresAiWorkflowStage,
} from '@/lib/ai/postgres-workflow-service';
import { submitPostgresCreationGeneration } from '@/lib/ai/postgres-creation-runtime';

type RunStageBody = {
  stageKey?: AiWorkflowStageKey;
  styleReferenceImage?: string;
  confirmed?: boolean;
};

function toTenantContext(context: NonNullable<Awaited<ReturnType<typeof getTenantContext>>>): TenantContext {
  return {
    userId: context.userId,
    enterpriseId: context.enterpriseId || '',
    role: context.role,
    username: context.username,
  };
}

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await getTenantContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!context.enterpriseId) {
      return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
    }

    const { id } = await params;
    const body = (await req.json()) as RunStageBody;

    if (!body.stageKey) {
      return NextResponse.json({ success: false, error: 'Missing stageKey' }, { status: 400 });
    }

    if (isPostgresWorkflowId(id)) {
      if (body.confirmed === false) {
        const stage = getWorkflowStageDefinition(body.stageKey);
        return NextResponse.json({
          success: true,
          data: {
            requiresConfirmation: true,
            message: `执行“${stage?.name || body.stageKey}”会消耗企业 AI 额度并生成新产物，请确认后再执行。`,
          },
        });
      }
      const generation = await preparePostgresAiWorkflowStage({
        enterpriseId: context.enterpriseId,
        operatorId: context.userId,
        workflowId: id,
        stageKey: body.stageKey,
        styleReferenceImage: body.styleReferenceImage,
      });
      await submitPostgresCreationGeneration({
        enterpriseId: context.enterpriseId,
        generationId: generation.id.toString(),
      });
      const workflowContext = await getPostgresAiWorkflowContext({
        enterpriseId: context.enterpriseId,
        workflowId: id,
      });
      return NextResponse.json({ success: true, data: workflowContext });
    }

    await dbConnect();

    await runAiWorkflowStage(
      {
        workflowId: id,
        stageKey: body.stageKey,
        styleReferenceImage: body.styleReferenceImage,
        confirmed: body.confirmed !== false,
      },
      toTenantContext(context)
    );

    const workflowContext = await getAiWorkflowContext(id, toTenantContext(context));

    return NextResponse.json({
      success: true,
      data: workflowContext,
    });
  } catch (error: unknown) {
    console.error('[AI Workflow Run Stage]', error);
    const status = (error as Error & { status?: number })?.status;
    const conflict = error as Error & { code?: string; generationId?: string };
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run workflow stage',
        code: conflict.code,
        existingGenerationId: conflict.generationId,
      },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
