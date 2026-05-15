import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withPlatformB2BTenantContext } from '@/lib/auth';
import { CommissionRecord } from '@/models/CommissionRecord';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const promoterId = searchParams.get('promoterId');

    // Handle Mini Program context
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;
      const query: any = {};
      if (staff.role === 'salesperson') {
        query.promoterId = staff._id;
      } else if (staff.role === 'admin' || staff.role === 'super_admin') {
        // Platform admins see everything
      } else {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      if (status) query.status = status;

      const commissions = await CommissionRecord.find(query)
        .populate('promoterId', 'displayName username role')
        .populate('recordId', 'enterpriseName contactPerson')
        .populate('orderId', 'packageName amount')
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({ success: true, data: commissions });
    }

    return await withPlatformB2BTenantContext(request, async (context) => {
      const query: any = {};
      if (context.role === 'salesperson') {
        query.promoterId = context.userId;
      }
      
      if (status) query.status = status;
      if (promoterId && ['admin', 'super_admin'].includes(context.role)) {
        query.promoterId = promoterId;
      }

      const [commissions, stats] = await Promise.all([
        CommissionRecord.find(query)
          .populate('promoterId', 'displayName username role')
          .populate('recordId', 'enterpriseName contactPerson')
          .populate('orderId', 'packageName amount')
          .sort({ createdAt: -1 })
          .lean(),
        CommissionRecord.aggregate([
          { $match: query },
          {
            $group: {
              _id: '$status',
              totalAmount: { $sum: '$commissionAmount' },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      return NextResponse.json({ 
        success: true, 
        data: commissions,
        summary: stats.reduce((acc: any, curr: any) => {
          acc[curr._id] = { amount: curr.totalAmount, count: curr.count };
          return acc;
        }, {})
      });
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
