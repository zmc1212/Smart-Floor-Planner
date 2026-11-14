/** Deployment switch for the weekly report worker. Parsing is pure: it never
 * reads the database, generates or sends reports, changes environment variables,
 * or falls back from an invalid pilot setup to the enterprise worker.
 *
 * The weekly worker has its own environment variables and never reads
 * `XIAOK_STAGE_REMINDER_*`. ID validation keeps the same rules as
 * `stage-reminder-config.ts`: positive bigint enterprise id and a 1-128
 * character pilot id. */
export const weeklyReportModes = ['enterprise', 'pilot'] as const;
export type WeeklyReportMode = typeof weeklyReportModes[number];

export type WeeklyReportConfigError =
  | 'weekly_report_mode_invalid'
  | 'weekly_report_enterprise_required'
  | 'weekly_report_enterprise_invalid'
  | 'weekly_report_pilot_required'
  | 'weekly_report_pilot_invalid';

export type WeeklyReportConfig =
  | { ok: true; mode: 'enterprise'; enterpriseId: string | null; pilotId: null }
  | { ok: true; mode: 'pilot'; enterpriseId: string; pilotId: string }
  | { ok: false; mode: WeeklyReportMode | null; code: WeeklyReportConfigError };

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

/** Read the weekly report worker mode from the deployment environment.
 *
 * An unset mode keeps the existing enterprise-wide weekly reports. A pilot run
 * requires both a valid enterprise id and a valid pilot id; every incomplete or
 * invalid pilot setup returns an explicit error instead of retrying as
 * enterprise. */
export function readWeeklyReportConfig(
  env: Record<string, string | undefined> = process.env,
): WeeklyReportConfig {
  const rawMode = env.XIAOK_WEEKLY_REPORT_MODE?.trim().toLowerCase() ?? '';
  const mode: WeeklyReportMode | null = rawMode === '' ? 'enterprise'
    : weeklyReportModes.includes(rawMode as WeeklyReportMode) ? rawMode as WeeklyReportMode : null;
  if (mode === null) return { ok: false, mode: null, code: 'weekly_report_mode_invalid' };

  const enterprise = parseEnterpriseId(env.XIAOK_WEEKLY_REPORT_ENTERPRISE_ID);
  const pilot = parsePilotId(env.XIAOK_WEEKLY_REPORT_PILOT_ID);
  if (mode === 'enterprise') {
    // The existing weekly reports stay unchanged: a pilot id is never used to
    // turn an enterprise run into a pilot run.
    if (enterprise.state === 'invalid') return { ok: false, mode, code: 'weekly_report_enterprise_invalid' };
    return { ok: true, mode,
      enterpriseId: enterprise.state === 'valid' ? enterprise.value : null, pilotId: null };
  }
  if (enterprise.state === 'missing') return { ok: false, mode, code: 'weekly_report_enterprise_required' };
  if (enterprise.state === 'invalid') return { ok: false, mode, code: 'weekly_report_enterprise_invalid' };
  if (pilot.state === 'missing') return { ok: false, mode, code: 'weekly_report_pilot_required' };
  if (pilot.state === 'invalid') return { ok: false, mode, code: 'weekly_report_pilot_invalid' };
  return { ok: true, mode, enterpriseId: enterprise.value, pilotId: pilot.value };
}
