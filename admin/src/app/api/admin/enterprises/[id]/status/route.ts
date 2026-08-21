import { NextResponse } from 'next/server';
import {
  enterpriseStatusEventToDto,
  enterpriseToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { ensureEnterpriseAdminForActiveEnterprise } from '@/lib/enterprise-admin-provision';
import {
  EnterpriseStatusTransitionError,
} from '@/lib/enterprise-status';
import { withTenantRoute } from '@/lib/tenant-route';
import { notifyEnterpriseContactOfJoinResult } from '@/lib/wechat-notification';

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async (context) => {
        const { id } = await params;
        const body = (await request.json()) as {
          action?: unknown;
          reason?: unknown;
        };
        const enterpriseId = parsePostgresId(id);
        const actorAdminId = parsePostgresId(context.userId, 'actor admin id');

        const result = await withPlatformTransaction(async (transaction) => {
          const enterprises = new EnterpriseRepository(transaction);
          const adminUsers = new AdminUserRepository(transaction);
          const applied = await enterprises.applyStatusAction({
            enterpriseId,
            action: body.action as string,
            reason: body.reason,
            actorAdminId,
          });
          if (!applied) return null;

          if (applied.transition.toStatus === 'active') {
            await ensureEnterpriseAdminForActiveEnterprise(
              adminUsers,
              applied.enterprise
            );
          }

          const statusEvents = await enterprises.listStatusEvents(
            enterpriseId,
            20
          );
          return { applied, statusEvents };
        });

        if (!result) {
          return NextResponse.json(
            { success: false, error: 'Enterprise not found' },
            { status: 404 }
          );
        }

        const action = String(body.action || '');
        if (action === 'approve' || action === 'reject') {
          const enterprise = result.applied.enterprise;
          void notifyEnterpriseContactOfJoinResult({
            enterpriseName: enterprise.name,
            contactPerson: enterprise.contactPerson as {
              name?: unknown;
              phone?: unknown;
            } | null,
            appliedAt: enterprise.createdAt,
            result: action === 'approve' ? 'approved' : 'rejected',
          }).catch((error) => {
            console.error('Enterprise join result notification dispatch failed:', error);
          });
        }

        return NextResponse.json({
          success: true,
          data: {
            ...sanitizeEnterpriseForResponse(
              enterpriseToDto(result.applied.enterprise)
            ),
            statusEvents: result.statusEvents.map(enterpriseStatusEventToDto),
          },
        });
      }
    );
  } catch (error: unknown) {
    if (error instanceof EnterpriseStatusTransitionError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 400 }
      );
    }
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
