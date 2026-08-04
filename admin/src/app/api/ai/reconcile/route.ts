import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { reconcileDueAiGenerations } from '@/lib/ai/execution-service';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

async function run(limit: number) {
  const [results, postgresqlClaimed] = await Promise.all([
    reconcileDueAiGenerations(limit),
    reconcilePostgresCreationTasks(undefined, limit),
  ]);
  return NextResponse.json({
    success: true,
    data: results.map((item) => ({ id: String(item._id), status: item.status })),
    postgresqlClaimed,
  });
}

export async function POST(request: Request) {
  try {
    await dbConnect();
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
