import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'admin', 'super_admin'], requireEnterprise: true },
      async () => {
        const records = await PromotionEnterpriseRecord.find({ ownershipStatus: 'conflict_pending' })
          .populate('promoterId', 'displayName username role')
          .sort({ createdAt: -1 })
          .lean();

        return NextResponse.json({ success: true, data: records });
      }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'admin', 'super_admin'], requireEnterprise: true },
      async (context) => {
        const body = await request.json();
        if (!body.recordId || !body.promoterId) {
          return NextResponse.json({ success: false, error: 'recordId and promoterId are required' }, { status: 400 });
        }

        const updated = await PromotionEnterpriseRecord.findByIdAndUpdate(
          body.recordId,
          {
            $set: {
              promoterId: body.promoterId,
              ownershipStatus: 'manually_locked',
              'conflictInfo.reviewedBy': context.userId,
              'conflictInfo.reviewedAt': new Date(),
              'conflictInfo.resolution': body.resolution || 'manual_override',
            },
          },
          { new: true }
        )
          .populate('promoterId', 'displayName username role')
          .lean();

        return NextResponse.json({ success: true, data: updated });
      }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
