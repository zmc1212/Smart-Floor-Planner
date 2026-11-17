import { checkPilotWorkerAlignment, type PilotWorkerAlignment,
  type PilotWorkerAlignmentErrorCode } from './pilot-worker-alignment';

/** Deployment gate in front of the reminder and weekly-report workers.
 *
 * The previous default treated an unset mode as an enterprise-wide run, so a
 * Worker started without any pilot configuration could generate and deliver
 * reminders, reports and in-app notifications for a whole enterprise. This gate
 * allows the four business workers only when both configurations resolve to the
 * same explicit pilot. Enterprise-wide and platform-wide runs are closed until
 * a pilot scope is configured; there is no fallback and no acknowledgement
 * switch that silently re-opens the enterprise scope.
 *
 * The gate is pure: it never reads the database, never sends a notification and
 * never falls back from pilot to enterprise. The saved pilot scope is still
 * resolved separately for every tick, so an inactive or emptied scope stops
 * generation and delivery even when this gate is open. */
export type WorkerSafetyGateStatus = 'open' | 'closed';
export type WorkerSafetyGateReason =
  | 'pilot_scope_configured'
  | 'pilot_worker_alignment'
  | 'pilot_scope_missing'
  | 'enterprise_scope_not_allowed'
  /** The platform super admin explicitly switched the Worker off. */
  | 'worker_disabled';
export type WorkerSafetyGateErrorCode =
  | PilotWorkerAlignmentErrorCode
  | 'worker_pilot_scope_missing'
  | 'worker_enterprise_scope_not_allowed'
  | 'worker_disabled';

export type WorkerSafetyGate = {
  status: WorkerSafetyGateStatus;
  reason: WorkerSafetyGateReason;
  /** Scope the four business workers would use if they run. */
  deliveryScope: 'pilot' | 'none';
  mode: 'enterprise' | 'pilot' | null;
  enterpriseId: string | null;
  pilotId: string | null;
  errorCode: WorkerSafetyGateErrorCode | null;
};

/** Evaluate the deployment gate. Only an aligned pilot configuration opens the
 * reminder and weekly-report workers. An enterprise mode is reported with its
 * configured ids but remains closed; absence of any explicit mode is reported
 * as a missing pilot scope. */
export function evaluateWorkerSafetyGate(
  env: Record<string, string | undefined> = process.env,
): WorkerSafetyGate {
  const alignment: PilotWorkerAlignment = checkPilotWorkerAlignment(env);
  if (alignment.status !== 'aligned' || alignment.mode === null) {
    return {
      status: 'closed', reason: 'pilot_worker_alignment', deliveryScope: 'none',
      mode: alignment.mode, enterpriseId: alignment.enterpriseId, pilotId: alignment.pilotId,
      errorCode: alignment.errorCode ?? 'pilot_worker_mode_mismatch',
    };
  }
  if (alignment.mode === 'pilot') {
    return {
      status: 'open', reason: 'pilot_scope_configured', deliveryScope: 'pilot',
      mode: 'pilot', enterpriseId: alignment.enterpriseId, pilotId: alignment.pilotId,
      errorCode: null,
    };
  }
  // Enterprise-wide generation and delivery stay closed in I7.5.8. The old
  // default (an unset mode) is reported distinctly from a deliberate
  // enterprise configuration, so operators can see why nothing ran.
  const explicitEnterprise = Boolean(env.XIAOK_STAGE_REMINDER_MODE?.trim())
    || Boolean(env.XIAOK_WEEKLY_REPORT_MODE?.trim())
    || Boolean(env.XIAOK_STAGE_REMINDER_ENTERPRISE_ID?.trim())
    || Boolean(env.XIAOK_WEEKLY_REPORT_ENTERPRISE_ID?.trim());
  return {
    status: 'closed',
    reason: explicitEnterprise ? 'enterprise_scope_not_allowed' : 'pilot_scope_missing',
    deliveryScope: 'none', mode: 'enterprise',
    enterpriseId: alignment.enterpriseId, pilotId: null,
    errorCode: explicitEnterprise
      ? 'worker_enterprise_scope_not_allowed'
      : 'worker_pilot_scope_missing',
  };
}
