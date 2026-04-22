import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser } from '@/models/AdminUser';
import { getTenantContext, getTenantFilter } from '@/lib/auth';

export async function GET(request: Request) {
  await dbConnect();
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const filter = getTenantFilter(context);
    
    const devices = await Device.find(filter)
      .populate({ path: 'enterpriseId', model: Enterprise, select: 'name' })
      .populate({ path: 'assignedUserId', model: AdminUser, select: 'displayName username' })
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({ success: true, data: devices });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await dbConnect();
  try {
    const context = await getTenantContext(request);
    if (!context || (context.role !== 'super_admin' && context.role !== 'admin' && context.role !== 'enterprise_admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    
    // Safety check for enterprise_admin: force their own enterpriseId
    if (context.role === 'enterprise_admin') {
      body.enterpriseId = context.enterpriseId;
      body.status = 'assigned'; // Associated with enterprise
    }

    const device = await Device.create(body);
    return NextResponse.json({ success: true, data: device });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '设备编码已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
