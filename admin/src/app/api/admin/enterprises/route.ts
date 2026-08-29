import { NextResponse } from 'next/server';
import { enterpriseToDto, parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';
import { hashEnterpriseAdminInitialPassword, buildEnterpriseAdminUsername } from '@/lib/enterprise-admin-provision';
import { isEnterpriseStatus } from '@/lib/enterprise-status';
import { httpErrorStatus } from '@/lib/http-error';
import {
  assertPlatformEnterprisePurgeAllowed,
  PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT,
  PLATFORM_ENTERPRISE_BATCH_PURGE_MAX,
  purgePlatformEnterprise,
  verifyPlatformAdminSensitivePassword,
} from '@/lib/platform-enterprise-purge';

export const dynamic = 'force-dynamic';

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

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const enterprises = await withPlatformTransaction((transaction) =>
          new EnterpriseRepository(transaction).list()
        );
        return NextResponse.json({
          success: true,
          data: enterprises.map((enterprise) =>
            sanitizeEnterpriseForResponse(enterpriseToDto(enterprise))
          ),
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

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const body = (await request.json()) as Record<string, unknown>;
        if (!body.name || !body.code) {
          return NextResponse.json(
            { success: false, error: 'Enterprise name and code are required' },
            { status: 400 }
          );
        }
        const contactPerson = (body.contactPerson || {}) as Record<
          string,
          unknown
        >;
        if (!contactPerson.name || !contactPerson.phone) {
          return NextResponse.json(
            { success: false, error: 'Enterprise contact name and phone are required' },
            { status: 400 }
          );
        }
        const result = await withPlatformTransaction(async (transaction) => {
          const enterprises = new EnterpriseRepository(transaction);
          const adminUsers = new AdminUserRepository(transaction);
          if (await enterprises.findByCode(String(body.code).trim())) {
            throw Object.assign(new Error('Enterprise code already exists'), {
              code: '23505',
            });
          }
          const enterprise = await enterprises.create({
            name: String(body.name).trim(),
            code: String(body.code).trim(),
            status: isEnterpriseStatus(body.status)
              ? body.status
              : 'pending_approval',
            registrationMode: 'manual',
            contactPerson,
            address: body.address ? String(body.address) : null,
            industry: body.industry ? String(body.industry) : null,
            description: body.description ? String(body.description) : null,
            logo: body.logo ? String(body.logo) : null,
            branding:
              (body.branding as Record<string, unknown> | undefined) || {},
            groundPromotionFixedCommission: String(
              Number(body.groundPromotionFixedCommission || 0)
            ),
            automationConfig: normalizeAutomationConfig(
              body.automationConfig as Record<string, unknown> | undefined
            ),
          });

          const phone = contactPerson.phone
            ? String(contactPerson.phone).trim()
            : '';
          if (phone) {
            if (await adminUsers.findByUsernameOrPhone(phone)) {
              throw Object.assign(
                new Error(`手机号 ${phone} 已被其他系统账号使用`),
                { code: 'ACCOUNT_CONFLICT' }
              );
            }
            await adminUsers.create({
              username: buildEnterpriseAdminUsername(phone, enterprise.id),
              passwordHash: await hashEnterpriseAdminInitialPassword(),
              mustChangePassword: true,
              displayName: contactPerson.name
                ? String(contactPerson.name)
                : '',
              role: 'enterprise_admin',
              enterpriseId: enterprise.id,
              phone,
              menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
              status: 'active',
            });
          }
          return enterprise;
        });

        return NextResponse.json({
          success: true,
          data: sanitizeEnterpriseForResponse(enterpriseToDto(result)),
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

export async function DELETE(request: Request) {
  try {
    assertPlatformEnterprisePurgeAllowed();
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const body = (await request.json().catch(() => ({}))) as {
          ids?: unknown;
          confirmText?: string;
          securityPassword?: string;
        };
        if (!Array.isArray(body.ids) || !body.ids.length) {
          return NextResponse.json(
            {
              success: false,
              error: `请选择 1–${PLATFORM_ENTERPRISE_BATCH_PURGE_MAX} 家企业进行删除`,
            },
            { status: 400 }
          );
        }

        let uniqueIds: bigint[];
        try {
          uniqueIds = [...new Set<bigint>(
            body.ids.map((id: unknown) =>
              parsePostgresId(String(id), 'enterprise id')
            )
          )];
        } catch {
          return NextResponse.json(
            { success: false, error: '企业 ID 无效' },
            { status: 400 }
          );
        }
        if (
          uniqueIds.length < 1 ||
          uniqueIds.length > PLATFORM_ENTERPRISE_BATCH_PURGE_MAX
        ) {
          return NextResponse.json(
            {
              success: false,
              error: `请选择 1–${PLATFORM_ENTERPRISE_BATCH_PURGE_MAX} 家企业进行删除`,
            },
            { status: 400 }
          );
        }

        const confirmText = String(body.confirmText || '').trim();
        if (confirmText !== PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT) {
          return NextResponse.json(
            {
              success: false,
              error: `请输入「${PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT}」以确认批量删除`,
            },
            { status: 400 }
          );
        }

        const adminUserId = parsePostgresId(context.userId, 'user id');
        await verifyPlatformAdminSensitivePassword(
          adminUserId,
          String(body.securityPassword || '')
        );

        const deleted: Array<{
          id: string;
          name: string;
          totalRows: number;
        }> = [];
        const failed: Array<{
          id: string;
          error: string;
          code?: string;
        }> = [];

        for (const enterpriseId of uniqueIds) {
          try {
            const result = await purgePlatformEnterprise({ enterpriseId });
            deleted.push({
              id: enterpriseId.toString(),
              name: result.enterpriseName,
              totalRows: result.totalRows,
            });
          } catch (error) {
            failed.push({
              id: enterpriseId.toString(),
              error: error instanceof Error ? error.message : '删除企业失败',
              code: (error as { code?: string }).code,
            });
          }
        }

        return NextResponse.json({
          success: failed.length === 0,
          data: { deleted, failed },
        });
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '批量删除企业失败',
      },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
