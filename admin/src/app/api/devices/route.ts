import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser } from '@/models/AdminUser';
import { withTenantContext } from '@/lib/auth';

export async function GET(request: Request) {
  await dbConnect();
  try {
    return await withTenantContext(request, async () => {
      // 插件会自动注入租户过滤条件，无需手动处理
      const devices = await Device.find({})
        .populate({ path: 'enterpriseId', model: Enterprise, select: 'name' })
        .populate({ path: 'assignedUserId', model: AdminUser, select: 'displayName username' })
        .sort({ createdAt: -1 })
        .lean();
      return NextResponse.json({ success: true, data: devices });
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await dbConnect();
  try {
    return await withTenantContext(request, async () => {
      const body = await request.json();

      // 插件会自动处理enterpriseId注入，但我们需要确保企业版管理员只能创建自己企业的设备
      const { getCurrentUserRole, getCurrentEnterpriseId } = require('@/lib/tenant-context');
      const role = getCurrentUserRole();
      const enterpriseId = getCurrentEnterpriseId();

      if (role === 'enterprise_admin' && !body.enterpriseId) {
        body.enterpriseId = enterpriseId;
        body.status = 'assigned'; // Associated with enterprise
      }

      const device = await Device.create(body);
      return NextResponse.json({ success: true, data: device });
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '设备编码已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
