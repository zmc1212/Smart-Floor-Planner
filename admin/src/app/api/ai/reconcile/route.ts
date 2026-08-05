import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

async function run(limit: number) {
  const postgresqlClaimed = await reconcilePostgresCreationTasks(undefined, limit);
  return NextResponse.json({
    success: true,
    postgresqlClaimed,
  });
}

export async function POST(request: Request) {
  try {
    const configuredSecret = process.env.AI_RECONCILIATION_SECRET?.trim();
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 20), 100));
    if (configuredSecret && bearer === configuredSecret) return run(limit);
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, () => run(limit));
  } catch (error) {
    console.error('[AI Reconcile]', error);
    return NextResponse.json({ success: false, error: 'AI 任务对账失败' }, { status: 500 });
  }
}
