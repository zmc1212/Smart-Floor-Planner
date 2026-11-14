import { processAssistantJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { advanceKnowledgeBatches } from '@/lib/assistant/knowledge/batch-worker';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { deliverPublicConsents } from '@/lib/construction/public-projections';
import { processPortfolioCopy } from '@/lib/portfolio/copy-service';
import {
  advanceConfiguredConstructionReports,
  deliverConfiguredConstructionReports,
} from '@/lib/construction/report-worker';
import {
  advanceConfiguredStageReminders,
  deliverConfiguredStageReminders,
} from '@/lib/xiaok-v1/stage-reminder-worker';
import { checkPilotWorkerAlignment, type PilotWorkerAlignment } from '@/lib/xiaok-v1/pilot-worker-alignment';
import { nativeWorkflowEnabled } from '@/lib/native-workflow/live/tenant-allowlist';

/** The optional dependencies keep production behaviour identical while letting
 * the Worker route be verified by call counts. Every default is the same
 * function the route used before this extraction. */
export type AssistantJobsTickDependencies = {
  now?: Date;
  env?: Record<string, string | undefined>;
  advanceKnowledgeBatches?: typeof advanceKnowledgeBatches;
  processAssistantJob?: typeof processAssistantJob;
  processAssistantRun?: typeof processAssistantRun;
  deliverSiteNotifications?: typeof deliverSiteNotifications;
  deliverPublicConsents?: typeof deliverPublicConsents;
  processPortfolioCopy?: typeof processPortfolioCopy;
  advanceConfiguredConstructionReports?: typeof advanceConfiguredConstructionReports;
  deliverConfiguredConstructionReports?: typeof deliverConfiguredConstructionReports;
  advanceConfiguredStageReminders?: typeof advanceConfiguredStageReminders;
  deliverConfiguredStageReminders?: typeof deliverConfiguredStageReminders;
  checkPilotWorkerAlignment?: typeof checkPilotWorkerAlignment;
  nativeWorkflowEnabled?: typeof nativeWorkflowEnabled;
  runNativeWorkflowScheduleTick?: () => Promise<unknown>;
  runNativeDelegationTick?: () => Promise<unknown>;
  runNativeDurableToolTick?: () => Promise<unknown>;
};

export type AssistantJobsTickData = {
  claimed: boolean;
  portfolioCopyClaimed: boolean;
  inAppDeliveries: number;
  knowledgeBatchChecks: unknown;
  constructionReportChecks: unknown;
  constructionReportDeliveries: unknown;
  stageReminderChecks: unknown;
  stageReminderDeliveries: unknown;
  pilotScopeAlignment: PilotWorkerAlignment;
  nativeWorkflowSchedule: unknown;
  nativeWorkflowDelegations: unknown;
  nativeWorkflowTools: unknown;
};

/** One internal assistant Worker tick.
 *
 * The reminder and weekly-report workers must resolve to the same deployment
 * mode (and, in pilot mode, the same enterprise and pilot) before either may
 * generate or deliver. Other Assistant jobs stay independent and keep running
 * even when one of the pilot workers fails. */
export async function runAssistantJobsTick(
  input: AssistantJobsTickDependencies = {},
): Promise<AssistantJobsTickData> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const knowledgeBatches = input.advanceKnowledgeBatches ?? advanceKnowledgeBatches;
  const assistantJob = input.processAssistantJob ?? processAssistantJob;
  const assistantRun = input.processAssistantRun ?? processAssistantRun;
  const siteNotifications = input.deliverSiteNotifications ?? deliverSiteNotifications;
  const publicConsents = input.deliverPublicConsents ?? deliverPublicConsents;
  const portfolioCopy = input.processPortfolioCopy ?? processPortfolioCopy;
  const advanceReports = input.advanceConfiguredConstructionReports ?? advanceConfiguredConstructionReports;
  const deliverReports = input.deliverConfiguredConstructionReports ?? deliverConfiguredConstructionReports;
  const advanceReminders = input.advanceConfiguredStageReminders ?? advanceConfiguredStageReminders;
  const deliverReminders = input.deliverConfiguredStageReminders ?? deliverConfiguredStageReminders;
  const alignmentOf = input.checkPilotWorkerAlignment ?? checkPilotWorkerAlignment;
  const workflowEnabled = input.nativeWorkflowEnabled ?? nativeWorkflowEnabled;

  const pilotScopeAlignment = alignmentOf(env);
  const pilotWorkersEnabled = pilotScopeAlignment.status === 'aligned';

  // The B5.9 weekly scheduler runs inside this existing Worker tick. It is
  // loaded only when the enterprise allowlist is explicitly enabled; a
  // failure is isolated and never blocks the existing assistant/report jobs.
  let nativeWorkflowSchedule: unknown = null;
  if (workflowEnabled(env.NATIVE_WORKFLOW_SCHEDULE_ENABLED) || workflowEnabled(env.NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED)) {
    try {
      const run = input.runNativeWorkflowScheduleTick
        ?? (async () => (await import('@/lib/native-workflow/live/period-report-schedule-runtime')).runNativeWorkflowScheduleTick());
      nativeWorkflowSchedule = await run();
    } catch {
      nativeWorkflowSchedule = { enabled: true, error: 'native_workflow_schedule_unavailable' };
    }
  }

  const knowledgeBatchChecks = await knowledgeBatches();

  let constructionReportChecks: unknown;
  if (pilotWorkersEnabled) {
    try { constructionReportChecks = await advanceReports({ now }); }
    catch { constructionReportChecks = { error: 'construction_report_unavailable' }; }
  } else {
    constructionReportChecks = { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode };
  }

  // I7.1 deterministic reminders are isolated from model and report failures.
  let stageReminderChecks: unknown;
  if (pilotWorkersEnabled) {
    try { stageReminderChecks = await advanceReminders({ now }); }
    catch { stageReminderChecks = { error: 'stage_reminder_unavailable' }; }
  } else {
    stageReminderChecks = { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode };
  }

  const data = await assistantJob(assistantRun);

  let nativeWorkflowDelegations: unknown = null;
  if (workflowEnabled(env.NATIVE_WORKFLOW_DELEGATION_ENABLED)) {
    try {
      const run = input.runNativeDelegationTick
        ?? (async () => (await import('@/lib/native-workflow/live/delegation-worker')).runNativeDelegationTick());
      nativeWorkflowDelegations = await run();
    } catch {
      nativeWorkflowDelegations = { enabled: true, error: 'native_workflow_delegations_unavailable' };
    }
  }

  let nativeWorkflowTools: unknown = null;
  if (workflowEnabled(env.NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED)) {
    try {
      const run = input.runNativeDurableToolTick
        ?? (async () => (await import('@/lib/native-workflow/live/durable-tool-worker')).runNativeDurableToolTick());
      nativeWorkflowTools = await run();
    } catch {
      nativeWorkflowTools = { enabled: true, error: 'native_workflow_tools_unavailable' };
    }
  }

  let constructionReportDeliveries: unknown;
  let reportDelivery: { delivered?: number } | null = null;
  if (pilotWorkersEnabled) {
    try { reportDelivery = await deliverReports({ now }); }
    catch { reportDelivery = null; }
    constructionReportDeliveries = reportDelivery
      ?? { error: 'construction_report_delivery_unavailable' };
  } else {
    constructionReportDeliveries = { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode, delivered: 0 };
  }

  const inAppDeliveries = await siteNotifications() + await publicConsents()
    + (reportDelivery?.delivered ?? 0);

  let stageReminderDeliveries: unknown;
  if (pilotWorkersEnabled) {
    try { stageReminderDeliveries = await deliverReminders({ now }); }
    catch { stageReminderDeliveries = { error: 'stage_reminder_delivery_unavailable' }; }
  } else {
    stageReminderDeliveries = { skipped: true, reason: 'pilot_worker_alignment', errorCode: pilotScopeAlignment.errorCode };
  }

  const portfolioCopyClaimed = data.claimed ? false : await portfolioCopy();

  return {
    claimed: data.claimed || portfolioCopyClaimed || inAppDeliveries > 0,
    portfolioCopyClaimed,
    inAppDeliveries,
    knowledgeBatchChecks,
    constructionReportChecks,
    constructionReportDeliveries,
    stageReminderChecks,
    stageReminderDeliveries,
    pilotScopeAlignment,
    nativeWorkflowSchedule,
    nativeWorkflowDelegations,
    nativeWorkflowTools,
  };
}
