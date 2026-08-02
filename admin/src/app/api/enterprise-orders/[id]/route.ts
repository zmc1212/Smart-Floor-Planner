import { NextResponse } from 'next/server';
import { enterpriseOrderToDto, parsePostgresId } from '@/db/postgres-dto';
import { CommercialRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { syncCommissionForPostgresOrder } from '@/lib/postgres-commercial-workflow';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const b2b = getPlatformB2BTenantContext(context);
    return await withAdminPostgresTransaction(b2b, async (transaction) => {
      const body = await request.json();
      const { id } = await params;

      const repository = new CommercialRepository(transaction);
      const currentOrder = await repository.findOrderById(parsePostgresId(id, 'order id'));
      if (!currentOrder) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
      }

      // If order is already paid, prevent changing its status back
      if (currentOrder.status === 'paid' && body.status !== undefined && body.status !== 'paid') {
        return NextResponse.json({ success: false, error: '已支付的订单不能修改状态' }, { status: 400 });
      }

      const updateData: Record<string, unknown> = {};
      if (body.packageName !== undefined) updateData.packageName = body.packageName.trim();
      if (body.amount !== undefined) updateData.amount = Number(body.amount);
      if (body.remark !== undefined) updateData.remark = body.remark.trim();
      if (body.status !== undefined) {
        updateData.status = body.status;
        updateData.paidAt = body.status === 'paid' ? new Date() : undefined;
      }

      const order = await repository.updateOrder(parsePostgresId(id, 'order id'), updateData);
      if (!order) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
      }

      await syncCommissionForPostgresOrder(transaction, order, parsePostgresId(context.userId, 'userId'));
      return NextResponse.json({ success: true, data: enterpriseOrderToDto(order) });
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
