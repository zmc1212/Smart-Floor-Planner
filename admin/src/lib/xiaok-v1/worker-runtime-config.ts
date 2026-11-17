import { sql } from 'drizzle-orm';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { evaluateWorkerSafetyGate, type WorkerSafetyGate } from './worker-safety-gate';

/** Admin-configured start/stop switch for the assistant Worker.
 *
 * Every save appends an immutable version to `app.assistant_worker_settings`.
 * The latest version is authoritative. Environment variables only provide the
 * initial values while no row exists, so a deployment that already used
 * XIAOK_* variables keeps its behavior until an operator saves the switch.
 *
 * The switch never widens delivery: an enabled record still has to resolve an
 * active, non-empty pilot project scope on every tick. */

export const workerSettingsTable = 'assistant_worker_settings';

const enterpriseIdPattern = /^[1-9]\d{0,18}$/u;
const pilotIdPattern = /^[a-zA-Z0-9._:-]{1,128}$/u;
const maxPostgresBigint = 9223372036854775807n;

export type WorkerRuntimeConfig = {
  version: number;
  enabled: boolean;
  enterpriseId: string | null;
  pilotId: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type WorkerRuntimeConfigSource = 'database' | 'environment';

/** The gate plus the environment a tick may use. `env` is the base process
 * environment with the XIAOK_* pilot pairs replaced by the saved database
 * values (or removed when the switch is off), so every downstream worker sees
 * exactly one scope. */
export type WorkerDeployment = {
  source: WorkerRuntimeConfigSource;
  config: WorkerRuntimeConfig | null;
  gate: WorkerSafetyGate;
  env: Record<string, string | undefined>;
};

export const workerPilotEnvKeys = [
  'XIAOK_STAGE_REMINDER_MODE',
  'XIAOK_STAGE_REMINDER_ENTERPRISE_ID',
  'XIAOK_STAGE_REMINDER_PILOT_ID',
  'XIAOK_WEEKLY_REPORT_MODE',
  'XIAOK_WEEKLY_REPORT_ENTERPRISE_ID',
  'XIAOK_WEEKLY_REPORT_PILOT_ID',
] as const;

const configColumns = sql`version,enabled,enterprise_id::text as "enterpriseId",pilot_id as "pilotId",
  updated_by::text as "updatedBy",updated_at as "updatedAt"`;

type WorkerRuntimeConfigRow = Omit<WorkerRuntimeConfig, 'updatedAt'> & { updatedAt: string | Date };

const configDto = (row: WorkerRuntimeConfigRow): WorkerRuntimeConfig => ({
  ...row, updatedAt: new Date(row.updatedAt).toISOString(),
});

export async function readWorkerRuntimeConfig(tx: PostgresTransaction): Promise<WorkerRuntimeConfig | undefined> {
  const row = await one<WorkerRuntimeConfigRow>(tx, sql`select ${configColumns}
    from app.assistant_worker_settings order by version desc limit 1`);
  return row ? configDto(row) : undefined;
}

/** The Worker deployment currently in effect. A saved row wins; otherwise the
 * legacy environment pairs decide. A read failure also falls back to the
 * environment, which can only open the gate when the deployment already names
 * an explicit aligned pilot there. */
export async function resolveWorkerDeployment(input: {
  env?: Record<string, string | undefined>;
  read?: () => Promise<WorkerRuntimeConfig | undefined>;
} = {}): Promise<WorkerDeployment> {
  const env = input.env ?? process.env;
  const read = input.read
    ?? (() => withPlatformTransaction(tx => readWorkerRuntimeConfig(tx), { readOnly: true }));
  let config: WorkerRuntimeConfig | undefined;
  try {
    config = await read();
  } catch {
    config = undefined;
  }
  if (!config) {
    return { source: 'environment', config: null, gate: evaluateWorkerSafetyGate(env), env };
  }
  const effectiveEnv: Record<string, string | undefined> = { ...env };
  for (const key of workerPilotEnvKeys) delete effectiveEnv[key];
  if (config.enabled && config.enterpriseId && config.pilotId) {
    Object.assign(effectiveEnv, {
      XIAOK_STAGE_REMINDER_MODE: 'pilot',
      XIAOK_STAGE_REMINDER_ENTERPRISE_ID: config.enterpriseId,
      XIAOK_STAGE_REMINDER_PILOT_ID: config.pilotId,
      XIAOK_WEEKLY_REPORT_MODE: 'pilot',
      XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: config.enterpriseId,
      XIAOK_WEEKLY_REPORT_PILOT_ID: config.pilotId,
    });
  }
  return { source: 'database', config, gate: workerSafetyGateFromConfig(config), env: effectiveEnv };
}

/** A saved record opens the gate only when it is enabled and names both ids.
 * An enterprise-wide run cannot be configured here, so this never re-opens the
 * legacy enterprise scope. */
export function workerSafetyGateFromConfig(config: WorkerRuntimeConfig): WorkerSafetyGate {
  if (!config.enabled) {
    return {
      status: 'closed', reason: 'worker_disabled', deliveryScope: 'none',
      mode: null, enterpriseId: null, pilotId: null, errorCode: 'worker_disabled',
    };
  }
  if (!config.enterpriseId || !config.pilotId) {
    return {
      status: 'closed', reason: 'pilot_scope_missing', deliveryScope: 'none',
      mode: null, enterpriseId: config.enterpriseId, pilotId: config.pilotId,
      errorCode: 'worker_pilot_scope_missing',
    };
  }
  return {
    status: 'open', reason: 'pilot_scope_configured', deliveryScope: 'pilot',
    mode: 'pilot', enterpriseId: config.enterpriseId, pilotId: config.pilotId, errorCode: null,
  };
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !enterpriseIdPattern.test(value.trim())
    || BigInt(value.trim()) > maxPostgresBigint) fail('worker_settings_invalid', 422);
  return value.trim();
}

