import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureDefaultAiStylePresets } from '@/lib/ai/presets';
import {
  preparePostgresDirectGeneration,
  type PostgresDirectGenerationInput,
} from '@/lib/ai/postgres-direct-generation-service';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      await ensureDefaultAiStylePresets(String(context.userId));
      const body = await request.json() as Partial<PostgresDirectGenerationInput>;
      if (!body.type || !body.style) {
        return NextResponse.json(
          { success: false, error: 'Missing required params: type / style' },
          { status: 400 }
        );
      }

      const result = await preparePostgresDirectGeneration({
        enterpriseId: String(context.enterpriseId),
        operatorId: String(context.userId),
        generation: body as PostgresDirectGenerationInput,
      });
      return NextResponse.json({
        success: true,
        data: {
          id: result.generation.id.toString(),
          prompt: result.prompt,
          negativePrompt: result.negativePrompt,
          type: result.generation.type,
          style: body.style,
          presetType: result.presetType,
          workflowId: result.workflowId,
          leadId: result.leadId,
          stageKey: result.stageKey,
          nextRecommendedStage: result.nextRecommendedStage,
        },
      });
    });
  } catch (error) {
    console.error('[AI Generate]', error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务端内部错误' },
      { status: status >= 400 ? status : 500 }
    );
  }
}
