import { advanceStageReminders, type ReminderPilotScopeStatus,
  type StageReminderAdvance } from './reminder-service';
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
      scannedProjects: 0, skippedProjects: 0, created: 0,
      errors: [{ enterpriseId: '', projectId: '', code: config.code }] };
  }
  const advance = input.advance ?? advanceStageReminders;
  if (config.mode === 'enterprise') {
    const result = await advance(input.now, config.enterpriseId ?? undefined);
    return { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
      scannedProjects: null, skippedProjects: null, created: result.created, errors: result.errors };
  }
  const result = await advance(input.now, config.enterpriseId, config.pilotId);
  return { mode: 'pilot', pilotId: config.pilotId,
    scopeVersion: result.scopeVersion ?? null, scopeStatus: result.scopeStatus ?? null,
    scannedProjects: result.scannedProjects ?? 0, skippedProjects: result.skippedProjects ?? 0,
    created: result.created, errors: result.errors };
}
