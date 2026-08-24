import { NextResponse } from 'next/server';
import { SmsDeliveryLogRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

function dto(row: Record<string, unknown>) {
  const safe = { ...row };
  delete safe.phoneEncrypted;
  for (const key of ['id', 'enterpriseId', 'leadId', 'recipientStaffId']) {
    if (typeof safe[key] === 'bigint') safe[key] = String(safe[key]);
  }
  for (const key of ['createdAt', 'updatedAt', 'sentAt']) {
    if (safe[key] instanceof Date) safe[key] = (safe[key] as Date).toISOString();
  }
  return safe;
}

export async function GET(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!['super_admin', 'admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { page, limit } = getPaginationParams(request.url);
    const status = new URL(request.url).searchParams.get('status') || undefined;
    if (status && !['pending', 'sent', 'failed', 'skipped'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }
    const result = await withPlatformTransaction((transaction) =>
      new SmsDeliveryLogRepository(transaction).list({ page, limit, status })
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => dto(row as unknown as Record<string, unknown>)),
      pagination: createPaginationMetadata(result.total, page, limit),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取短信记录失败' }, { status: 400 });
  }
}
