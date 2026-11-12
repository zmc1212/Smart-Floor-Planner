import { NextResponse } from 'next/server';
import { AssistantError } from '@/lib/assistant/contracts';
import { getTenantContext } from '@/lib/auth';
import { readPeriodReportRunStatus } from '@/lib/native-workflow/live/period-report-status';
import { requirePlatformAdmin, workflowApiError } from '@/lib/native-workflow/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;

  const context = await getTenantContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  // The host tenant comes from the admin session/tenant selector only. Never
  // take an enterprise, project or report id from the query string.
  const enterpriseId = context.enterpriseId;
  if (!enterpriseId) {
    return NextResponse.json(
      {
        success: false,
        error: 'enterprise_context_required',
        message: '需要有效的宿主企业上下文才能读取运行状态',
      },
      { status: 409 },
    );
  }

  try {
    const { runId } = await params;
    const observation = await readPeriodReportRunStatus({
      runId,
      viewer: { enterpriseId, adminId: context.userId },
    });
    return NextResponse.json({ success: true, data: observation });
  } catch (error) {
    // The reader surfaces the construction report service's authorization
    // errors unchanged (403/404). They must not degrade into a 500 native
    // workflow error, which would hide a real access decision.
    if (error instanceof AssistantError) {
      return NextResponse.json(
        { success: false, error: error.code, message: error.code },
        { status: error.status },
      );
    }
    return workflowApiError(error);
  }
}
