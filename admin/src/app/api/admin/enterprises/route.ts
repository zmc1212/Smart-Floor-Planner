import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';
import { sanitizeEnterpriseAiConfig, summarizeDailyUsage } from '@/lib/ai/enterprise-ai';

export const dynamic = 'force-dynamic';

const DEFAULT_ENTERPRISE_AUTOMATION_CONFIG = {
  followUpSlaHours: 24,
  measureTaskSlaHours: 48,
  designTaskSlaHours: 72,
  reminderIntervalHours: 24,
  maxReminderTimes: 3,
  browserNotificationEnabled: true,
  miniprogramNotificationEnabled: true,
};

function normalizeAutomationConfig(automationConfig?: Record<string, unknown>) {
  return {
    followUpSlaHours: Number(automationConfig?.followUpSlaHours || DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.followUpSlaHours),
    measureTaskSlaHours: Number(automationConfig?.measureTaskSlaHours || DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.measureTaskSlaHours),
    designTaskSlaHours: Number(automationConfig?.designTaskSlaHours || DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.designTaskSlaHours),
    reminderIntervalHours: Number(automationConfig?.reminderIntervalHours || DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.reminderIntervalHours),
    maxReminderTimes: Number(automationConfig?.maxReminderTimes || DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.maxReminderTimes),
    browserNotificationEnabled: automationConfig?.browserNotificationEnabled !== false,
    miniprogramNotificationEnabled: automationConfig?.miniprogramNotificationEnabled !== false,
  };
}

function sanitizeEnterpriseForResponse(enterprise: object & { automationConfig?: unknown }) {
  const enterpriseRecord = enterprise as Record<string, unknown>;
  return {
    ...enterpriseRecord,
    automationConfig: normalizeAutomationConfig(enterprise.automationConfig as Record<string, unknown> | undefined),
    aiConfig: sanitizeEnterpriseAiConfig(enterpriseRecord),
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

        const enriched = enterprises.map((enterprise) => {
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
        const automationConfig = (body.automationConfig || {}) as Record<string, unknown>;
        const enterprise = await Enterprise.create({
          ...body,
          groundPromotionFixedCommission: Number(body.groundPromotionFixedCommission || 0),
          automationConfig: normalizeAutomationConfig(automationConfig),
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
          data: sanitizeEnterpriseForResponse(enterprise.toObject() as unknown as Record<string, unknown>),
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
