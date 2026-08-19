import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { runPostgresWorkflowChatTurn } from '@/lib/ai/postgres-chat-turn-service';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

type ChatTurnBody = {
  message?: string;
  baselineGenerationId?: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: '方案对话不存在' }, { status: 404 });
      }
      const body = (await req.json()) as ChatTurnBody;
      const workflowContext = await runPostgresWorkflowChatTurn({
        enterpriseId: context.enterpriseId!,
        operatorId: context.userId,
        workflowId: id,
        message: body.message || '',
        baselineGenerationId: body.baselineGenerationId,
      });
      return NextResponse.json({ success: true, data: workflowContext });
    });
  } catch (error: unknown) {
    console.error('[AI Workflow Chat Turn]', error);
    const status = (error as Error & { status?: number }).status;
    const conflict = error as Error & { code?: string; generationId?: string };
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '出图失败',
        code: conflict.code,
        existingGenerationId: conflict.generationId,
      },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
