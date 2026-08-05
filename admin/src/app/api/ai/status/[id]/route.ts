import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

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

    if (!isPostgresId(id) || !ctx.enterpriseId || !isPostgresId(String(ctx.enterpriseId))) {
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
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
