import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';
import { sanitizeEnterpriseAiConfig, summarizeDailyUsage } from '@/lib/ai/enterprise-ai';

export const dynamic = 'force-dynamic';

function sanitizeEnterpriseForResponse(enterprise: Record<string, any>) {
  return {
    ...enterprise,
    aiConfig: sanitizeEnterpriseAiConfig(enterprise),
  };
}

export async function GET(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const enterprises = await Enterprise.find().sort({ createdAt: -1 }).lean();
        const enterpriseIds = enterprises.map((item) => item._id);
        const aiSnapshots = enterpriseIds.length
          ? await EnterpriseAiUsageSnapshot.find({ enterpriseId: { $in: enterpriseIds } }).lean()
          : [];
        const aiSnapshotMap = new Map(
          aiSnapshots.map((item) => [String(item.enterpriseId), item])
        );

        const enriched = enterprises.map((enterprise: any) => {
          const aiSnapshot = aiSnapshotMap.get(String(enterprise._id));
          return {
            ...sanitizeEnterpriseForResponse(enterprise),
            aiUsageSnapshot: aiSnapshot
              ? {
                  balance: aiSnapshot.balance || 0,
                  currency: aiSnapshot.currency || 'USD',
                  keyInfo: aiSnapshot.keyInfo || null,
                  lastSyncedAt: aiSnapshot.lastSyncedAt || null,
                  syncError: aiSnapshot.syncError || '',
                  summary: summarizeDailyUsage(aiSnapshot.dailyUsage || []),
                }
              : null,
          };
        });
        return NextResponse.json({ success: true, data: enriched });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const body = (await request.json()) as Record<string, unknown>;
        const enterprise = await Enterprise.create({
          ...body,
          groundPromotionFixedCommission: Number(body.groundPromotionFixedCommission || 0),
          automationConfig: {
            followUpSlaHours: Number((body.automationConfig as any)?.followUpSlaHours || 24),
            measureTaskSlaHours: Number((body.automationConfig as any)?.measureTaskSlaHours || 48),
            designTaskSlaHours: Number((body.automationConfig as any)?.designTaskSlaHours || 72),
            reminderIntervalHours: Number((body.automationConfig as any)?.reminderIntervalHours || 24),
            maxReminderTimes: Number((body.automationConfig as any)?.maxReminderTimes || 3),
          },
          registrationMode: 'manual',
        });

        if (enterprise.contactPerson?.phone) {
          const passwordHash = await bcrypt.hash('Admin123456', 10);
          const existingUser = await AdminUser.findOne({ username: enterprise.contactPerson.phone });
          if (!existingUser) {
            await AdminUser.create({
              username: enterprise.contactPerson.phone,
              passwordHash,
              displayName: enterprise.contactPerson.name,
              role: 'enterprise_admin',
              enterpriseId: enterprise._id,
              phone: enterprise.contactPerson.phone,
              menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
              status: 'active',
            });
          }
        }

        return NextResponse.json({
          success: true,
          data: sanitizeEnterpriseForResponse(enterprise.toObject() as unknown as Record<string, any>),
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