function optionalPilotId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !pilotIdPattern.test(value.trim())) fail('worker_settings_invalid', 422);
  return value.trim();
}

/** Validate an explicit enterprise/pilot id coming from a query string. */
export function workerEnterpriseId(value: unknown): string {
  const parsed = optionalId(value);
  if (!parsed) fail('worker_settings_invalid', 422);
  return parsed;
}

export function workerPilotId(value: unknown): string {
  const parsed = optionalPilotId(value);
  if (!parsed) fail('worker_settings_invalid', 422);
  return parsed;
}

/** Append one switch version. `expectedVersion` is the version the browser
 * loaded; a concurrent change is a 409 instead of a silent overwrite. */
export async function saveWorkerRuntimeConfig(input: {
  enabled: unknown;
  enterpriseId: unknown;
  pilotId: unknown;
  expectedVersion: unknown;
  updatedBy: string;
}): Promise<WorkerRuntimeConfig> {
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : fail('worker_settings_invalid', 422);
  const enterpriseId = optionalId(input.enterpriseId);
  const pilotId = optionalPilotId(input.pilotId);
  const expectedVersion = input.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 0 || expectedVersion >= 2147483647) {
    fail('worker_settings_invalid', 422);
  }
  if (pilotId && !enterpriseId) fail('worker_settings_invalid', 422);
  if (enabled && (!enterpriseId || !pilotId)) fail('worker_settings_invalid', 422);

  return withPlatformTransaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('assistant-worker-settings',0))`);
    const current = await readWorkerRuntimeConfig(tx);
    if ((current?.version ?? 0) !== expectedVersion) fail('worker_settings_conflict', 409);
    if (enterpriseId) {
      const enterprise = await one(tx, sql`select id from app.enterprises
        where id=${enterpriseId} and status='active'`);
      if (!enterprise) fail('worker_settings_enterprise_unavailable', 422);
    }
    const saved = await one<WorkerRuntimeConfigRow>(tx, sql`insert into app.assistant_worker_settings
      (version,enabled,enterprise_id,pilot_id,updated_by)
      values(${expectedVersion + 1},${enabled},${enterpriseId},${pilotId},${input.updatedBy})
      returning ${configColumns}`);
    if (!saved) throw new AssistantError('worker_settings_unavailable', 503);
    return configDto(saved);
  });
}
