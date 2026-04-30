import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { hasCompleteWecomConfig, normalizeWecomConfig } from '@/lib/enterprise-wecom';
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
    wecomReminderEnabled?: boolean;
    reminderIntervalHours?: number;
    maxReminderTimes?: number;
  };
  wecomConfig?: {
    corpId?: string;
    agentId?: string;
    secret?: string;
  };
}

export const dynamic = 'force-dynamic';

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
    wecomMemberStats?: {
      totalStaff: number;
      configuredStaff: number;
    };
  }
) {
  const wecomConfig =
    enterprise.wecomConfig && typeof enterprise.wecomConfig === 'object'
      ? {
          corpId: (enterprise.wecomConfig as { corpId?: string }).corpId || '',
          agentId: (enterprise.wecomConfig as { agentId?: string }).agentId || '',
        }
      : undefined;

  return {
    ...enterprise,
    wecomConfig,
    wecomSecretConfigured: Boolean(
      (enterprise.wecomConfig as { secret?: string } | undefined)?.secret
    ),
    wecomConfigConfigured: hasCompleteWecomConfig(
      enterprise.wecomConfig as {
        corpId?: string;
        agentId?: string;
        secret?: string;
      } | undefined
    ),
    wecomMemberStats: options?.wecomMemberStats || {
      totalStaff: 0,
      configuredStaff: 0,
    },
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

      const [aiSnapshot, wecomMemberStatsRow] = await Promise.all([
        EnterpriseAiUsageSnapshot.findOne({ enterpriseId: id }).lean(),
        AdminUser.aggregate([
          {
            $match: {
              enterpriseId: enterprise._id,
              role: { $in: ['enterprise_admin', 'salesperson', 'measurer', 'designer'] },
            },
          },
          {
            $group: {
              _id: '$enterpriseId',
              totalStaff: { $sum: 1 },
              configuredStaff: {
                $sum: {
                  $cond: [
                    {
                      $gt: [{ $strLenCP: { $ifNull: ['$wecomUserId', ''] } }, 0],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
      ]);

      return NextResponse.json({
        success: true,
        data: sanitizeEnterpriseForResponse(enterprise as unknown as Record<string, unknown>, {
          aiSnapshot,
          wecomMemberStats: {
            totalStaff: wecomMemberStatsRow[0]?.totalStaff || 0,
            configuredStaff: wecomMemberStatsRow[0]?.configuredStaff || 0,
          },
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
          wecomConfig,
        } = body;

        const currentEnterprise = await Enterprise.findById(enterpriseId).select('contactPerson wecomConfig');
        if (!currentEnterprise) {
          return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
        }

        const updateData: Record<string, unknown> = {};
        const unsetData: Record<string, unknown> = {};

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
          updateData.automationConfig = {
            followUpSlaHours: Number(automationConfig.followUpSlaHours || 24),
            measureTaskSlaHours: Number(automationConfig.measureTaskSlaHours || 48),
            designTaskSlaHours: Number(automationConfig.designTaskSlaHours || 72),
            wecomReminderEnabled: automationConfig.wecomReminderEnabled !== false,
            reminderIntervalHours: Number(automationConfig.reminderIntervalHours || 24),
            maxReminderTimes: Number(automationConfig.maxReminderTimes || 3),
          };
        }
        if (wecomConfig !== undefined) {
          const normalizedWecomConfig = normalizeWecomConfig(wecomConfig, {
            currentSecret: currentEnterprise.wecomConfig?.secret,
          });
          if (normalizedWecomConfig.mode === 'set') {
            updateData.wecomConfig = normalizedWecomConfig.value;
          } else {
            unsetData.wecomConfig = 1;
          }
        }

        const updateOperation: Record<string, unknown> = {};
        if (Object.keys(updateData).length > 0) {
          updateOperation.$set = updateData;
        }
        if (Object.keys(unsetData).length > 0) {
          updateOperation.$unset = unsetData;
        }

        const enterprise = await Enterprise.findByIdAndUpdate(enterpriseId, updateOperation, { new: true });
        if (!enterprise) {
          return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
        }

        if (status === 'active' && enterprise.contactPerson?.phone) {
          const existingUser = await AdminUser.findOne({ username: enterprise.contactPerson.phone });
          if (!existingUser) {
            const passwordHash = await bcrypt.hash('Admin123456', 10);
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
