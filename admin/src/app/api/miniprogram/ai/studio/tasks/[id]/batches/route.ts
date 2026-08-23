import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { ensureAiCreditAccount, serializeAiCreditAccount } from '@/lib/ai/credits';
import { preparePostgresCreationBatch } from '@/lib/ai/postgres-creation-service';
import {
  isMiniStudioContext,
  requireMiniStudioContext,
  serializeCreationTaskForMini,
} from '@/lib/ai/mini-ai-studio';
import {
  submitPostgresCreationGeneration,
} from '@/lib/ai/postgres-creation-runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const { id } = await params;
    const body = await request.json() as {
      prompt?: string;
      negativePrompt?: string;
      referenceAssetIds?: string[];
      modelProfileId?: string;
      aspectRatio?: string;
      resolutionTier?: '1K' | '2K' | '4K' | 'CUSTOM';
      width?: number;
      height?: number;
      size?: string;
      quality?: string;
      templateId?: string;
      count?: number;
      workflowId?: string;
      targetScope?: string;
      roomId?: string;
    };
    if (!body.modelProfileId) {
      return NextResponse.json({ success: false, error: '请选择模型' }, { status: 400 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const result = await preparePostgresCreationBatch({
      enterpriseId: enterpriseId.toString(),
      operatorId: context.operatorId,
      taskId: id,
      prompt: String(body.prompt || ''),
      negativePrompt: body.negativePrompt,
      referenceAssetIds: body.referenceAssetIds,
      modelProfileId: body.modelProfileId,
      parameters: {
        aspectRatio: body.aspectRatio,
        resolutionTier: body.resolutionTier,
        width: body.width,
        height: body.height,
        size: body.size,
        quality: body.quality,
      },
      templateId: body.templateId,
      count: body.count,
      workflowId: body.workflowId,
      targetScope: body.targetScope,
      roomId: body.roomId,
    });
    await Promise.allSettled(result.generations.map((generation) =>
      submitPostgresCreationGeneration({
        enterpriseId: enterpriseId.toString(),
        generationId: generation.id.toString(),
      }),
    ));
    const view = await withTenantTransaction(enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).loadTaskView(result.taskId),
    );
    if (!view) throw new Error('创作任务提交后无法读取');
    return NextResponse.json({
      success: true,
      data: {
        task: await serializeCreationTaskForMini(request, context.enterpriseId, view),
        account: serializeAiCreditAccount(await ensureAiCreditAccount(enterpriseId.toString())),
      },
    });
  } catch (error) {
    console.error('[Mini AI Studio Batch POST]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '生成任务提交失败' },
      { status },
    );
  }
}
