import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { enterpriseToDto, parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
  type EnterpriseUpdate,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';

export const dynamic = 'force-dynamic';

interface EnterprisePatchBody {
  name?: string;
  code?: string;
  contactPerson?: Record<string, unknown>;
  status?: string;
  logo?: string;
  branding?: Record<string, unknown>;
  groundPromotionFixedCommission?: number;
  automationConfig?: Record<string, unknown>;
}

const DEFAULT_ENTERPRISE_AUTOMATION_CONFIG = {
  followUpSlaHours: 24,
  measureTaskSlaHours: 48,
  designTaskSlaHours: 72,
  reminderIntervalHours: 24,
  maxReminderTimes: 3,
  miniprogramNotificationEnabled: true,
};

function normalizeAutomationConfig(
  automationConfig?: Record<string, unknown>
) {
  return {
    followUpSlaHours: Number(
      automationConfig?.followUpSlaHours ||
        DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.followUpSlaHours
    ),
    measureTaskSlaHours: Number(
      automationConfig?.measureTaskSlaHours ||
        DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.measureTaskSlaHours
    ),
    designTaskSlaHours: Number(
      automationConfig?.designTaskSlaHours ||
        DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.designTaskSlaHours
    ),
    reminderIntervalHours: Number(
      automationConfig?.reminderIntervalHours ||
        DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.reminderIntervalHours
    ),
    maxReminderTimes: Number(
      automationConfig?.maxReminderTimes ||
        DEFAULT_ENTERPRISE_AUTOMATION_CONFIG.maxReminderTimes
    ),
    miniprogramNotificationEnabled:
      automationConfig?.miniprogramNotificationEnabled !== false,
  };
}

function sanitizeEnterpriseForResponse(
  enterprise: ReturnType<typeof enterpriseToDto>
) {
  const aiConfig = enterprise.aiConfig;
  return {
    ...enterprise,
    automationConfig: normalizeAutomationConfig(enterprise.automationConfig),
    aiConfig:
      Object.keys(aiConfig).length > 0
        ? {
            provider: aiConfig.provider,
            keyMode: aiConfig.keyMode,
            pollinationsKeyRef: aiConfig.pollinationsKeyRef || '',
            pollinationsKeyName: aiConfig.pollinationsKeyName || '',
            pollinationsMaskedKey: aiConfig.pollinationsMaskedKey || '',
            allowedModels: aiConfig.allowedModels || [],
            pollenBudget: aiConfig.pollenBudget ?? null,
            lastSyncedAt: aiConfig.lastSyncedAt || null,
          }
        : undefined,
    aiUsageSnapshot: null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'] },
      async (context) => {
        const { id } = await params;
        if (context.role === 'enterprise_admin' && context.enterpriseId !== id) {
          return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
        const enterprise = await withPlatformTransaction((transaction) =>
          new EnterpriseRepository(transaction).findById(parsePostgresId(id))
        );
        if (!enterprise) {
          return NextResponse.json(
            { success: false, error: 'Enterprise not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: sanitizeEnterpriseForResponse(enterpriseToDto(enterprise)),
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'] },
      async (context) => {
        const { id } = await params;
        if (context.role === 'enterprise_admin' && context.enterpriseId !== id) {
          return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
        const enterpriseId = parsePostgresId(id);
        const body = (await request.json()) as EnterprisePatchBody;
        const enterprise = await withPlatformTransaction(
          async (transaction) => {
            const enterprises = new EnterpriseRepository(transaction);
            const adminUsers = new AdminUserRepository(transaction);
            const current = await enterprises.findById(enterpriseId);
            if (!current) return null;

            const updateData: EnterpriseUpdate = {};
            if (body.name !== undefined) updateData.name = body.name;
            if (body.code !== undefined) updateData.code = body.code;
            if (body.contactPerson !== undefined) {
              updateData.contactPerson = body.contactPerson;
            }
            if (body.status !== undefined) updateData.status = body.status;
            if (body.logo !== undefined) updateData.logo = body.logo;
            if (body.branding !== undefined) {
              updateData.branding = body.branding;
            }
            if (body.groundPromotionFixedCommission !== undefined) {
              updateData.groundPromotionFixedCommission = String(
                Number(body.groundPromotionFixedCommission)
              );
            }
            if (body.automationConfig !== undefined) {
              updateData.automationConfig = normalizeAutomationConfig(
                body.automationConfig
              );
            }
            const updated = await enterprises.update(
              enterpriseId,
              updateData
            );
            if (!updated) return null;

            const contact = updated.contactPerson;
            const phone =
              typeof contact.phone === 'string' ? contact.phone.trim() : '';
            if (body.status === 'active' && phone) {
              const existingUser =
                await adminUsers.findByUsernameOrPhone(phone);
              if (!existingUser) {
                await adminUsers.create({
                  username: phone,
                  passwordHash: await bcrypt.hash('Admin123456', 10),
                  displayName:
                    typeof contact.name === 'string' ? contact.name : '',
                  role: 'enterprise_admin',
                  enterpriseId: updated.id,
                  phone,
                  menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
                  status: 'active',
                });
              } else if (existingUser.enterpriseId !== updated.id) {
                throw Object.assign(
                  new Error(`手机号 ${phone} 已被其他企业账号使用`),
                  { code: 'ACCOUNT_CONFLICT' }
                );
              }
            }
            return updated;
          }
        );

        if (!enterprise) {
          return NextResponse.json(
            { success: false, error: 'Enterprise not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: sanitizeEnterpriseForResponse(enterpriseToDto(enterprise)),
        });
      }
    );
  } catch (error: unknown) {
    const details = error as { code?: string };
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      {
        status:
          details.code === '23505' || details.code === 'ACCOUNT_CONFLICT'
            ? 400
            : 500,
      }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const { id } = await params;
        const deleted = await withPlatformTransaction((transaction) =>
          new EnterpriseRepository(transaction).delete(parsePostgresId(id))
        );
        if (!deleted) {
          return NextResponse.json(
            { success: false, error: 'Enterprise not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          message: 'Deleted successfully',
        });
      }
    );
  } catch (error: unknown) {
    const details = error as { code?: string };
    const message =
      details.code === '23503'
        ? 'Enterprise still has related records and cannot be deleted'
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: details.code === '23503' ? 409 : 500 }
    );
  }
}
