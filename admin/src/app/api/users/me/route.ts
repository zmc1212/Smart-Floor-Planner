import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';
import { Enterprise } from '@/models/Enterprise';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export async function GET(req: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniProgramContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { user, staff } = context;
    
    // Enrich with professional context if user is staff
    let extraData = {};
    if (staff) {
      let enterpriseName = '';
      if (staff.enterpriseId) {
        const ent = await Enterprise.findById(staff.enterpriseId);
        enterpriseName = ent?.name || '';
      }
      extraData = {
        staffRole: staff.role,
        enterpriseId: staff.enterpriseId,
        enterpriseName: enterpriseName,
        staffId: staff._id
      };
    }
    
    const userData = {
      ...(typeof user.toObject === 'function' ? user.toObject() : user),
      ...extraData
    };
    
    return NextResponse.json({ success: true, data: userData });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniProgramContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    delete body.role; // Safety check

    // Try to update existing user
    let user = await User.findByIdAndUpdate(context.user._id, body, { new: true, runValidators: true });
    
    // If not found, it might be a staff user without a User record yet
    if (!user && context.staff) {
      console.log('User record not found for staff, creating one...');
      user = new User({
        ...body,
        _id: context.user._id, // Use the ID provided by context (even if mocked)
        openid: context.staff.openid || `staff_${context.staff._id}`,
        phone: context.staff.phone,
        role: 'staff',
        enterpriseId: context.staff.enterpriseId
      });
      await user.save();
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: user });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
