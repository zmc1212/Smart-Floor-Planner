import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { getAiWorkflowContext, runAiWorkflowStage } from '@/lib/ai/workflow-service';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await dbConnect();

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
