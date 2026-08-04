import { NextResponse } from 'next/server';
import { parseOptionalPostgresId, parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

const LEGACY_HISTORY_TYPE_FILTERS: Record<string, { types: string[]; stageKeys?: string[] }> = {
  floor_plan_style: {
    types: ['scenario'],
    stageKeys: ['direction', 'base_render', 'perspective_upgrade'],
  },
  furnishing_render: {
    types: ['scenario'],
    stageKeys: ['base_render', 'perspective_upgrade'],
  },
  soft_furnishing_render: {
    types: ['scenario'],
    stageKeys: ['soft_furnishing'],
  },
};

function serializeHistoryGeneration(generation: Awaited<ReturnType<AiCreationRepository['listHistory']>>['rows'][number]) {
  return {
    _id: generation.id.toString(),
    enterpriseId: generation.enterpriseId.toString(),
    operatorId: generation.operatorId.toString(),
    floorPlanId: generation.floorPlanId?.toString(),
    leadId: generation.leadId?.toString(),
    workflowId: generation.workflowId?.toString(),
    parentGenerationId: generation.parentGenerationId?.toString(),
    type: generation.type,
    channel: generation.channel,
    stageKey: generation.stageKey,
    sourceAssetRole: generation.sourceAssetRole,
    isSelectedBaseline: generation.isSelectedBaseline,
    nextRecommendedStage: generation.nextRecommendedStage,
    input: generation.input,
    output: generation.output,
    status: generation.status,
    provider: generation.provider,
    errorMessage: generation.errorMessage,
    errorCode: generation.errorCode,
    durationMs: generation.durationMs,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
  };
}

export async function GET(req: Request) {
  try {
    return await withTenantRoute(
      req,
      { requireEnterprise: true },
      async (context) => {
        const { searchParams } = new URL(req.url);
        const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
        const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20));
        const type = searchParams.get('type');
        const legacyFilter = type ? LEGACY_HISTORY_TYPE_FILTERS[type] : undefined;
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
        const result = await withTenantTransaction(enterpriseId, (transaction) =>
          new AiCreationRepository(transaction).listHistory({
            page,
            limit,
            types: legacyFilter?.types ?? (type ? [type] : undefined),
            stageKeys: legacyFilter?.stageKeys,
            workflowId: parseOptionalPostgresId(searchParams.get('workflowId'), 'workflowId') ?? undefined,
            leadId: parseOptionalPostgresId(searchParams.get('leadId'), 'leadId') ?? undefined,
          })
        );

        return NextResponse.json({
          success: true,
          data: result.rows.map(serializeHistoryGeneration),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: Math.ceil(result.total / result.limit),
          },
        });
      }
    );
  } catch (error) {
    console.error('[AI History GET]', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
