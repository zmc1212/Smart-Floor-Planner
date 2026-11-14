/** Deployment switch for the stage reminder worker. Parsing is pure: it never
 * reads the database, sends notifications, changes environment variables or
 * falls back from an invalid pilot setup to the enterprise worker. */
export const stageReminderModes = ['enterprise', 'pilot'] as const;
export type StageReminderMode = typeof stageReminderModes[number];

export type StageReminderConfigError =
  | 'stage_reminder_mode_invalid'
  | 'stage_reminder_enterprise_required'
  | 'stage_reminder_enterprise_invalid'
  | 'stage_reminder_pilot_required'
  | 'stage_reminder_pilot_invalid';

export type StageReminderConfig =
  | { ok: true; mode: 'enterprise'; enterpriseId: string | null; pilotId: null }
  | { ok: true; mode: 'pilot'; enterpriseId: string; pilotId: string }
  | { ok: false; mode: StageReminderMode | null; code: StageReminderConfigError };

const enterpriseIdPattern = /^[1-9]\d{0,18}$/u;
const pilotIdPattern = /^[a-zA-Z0-9._:-]{1,128}$/u;
const maxPostgresBigint = 9223372036854775807n;

type ParsedValue =
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'valid'; value: string };

function parseEnterpriseId(value: string | undefined): ParsedValue {
  const normalized = value?.trim() ?? '';
  if (!normalized) return { state: 'missing' };
  return enterpriseIdPattern.test(normalized) && BigInt(normalized) <= maxPostgresBigint
    ? { state: 'valid', value: normalized }
    : { state: 'invalid' };
}

function parsePilotId(value: string | undefined): ParsedValue {
  const normalized = value?.trim() ?? '';
  if (!normalized) return { state: 'missing' };
  return pilotIdPattern.test(normalized)
    ? { state: 'valid', value: normalized }
    : { state: 'invalid' };
}

/** Read the worker mode from the deployment environment.
 *
 * An unset mode keeps the existing enterprise-wide worker. A pilot run requires
 * both a valid enterprise id and a valid pilot id; every incomplete or invalid
 * pilot setup returns an explicit error instead of retrying as enterprise. */
export function readStageReminderConfig(
  env: Record<string, string | undefined> = process.env,
): StageReminderConfig {
  const rawMode = env.XIAOK_STAGE_REMINDER_MODE?.trim().toLowerCase() ?? '';
  const mode: StageReminderMode | null = rawMode === '' ? 'enterprise'
    : stageReminderModes.includes(rawMode as StageReminderMode) ? rawMode as StageReminderMode : null;
  if (mode === null) return { ok: false, mode: null, code: 'stage_reminder_mode_invalid' };

  const enterprise = parseEnterpriseId(env.XIAOK_STAGE_REMINDER_ENTERPRISE_ID);
  const pilot = parsePilotId(env.XIAOK_STAGE_REMINDER_PILOT_ID);
  if (mode === 'enterprise') {
    // The existing worker stays unchanged: a pilot id is never used to turn an
    // enterprise run into a pilot run.
    if (enterprise.state === 'invalid') return { ok: false, mode, code: 'stage_reminder_enterprise_invalid' };
    return { ok: true, mode,
      enterpriseId: enterprise.state === 'valid' ? enterprise.value : null, pilotId: null };
  }
  if (enterprise.state === 'missing') return { ok: false, mode, code: 'stage_reminder_enterprise_required' };
  if (enterprise.state === 'invalid') return { ok: false, mode, code: 'stage_reminder_enterprise_invalid' };
  if (pilot.state === 'missing') return { ok: false, mode, code: 'stage_reminder_pilot_required' };
  if (pilot.state === 'invalid') return { ok: false, mode, code: 'stage_reminder_pilot_invalid' };
  return { ok: true, mode, enterpriseId: enterprise.value, pilotId: pilot.value };
}
