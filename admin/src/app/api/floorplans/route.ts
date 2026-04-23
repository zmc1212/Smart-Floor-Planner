import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';
import { withTenantContext } from '@/lib/auth';

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

    // Create a single FloorPlan with all rooms
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

    // 💡 抽离公共的查询执行逻辑
    const executeQuery = async (baseQuery: any = {}) => {
      // 处理phone过滤
      if (phone) {
        const users = await User.find({ phone });
        if (users.length > 0) {
          baseQuery.creator = { $in: users.map(u => u._id) };
        }
      }

      // 处理search过滤
      if (search) {
        baseQuery.name = { $regex: search, $options: 'i' };
      }

      // 执行查询
      return await FloorPlan.find(baseQuery)
        .populate({ path: 'creator', model: User })
        .sort({ createdAt: -1 });
    };

    // 1. Mini-Program Context (via openid)
    if (openid) {
      let query: any = {};
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

      const floorPlans = await executeQuery(query);
      return NextResponse.json({ success: true, data: floorPlans });
    }

    // 2. Admin Dashboard Context (via Auth Token) - 使用新的租户上下文包装器
    else {
      try {
        return await withTenantContext(req, async () => {
          // 💡 这里传入空对象即可！插件会自动拦截find并加上enterpriseId
          const floorPlans = await executeQuery({});
          return NextResponse.json({ success: true, data: floorPlans });
        });
      } catch (error: any) {
        if (error.message === 'Unauthorized') {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
      }
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}