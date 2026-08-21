import { NextResponse } from 'next/server';
import { promotionRecordToDto } from '@/db/postgres-dto';
import { PromotionRecordRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getPlatformB2BTenantContext } from '@/lib/auth';
import { withTenantRoute } from '@/lib/tenant-route';
import { promotionActorFromContext, updatePromotionRecord } from '@/lib/postgres-promotion-workflow';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'admin', 'super_admin'], requireEnterprise: true },
      async (context) => {
        const b2bContext = getPlatformB2BTenantContext(context);
        const result = await withAdminPostgresTransaction(b2bContext, (transaction) =>
          new PromotionRecordRepository(transaction).list({
            ownershipStatus: 'conflict_pending',
            limit: 200,
          })
        );
        return NextResponse.json({
          success: true,
          data: result.rows.map(promotionRecordToDto),
          pagination: { total: result.total },
        });
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'admin', 'super_admin'], requireEnterprise: true },
      async (context) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (!body.recordId || !body.promoterId) {
          return NextResponse.json(
            { success: false, error: 'recordId and promoterId are required' },
            { status: 400 }
          );
        }
        const b2bContext = getPlatformB2BTenantContext(context);
        const actor = promotionActorFromContext({
          id: b2bContext.userId,
          role: b2bContext.role,
          name: b2bContext.username,
          enterpriseId: b2bContext.enterpriseId,
        });
        const result = await withAdminPostgresTransaction(b2bContext, (transaction) =>
          updatePromotionRecord(transaction, body.recordId, {
            ...body,
            ownershipStatus: 'manually_locked',
          }, actor)
        );
        if (!result) {
          return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, data: promotionRecordToDto(result.record) });
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
