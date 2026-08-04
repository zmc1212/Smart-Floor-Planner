import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { reconcileDueAiGenerations } from '@/lib/ai/execution-service';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json().catch(() => ({}));
      const limit = Number(body.limit || 20);
      const [results, postgresqlClaimed] = await Promise.all([
        reconcileDueAiGenerations(limit),
        reconcilePostgresCreationTasks(undefined, limit),
      ]);
      return NextResponse.json({
        success: true,
        data: results.map((item) => ({ id: String(item._id), status: item.status, externalTask: item.externalTask })),
        postgresqlClaimed,
      });
    });
  } catch (error) {
    console.error('[AI Reconciliation]', error);
    return NextResponse.json({ success: false, error: 'AI 任务对账失败' }, { status: 500 });
  }
}
