import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { assignPoolRecordToPromoter, claimFromPool } from '@/lib/promotion-workflow';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * GET /api/promotion-records/pool
 * 获取公海池中可认领的报备记录
 */
export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    
    // Try Mini Program JWT first
    const mpContext = await resolveMiniProgramContext(request);
    let context;

    if (mpContext && mpContext.staff) {
      context = {
        role: mpContext.staff.role,
        userId: mpContext.staff._id.toString(),
        enterpriseId: mpContext.staff.enterpriseId?.toString(),
      };
    } else {
      context = await getTenantContext(request);
    }

    if (!context || !['salesperson', 'enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

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
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
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
    const body = await request.json();
    
    // Check Mini Program JWT first
    const mpContext = await resolveMiniProgramContext(request);
    let context;

    if (mpContext && mpContext.staff) {
      context = {
        role: mpContext.staff.role,
        userId: mpContext.staff._id.toString(),
      };
    } else {
      context = await getTenantContext(request);
    }

    if (!body.recordId) {
      return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
    }

    const action = body.action || 'claim';
    let result = null;

    if (action === 'assign') {
      if (!context || !['admin', 'super_admin'].includes(context.role)) {
        return NextResponse.json({ success: false, error: 'Only managers can assign pool records' }, { status: 403 });
      }
      if (!body.promoterId) {
        return NextResponse.json({ success: false, error: 'Missing promoterId' }, { status: 400 });
      }
      result = await assignPoolRecordToPromoter(body.recordId, body.promoterId, context.userId);
    } else {
      if (!context || context.role !== 'salesperson') {
        return NextResponse.json({ success: false, error: 'Only salesperson can claim from pool' }, { status: 403 });
      }
      result = await claimFromPool(body.recordId, context.userId);
    }

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Record not available in claimable pool' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message === 'Target salesperson not found') {
      return NextResponse.json({ success: false, error: 'Target salesperson not found' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
