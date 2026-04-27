import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { getTenantContext } from '@/lib/auth';

/**
 * GET — 查询 AI 生成历史 (分页)
 */
export async function GET(req: Request) {
  try {
    await dbConnect();
    const ctx = await getTenantContext(req);
    if (!ctx || !ctx.enterpriseId) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const type = searchParams.get('type'); // filter by type
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { enterpriseId: ctx.enterpriseId };
    if (type) filter.type = type;

    const [items, total] = await Promise.all([
      AiGeneration.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('operatorId', 'displayName username')
        .populate('floorPlanId', 'name')
        .lean(),
      AiGeneration.countDocuments(filter),
    ]);

    return NextResponse.json({
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[AI History GET]', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
