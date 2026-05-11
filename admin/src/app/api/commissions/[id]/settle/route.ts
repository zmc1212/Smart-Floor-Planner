import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { CommissionRecord } from '@/models/CommissionRecord';

export const dynamic = 'force-dynamic';

/**
 * 结算佣金
 * POST /api/commissions/[id]/settle
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    
    // 只有平台管理员或超级管理员可以操作结算
    if (!context || !['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    return await withTenantContext(request, async () => {
      const { id } = await params;

      const commission = await CommissionRecord.findById(id);
      if (!commission) {
        return NextResponse.json({ success: false, error: 'Commission record not found' }, { status: 404 });
      }

      if (commission.status !== 'pending_settlement') {
        return NextResponse.json({ success: false, error: 'Commission already settled or voided' }, { status: 400 });
      }

      commission.status = 'paid';
      commission.settledAt = new Date();
      commission.settledBy = context.userId as any;
      await commission.save();

      return NextResponse.json({ success: true, data: commission });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
