import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  DeviceRepository,
  FloorPlanRepository,
  LeadRepository,
  MeasurementRepository,
} from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  adaptSurveyGraphToRooms,
  isFormalSurveyLayout,
} from '@/lib/survey-graph';

export const dynamic = 'force-dynamic';

function parseRooms(layoutData: unknown) {
  return isFormalSurveyLayout(layoutData)
    ? adaptSurveyGraphToRooms(layoutData)
    : [];
}

function calculateArea(rooms: ReturnType<typeof parseRooms>) {
  const rawArea = rooms.reduce((sum, room) => {
    if (room.polygon.length >= 3 && room.polygonClosed !== false) {
      let area = 0;
      for (let index = 0; index < room.polygon.length; index += 1) {
        const current = room.polygon[index];
        const next = room.polygon[(index + 1) % room.polygon.length];
        area += current.x * next.y - next.x * current.y;
      }
      return sum + Math.abs(area) / 2;
    }
    return sum + Number(room.width || 0) * Number(room.height || 0);
  }, 0);
  return rawArea > 0 ? Math.round((rawArea / 100) * 100) / 100 : undefined;
}

function deriveCity(user: Record<string, unknown>) {
  if (typeof user.city === 'string' && user.city) return user.city;
  const text = String(user.communityName || '');
  const match = text.match(/([\u4e00-\u9fa5]+(?:市|区|县))/);
  return match?.[1] || '';
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const result = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const floorPlans = new FloorPlanRepository(transaction);
        const leads = new LeadRepository(transaction);
        const measurements = new MeasurementRepository(transaction);
        const devices = new DeviceRepository(transaction);
        const staffId = context.staff
          ? parsePostgresId(context.staff._id, 'staff id')
          : null;
        const staffScoped =
          context.staff && context.staff.role !== 'enterprise_admin';
        const floorPlanOptions = {
          formalOnly: true,
          staffId: staffScoped ? staffId ?? undefined : undefined,
          creatorId: !context.staff
            ? parsePostgresId(context.user._id, 'user id')
            : undefined,
        };
        const leadOptions = context.staff
          ? context.staff.role === 'enterprise_admin'
            ? {}
            : {
                staffId: staffId ?? undefined,
                staffVisibility: 'promoted-or-assigned' as const,
              }
          : null;
        const measurementOptions = context.staff
          ? context.staff.role === 'enterprise_admin'
            ? {}
            : { operatorId: staffId ?? undefined }
          : null;

        const [savedPlans, measurementRecords, leadCount, recentPlans, device] =
          await Promise.all([
            floorPlans.count(floorPlanOptions),
            measurementOptions
              ? measurements.count(measurementOptions)
              : Promise.resolve(0),
            leadOptions ? leads.count(leadOptions) : Promise.resolve(0),
            floorPlans.listRecent(floorPlanOptions, 3),
            staffId
              ? devices.findLatestAssignedToUser(staffId)
              : Promise.resolve(null),
          ]);
        return {
          savedPlans,
          measurementRecords,
          leadCount,
          recentPlans,
          device,
        };
      }
    );

    const recentPlans = result.recentPlans.map((plan) => {
      const rooms = parseRooms(plan.layoutData);
      return {
        id: plan.id.toString(),
        _id: plan.id.toString(),
        name: plan.name || '未命名方案',
        status: plan.status || 'draft',
        statusLabel: plan.status === 'completed' ? '已完成' : '编辑中',
        updatedAt: (plan.updatedAt || plan.createdAt).toISOString(),
        roomCount: rooms.length,
        area: calculateArea(rooms),
      };
    });
    const enterprise = context.enterprise;
    const staff = context.staff;
    const user = context.user;
    const deviceCode = result.device?.code;

    return NextResponse.json({
      success: true,
      data: {
        user: {
          openid: user.openid,
          role: user.role || 'user',
          displayName:
            staff?.displayName || user.nickname || staff?.username || '',
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
          connectedLabel: deviceCode
            ? `已授权 ${deviceCode}`
            : '请连接授权设备',
          deviceCode,
          authorized: Boolean(deviceCode),
        },
        stats: {
          savedPlans: result.savedPlans,
          aiGeneratedCases: 0,
          measurementRecords: result.measurementRecords,
          leadCount: result.leadCount,
        },
        recentPlans,
        quickActions: {
          quoteEnabled: false,
          quoteLabel: '即将上线',
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Mini program home error:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
