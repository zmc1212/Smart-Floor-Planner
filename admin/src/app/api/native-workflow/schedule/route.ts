import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/auth';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import { requirePlatformAdmin, workflowApiError } from '@/lib/native-workflow/server';
import {
  cancelScheduledPeriodReport,
  readScheduledPeriodReportDispatch,
  resolveEndedShanghaiWeek,
  setScheduledPeriodReportPaused,
} from '@/lib/native-workflow/live/period-report-schedule';
import {
  readWeeklyScheduleSettings,
  type WeeklyScheduleSettingsSnapshot,
} from '@/lib/native-workflow/live/period-report-schedule-ports';
import { createNativeRuntimeStores } from '@/lib/native-workflow/live/runtime-stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function tenantContext(request: Request) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return { denied };
  const context = await getTenantContext(request);
  if (!context) {
    return {
      denied: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (!context.enterpriseId) {
    return {
      denied: NextResponse.json(
        {
          success: false,
          error: 'enterprise_context_required',
          message: '需要有效的宿主企业上下文才能读取或管理调度',
        },
        { status: 409 },
      ),
    };
  }
  return { context };
}

/**
 * Read-only schedule summary/detail. The enterprise always comes from the
 * admin session/tenant selector, never from the query string.
 */
export async function GET(request: Request) {
  const auth = await tenantContext(request);
  if (auth.denied) return auth.denied;
  const context = auth.context!;
  const url = new URL(request.url);
  try {
    const result = await readScheduledPeriodReportDispatch({
      enterpriseId: context.enterpriseId!,
      store: createNativeRuntimeStores(context.enterpriseId!).store,
      ...(url.searchParams.get('runId')
        ? { runId: url.searchParams.get('runId')! }
        : {}),
      ...(url.searchParams.get('periodStart')
        ? { periodStart: url.searchParams.get('periodStart')! }
        : {}),
    });
    // The stored weekly slot is read without a lock or claim, so the operations
    // view can show the next execution time even before this cycle dispatches.
    let settings: WeeklyScheduleSettingsSnapshot | null = null;
    let settingsError: string | null = null;
    try {
      settings = await readWeeklyScheduleSettings({ enterpriseId: context.enterpriseId! });
    } catch (error) {
      settingsError = error instanceof WorkflowOperationError
        ? error.code
        : 'weekly_settings_unavailable';
    }
    return NextResponse.json({ success: true, data: { ...result, settings, settingsError } });
  } catch (error) {
    return workflowApiError(error);
  }
}

/** Tenant-scoped pause/resume for the weekly scheduler. */
export async function POST(request: Request) {
  const auth = await tenantContext(request);
  if (auth.denied) return auth.denied;
  const context = auth.context!;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'invalid_schedule_control' },
      { status: 422 },
    );
  }
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || !['pause', 'resume', 'cancel'].includes(String((body as Record<string, unknown>).action))
  ) {
    return NextResponse.json(
      { success: false, error: 'invalid_schedule_control' },
      { status: 422 },
    );
  }
  const input = body as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.slice(0, 300) : null;
  const action = String(input.action);
  if (action === 'cancel') {
    const requested = input.periodStart;
    if (requested !== undefined && (
      typeof requested !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(requested)
    )) {
      return NextResponse.json(
        { success: false, error: 'invalid_schedule_period' },
        { status: 422 },
      );
    }
    try {
      const result = await cancelScheduledPeriodReport({
        enterpriseId: context.enterpriseId!,
        periodStart: typeof requested === 'string'
          ? requested
          : resolveEndedShanghaiWeek(new Date()).periodStart,
        updatedBy: context.userId,
        reason,
        store: createNativeRuntimeStores(context.enterpriseId!).store,
      });
      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      return workflowApiError(error);
    }
  }
  try {
    const control = await setScheduledPeriodReportPaused({
      enterpriseId: context.enterpriseId!,
      paused: action === 'pause',
      updatedBy: context.userId,
      reason,
      store: createNativeRuntimeStores(context.enterpriseId!).store,
    });
    return NextResponse.json({ success: true, data: control });
  } catch (error) {
    return workflowApiError(error);
  }
}
