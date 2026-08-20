import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { ensureAiCreditAccount, serializeAiCreditAccount } from '@/lib/ai/credits';
import { preparePostgresCreationBatchRetry } from '@/lib/ai/postgres-creation-service';
import {
  isMiniStudioContext,
  requireMiniStudioContext,
  serializeCreationTaskForMini,
} from '@/lib/ai/mini-ai-studio';
import {
  submitPostgresCreationGeneration,
} from '@/lib/ai/postgres-creation-runtime';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const { id, batchId } = await params;
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const result = await preparePostgresCreationBatchRetry({
      enterpriseId: enterpriseId.toString(),
      taskId: id,
      batchId,
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
    if (!view) throw new Error('当前轮重试后无法读取创作任务');
    return NextResponse.json({
      success: true,
      data: {
        task: serializeCreationTaskForMini(request, context.enterpriseId, view),
        account: serializeAiCreditAccount(await ensureAiCreditAccount(enterpriseId.toString())),
        retriedCount: result.generations.length,
      },
    });
  } catch (error) {
    console.error('[Mini AI Studio Batch Retry POST]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '当前轮重试失败' },
      { status },
    );
  }
}
