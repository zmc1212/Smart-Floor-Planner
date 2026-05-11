import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { CommissionRecord } from '@/models/CommissionRecord';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { tenantStorage } from '@/lib/tenant-context';
import { withTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);

    // Try Mini Program JWT first
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;

      return await tenantStorage.run(
        {
          enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
          role: staff.role,
          userId: String(staff._id),
        },
        async () => {
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
      );
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
