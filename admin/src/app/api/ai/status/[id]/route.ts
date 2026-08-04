import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { AiGeneration } from '@/models/AiGeneration';
import { getTenantContext } from '@/lib/auth';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';
import { reconcileAiGeneration } from '@/lib/ai/execution-service';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';
import { syncSuccessfulGenerationToWorkflow } from '@/lib/ai/workflow-baseline';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function generationProgress(status: string) {
  if (status === 'succeeded' || status === 'failed') return 100;
  return status === 'processing' ? 65 : 0;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantContext(req);
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (isPostgresId(id)) {
      if (!ctx.enterpriseId || !isPostgresId(String(ctx.enterpriseId))) {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      }
      const enterpriseId = parsePostgresId(ctx.enterpriseId, 'enterpriseId');
      await reconcilePostgresCreationTasks(enterpriseId.toString(), 1).catch((error) =>
        console.error('[AI Status PostgreSQL Reconcile]', error)
      );
      const generation = await withTenantTransaction(enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).findGeneration(parsePostgresId(id, 'generationId'))
      );
      if (!generation || generation.deletedAt) {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      }

      const stageDefinition = getWorkflowStageDefinition(generation.stageKey);
      const output = asRecord(generation.output);
      const externalTask = asRecord(generation.externalTask);
      return NextResponse.json({
        success: true,
        data: {
          id: generation.id.toString(),
          leadId: generation.leadId?.toString(),
          workflowId: generation.workflowId?.toString(),
          parentGenerationId: generation.parentGenerationId?.toString(),
          type: generation.type,
          stageKey: generation.stageKey,
          stageLabel: stageDefinition?.name,
          sourceAssetRole: generation.sourceAssetRole,
          isSelectedBaseline: generation.isSelectedBaseline,
          nextRecommendedStage: generation.nextRecommendedStage,
          status: generation.status,
          progress: generationProgress(generation.status),
          imageUrl: typeof output.imageUrl === 'string' && output.imageUrl
            ? `/api/ai/generations/${generation.id.toString()}/image`
            : undefined,
          error: generation.errorMessage,
          duration: generation.durationMs,
          input: generation.input,
          createdAt: generation.createdAt,
          provider: generation.provider,
          externalStatus: externalTask.status,
          floorPlanId: generation.floorPlanId?.toString(),
        },
      });
    }

    await dbConnect();
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
