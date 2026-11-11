/** Pure-IO helpers for restoring the B5.2 acceptance mutations.
 *
 * The acceptance script changes two persisted settings rows and temporarily
 * revokes customer access / media. These helpers snapshot the original values,
 * restore them with explicit nulls (never `String(null)`), re-read the rows and
 * report mismatches. Every function takes a tiny `Queryable`, so the behaviour
 * is testable offline without a real PostgreSQL connection.
 */

export interface Queryable {
  query<T = unknown>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface ReportPlanSnapshot {
  enabled: boolean | null;
  stage_enabled: boolean | null;
  next_daily_at: Date | null;
  next_weekly_at: Date | null;
  stage_cursor: string | null;
  project_ids: unknown;
  audiences: unknown;
}

export interface AgentSettingsSnapshot {
  agent_config: unknown | null;
  enabled: boolean | null;
}

export interface RestorationStep {
  name: string;
  run(): Promise<void>;
  verify?(): Promise<string[]>;
}

export interface RestorationOutcome {
  name: string;
  restored: boolean;
  error: string | null;
  mismatches: string[];
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function reportPlanSnapshot(row: Record<string, unknown>): ReportPlanSnapshot {
  return {
    enabled: nullableBoolean(row.enabled),
    stage_enabled: nullableBoolean(row.stage_enabled),
    next_daily_at: nullableDate(row.next_daily_at),
    next_weekly_at: nullableDate(row.next_weekly_at),
    stage_cursor: nullableText(row.stage_cursor),
    project_ids: row.project_ids === undefined ? null : row.project_ids,
    audiences: row.audiences === undefined ? null : row.audiences,
  };
}

export function agentSettingsSnapshot(row: Record<string, unknown> | undefined): AgentSettingsSnapshot {
  if (!row) return { agent_config: null, enabled: null };
  return {
    agent_config: row.agent_config === undefined ? null : row.agent_config,
    enabled: nullableBoolean(row.enabled),
  };
}

export async function restoreReportPlan(
  pool: Queryable,
  enterpriseId: string,
  snapshot: ReportPlanSnapshot,
): Promise<void> {
  await pool.query(
    `update app.construction_report_settings
        set enabled=$1::boolean, stage_enabled=$2::boolean,
            next_daily_at=$3::timestamptz, next_weekly_at=$4::timestamptz,
            stage_cursor=$5::bigint, project_ids=$6::jsonb, audiences=$7::jsonb,
            updated_at=now()
      where enterprise_id=$8::bigint`,
    [
      snapshot.enabled,
      snapshot.stage_enabled,
      snapshot.next_daily_at,
      snapshot.next_weekly_at,
      snapshot.stage_cursor,
      JSON.stringify(snapshot.project_ids ?? []),
      JSON.stringify(snapshot.audiences ?? []),
      enterpriseId,
    ],
  );
}

export async function restoreAgentSettings(
  pool: Queryable,
  enterpriseId: string,
  snapshot: AgentSettingsSnapshot,
): Promise<void> {
  const config = snapshot.agent_config === null || snapshot.agent_config === undefined
    ? null
    : JSON.stringify(snapshot.agent_config);
  await pool.query(
    `update app.assistant_enterprise_settings
        set agent_config=$1::jsonb, enabled=$2::boolean, updated_at=now()
      where enterprise_id=$3::bigint`,
    [config, snapshot.enabled, enterpriseId],
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function describeValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return canonicalJson(value);
}

export async function verifyReportPlan(
  pool: Queryable,
  enterpriseId: string,
  snapshot: ReportPlanSnapshot,
): Promise<string[]> {
  const row = (await pool.query<Record<string, unknown>>(
    `select enabled, stage_enabled, next_daily_at, next_weekly_at, stage_cursor, project_ids, audiences
       from app.construction_report_settings where enterprise_id=$1::bigint`,
    [enterpriseId],
  )).rows[0];
  if (!row) return ['report settings row is missing'];
  const actual = reportPlanSnapshot(row);
  const mismatches: string[] = [];
  if (actual.enabled !== snapshot.enabled) {
    mismatches.push(`enabled expected ${describeValue(snapshot.enabled)} got ${describeValue(actual.enabled)}`);
  }
  if (actual.stage_enabled !== snapshot.stage_enabled) {
    mismatches.push(`stage_enabled expected ${describeValue(snapshot.stage_enabled)} got ${describeValue(actual.stage_enabled)}`);
  }
  if (!sameInstant(actual.next_daily_at, snapshot.next_daily_at)) {
    mismatches.push(`next_daily_at expected ${describeValue(snapshot.next_daily_at)} got ${describeValue(actual.next_daily_at)}`);
  }
  if (!sameInstant(actual.next_weekly_at, snapshot.next_weekly_at)) {
    mismatches.push(`next_weekly_at expected ${describeValue(snapshot.next_weekly_at)} got ${describeValue(actual.next_weekly_at)}`);
  }
  if (actual.stage_cursor !== snapshot.stage_cursor) {
    mismatches.push(`stage_cursor expected ${describeValue(snapshot.stage_cursor)} got ${describeValue(actual.stage_cursor)}`);
  }
  if (canonicalJson(actual.project_ids) !== canonicalJson(snapshot.project_ids)) {
    mismatches.push(`project_ids expected ${describeValue(snapshot.project_ids)} got ${describeValue(actual.project_ids)}`);
  }
  if (canonicalJson(actual.audiences) !== canonicalJson(snapshot.audiences)) {
    mismatches.push(`audiences expected ${describeValue(snapshot.audiences)} got ${describeValue(actual.audiences)}`);
  }
  return mismatches;
}

export async function verifyAgentSettings(
  pool: Queryable,
  enterpriseId: string,
  snapshot: AgentSettingsSnapshot,
): Promise<string[]> {
  const row = (await pool.query<Record<string, unknown>>(
    `select agent_config, enabled from app.assistant_enterprise_settings where enterprise_id=$1::bigint`,
    [enterpriseId],
  )).rows[0];
  if (!row) return ['assistant enterprise settings row is missing'];
  const actual = agentSettingsSnapshot(row);
  const mismatches: string[] = [];
  if (canonicalJson(actual.agent_config) !== canonicalJson(snapshot.agent_config)) {
    mismatches.push(`agent_config expected ${describeValue(snapshot.agent_config)} got ${describeValue(actual.agent_config)}`);
  }
  if (actual.enabled !== snapshot.enabled) {
    mismatches.push(`enabled expected ${describeValue(snapshot.enabled)} got ${describeValue(actual.enabled)}`);
  }
  return mismatches;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A mutable restoration responsibility for one external account status. */
export interface AccountStatusResponsibility {
  /** Original status captured before any mutation; null means "not captured". */
  before: string | null;
  /** True from the moment a mutation is attempted until a confirmed restore. */
  changed: boolean;
}

/** The real account-status operations; tests inject offline doubles. */
export interface AccountStatusPort {
  setStatus(status: string): Promise<unknown>;
  readStatus(): Promise<{ status: string }>;
}

/**
 * Attempt one account-status change.
 *
 * Responsibility is registered before `setStatus` runs, so a committed update
 * whose independent read-back fails is still restored by the caller's finally
 * path. A successful restore back to `before` only clears the responsibility
 * after the read-back confirms the original status.
 */
export async function applyAccountStatus(
  responsibility: AccountStatusResponsibility,
  target: string,
  port: AccountStatusPort,
): Promise<{ status: string }> {
  if (responsibility.before === null) {
    throw new Error('the account status before the change was not captured');
  }
  responsibility.changed = true;
  await port.setStatus(target);
  const readBack = await port.readStatus();
  if (readBack.status !== target) {
    throw new Error(
      `the account status change did not take effect (expected ${target}, got ${readBack.status})`,
    );
  }
  // A successful restore is only complete once the read-back confirms it.
  if (target === responsibility.before) responsibility.changed = false;
  return readBack;
}

/**
 * Restoration step for an account status responsibility. The flag is cleared
 * only by a successful read-back of the original status; a failed update, a
 * failed read-back or a mismatched status keeps the responsibility registered.
 */
export function accountStatusRestorationStep(
  responsibility: AccountStatusResponsibility,
  port: AccountStatusPort,
  name = 'account_status',
): RestorationStep {
  return {
    name,
    run: async () => {
      if (!responsibility.changed || responsibility.before === null) return;
      await port.setStatus(responsibility.before);
    },
    verify: async () => {
      if (responsibility.before === null) return [];
      const current = await port.readStatus();
      if (current.status !== responsibility.before) {
        return [`status is ${current.status}`];
      }
      responsibility.changed = false;
      return [];
    },
  };
}

/**
 * Run each restoration step in order. A failing step never stops the following
 * steps; its error and any post-restore mismatches are recorded instead.
 */
export async function runRestorations(
  steps: readonly RestorationStep[],
): Promise<RestorationOutcome[]> {
  const outcomes: RestorationOutcome[] = [];
  for (const step of steps) {
    let error: string | null = null;
    let mismatches: string[] = [];
    try {
      await step.run();
    } catch (runError) {
      error = messageOf(runError);
    }
    if (error === null && step.verify) {
      try {
        mismatches = await step.verify();
      } catch (verifyError) {
        error = messageOf(verifyError);
      }
    }
    outcomes.push({
      name: step.name,
      restored: error === null && mismatches.length === 0,
      error,
      mismatches,
    });
  }
  return outcomes;
}
