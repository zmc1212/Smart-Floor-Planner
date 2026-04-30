import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { CommissionRecord } from '@/models/CommissionRecord';
import { getMiniProgramStaffContext } from '@/lib/promotion-workflow';

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
        query.promoterId = staff._id;
      } else if (staff.enterpriseId) {
        query.enterpriseId = staff.enterpriseId;
      } else {
        query._id = null;
      }

      const items = await CommissionRecord.find(query)
        .populate('orderId', 'packageName amount status')
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({ success: true, data: items });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return await withTenantContext(request, async () => {
      const query: Record<string, unknown> = {};
      if (context.role === 'salesperson') {
        query.promoterId = context.userId;
      }

      const items = await CommissionRecord.find(query)
        .populate('orderId', 'packageName amount status')
        .populate('promoterId', 'displayName username role')
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({ success: true, data: items });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
