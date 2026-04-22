import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';
import { getTenantContext, getTenantFilter } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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

    // 1. Mini-Program Context (via openid)
    if (openid) {
      const user = await User.findOne({ openid });
      if (!user) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
      
      // If staff, see all company plans or assigned plans
      if (user.role === 'staff') {
        const staffMember = await AdminUser.findOne({ phone: user.phone });
        if (staffMember) {
          if (staffMember.role === 'enterprise_admin') {
            query.enterpriseId = staffMember.enterpriseId;
          } else {
            query.staffId = staffMember._id;
          }
        } else {
          query.creator = user._id;
        }
      } else {
        query.creator = user._id;
      }
    } else {
      // 2. Admin Dashboard Context (via Auth Token)
      const context = await getTenantContext(req);
      if (!context) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      const tenantFilter = getTenantFilter(context);
      query = { ...query, ...tenantFilter };
    }

    // Additional filters
    if (phone) {
      const users = await User.find({ phone });
      if (users.length > 0) {
        query.creator = { $in: users.map(u => u._id) };
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
