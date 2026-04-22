import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';

// Apply FloorPlan mapping: Save layout data from Mini Program
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { openid, name, layoutData, status } = await req.json();

    if (!openid || !layoutData) {
      return NextResponse.json({ success: false, error: 'Missing openid or layoutData' }, { status: 400 });
    }

    const user = await User.findOne({ openid });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found for provided openid' }, { status: 404 });
    }

    // Automatic Association for Staff
    let staffId = undefined;
    let enterpriseId = undefined;
    
    if (user.role === 'staff') {
      const staffMember = await AdminUser.findOne({ phone: user.phone });
      if (staffMember) {
        staffId = staffMember._id;
        enterpriseId = staffMember.enterpriseId;
      }
    }

    const newPlan = await FloorPlan.create({
      name: name || '未命名户型',
      creator: user._id,
      staffId,
      enterpriseId,
      layoutData,
      status: status || 'completed'
    });

    return NextResponse.json({ success: true, data: newPlan });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Get all floor plans or filtered list
export async function GET(req: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const openid = searchParams.get('openid');
    const phone = searchParams.get('phone');
    const search = searchParams.get('search');

    let query: any = {};
    if (openid) {
      const user = await User.findOne({ openid });
      if (!user) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
      query.creator = user._id;
    } else if (phone) {
      const users = await User.find({ phone });
      if (users.length > 0) {
        query.creator = { $in: users.map(u => u._id) };
      } else {
        // If no user found by phone, return empty data
        return NextResponse.json({ success: true, data: [] });
      }
    }

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const floorPlans = await FloorPlan.find(query)
      .populate({ path: 'creator', model: User })
      .sort({ createdAt: -1 });

    return NextResponse.json({ success: true, data: floorPlans });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
