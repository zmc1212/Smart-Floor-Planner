import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { getTenantContext, getTenantFilter } from '@/lib/auth';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // If assigning to someone for the first time or changing assignment, update assignedAt
    if (body.assignedTo) {
      body.assignedAt = new Date();
    }

    // Verify ownership/tenant access
    const tenantFilter = getTenantFilter(context, { staffField: 'assignedTo' });
    const lead = await Lead.findOneAndUpdate(
      { _id: id, ...tenantFilter },
      body,
      { new: true, runValidators: true }
    );
    
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: lead });
  } catch (error: any) {
    console.error('Update lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership/tenant access
    const tenantFilter = getTenantFilter(context, { staffField: 'assignedTo' });
    const lead = await Lead.findOneAndDelete({ _id: id, ...tenantFilter });
    
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    console.error('Delete lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
