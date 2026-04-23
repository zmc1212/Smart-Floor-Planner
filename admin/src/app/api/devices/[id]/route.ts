import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';
import { withTenantContext } from '@/lib/auth';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    return await withTenantContext(request, async () => {
      const { id } = await params;
      const body = await request.json();
      const { code, description, enterpriseId, assignedUserId, status } = body;

      const updateData: any = {
        code: code?.trim(),
        description: description?.trim(),
        enterpriseId: enterpriseId || null,
        assignedUserId: assignedUserId || null,
        status: status || 'unassigned'
      };

      // Safety for enterprise_admin - 插件会自动注入enterpriseId，这里确保数据一致性
      if (!updateData.enterpriseId) {
        const { getCurrentUserRole, getCurrentEnterpriseId } = require('@/lib/tenant-context');
        const role = getCurrentUserRole();
        if (role === 'enterprise_admin') {
          updateData.enterpriseId = getCurrentEnterpriseId();
        }
      }

      const device = await Device.findOneAndUpdate(
        { _id: id }, // 插件自动注入租户过滤
        updateData,
        { new: true, runValidators: true }
      );

      if (!device) {
        return NextResponse.json({ success: false, error: '设备不存在或无权操作' }, { status: 404 });
      }

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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    return await withTenantContext(request, async () => {
      const { id } = await params;

      // 插件会自动注入租户过滤，无需手动处理
      const device = await Device.findOneAndDelete({ _id: id });
      if (!device) {
        return NextResponse.json({ success: false, error: '设备不存在或无权操作' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
