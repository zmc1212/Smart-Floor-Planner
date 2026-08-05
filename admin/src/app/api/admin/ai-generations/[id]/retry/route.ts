import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import { retryMiniAiTask } from '@/lib/ai/mini-ai-tasks';
import { retryPostgresMiniAiTaskForAdmin } from '@/lib/ai/postgres-mini-ai-tasks';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      if (isPostgresId(id)) {
        if (!context.enterpriseId) {
          return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
        }
        const generation = await retryPostgresMiniAiTaskForAdmin(id, context.enterpriseId);
        if (!generation) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
        return NextResponse.json({ success: true });
      }

      await dbConnect();
      const generation = await AiGeneration.findOne({ _id: id, channel: 'miniprogram' });
      if (!generation) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
      const legacyEnterpriseId = generation.enterpriseId;
      if (!(legacyEnterpriseId instanceof mongoose.Types.ObjectId)) {
        return NextResponse.json({ success: false, error: '该历史任务不支持通过小程序重试' }, { status: 409 });
      }
      await retryMiniAiTask(generation, {
        enterpriseId: legacyEnterpriseId.toString(),
        operatorId: context.userId,
        username: context.username,
        role: context.role,
      });
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error('[Admin Mini AI Retry]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '任务重试失败' },
      { status }
    );
  }
}
