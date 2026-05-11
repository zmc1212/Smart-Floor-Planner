import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { Package } from '@/models/Package';

export const dynamic = 'force-dynamic';

/**
 * 更新套餐
 * PUT /api/admin/packages/[id]
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    const { id } = await params;

    if (!context || !['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const item = await Package.findByIdAndUpdate(id, body, { new: true });

    if (!item) {
      return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * 删除套餐
 * DELETE /api/admin/packages/[id]
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    const { id } = await params;

    if (!context || !['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const item = await Package.findByIdAndDelete(id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Deleted' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
