import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { AiGeneration } from '@/models/AiGeneration';
import { Device } from '@/models/Device';
import { Enterprise } from '@/models/Enterprise';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import { Measurement } from '@/models/Measurement';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

function asObjectId(value: unknown) {
  if (!value) return undefined;
  const id = typeof value === 'object' && value !== null && '_id' in value ? (value as any)._id : value;
  return mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : undefined;
}

function parseRooms(layoutData: unknown): any[] {
  if (!layoutData) return [];

  let parsed = layoutData;
  if (typeof layoutData === 'string') {
    try {
      parsed = JSON.parse(layoutData);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).rooms)) {
    return (parsed as any).rooms;
  }

  return parsed ? [parsed] : [];
}

function calculateArea(rooms: any[]) {
  const rawArea = rooms.reduce((sum, room) => {
    if (Array.isArray(room?.polygon) && room.polygon.length >= 3 && room.polygonClosed !== false) {
      let area = 0;
      for (let i = 0; i < room.polygon.length; i += 1) {
        const current = room.polygon[i];
        const next = room.polygon[(i + 1) % room.polygon.length];
        area += current.x * next.y - next.x * current.y;
      }
      return sum + Math.abs(area) / 2;
    }

    return sum + Number(room?.width || 0) * Number(room?.height || 0);
  }, 0);

  return rawArea > 0 ? Math.round((rawArea / 100) * 100) / 100 : undefined;
}

function deriveCity(user: any) {
  const text = String(user?.communityName || '');
  const match = text.match(/([\u4e00-\u9fa5]+(?:市|区|县))/);
  return match?.[1] || '上海市';
}

async function resolveMiniProgramContext(openid: string) {
  const user = await User.findOne({ openid }).lean();
  if (!user) return null;

  const staff = await AdminUser.findOne({
    status: 'active',
    $or: [{ openid }, ...((user as any).phone ? [{ phone: (user as any).phone }] : [])],
  }).lean();

  const enterpriseId = asObjectId((staff as any)?.enterpriseId || (user as any).enterpriseId);
  const enterprise = enterpriseId ? await Enterprise.findById(enterpriseId).lean() : null;

  return { user, staff, enterprise, enterpriseId };
}

function buildVisibilityQueries(context: Awaited<ReturnType<typeof resolveMiniProgramContext>>) {
  if (!context) {
    return {
      floorPlanQuery: { _id: null },
      leadQuery: { _id: null },
      measurementQuery: { _id: null },
      aiQuery: { _id: null },
    };
  }

  const userId = asObjectId((context.user as any)._id);
  const staffId = asObjectId((context.staff as any)?._id);
  const enterpriseId = context.enterpriseId;
  const staffRole = (context.staff as any)?.role;

  if (context.staff && staffRole === 'enterprise_admin' && enterpriseId) {
    return {
      floorPlanQuery: { enterpriseId },
      leadQuery: { enterpriseId },
      measurementQuery: { enterpriseId },
      aiQuery: { enterpriseId, status: 'succeeded' },
    };
  }

  if (context.staff && staffId) {
    return {
      floorPlanQuery: { staffId },
      leadQuery: { $or: [{ promoterId: staffId }, { assignedTo: staffId }] },
      measurementQuery: { operatorId: staffId },
      aiQuery: { operatorId: staffId, status: 'succeeded' },
    };
  }

  return {
    floorPlanQuery: { creator: userId },
    leadQuery: { _id: null },
    measurementQuery: { _id: null },
    aiQuery: { _id: null, status: 'succeeded' },
  };
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const openid = searchParams.get('openid');

    if (!openid) {
      return NextResponse.json({ success: false, error: 'openid is required' }, { status: 400 });
    }

    const context = await resolveMiniProgramContext(openid);
    if (!context) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const { floorPlanQuery, leadQuery, measurementQuery, aiQuery } = buildVisibilityQueries(context);

    const [savedPlans, aiGeneratedCases, measurementRecords, leadCount, recentPlans, assignedDevice] = await Promise.all([
      FloorPlan.countDocuments(floorPlanQuery),
      AiGeneration.countDocuments(aiQuery),
      Measurement.countDocuments(measurementQuery),
      Lead.countDocuments(leadQuery),
      FloorPlan.find(floorPlanQuery).sort({ updatedAt: -1, createdAt: -1 }).limit(3).lean(),
      context.staff
        ? Device.findOne({ assignedUserId: (context.staff as any)._id, status: 'assigned' }).sort({ updatedAt: -1 }).lean()
        : null,
    ]);

    const recentPlanItems = recentPlans.map((plan: any) => {
      const rooms = parseRooms(plan.layoutData);
      const updatedAt = plan.updatedAt || plan.createdAt;
      return {
        id: String(plan._id),
        _id: String(plan._id),
        name: plan.name || '未命名方案',
        status: plan.status || 'draft',
        statusLabel: plan.status === 'completed' ? '已完成' : '编辑中',
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : '',
        roomCount: rooms.length,
        area: calculateArea(rooms),
      };
    });

    const enterprise = context.enterprise as any;
    const staff = context.staff as any;
    const user = context.user as any;
    const deviceCode = (assignedDevice as any)?.code;

    return NextResponse.json({
      success: true,
      data: {
        user: {
          openid,
          role: user.role || 'user',
          displayName: staff?.displayName || user.nickname || staff?.username || '',
          city: deriveCity(user),
          enterpriseName: enterprise?.name,
          branding: enterprise
            ? {
                name: enterprise.name,
                logo: enterprise.logo,
                primaryColor: enterprise.branding?.primaryColor,
              }
            : undefined,
        },
        bluetooth: {
          connectedLabel: deviceCode ? `已授权 ${deviceCode}` : '请连接授权设备',
          deviceCode,
          authorized: !!deviceCode,
        },
        stats: {
          savedPlans,
          aiGeneratedCases,
          measurementRecords,
          leadCount,
        },
        recentPlans: recentPlanItems,
        quickActions: {
          quoteEnabled: false,
          quoteLabel: '即将上线',
        },
      },
    });
  } catch (error: any) {
    console.error('Mini program home error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
