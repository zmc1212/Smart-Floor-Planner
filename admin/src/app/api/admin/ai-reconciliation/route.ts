import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json().catch(() => ({}));
      const limit = Number(body.limit || 20);
      const postgresqlClaimed = await reconcilePostgresCreationTasks(undefined, limit);
      return NextResponse.json({
        success: true,
        postgresqlClaimed,
      });
    });
  } catch (error) {
    console.error('[AI Reconciliation]', error);
    return NextResponse.json({ success: false, error: 'AI 任务对账失败' }, { status: 500 });
  }
}
