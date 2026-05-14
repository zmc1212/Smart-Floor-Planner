import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';
import { sanitizeEnterpriseAiConfig, summarizeDailyUsage } from '@/lib/ai/enterprise-ai';

interface EnterprisePatchBody {
  name?: string;
  code?: string;
  contactPerson?: {
    name: string;
    phone: string;
    email?: string;
  };
  status?: string;
  logo?: string;
  branding?: {
    primaryColor?: string;
    accentColor?: string;
  };
  groundPromotionFixedCommission?: number;
  automationConfig?: {
    followUpSlaHours?: number;
    measureTaskSlaHours?: number;
    designTaskSlaHours?: number;
    reminderIntervalHours?: number;
    maxReminderTimes?: number;
    browserNotificationEnabled?: boolean;
    miniprogramNotificationEnabled?: boolean;
  };
}

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

function sanitizeEnterpriseForResponse(
  enterprise: Record<string, unknown>,
  options?: {
    aiSnapshot?: {
      balance?: number;
      currency?: string;
      keyInfo?: Record<string, unknown> | null;
      lastSyncedAt?: Date | string | null;
      syncError?: string;
      dailyUsage?: Array<{ date: string; model: string; requests: number; costUsd: number }>;
    } | null;
  }
) {
  return {
    ...enterprise,
    automationConfig: normalizeAutomationConfig(enterprise.automationConfig as Record<string, unknown> | undefined),
    aiConfig: sanitizeEnterpriseAiConfig(
      enterprise as unknown as Record<string, unknown> & {
        aiConfig?: ReturnType<typeof sanitizeEnterpriseAiConfig>;
      }
    ),
    aiUsageSnapshot: options?.aiSnapshot
      ? {
          balance: options.aiSnapshot.balance || 0,
          currency: options.aiSnapshot.currency || 'USD',
          keyInfo: options.aiSnapshot.keyInfo || null,
          lastSyncedAt: options.aiSnapshot.lastSyncedAt || null,
          syncError: options.aiSnapshot.syncError || '',
          summary: summarizeDailyUsage(options.aiSnapshot.dailyUsage || []),
        }
      : null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const enterprise = await Enterprise.findById(id).lean();
      if (!enterprise) {
        return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      }

      const aiSnapshot = await EnterpriseAiUsageSnapshot.findOne({ enterpriseId: id }).lean();

      return NextResponse.json({
        success: true,
        data: sanitizeEnterpriseForResponse(enterprise as unknown as Record<string, unknown>, {
          aiSnapshot,
        }),
      });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const { id: enterpriseId } = await params;
        const body = (await request.json()) as EnterprisePatchBody;
        const {
          name,
          code,
          contactPerson,
          status,
          logo,
          branding,
          groundPromotionFixedCommission,
          automationConfig,
        } = body;

        const currentEnterprise = await Enterprise.findById(enterpriseId).select('contactPerson');
        if (!currentEnterprise) {
          return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
        }

        const updateData: Record<string, unknown> = {};

        if (name !== undefined) updateData.name = name;
        if (code !== undefined) updateData.code = code;
        if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
        if (status !== undefined) updateData.status = status;
        if (logo !== undefined) updateData.logo = logo;
        if (branding !== undefined) updateData.branding = branding;
        if (groundPromotionFixedCommission !== undefined) {
          updateData.groundPromotionFixedCommission = Number(groundPromotionFixedCommission);
        }
        if (automationConfig !== undefined) {
          updateData.automationConfig = normalizeAutomationConfig(automationConfig as Record<string, unknown>);
        }

        const enterprise = await Enterprise.findByIdAndUpdate(
          enterpriseId,
          { $set: updateData },
          { new: true }
        );
        if (!enterprise) {
          return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
        }

        if (status === 'active' && enterprise.contactPerson?.phone) {
          const targetPhone = enterprise.contactPerson.phone;
          const existingUser = await AdminUser.findOne({
            $or: [{ username: targetPhone }, { phone: targetPhone }]
          });

          if (!existingUser) {
            const passwordHash = await bcrypt.hash('Admin123456', 10);
            await AdminUser.create({
              username: targetPhone,
              passwordHash,
              displayName: enterprise.contactPerson.name,
              role: 'enterprise_admin',
              enterpriseId: enterprise._id,
              phone: targetPhone,
              menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
              status: 'active',
            });
          } else if (existingUser.enterpriseId?.toString() !== enterprise._id.toString()) {
            return NextResponse.json({
              success: false,
              error: `婵€娲诲け璐ワ細鎵嬫満鍙?${targetPhone} 宸茶鍏朵粬璐﹀彿浣跨敤锛岃鍏堜慨鏀硅仈绯荤數璇濄€?`,
            }, { status: 400 });
          }
        }

        return NextResponse.json({
          success: true,
          data: sanitizeEnterpriseForResponse(
            enterprise.toObject() as unknown as Record<string, unknown>
          ),
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const { id } = await params;
        await Enterprise.findByIdAndDelete(id);
        return NextResponse.json({ success: true, message: 'Deleted successfully' });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
