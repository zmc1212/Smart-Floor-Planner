import { NextResponse } from 'next/server';
import { LeadCommissionRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

type AdjustBody = {
  payableAmount?: unknown;
  beneficiaryUserId?: unknown;
  reason?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const { id } = await params;
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
        const actorId = parsePostgresId(context.userId, 'actor id');
        const commissionId = parsePostgresId(id, 'commission id');
        const body = (await request.json()) as AdjustBody;

        let reason: string | undefined;
        if (body.reason !== undefined && body.reason !== null) {
          if (typeof body.reason !== 'string') {
            return NextResponse.json({ success: false, error: '调整原因格式无效' }, { status: 400 });
          }
          reason = body.reason;
        }

        let payableAmount: string | undefined;
        if (body.payableAmount !== undefined) {
          if (typeof body.payableAmount !== 'string' && typeof body.payableAmount !== 'number') {
            return NextResponse.json({ success: false, error: '应付金额格式无效' }, { status: 400 });
          }
          payableAmount = String(body.payableAmount);
        }

        let beneficiaryUserId: bigint | undefined;
        if (body.beneficiaryUserId !== undefined && body.beneficiaryUserId !== null && body.beneficiaryUserId !== '') {
          beneficiaryUserId = parsePostgresId(body.beneficiaryUserId, 'beneficiary user id');
        }

        const row = await withTenantTransaction(enterpriseId, (transaction) =>
          new LeadCommissionRepository(transaction).adjustPayable(enterpriseId, commissionId, actorId, {
            payableAmount,
            beneficiaryUserId,
            reason,
          })
        );

        return NextResponse.json({
          success: true,
          data: {
            id: row.id.toString(),
            role: row.role,
            beneficiaryUserId: row.beneficiaryUserId.toString(),
            payableAmount: row.payableAmount,
            originalPayableAmount: row.originalPayableAmount,
            originalBeneficiaryUserId: row.originalBeneficiaryUserId.toString(),
            adjustedAt: row.adjustedAt,
            adjustedBy: row.adjustedBy?.toString() ?? null,
            adjustReason: row.adjustReason,
            status: row.status,
            updatedAt: row.updatedAt,
          },
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '调整提成失败',
      },
      { status: httpErrorStatus(error, 400) }
    );
  }
}
