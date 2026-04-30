import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { EnterpriseOrder } from '@/models/EnterpriseOrder';
import { syncCommissionForOrder } from '@/lib/promotion-workflow';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    return await withTenantContext(request, async () => {
      const body = await request.json();
      const { id } = await params;

      const updateData: Record<string, unknown> = {};
      if (body.packageName !== undefined) updateData.packageName = body.packageName.trim();
      if (body.amount !== undefined) updateData.amount = Number(body.amount);
      if (body.remark !== undefined) updateData.remark = body.remark.trim();
      if (body.status !== undefined) {
        updateData.status = body.status;
        updateData.paidAt = body.status === 'paid' ? new Date() : undefined;
      }

      const order = await EnterpriseOrder.findByIdAndUpdate(id, { $set: updateData }, { new: true });
      if (!order) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
      }

      await syncCommissionForOrder(order, context.userId);
      return NextResponse.json({ success: true, data: order });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
