import { NextResponse } from 'next/server';
import { COMMISSION_ROLES, LeadCommissionRepository, type CommissionRole } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
        const role = new URL(request.url).searchParams.get('role') || '';
        if (!(COMMISSION_ROLES as readonly string[]).includes(role)) {
          return NextResponse.json({ success: false, error: '提成角色无效' }, { status: 400 });
        }
        const rows = await withTenantTransaction(enterpriseId, (transaction) =>
          new LeadCommissionRepository(transaction).listEligibleBeneficiaries(
            enterpriseId,
            role as CommissionRole
          )
        );
        return NextResponse.json({
          success: true,
          data: rows.map((row) => ({
            userId: row.userId.toString(),
            displayName: row.displayName,
            phone: row.phone,
          })),
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '读取可选受益人失败',
      },
      { status: httpErrorStatus(error, 400) }
    );
  }
}
