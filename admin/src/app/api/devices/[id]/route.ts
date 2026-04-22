import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';
import { getTenantContext, getTenantFilter } from '@/lib/auth';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { id } = await params;
    const filter: any = getTenantFilter(context);
    filter._id = id;

    const body = await request.json();
    const { code, description, enterpriseId, assignedUserId, status } = body;

    const updateData: any = { 
      code: code?.trim(), 
      description: description?.trim(),
      enterpriseId: enterpriseId || null,
      assignedUserId: assignedUserId || null,
      status: status || 'unassigned'
    };

    // Safety for enterprise_admin
    if (context.role === 'enterprise_admin') {
      updateData.enterpriseId = context.enterpriseId;
    }

    const device = await Device.findOneAndUpdate(
      filter,
      updateData,
      { new: true, runValidators: true }
    );

    if (!device) {
      return NextResponse.json({ success: false, error: '设备不存在或无权操作' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: device });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '设备编码已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { id } = await params;
    const filter: any = getTenantFilter(context);
    filter._id = id;

    const device = await Device.findOneAndDelete(filter);
    if (!device) {
      return NextResponse.json({ success: false, error: '设备不存在或无权操作' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
