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
import { advanceConfiguredConstructionReports, deliverConfiguredConstructionReports } from '@/lib/construction/report-worker';
import { advanceConfiguredStageReminders, deliverConfiguredStageReminders } from '@/lib/xiaok-v1/stage-reminder-worker';
import { checkPilotWorkerAlignment } from '@/lib/xiaok-v1/pilot-worker-alignment';
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
    // Reminder and weekly-report workers must resolve to the same deployment
    // mode (and, in pilot mode, the same enterprise and pilot) before either
    // may generate or deliver. Other Assistant jobs stay independent.
    const pilotScopeAlignment = checkPilotWorkerAlignment();
    const pilotWorkersEnabled = pilotScopeAlignment.status === 'aligned';
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
    const constructionReportChecks = pilotWorkersEnabled
      ? await advanceConfiguredConstructionReports({ now: new Date() })
      : { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode };
    // I7.1 deterministic reminders are isolated from model and report failures.
    // I7.4.5-C2 resolves the deployment mode first: a pilot run only scans its
    // saved scope, and an invalid pilot configuration never runs as enterprise.
    let stageReminderChecks: unknown;
    if (pilotWorkersEnabled) {
      try { stageReminderChecks = await advanceConfiguredStageReminders({ now: new Date() }); }
      catch { stageReminderChecks = { error: 'stage_reminder_unavailable' }; }
    } else {
      stageReminderChecks = { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode };
    }
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
    const reportDelivery = pilotWorkersEnabled
      ? await deliverConfiguredConstructionReports({ now: new Date() })
      : null;
    const constructionReportDeliveries = reportDelivery
      ?? { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode, delivered: 0 };
    const inAppDeliveries = await deliverSiteNotifications() + await deliverPublicConsents()
      + (reportDelivery?.delivered ?? 0);
    let stageReminderDeliveries: unknown;
    if (pilotWorkersEnabled) {
      try { stageReminderDeliveries = await deliverConfiguredStageReminders({ now: new Date() }); }
      catch { stageReminderDeliveries = { error: 'stage_reminder_delivery_unavailable' }; }
    } else {
      stageReminderDeliveries = { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode };
    }
    const portfolioCopyClaimed = data.claimed ? false : await processPortfolioCopy();
    return NextResponse.json({ success: true, data: { ...data, claimed: data.claimed || portfolioCopyClaimed || inAppDeliveries > 0, portfolioCopyClaimed, inAppDeliveries, knowledgeBatchChecks, constructionReportChecks, constructionReportDeliveries, stageReminderChecks, stageReminderDeliveries, pilotScopeAlignment, nativeWorkflowSchedule, nativeWorkflowDelegations, nativeWorkflowTools }, requestId });
  } catch {
    return NextResponse.json({ success: false, code: 'assistant_unavailable', requestId }, { status: 503 });
  }
}
