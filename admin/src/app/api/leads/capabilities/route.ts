import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { getTenantContext } from '@/lib/auth';
import { canManageLeadArchive, canPurgeLeads } from '@/lib/lead-lifecycle';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export async function GET(request: Request) {
  const context = await getTenantContext(request);
  if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!context.enterpriseId) {
    return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
  }
  const actorId = parsePostgresId(context.userId, 'userId');
  const canArchive = await withAdminPostgresTransaction(context, (transaction) =>
    canManageLeadArchive(transaction, {
      role: context.role,
      actorId,
      enterpriseId: BigInt(context.enterpriseId!),
    })
  );
  return NextResponse.json({
    success: true,
    data: { canManageArchive: canArchive, canPurge: canPurgeLeads(context.role) },
  });
}
