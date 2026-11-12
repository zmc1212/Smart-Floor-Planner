import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/auth';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import { requirePlatformAdmin, workflowApiError } from '@/lib/native-workflow/server';
import {
  readScheduledPeriodReportDispatch,
  setScheduledPeriodReportPaused,
} from '@/lib/native-workflow/live/period-report-schedule';
import {
  readWeeklyScheduleSettings,
  type WeeklyScheduleSettingsSnapshot,
} from '@/lib/native-workflow/live/period-report-schedule-ports';
import {
  createFilePeriodReportScheduleStore,
  resolveNativeWorkflowScheduleDir,
} from '@/lib/native-workflow/live/period-report-schedule-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function store() {
  return createFilePeriodReportScheduleStore({
    rootDir: resolveNativeWorkflowScheduleDir(),
  });
}

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
      store: store(),
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
    || !['pause', 'resume'].includes(String((body as Record<string, unknown>).action))
  ) {
    return NextResponse.json(
      { success: false, error: 'invalid_schedule_control' },
      { status: 422 },
    );
  }
  const input = body as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.slice(0, 300) : null;
  try {
    const control = await setScheduledPeriodReportPaused({
      enterpriseId: context.enterpriseId!,
      paused: input.action === 'pause',
      updatedBy: context.userId,
      reason,
      store: store(),
    });
    return NextResponse.json({ success: true, data: control });
  } catch (error) {
    return workflowApiError(error);
  }
}
