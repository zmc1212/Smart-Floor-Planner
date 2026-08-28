import { NextResponse } from 'next/server';
import {
  enterpriseStatusEventToDto,
  enterpriseToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  applyEnterpriseStatusChange,
  enterpriseStatusChangeErrorResponse,
} from '@/lib/enterprise-status-change';
import { withTenantRoute } from '@/lib/tenant-route';

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

        const result = await applyEnterpriseStatusChange({
          enterpriseId: parsePostgresId(id),
          action: body.action,
          reason: body.reason,
          actorAdminId: parsePostgresId(context.userId, 'actor admin id'),
        });

        if (!result) {
          return NextResponse.json(
            { success: false, error: 'Enterprise not found' },
            { status: 404 }
          );
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
    const { status, body } = enterpriseStatusChangeErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
