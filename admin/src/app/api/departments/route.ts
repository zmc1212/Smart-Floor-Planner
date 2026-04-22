import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Department } from '@/models/Department';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    let filter: any = {};
    if (context.role === 'enterprise_admin' || context.role === 'designer' || context.role === 'salesperson') {
      filter.enterpriseId = context.enterpriseId;
    } else if (context.role === 'super_admin' || context.role === 'admin') {
      const { searchParams } = new URL(request.url);
      const entId = searchParams.get('enterpriseId');
      if (entId) filter.enterpriseId = entId;
    }

    if (!filter.enterpriseId && context.role !== 'super_admin') {
      return NextResponse.json({ success: true, data: [] });
    }

    const departments = await Department.find(filter).sort({ order: 1, createdAt: 1 });
    return NextResponse.json({ success: true, data: departments });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'enterprise_admin' && context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { name, parentId, order } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: '请填写部门名称' }, { status: 400 });
    }

    let targetEnterpriseId = context.enterpriseId;
    if ((context.role === 'super_admin' || context.role === 'admin') && body.enterpriseId) {
      targetEnterpriseId = body.enterpriseId;
    }

    if (!targetEnterpriseId) {
      return NextResponse.json({ success: false, error: '无法确定关联企业' }, { status: 400 });
    }

    const department = await Department.create({
      name,
      enterpriseId: targetEnterpriseId,
      parentId: parentId || null,
      order: order || 0,
    });

    return NextResponse.json({ success: true, data: department }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
