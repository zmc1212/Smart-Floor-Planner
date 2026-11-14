import { randomUUID } from 'node:crypto';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { NextResponse } from 'next/server';
import { processAssistantJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { deliverPublicConsents } from '@/lib/construction/public-projections';
import { workerRuntimeSnapshot } from '@/lib/assistant/operations';
import { advanceKnowledgeBatches } from '@/lib/assistant/knowledge/batch-worker';
import { processPortfolioCopy } from '@/lib/portfolio/copy-service';
import { advanceConstructionReports, deliverConstructionReports } from '@/lib/construction/report-worker';
import { advanceStageReminders, deliverStageReminders } from '@/lib/xiaok-v1/reminder-service';
import { nativeWorkflowEnabled } from '@/lib/native-workflow/live/tenant-allowlist';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, code: 'unauthorized' }, { status: 401 });
  const runtime = await workerRuntimeSnapshot();
  return NextResponse.json({ success: true, data: { workerTiming: runtime.timing, retrieval: runtime.retrieval, worker: runtime.heartbeat, authConfigured: runtime.authConfigured, endpointConfigured: runtime.endpointConfigured } });
}
export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!authorized(request)) return NextResponse.json({ success: false, code: 'unauthorized', requestId }, { status: 401 });
  try {
    if ((await request.text()).trim() && (request.headers.get('content-length') !== '0')) {
      return NextResponse.json({ success: false, code: 'invalid_message', requestId }, { status: 422 });
    }
    // The B5.9 weekly scheduler runs inside this existing Worker tick. It is
    // loaded only when the enterprise allowlist is explicitly enabled; a
    // failure is isolated and never blocks the existing assistant/report jobs.
    let nativeWorkflowSchedule: unknown = null;
    if (nativeWorkflowEnabled(process.env.NATIVE_WORKFLOW_SCHEDULE_ENABLED) || nativeWorkflowEnabled(process.env.NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED)) {
      try {
        const { runNativeWorkflowScheduleTick } = await import(
          '@/lib/native-workflow/live/period-report-schedule-runtime'
        );
        nativeWorkflowSchedule = await runNativeWorkflowScheduleTick();
      } catch {
        nativeWorkflowSchedule = { enabled: true, error: 'native_workflow_schedule_unavailable' };
      }
    }
    const knowledgeBatchChecks=await advanceKnowledgeBatches();
    const constructionReportChecks = await advanceConstructionReports();
    // I7.1 deterministic reminders are isolated from model and report failures.
    let stageReminderChecks: unknown;
    try { stageReminderChecks = await advanceStageReminders(); }
    catch { stageReminderChecks = { error: 'stage_reminder_unavailable' }; }
    const data = await processAssistantJob(processAssistantRun);
    let nativeWorkflowDelegations: unknown = null;
    if (nativeWorkflowEnabled(process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED)) {
      try {
        const { runNativeDelegationTick } = await import('@/lib/native-workflow/live/delegation-worker');
        nativeWorkflowDelegations = await runNativeDelegationTick();
      } catch {
        nativeWorkflowDelegations = { enabled: true, error: 'native_workflow_delegations_unavailable' };
      }
    }
    let nativeWorkflowTools: unknown = null;
    if (nativeWorkflowEnabled(process.env.NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED)) {
      try {
        const { runNativeDurableToolTick } = await import('@/lib/native-workflow/live/durable-tool-worker');
        nativeWorkflowTools = await runNativeDurableToolTick();
      } catch {
        nativeWorkflowTools = { enabled: true, error: 'native_workflow_tools_unavailable' };
      }
    }
    const inAppDeliveries = await deliverSiteNotifications() + await deliverPublicConsents() + await deliverConstructionReports();
    let stageReminderDeliveries: unknown;
    try { stageReminderDeliveries = await deliverStageReminders(); }
    catch { stageReminderDeliveries = { error: 'stage_reminder_delivery_unavailable' }; }
    const portfolioCopyClaimed = data.claimed ? false : await processPortfolioCopy();
    return NextResponse.json({ success: true, data: { ...data, claimed: data.claimed || portfolioCopyClaimed || inAppDeliveries > 0, portfolioCopyClaimed, inAppDeliveries, knowledgeBatchChecks, constructionReportChecks, stageReminderChecks, stageReminderDeliveries, nativeWorkflowSchedule, nativeWorkflowDelegations, nativeWorkflowTools }, requestId });
  } catch {
    return NextResponse.json({ success: false, code: 'assistant_unavailable', requestId }, { status: 503 });
  }
}
