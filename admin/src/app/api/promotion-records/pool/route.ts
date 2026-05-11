import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { claimFromPool } from '@/lib/promotion-workflow';

export const dynamic = 'force-dynamic';

/**
 * GET /api/promotion-records/pool
 * 获取公海池中可认领的报备记录
 */
export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context || !['salesperson', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    const query: Record<string, unknown> = { poolStatus: 'in_pool' };
    if (search?.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { enterpriseName: regex },
        { contactPerson: regex },
        { phone: regex },
        { creditCode: regex },
      ];
    }

    const records = await PromotionEnterpriseRecord.find(query)
      .populate('promoterId', 'displayName username role')
      .sort({ lastActivityAt: -1 })
      .lean();

    return NextResponse.json({ success: true, data: records });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/promotion-records/pool
 * 从公海池认领一条报备记录
 * Body: { recordId: string }
 */
export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context || context.role !== 'salesperson') {
      return NextResponse.json({ success: false, error: 'Only salesperson can claim from pool' }, { status: 403 });
    }

    const body = await request.json();
    if (!body.recordId) {
      return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
    }

    const result = await claimFromPool(body.recordId, context.userId);
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Record not available for claiming' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
