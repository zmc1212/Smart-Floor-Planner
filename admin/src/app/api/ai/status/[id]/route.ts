import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { getTenantContext } from '@/lib/auth';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';
import { reconcileAiGeneration } from '@/lib/ai/execution-service';
import { syncSuccessfulGenerationToWorkflow } from '@/lib/ai/workflow-baseline';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const ctx = await getTenantContext(req);
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const generation = await AiGeneration.findById(id);

    if (!generation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (generation.enterpriseId.toString() !== ctx.enterpriseId?.toString()) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const current = generation.status === 'processing'
      ? await reconcileAiGeneration(generation)
      : generation;
    if (current.status === 'succeeded' && current.workflowId) {
      await syncSuccessfulGenerationToWorkflow(current);
    }
    const progress =
      current.status === 'succeeded'
        ? 100
        : current.status === 'failed'
          ? 100
          : current.status === 'processing'
            ? 65
            : 0;
    const stageDefinition = getWorkflowStageDefinition(current.stageKey);

    return NextResponse.json({
      success: true,
      data: {
        id: current._id,
        leadId: current.leadId,
        workflowId: current.workflowId,
        parentGenerationId: current.parentGenerationId,
        type: current.type,
        stageKey: current.stageKey,
        stageLabel: stageDefinition?.name,
        sourceAssetRole: current.sourceAssetRole,
        isSelectedBaseline: current.isSelectedBaseline,
        nextRecommendedStage: current.nextRecommendedStage,
        status: current.status,
        progress,
        imageUrl: current.output?.imageUrl,
        error: current.errorMessage,
        duration: current.durationMs,
        input: current.input,
        createdAt: current.createdAt,
        provider: current.provider,
        externalStatus: current.externalTask?.status,
        floorPlanId: current.floorPlanId,
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
