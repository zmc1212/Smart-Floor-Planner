import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { getTenantContext, getTenantFilter } from '@/lib/auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const lead = await Lead.findById(id)
      .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status', strictPopulate: false })
      .populate('assignedTo', 'displayName role');

    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: lead });
  } catch (error: any) {
    console.error('Fetch lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();

    let tenantFilter = {};
    const context = await getTenantContext(request);

    // Support Mini Program auth via openid
    if (!context && body.openid) {
      const { User } = require('@/models/User');
      const { AdminUser } = require('@/models/AdminUser');
      const user = await User.findOne({ openid: body.openid });
      if (user && user.role === 'staff') {
        const staff = await AdminUser.findOne({ phone: user.phone });
        if (staff) {
          tenantFilter = {
            $or: [
              { promoterId: staff._id },
              { assignedTo: staff._id }
            ]
          };
        } else {
          return NextResponse.json({ success: false, error: 'Staff profile not found' }, { status: 403 });
        }
      } else {
         return NextResponse.json({ success: false, error: 'Unauthorized: Miniprogram user is not staff' }, { status: 403 });
      }
    } else if (context) {
      tenantFilter = getTenantFilter(context, { staffField: 'assignedTo' });
    } else {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // If assigning to someone for the first time or changing assignment, update assignedAt
    if (body.assignedTo) {
      body.assignedAt = new Date();
    }
    
    // Support appending floorPlanId
    let updateOps: any = { ...body };
    let updateDoc: any = {};
    
    // Cleanup auth fields from body
    if (updateOps.openid) delete updateOps.openid;
    
    if (body.floorPlanId) {
      delete updateOps.floorPlanId; 
      updateDoc.$addToSet = { floorPlanIds: body.floorPlanId };
    }
    
    if (Object.keys(updateOps).length > 0) {
      updateDoc.$set = updateOps;
    }

    const lead = await Lead.findOneAndUpdate(
      { _id: id, ...tenantFilter },
      Object.keys(updateDoc).length > 0 ? updateDoc : body,
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
