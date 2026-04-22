import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await req.json();

    // Automatic Association for Staff if missing
    let staffUpdate: any = {};
    if (body.openid) {
       const user = await User.findOne({ openid: body.openid });
       if (user && user.role === 'staff') {
         const staffMember = await AdminUser.findOne({ phone: user.phone });
         if (staffMember) {
           staffUpdate.staffId = staffMember._id;
           staffUpdate.enterpriseId = staffMember.enterpriseId;
         }
       }
    }

    const updatedPlan = await FloorPlan.findByIdAndUpdate(
      id,
      { 
        $set: {
          name: body.name,
          layoutData: body.layoutData,
          status: body.status,
          ...staffUpdate
        }
      },
      { new: true }
    );

    if (!updatedPlan) {
      return NextResponse.json({ success: false, error: 'FloorPlan not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updatedPlan });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await params;
    await FloorPlan.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
