import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository } from '@/db/repositories/lead-lifecycle-repository';
import { requireMiniProgramPortalMode } from '@/lib/miniprogram-portal-authority';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    requireMiniProgramPortalMode(context, 'referrer');
    const body = await request.json().catch(() => ({}));
    const key = request.headers.get('Idempotency-Key') || body.idempotencyKey || '';
    if (typeof key !== 'string' || key.length < 8 || key.length > 160) return NextResponse.json({ success: false, code: 'idempotency_key_invalid', error: '请重试该操作' }, { status: 400 });
    const result = await withMiniProgramPostgresTransaction(context, (transaction) => new LeadLifecycleRepository(transaction).restoreReferrerWithdrawal({ leadId: parsePostgresId(body.leadId, 'lead id'), userId: parsePostgresId(context.user._id, 'user id'), membershipId: parsePostgresId(context.referrerMembershipId!, 'membership id') }));
    return NextResponse.json({ success: true, data: { leadId: result?.id.toString(), status: result?.status, terminationType: null } });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '撤回撤销失败' }, { status });
  }
}
