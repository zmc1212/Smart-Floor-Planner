import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { CommissionRecord } from '@/models/CommissionRecord';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    return await withTenantContext(request, async () => {
      const body = await request.json();
      const { id } = await params;
      const status = body.status;

      if (!['pending_settlement', 'paid', 'voided'].includes(status)) {
        return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
      }

      const updateData: Record<string, unknown> = { status };
      if (status === 'paid' || status === 'voided') {
        updateData.settledAt = new Date();
        updateData.settledBy = context.userId;
      }

      const record = await CommissionRecord.findByIdAndUpdate(id, { $set: updateData }, { new: true });
      if (!record) {
        return NextResponse.json({ success: false, error: 'Commission not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, data: record });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
