import { readStageReminderConfig, type StageReminderConfig, type StageReminderConfigError } from './stage-reminder-config';
import { readWeeklyReportConfig, type WeeklyReportConfig, type WeeklyReportConfigError } from './weekly-report-config';

export type PilotWorkerAlignmentStatus = 'aligned' | 'mismatch' | 'invalid';
export type PilotWorkerAlignmentMode = 'enterprise' | 'pilot' | null;
export type PilotWorkerAlignmentErrorCode =
  | 'pilot_worker_mode_mismatch'
  | 'pilot_worker_enterprise_mismatch'
  | 'pilot_worker_pilot_mismatch'
  | StageReminderConfigError
  | WeeklyReportConfigError;

export type PilotWorkerAlignment = {
  status: PilotWorkerAlignmentStatus;
  mode: PilotWorkerAlignmentMode;
  enterpriseId: string | null;
  pilotId: string | null;
  reminderConfig: StageReminderConfig;
  weeklyReportConfig: WeeklyReportConfig;
  errorCode: PilotWorkerAlignmentErrorCode | null;
};

/** Validate that the reminder and weekly-report workers resolve to the same
 * deployment mode and, in pilot mode, the same enterprise and pilot.
 *
 * Parsing reuses both existing pure config readers. Any invalid or mismatched
 * configuration is reported as-is; this function never falls back to the
 * enterprise mode and never reads the database. */
export function checkPilotWorkerAlignment(
  env: Record<string, string | undefined> = process.env,
): PilotWorkerAlignment {
  const reminderConfig = readStageReminderConfig(env);
  const weeklyReportConfig = readWeeklyReportConfig(env);
  if (!reminderConfig.ok) {
    return { status: 'invalid', mode: null, enterpriseId: null, pilotId: null,
      reminderConfig, weeklyReportConfig, errorCode: reminderConfig.code };
  }
  if (!weeklyReportConfig.ok) {
    return { status: 'invalid', mode: null, enterpriseId: null, pilotId: null,
      reminderConfig, weeklyReportConfig, errorCode: weeklyReportConfig.code };
  }
  if (reminderConfig.mode !== weeklyReportConfig.mode) {
    const pilotSide = reminderConfig.mode === 'pilot' ? reminderConfig : weeklyReportConfig;
    return { status: 'mismatch', mode: 'pilot', enterpriseId: pilotSide.enterpriseId, pilotId: pilotSide.pilotId,
      reminderConfig, weeklyReportConfig, errorCode: 'pilot_worker_mode_mismatch' };
  }
  if (reminderConfig.mode === 'enterprise') {
    // The enterprise id is optional in this mode. One configured value is
    // enough; only two different explicit values are inconsistent.
    const ids = [reminderConfig.enterpriseId, weeklyReportConfig.enterpriseId]
      .filter((value): value is string => !!value);
    if (new Set(ids).size > 1) {
      return { status: 'mismatch', mode: 'enterprise', enterpriseId: ids[0], pilotId: null,
        reminderConfig, weeklyReportConfig, errorCode: 'pilot_worker_enterprise_mismatch' };
    }
    return { status: 'aligned', mode: 'enterprise', enterpriseId: ids[0] ?? null, pilotId: null,
      reminderConfig, weeklyReportConfig, errorCode: null };
  }
  if (reminderConfig.enterpriseId !== weeklyReportConfig.enterpriseId) {
    return { status: 'mismatch', mode: 'pilot', enterpriseId: reminderConfig.enterpriseId,
      pilotId: reminderConfig.pilotId, reminderConfig, weeklyReportConfig,
      errorCode: 'pilot_worker_enterprise_mismatch' };
  }
  if (reminderConfig.pilotId !== weeklyReportConfig.pilotId) {
    return { status: 'mismatch', mode: 'pilot', enterpriseId: reminderConfig.enterpriseId,
      pilotId: reminderConfig.pilotId, reminderConfig, weeklyReportConfig,
      errorCode: 'pilot_worker_pilot_mismatch' };
  }
  return { status: 'aligned', mode: 'pilot', enterpriseId: reminderConfig.enterpriseId,
    pilotId: reminderConfig.pilotId, reminderConfig, weeklyReportConfig, errorCode: null };
}
