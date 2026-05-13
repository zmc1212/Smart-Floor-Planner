import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { Package } from '@/models/Package';

export const dynamic = 'force-dynamic';

/**
 * 获取套餐列表
 * GET /api/admin/packages
 */
export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    
    // 只有平台管理员可以查看
    if (!context || !['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    
    const query: any = {};
    if (status) query.status = status;

    const items = await Package.find(query).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: items });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * 创建套餐
 * POST /api/admin/packages
 */
export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || !['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    console.log('CREATING PACKAGE:', body);
    const item = await Package.create(body);

    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
