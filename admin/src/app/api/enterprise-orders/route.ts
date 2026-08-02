import { NextResponse } from 'next/server';
import { enterpriseOrderToDto, parsePostgresId } from '@/db/postgres-dto';
import { CommercialRepository, PromotionRecordRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { syncCommissionForPostgresOrder } from '@/lib/postgres-commercial-workflow';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;
      const orders = await withMiniProgramPostgresTransaction(mpContext, (transaction) =>
        new CommercialRepository(transaction).listOrders({
          promoterId: staff.role === 'salesperson' ? parsePostgresId(staff._id, 'staff id') : undefined,
          enterpriseId: staff.role === 'salesperson' ? undefined : staff.enterpriseId ? parsePostgresId(staff.enterpriseId, 'enterprise id') : null,
        })
      );
      return NextResponse.json({ success: true, data: orders.map(enterpriseOrderToDto) });
    }
    const context = await getTenantContext(request);
    if (!context) throw new Error('Unauthorized');
    const b2b = getPlatformB2BTenantContext(context);
    const orders = await withAdminPostgresTransaction(b2b, (transaction) =>
      new CommercialRepository(transaction).listOrders({
        promoterId: b2b.role === 'salesperson' ? parsePostgresId(b2b.userId, 'userId') : undefined,
        enterpriseId: b2b.role === 'enterprise_admin' ? parsePostgresId(b2b.enterpriseId, 'enterpriseId') : undefined,
      })
    );
    return NextResponse.json({ success: true, data: orders.map(enterpriseOrderToDto) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) throw new Error('Unauthorized');
    const b2b = getPlatformB2BTenantContext(context);
    return await withAdminPostgresTransaction(b2b, async (transaction) => {
      const context = b2b;
      if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      const body = await request.json();
      if (!body.recordId || !body.packageName || body.amount === undefined) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }

      const record = await new PromotionRecordRepository(transaction).findById(parsePostgresId(body.recordId, 'recordId'));
      if (!record) {
        return NextResponse.json({ success: false, error: 'Promotion record not found' }, { status: 404 });
      }

      const order = await new CommercialRepository(transaction).createOrder({
        recordId: record.id,
        enterpriseId: record.enterpriseId,
        enterpriseNameSnapshot: record.enterpriseName,
        packageName: body.packageName.trim(),
        amount: String(Number(body.amount)),
        currency: 'CNY',
        status: body.status || 'draft',
        paidAt: body.status === 'paid' ? new Date() : undefined,
        createdBy: parsePostgresId(context.userId, 'userId'),
        remark: body.remark?.trim() || '',
      });

      await syncCommissionForPostgresOrder(transaction, order, parsePostgresId(context.userId, 'userId'));
      return NextResponse.json({ success: true, data: enterpriseOrderToDto(order) }, { status: 201 });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
