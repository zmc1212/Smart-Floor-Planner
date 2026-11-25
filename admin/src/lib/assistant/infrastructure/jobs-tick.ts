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
import { evaluateWorkerSafetyGate, type WorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';
import type { WorkerDeployment } from '@/lib/xiaok-v1/worker-runtime-config';
import { nativeWorkflowEnabled, nativeWorkflowEnterpriseIds } from '@/lib/native-workflow/live/tenant-allowlist';
import { delegationEnterprises } from '@/lib/native-workflow/live/delegation-config';
import { nativeWorkflowScope, workerTaskScope, type NativeWorkflowScope } from './worker-scope';

/** The optional dependencies keep production behaviour identical while letting
 * the Worker route be verified by call counts. Every default is the same
 * function the route used before this extraction. */
export type AssistantJobsTickDependencies = {
  now?: Date;
  env?: Record<string, string | undefined>;
  /** Resolved admin switch. Production resolves the saved database version
   * before calling the tick; direct callers keep the pure environment gate. */
  deployment?: WorkerDeployment;
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
  evaluateWorkerSafetyGate?: typeof evaluateWorkerSafetyGate;
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
  workerSafetyGate: WorkerSafetyGate;
  workerExecution: {
    businessTasksEnabled: boolean;
    mode: 'enterprise' | 'pilot' | null;
    enterpriseId: string | null;
    pilotId: string | null;
    taskScope: 'pilot_enterprise' | 'none';
  };
  nativeWorkflowScopes: {
    schedule: NativeWorkflowScope;
    delegations: NativeWorkflowScope;
    durableTools: NativeWorkflowScope;
  };
  nativeWorkflowSchedule: unknown;
  nativeWorkflowDelegations: unknown;
  nativeWorkflowTools: unknown;
};

/** Native workflow keeps its own explicit allowlist. In pilot mode that list
 * must contain exactly the pilot enterprise: a list with another enterprise is
 * skipped instead of silently sending reminders or writing workflow data
 * outside the pilot. */
function nativeScope(ids: readonly string[], pilotEnterpriseId: string | null,
  enabled: boolean): NativeWorkflowScope {
  return nativeWorkflowScope(ids, pilotEnterpriseId, enabled);
}

/** One internal assistant Worker tick.
 *
 * The reminder and weekly-report workers must resolve to the same explicit
 * pilot before any business task runs. When the safety gate is closed no task
 * with a notification, model-call or business-write side effect is invoked, so
 * a direct tick cannot start authorized work without a pilot. An active
 * Worker also handles user-initiated customer consultations across tenants.
 * Reminder, report and other background work keeps its pilot scope. */
export async function runAssistantJobsTick(
  input: AssistantJobsTickDependencies = {},
): Promise<AssistantJobsTickData> {
  const now = input.now ?? new Date();
  const env = input.deployment?.env ?? input.env ?? process.env;
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
  const safetyGateOf = input.evaluateWorkerSafetyGate ?? evaluateWorkerSafetyGate;
  const workflowEnabled = input.nativeWorkflowEnabled ?? nativeWorkflowEnabled;

  const pilotScopeAlignment = alignmentOf(env);
  const workerSafetyGate = input.deployment?.gate ?? safetyGateOf(env);
  const execution = workerTaskScope(workerSafetyGate);
  const businessTasksEnabled = execution.enabled;
  const pilotEnterpriseId = execution.enterpriseId;
  const taskScope = execution.scope;
  const skippedBusinessTasks = {
    skipped: true, reason: 'worker_safety_gate',
    gateReason: workerSafetyGate.reason, errorCode: workerSafetyGate.errorCode,
  };

  const scheduleEnabled = workflowEnabled(env.NATIVE_WORKFLOW_SCHEDULE_ENABLED)
    || workflowEnabled(env.NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED);
  const delegationEnabled = workflowEnabled(env.NATIVE_WORKFLOW_DELEGATION_ENABLED);
  const durableToolEnabled = workflowEnabled(env.NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED);
  const scheduleScope = !businessTasksEnabled
    ? { allowed: false, reason: 'worker_safety_gate' as const, enterpriseIds: [] }
    : nativeScope(nativeWorkflowEnterpriseIds(env.NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS),
      pilotEnterpriseId, scheduleEnabled);
  const processEnv = env as NodeJS.ProcessEnv;
  const delegationScope = !businessTasksEnabled
    ? { allowed: false, reason: 'worker_safety_gate' as const, enterpriseIds: [] }
    : nativeScope(delegationEnterprises(processEnv), pilotEnterpriseId, delegationEnabled);
  const durableToolScope = !businessTasksEnabled
    ? { allowed: false, reason: 'worker_safety_gate' as const, enterpriseIds: [] }
    : nativeScope(delegationEnterprises(processEnv), pilotEnterpriseId, durableToolEnabled);

  // The B5.9 weekly scheduler runs inside this existing Worker tick. It is
  // loaded only when the enterprise allowlist is explicitly enabled; a failure
  // is isolated and never blocks the existing assistant/report jobs.
  let nativeWorkflowSchedule: unknown = null;
  if (scheduleScope.allowed) {
    try {
      const run = input.runNativeWorkflowScheduleTick
        ?? (async () => (await import('@/lib/native-workflow/live/period-report-schedule-runtime')).runNativeWorkflowScheduleTick(processEnv));
      nativeWorkflowSchedule = await run();
    } catch {
      nativeWorkflowSchedule = { enabled: true, error: 'native_workflow_schedule_unavailable' };
    }
  } else if (scheduleScope.reason !== 'not_enabled') {
    nativeWorkflowSchedule = { skipped: true, reason: scheduleScope.reason };
  }

  const knowledgeBatchChecks = businessTasksEnabled
    ? await knowledgeBatches(taskScope)
    : { ...skippedBusinessTasks, task: 'knowledge_batches' };

  let constructionReportChecks: unknown;
  if (businessTasksEnabled) {
    try { constructionReportChecks = await advanceReports({ now, env }); }
    catch { constructionReportChecks = { error: 'construction_report_unavailable' }; }
  } else {
    constructionReportChecks = skippedBusinessTasks;
  }

  // I7.1 deterministic reminders are isolated from model and report failures.
  let stageReminderChecks: unknown;
  if (businessTasksEnabled) {
    try { stageReminderChecks = await advanceReminders({ now, env }); }
    catch { stageReminderChecks = { error: 'stage_reminder_unavailable' }; }
  } else {
    stageReminderChecks = skippedBusinessTasks;
  }

  const data = execution.assistantQueueScope
    ? await assistantJob(assistantRun, undefined, execution.assistantQueueScope)
    : { claimed: false, skipped: true, reason: 'worker_safety_gate' as const };

  let nativeWorkflowDelegations: unknown = null;
  if (delegationScope.allowed) {
    try {
      const run = input.runNativeDelegationTick
        ?? (async () => (await import('@/lib/native-workflow/live/delegation-worker')).runNativeDelegationTick(processEnv));
      nativeWorkflowDelegations = await run();
    } catch {
      nativeWorkflowDelegations = { enabled: true, error: 'native_workflow_delegations_unavailable' };
    }
  } else if (delegationScope.reason !== 'not_enabled') {
    nativeWorkflowDelegations = { skipped: true, reason: delegationScope.reason };
  }

  let nativeWorkflowTools: unknown = null;
  if (durableToolScope.allowed) {
    try {
      const run = input.runNativeDurableToolTick
        ?? (async () => (await import('@/lib/native-workflow/live/durable-tool-worker')).runNativeDurableToolTick(processEnv));
      nativeWorkflowTools = await run();
    } catch {
      nativeWorkflowTools = { enabled: true, error: 'native_workflow_tools_unavailable' };
    }
  } else if (durableToolScope.reason !== 'not_enabled') {
    nativeWorkflowTools = { skipped: true, reason: durableToolScope.reason };
  }

  let constructionReportDeliveries: unknown;
  let reportDelivery: { delivered?: number } | null = null;
  if (businessTasksEnabled) {
    try { reportDelivery = await deliverReports({ now, env }); }
    catch { reportDelivery = null; }
    constructionReportDeliveries = reportDelivery
      ?? { error: 'construction_report_delivery_unavailable' };
  } else {
    constructionReportDeliveries = { ...skippedBusinessTasks, delivered: 0 };
  }

  const siteNotificationDeliveries = businessTasksEnabled ? await siteNotifications(taskScope) : 0;
  const publicConsentDeliveries = businessTasksEnabled
    ? await publicConsents(pilotEnterpriseId ?? undefined)
    : 0;
  const inAppDeliveries = siteNotificationDeliveries + publicConsentDeliveries
    + (reportDelivery?.delivered ?? 0);

  let stageReminderDeliveries: unknown;
  if (businessTasksEnabled) {
    try { stageReminderDeliveries = await deliverReminders({ now, env }); }
    catch { stageReminderDeliveries = { error: 'stage_reminder_delivery_unavailable' }; }
  } else {
    stageReminderDeliveries = skippedBusinessTasks;
  }

  const portfolioCopyClaimed = data.claimed ? false
    : businessTasksEnabled ? await portfolioCopy(taskScope) : false;

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
    workerSafetyGate,
    workerExecution: {
      businessTasksEnabled,
      mode: workerSafetyGate.mode,
      enterpriseId: pilotEnterpriseId,
      pilotId: execution.pilotId,
      taskScope: taskScope ? 'pilot_enterprise' : 'none',
    },
    nativeWorkflowScopes: {
      schedule: scheduleScope,
      delegations: delegationScope,
      durableTools: durableToolScope,
    },
    nativeWorkflowSchedule,
    nativeWorkflowDelegations,
    nativeWorkflowTools,
  };
}
