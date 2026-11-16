import { advanceStageReminders, deliverStageReminders, type ReminderDeliveryError,
  type ReminderDeliveryScopeStatus, type ReminderPilotScopeStatus, type StageReminderAdvance,
  type StageReminderDelivery } from './reminder-service';
import { readStageReminderConfig, type StageReminderMode } from './stage-reminder-config';

export type StageReminderAdvanceFn =
  (now: Date, enterpriseId?: string, pilotId?: string) => Promise<StageReminderAdvance>;

/** Reported by the internal Worker tick for deterministic stage reminders. An
 * enterprise run has no pilot scope, so its scope fields stay null instead of
 * inventing values. A config error is reported here and never retried as an
 * enterprise run. */
export type StageReminderChecks = {
  mode: StageReminderMode | null;
  pilotId: string | null;
  scopeVersion: number | null;
  scopeStatus: ReminderPilotScopeStatus | null;
  scannedProjects: number | null;
  skippedProjects: number | null;
  candidates: number;
  created: number;
  errors: StageReminderAdvance['errors'];
};

/** Resolve the configured reminder mode and run exactly that mode. */
export async function advanceConfiguredStageReminders(input: {
  now: Date;
  env?: Record<string, string | undefined>;
  advance?: StageReminderAdvanceFn;
}): Promise<StageReminderChecks> {
  const config = readStageReminderConfig(input.env);
  if (!config.ok) {
    return { mode: config.mode, pilotId: null, scopeVersion: null, scopeStatus: null,
      scannedProjects: 0, skippedProjects: 0, candidates: 0, created: 0,
      errors: [{ enterpriseId: '', projectId: '', code: config.code }] };
  }
  const advance = input.advance ?? advanceStageReminders;
  if (config.mode === 'enterprise') {
    const result = await advance(input.now, config.enterpriseId ?? undefined);
    return { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
      scannedProjects: null, skippedProjects: null,
      candidates: result.candidates, created: result.created, errors: result.errors };
  }
  const result = await advance(input.now, config.enterpriseId, config.pilotId);
  return { mode: 'pilot', pilotId: config.pilotId,
    scopeVersion: result.scopeVersion ?? null, scopeStatus: result.scopeStatus ?? null,
    scannedProjects: result.scannedProjects ?? 0, skippedProjects: result.skippedProjects ?? 0,
    candidates: result.candidates, created: result.created, errors: result.errors };
}

export type StageReminderDeliverFn =
  (now: Date, enterpriseId?: string, pilotId?: string) => Promise<StageReminderDelivery>;

/** Reported by the internal Worker tick for reminder delivery. Enterprise runs
 * have no pilot scope, so the scope fields stay null instead of inventing
 * values. A config error is reported here and never retried as enterprise. */
export type StageReminderDeliveryChecks = {
  mode: StageReminderMode | null;
  pilotId: string | null;
  scopeVersion: number | null;
  scopeStatus: ReminderDeliveryScopeStatus | null;
  scannedProjects: number | null;
  skippedProjects: number | null;
  delivered: number;
  no_inbox: number;
  paused: number;
  cancelled: number;
  failed: number;
  errors: ReminderDeliveryError[];
};

/** Resolve the configured reminder mode and deliver exactly that mode.
 *
 * This reads the same `readStageReminderConfig()` entry as the advance step, so
 * generation and delivery of one Worker tick always use the same mode and the
 * same pilotId. An invalid configuration delivers nothing and never falls back
 * to the enterprise-wide delivery. */
export async function deliverConfiguredStageReminders(input: {
  now: Date;
  env?: Record<string, string | undefined>;
  deliver?: StageReminderDeliverFn;
}): Promise<StageReminderDeliveryChecks> {
  const config = readStageReminderConfig(input.env);
  if (!config.ok) {
    return { mode: config.mode, pilotId: null, scopeVersion: null, scopeStatus: null,
      scannedProjects: 0, skippedProjects: 0, delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0,
      errors: [{ enterpriseId: '', projectId: '', code: config.code }] };
  }
  const deliver = input.deliver ?? deliverStageReminders;
  if (config.mode === 'enterprise') {
    const result = await deliver(input.now, config.enterpriseId ?? undefined);
    return { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
      scannedProjects: null, skippedProjects: null, delivered: result.delivered, no_inbox: result.no_inbox,
      paused: result.paused, cancelled: result.cancelled, failed: result.failed, errors: result.errors };
  }
  const result = await deliver(input.now, config.enterpriseId, config.pilotId);
  return { mode: 'pilot', pilotId: config.pilotId,
    scopeVersion: result.scopeVersion ?? null, scopeStatus: result.scopeStatus ?? null,
    scannedProjects: result.scannedProjects ?? 0, skippedProjects: result.skippedProjects ?? 0,
    delivered: result.delivered, no_inbox: result.no_inbox, paused: result.paused,
    cancelled: result.cancelled, failed: result.failed, errors: result.errors };
}
