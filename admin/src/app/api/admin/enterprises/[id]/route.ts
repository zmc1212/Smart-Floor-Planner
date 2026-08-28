import { NextResponse } from 'next/server';
import {
  enterpriseStatusEventToDto,
  enterpriseToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  EnterpriseRepository,
  type EnterpriseUpdate,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import {
  assertPlatformEnterprisePurgeAllowed,
  purgePlatformEnterprise,
  verifyPlatformAdminSensitivePassword,
} from '@/lib/platform-enterprise-purge';
import {
  isPlatformAdminRole,
  parseReferrerAdditionalEnterpriseLimit,
} from '@/lib/referrer-join-limits';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

interface EnterprisePatchBody {
  name?: string;
  code?: string;
  contactPerson?: Record<string, unknown>;
  logo?: string;
  branding?: Record<string, unknown>;
  groundPromotionFixedCommission?: number;
  automationConfig?: Record<string, unknown>;
  referrerAdditionalEnterpriseLimit?: number | null;
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
          return NextResponse.json(
            { success: false, error: 'Forbidden' },
            { status: 403 }
          );
        }
        const payload = await withPlatformTransaction(async (transaction) => {
          const enterprises = new EnterpriseRepository(transaction);
          const enterprise = await enterprises.findById(parsePostgresId(id));
          if (!enterprise) return null;
          const statusEvents =
            context.role === 'super_admin' || context.role === 'admin'
              ? await enterprises.listStatusEvents(enterprise.id, 20)
              : [];
          return { enterprise, statusEvents };
        });
        if (!payload) {
          return NextResponse.json(
            { success: false, error: 'Enterprise not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: {
            ...sanitizeEnterpriseForResponse(
              enterpriseToDto(payload.enterprise)
            ),
            statusEvents: payload.statusEvents.map(enterpriseStatusEventToDto),
          },
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
          return NextResponse.json(
            { success: false, error: 'Forbidden' },
            { status: 403 }
          );
        }
        const enterpriseId = parsePostgresId(id);
        const body = (await request.json()) as EnterprisePatchBody & {
          status?: unknown;
        };
        if (body.status !== undefined) {
          return NextResponse.json(
            {
              success: false,
              error:
                '企业状态请通过 POST /api/admin/enterprises/[id]/status 变更',
            },
            { status: 400 }
          );
        }
        if (body.referrerAdditionalEnterpriseLimit !== undefined) {
          if (!isPlatformAdminRole(context.role)) {
            return NextResponse.json(
              { success: false, error: 'Forbidden' },
              { status: 403 }
            );
          }
          const parsed = parseReferrerAdditionalEnterpriseLimit(
            body.referrerAdditionalEnterpriseLimit
          );
          if (!parsed.ok) {
            return NextResponse.json(
              {
                success: false,
                error: '推广人企业保护须为 0–99 的整数，或留空关闭',
              },
              { status: 400 }
            );
          }
        }
        const enterprise = await withPlatformTransaction(async (transaction) => {
          const enterprises = new EnterpriseRepository(transaction);
          const current = await enterprises.findById(enterpriseId);
          if (!current) return null;

          const updateData: EnterpriseUpdate = {};
          if (body.name !== undefined) updateData.name = body.name;
          if (body.code !== undefined) updateData.code = body.code;
          if (body.contactPerson !== undefined) {
            updateData.contactPerson = body.contactPerson;
          }
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
          if (body.referrerAdditionalEnterpriseLimit !== undefined) {
            const parsed = parseReferrerAdditionalEnterpriseLimit(
              body.referrerAdditionalEnterpriseLimit
            );
            if (parsed.ok) {
              updateData.referrerAdditionalEnterpriseLimit = parsed.value;
            }
          }
          return enterprises.update(enterpriseId, updateData);
        });

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
    assertPlatformEnterprisePurgeAllowed();
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const { id } = await params;
        const body = (await request.json().catch(() => ({}))) as {
          confirmEnterpriseName?: string;
          securityPassword?: string;
        };
        const confirmEnterpriseName = String(
          body.confirmEnterpriseName || ''
        ).trim();
        if (!confirmEnterpriseName) {
          return NextResponse.json(
            { success: false, error: '请输入企业全名以确认删除整家企业' },
            { status: 400 }
          );
        }

        const adminUserId = parsePostgresId(context.userId, 'user id');
        const enterpriseId = parsePostgresId(id);
        await verifyPlatformAdminSensitivePassword(
          adminUserId,
          String(body.securityPassword || '')
        );
        const data = await purgePlatformEnterprise({
          enterpriseId,
          confirmEnterpriseName,
        });
        return NextResponse.json({
          success: true,
          data: {
            ...data,
            enterpriseDeleted: true,
          },
          message: '企业已删除',
        });
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '删除企业失败',
      },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
