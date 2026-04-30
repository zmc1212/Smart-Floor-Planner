import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { EnterpriseOrder } from '@/models/EnterpriseOrder';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { findPromotionRecordIdsForPromoter, getMiniProgramStaffContext, syncCommissionForOrder } from '@/lib/promotion-workflow';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const openid = searchParams.get('openid');

    if (openid) {
      const { staff } = await getMiniProgramStaffContext(openid);
      if (!staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }

      const query: Record<string, unknown> = {};
      if (staff.role === 'salesperson') {
        query.recordId = { $in: await findPromotionRecordIdsForPromoter(staff._id) };
      } else if (staff.enterpriseId) {
        query.enterpriseId = staff.enterpriseId;
      }

      const orders = await EnterpriseOrder.find(query)
        .populate('recordId', 'enterpriseName businessStage promoterId')
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({ success: true, data: orders });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return await withTenantContext(request, async () => {
      const query: Record<string, unknown> = {};
      if (context.role === 'salesperson') {
        query.recordId = { $in: await findPromotionRecordIdsForPromoter(context.userId) };
      }

      const orders = await EnterpriseOrder.find(query)
        .populate('recordId', 'enterpriseName businessStage promoterId')
        .populate('createdBy', 'displayName username role')
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({ success: true, data: orders });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantContext(request, async () => {
      const context = await getTenantContext(request);
      if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      const body = await request.json();
      if (!body.recordId || !body.packageName || body.amount === undefined) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }

      const record = await PromotionEnterpriseRecord.findById(body.recordId);
      if (!record) {
        return NextResponse.json({ success: false, error: 'Promotion record not found' }, { status: 404 });
      }

      const order = await EnterpriseOrder.create({
        recordId: record._id,
        enterpriseId: record.enterpriseId,
        enterpriseNameSnapshot: record.enterpriseName,
        packageName: body.packageName.trim(),
        amount: Number(body.amount),
        currency: 'CNY',
        status: body.status || 'draft',
        paidAt: body.status === 'paid' ? new Date() : undefined,
        createdBy: context.userId,
        remark: body.remark?.trim() || '',
      });

      await syncCommissionForOrder(order, context.userId);
      return NextResponse.json({ success: true, data: order }, { status: 201 });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
