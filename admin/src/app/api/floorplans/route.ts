import { tenantStorage } from '@/lib/tenant-context';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    const { name, layoutData, status } = body;

    const context = await resolveMiniProgramContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!layoutData) {
      return NextResponse.json({ success: false, error: 'Missing layoutData' }, { status: 400 });
    }

    const { user, staff, enterpriseId } = context;
    const staffId = staff?._id;

    return await tenantStorage.run(
      {
        enterpriseId: enterpriseId ? String(enterpriseId) : null,
        role: staff?.role || 'user',
        userId: staff ? String(staff._id) : String(user._id),
      },
      async () => {
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
      }
    );
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

    // 1. Mini-Program Context (via JWT)
    const context = await resolveMiniProgramContext(req);
    if (context) {
      const { user, staff, enterpriseId } = context;

      return await tenantStorage.run(
        {
          enterpriseId: enterpriseId ? String(enterpriseId) : null,
          role: staff?.role || 'user',
          userId: staff ? String(staff._id) : String(user._id),
        },
        async () => {
          let query: any = {};
          if (staff) {
            if (staff.role === 'enterprise_admin') {
              query.enterpriseId = staff.enterpriseId;
            } else {
              query.staffId = staff._id;
            }
          } else {
            query.creator = user._id;
          }

          const floorPlans = await executeQuery(query);
          return NextResponse.json({ success: true, data: floorPlans });
        }
      );
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