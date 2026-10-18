import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext } from './contracts';
import { usageWindow } from './core/usage';
import { EMBEDDING_PROFILE } from './infrastructure/embedding-gateway';
import { workerTiming } from './infrastructure/job-queue';

type Environment = Record<string, string | undefined>;

export type OperationsThresholds = {
  queueBacklogWarn: number;
  queueBacklogCritical: number;
  queueAgeWarnSeconds: number;
  queueAgeCriticalSeconds: number;
  latencyP95WarnMs: number;
  latencyP95CriticalMs: number;
  insufficientRatioWarn: number;
  insufficientRatioCritical: number;
  citationFailureWarn: number;
  citationFailureCritical: number;
  unknownCostWarn: number;
  unknownCostCritical: number;
  workerStaleSeconds: number;
};

const DEFAULT_THRESHOLDS: OperationsThresholds = {
  queueBacklogWarn: 10,
  queueBacklogCritical: 50,
  queueAgeWarnSeconds: 60,
  queueAgeCriticalSeconds: 300,
  latencyP95WarnMs: 30000,
  latencyP95CriticalMs: 90000,
  insufficientRatioWarn: 0.2,
  insufficientRatioCritical: 0.5,
  citationFailureWarn: 1,
  citationFailureCritical: 5,
  unknownCostWarn: 1,
  unknownCostCritical: 5,
  workerStaleSeconds: 210,
};

const THRESHOLD_ENV: Record<keyof OperationsThresholds, [string, number, number, boolean]> = {
  queueBacklogWarn: ['ASSISTANT_OPERATIONS_QUEUE_BACKLOG_WARN', 0, 100000, true],
  queueBacklogCritical: ['ASSISTANT_OPERATIONS_QUEUE_BACKLOG_CRITICAL', 0, 100000, true],
  queueAgeWarnSeconds: ['ASSISTANT_OPERATIONS_QUEUE_AGE_WARN_SECONDS', 0, 86400, true],
  queueAgeCriticalSeconds: ['ASSISTANT_OPERATIONS_QUEUE_AGE_CRITICAL_SECONDS', 0, 604800, true],
  latencyP95WarnMs: ['ASSISTANT_OPERATIONS_LATENCY_P95_WARN_MS', 0, 3600000, true],
  latencyP95CriticalMs: ['ASSISTANT_OPERATIONS_LATENCY_P95_CRITICAL_MS', 0, 86400000, true],
  insufficientRatioWarn: ['ASSISTANT_OPERATIONS_INSUFFICIENT_RATIO_WARN', 0, 1, false],
  insufficientRatioCritical: ['ASSISTANT_OPERATIONS_INSUFFICIENT_RATIO_CRITICAL', 0, 1, false],
  citationFailureWarn: ['ASSISTANT_OPERATIONS_CITATION_FAILURE_WARN', 0, 100000, true],
  citationFailureCritical: ['ASSISTANT_OPERATIONS_CITATION_FAILURE_CRITICAL', 0, 100000, true],
  unknownCostWarn: ['ASSISTANT_OPERATIONS_UNKNOWN_COST_WARN', 0, 100000, true],
  unknownCostCritical: ['ASSISTANT_OPERATIONS_UNKNOWN_COST_CRITICAL', 0, 100000, true],
  workerStaleSeconds: ['ASSISTANT_OPERATIONS_WORKER_STALE_SECONDS', 1, 604800, true],
};

function configuredNumber(raw: string | undefined, fallback: number, min: number, max: number, integer: boolean) {
  if (!raw?.trim()) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) return fallback;
  return value;
}

function thresholdPair(
  env: Environment,
  warnKey: keyof OperationsThresholds,
  criticalKey: keyof OperationsThresholds,
): [number, number] {
  const [warnName, warnMin, warnMax, warnInteger] = THRESHOLD_ENV[warnKey];
  const [criticalName, criticalMin, criticalMax, criticalInteger] = THRESHOLD_ENV[criticalKey];
  const warn = configuredNumber(env[warnName], DEFAULT_THRESHOLDS[warnKey], warnMin, warnMax, warnInteger);
  const critical = configuredNumber(env[criticalName], DEFAULT_THRESHOLDS[criticalKey], criticalMin, criticalMax, criticalInteger);
  if (critical <= warn) return [DEFAULT_THRESHOLDS[warnKey], DEFAULT_THRESHOLDS[criticalKey]];
  return [warn, critical];
}

export function readOperationsThresholds(env: Environment = process.env): OperationsThresholds {
  const [queueBacklogWarn, queueBacklogCritical] = thresholdPair(env, 'queueBacklogWarn', 'queueBacklogCritical');
  const [queueAgeWarnSeconds, queueAgeCriticalSeconds] = thresholdPair(env, 'queueAgeWarnSeconds', 'queueAgeCriticalSeconds');
  const [latencyP95WarnMs, latencyP95CriticalMs] = thresholdPair(env, 'latencyP95WarnMs', 'latencyP95CriticalMs');
  const [insufficientRatioWarn, insufficientRatioCritical] = thresholdPair(env, 'insufficientRatioWarn', 'insufficientRatioCritical');
  const [citationFailureWarn, citationFailureCritical] = thresholdPair(env, 'citationFailureWarn', 'citationFailureCritical');
  const [unknownCostWarn, unknownCostCritical] = thresholdPair(env, 'unknownCostWarn', 'unknownCostCritical');
  const [workerStaleName, workerStaleMin, workerStaleMax, workerStaleInteger] = THRESHOLD_ENV.workerStaleSeconds;
  return {
    queueBacklogWarn,
    queueBacklogCritical,
    queueAgeWarnSeconds,
    queueAgeCriticalSeconds,
    latencyP95WarnMs,
    latencyP95CriticalMs,
    insufficientRatioWarn,
    insufficientRatioCritical,
    citationFailureWarn,
    citationFailureCritical,
    unknownCostWarn,
    unknownCostCritical,
    workerStaleSeconds: configuredNumber(env[workerStaleName], DEFAULT_THRESHOLDS.workerStaleSeconds, workerStaleMin, workerStaleMax, workerStaleInteger),
  };
}

function decimalString(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function bigintString(value: unknown, fallback = '0') {
  try {
    const normalized = BigInt(String(value ?? fallback));
    return normalized >= BigInt(0) ? normalized.toString() : fallback;
  } catch {
    return fallback;
  }
}

function optionalIntegerString(value: unknown) {
  if (value === null || value === undefined || value === '') return 'unknown';
  return bigintString(value, 'unknown');
}

export function ratioString(numerator: string, denominator: string) {
  try {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    if (d <= BigInt(0)) return 'unknown';
    return decimalString(Number(n) / Number(d));
  } catch {
    return 'unknown';
  }
}

export type RetrievalConfiguration = {
  configured: boolean;
  status: 'configured' | 'not_configured';
  health: 'unknown';
  reason: 'configured' | 'missing_url' | 'missing_api_key' | 'invalid_url';
  profile: string;
};

export function retrievalConfiguration(env: Environment = process.env): RetrievalConfiguration {
  const rawUrl = env.ASSISTANT_EMBEDDING_URL?.trim() || '';
  const apiKey = env.ASSISTANT_EMBEDDING_API_KEY?.trim() || '';
  if (!rawUrl) return { configured: false, status: 'not_configured', health: 'unknown', reason: 'missing_url', profile: EMBEDDING_PROFILE.id };
  if (!apiKey) return { configured: false, status: 'not_configured', health: 'unknown', reason: 'missing_api_key', profile: EMBEDDING_PROFILE.id };
  try {
    const endpoint = new URL(rawUrl);
    const validProtocol = endpoint.protocol === 'https:'
      || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname));
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !validProtocol) throw new Error('invalid_url');
  } catch {
    return { configured: false, status: 'not_configured', health: 'unknown', reason: 'invalid_url', profile: EMBEDDING_PROFILE.id };
  }
  // Configuration presence is not a live probe. The health field deliberately stays unknown.
  return { configured: true, status: 'configured', health: 'unknown', reason: 'configured', profile: EMBEDDING_PROFILE.id };
}

export type WorkerHeartbeat = {
  freshness: 'fresh' | 'stale' | 'unknown';
  lastSuccessAt: string;
  ageSeconds: string;
  liveProbe: false;
};

export async function readWorkerHeartbeat(
  env: Environment = process.env,
  staleSeconds = readOperationsThresholds(env).workerStaleSeconds,
  nowMs = Date.now(),
): Promise<WorkerHeartbeat> {
  const healthFile = env.ASSISTANT_WORKER_HEALTH_FILE?.trim() || path.join(tmpdir(), 'assistant-worker-health.json');
  try {
    const raw = await readFile(healthFile, 'utf8');
    if (Buffer.byteLength(raw) > 4096) throw new Error('health_file_too_large');
    const parsed = JSON.parse(raw) as { lastSuccessAt?: unknown };
    const lastSuccessAt = Number(parsed.lastSuccessAt);
    if (!Number.isFinite(lastSuccessAt) || lastSuccessAt <= 0) throw new Error('invalid_health_file');
    const ageSeconds = Math.max(0, Math.floor((nowMs - lastSuccessAt) / 1000));
    return {
      freshness: ageSeconds <= staleSeconds ? 'fresh' : 'stale',
      lastSuccessAt: new Date(lastSuccessAt).toISOString(),
      ageSeconds: String(ageSeconds),
      liveProbe: false,
    };
  } catch {
    return { freshness: 'unknown', lastSuccessAt: 'unknown', ageSeconds: 'unknown', liveProbe: false };
  }
}

export async function workerRuntimeSnapshot(env: Environment = process.env, nowMs = Date.now()) {
  const thresholds = readOperationsThresholds(env);
  const heartbeat = await readWorkerHeartbeat(env, thresholds.workerStaleSeconds, nowMs);
  return {
    authConfigured: Boolean(env.CRON_SECRET?.trim()),
    endpointConfigured: Boolean(env.ASSISTANT_WORKER_ENDPOINT?.trim()),
    timing: Object.fromEntries(Object.entries(workerTiming).map(([key, value]) => [key, String(value)])),
    retrieval: retrievalConfiguration(env),
    heartbeat,
  };
}

export type AlertStatus = 'ok' | 'warning' | 'critical' | 'unknown';
export type OperationsAlert = {
  code: string;
  status: AlertStatus;
  value: string;
  warnAt: string;
  criticalAt: string;
  unit: 'count' | 'seconds' | 'milliseconds' | 'ratio';
  reason?: string;
};

export function aggregateAlertStatus(alerts: OperationsAlert[]): AlertStatus {
  if (alerts.some(alert => alert.status === 'critical')) return 'critical';
  if (alerts.some(alert => alert.status === 'warning')) return 'warning';
  if (alerts.some(alert => alert.status === 'unknown')) return 'unknown';
  return 'ok';
}

function countAlert(code: string, value: string, warn: number, critical: number, unit: OperationsAlert['unit'], active = true): OperationsAlert {
  if (!active) return { code, status: 'ok', value, warnAt: String(warn), criticalAt: String(critical), unit };
  try {
    const actual = BigInt(value);
    return {
      code,
      status: actual >= BigInt(critical) ? 'critical' : actual >= BigInt(warn) ? 'warning' : 'ok',
      value,
      warnAt: String(warn),
      criticalAt: String(critical),
      unit,
    };
  } catch {
    return { code, status: 'unknown', value: 'unknown', warnAt: String(warn), criticalAt: String(critical), unit, reason: 'invalid_metric' };
  }
}

function decimalAlert(code: string, value: string, warn: number, critical: number, unit: OperationsAlert['unit'], active = true): OperationsAlert {
  if (value === 'unknown') return {
    code,
    status: 'unknown',
    value,
    warnAt: decimalString(warn),
    criticalAt: decimalString(critical),
    unit,
    reason: 'no_observed_samples',
  };
  if (!active) return { code, status: 'ok', value, warnAt: decimalString(warn), criticalAt: decimalString(critical), unit };
  const actual = Number(value);
  if (!Number.isFinite(actual)) return { code, status: 'unknown', value: 'unknown', warnAt: decimalString(warn), criticalAt: decimalString(critical), unit, reason: 'invalid_metric' };
  return {
    code,
    status: actual >= critical ? 'critical' : actual >= warn ? 'warning' : 'ok',
    value,
    warnAt: decimalString(warn),
    criticalAt: decimalString(critical),
    unit,
  };
}

export function buildOperationsAlerts(input: {
  queueBacklog: string;
  queueOldestAgeSeconds: string;
  answerLatencyP95Ms: string;
  latencySamples: string;
  insufficientRatio: string;
  answeredCount: string;
  citationFailures: string;
  unknownCostBacklog: string;
  worker: WorkerHeartbeat;
  thresholds: OperationsThresholds;
}): OperationsAlert[] {
  const { thresholds: t } = input;
  const workerAlert: OperationsAlert = input.worker.freshness === 'unknown'
    ? { code: 'worker_heartbeat', status: 'unknown', value: 'unknown', warnAt: String(t.workerStaleSeconds), criticalAt: String(t.workerStaleSeconds), unit: 'seconds', reason: 'heartbeat_unavailable' }
    : { code: 'worker_heartbeat', status: input.worker.freshness === 'stale' ? 'critical' : 'ok', value: input.worker.ageSeconds, warnAt: String(t.workerStaleSeconds), criticalAt: String(t.workerStaleSeconds), unit: 'seconds', reason: input.worker.freshness === 'stale' ? 'heartbeat_stale' : undefined };
  return [
    countAlert('queue_backlog', input.queueBacklog, t.queueBacklogWarn, t.queueBacklogCritical, 'count'),
    countAlert('queue_oldest_age', input.queueOldestAgeSeconds, t.queueAgeWarnSeconds, t.queueAgeCriticalSeconds, 'seconds', input.queueBacklog !== '0'),
    decimalAlert('answer_latency_p95', input.answerLatencyP95Ms, t.latencyP95WarnMs, t.latencyP95CriticalMs, 'milliseconds', input.latencySamples !== '0'),
    decimalAlert('insufficient_evidence_ratio', input.insufficientRatio, t.insufficientRatioWarn, t.insufficientRatioCritical, 'ratio', input.answeredCount !== '0'),
    countAlert('citation_failure_count', input.citationFailures, t.citationFailureWarn, t.citationFailureCritical, 'count'),
    countAlert('unknown_cost_backlog', input.unknownCostBacklog, t.unknownCostWarn, t.unknownCostCritical, 'count'),
    workerAlert,
  ];
}

type QueueRow = Row & { kind: string; queued: string; running: string; oldest_age_seconds: string };
type SettingsRow = Row & { enabled: boolean; daily_requests: string | number; daily_tokens: string; daily_cost_micros: string; budget_currency: string; retention_days: string | number };

function sumStrings(values: unknown[]) {
  return values.reduce<bigint>((sum, value) => sum + BigInt(bigintString(value)), BigInt(0)).toString();
}

function maxString(values: unknown[]) {
  return values.reduce<bigint>((max, value) => {
    const candidate = BigInt(bigintString(value));
    return candidate > max ? candidate : max;
  }, BigInt(0)).toString();
}

async function authorizeOperations(tx: PostgresTransaction, actor: ActorContext) {
  if (actor.principal.kind !== 'admin') fail('assistant_capability_forbidden', 403);
  const admin = await one(tx, sql`select a.id from app.admin_users a join app.enterprises e on e.id=a.enterprise_id
    where a.enterprise_id=${actor.enterpriseId} and a.id=${actor.principal.adminId} and a.role='enterprise_admin'
    and a.status='active' and not a.must_change_password and e.status='active'
    and 'assistant-usage'=any(a.menu_permissions) for share of a,e`);
  if (!admin) fail('assistant_capability_forbidden', 403);
}

export class OperationsService {
  constructor(private readonly actor: ActorContext, private readonly env: Environment = process.env) {}

  async snapshot(from?: string | null, to?: string | null) {
    const window = usageWindow(from, to);
    const thresholds = readOperationsThresholds(this.env);
    const runtime = await workerRuntimeSnapshot(this.env);
    const eid = this.actor.enterpriseId;
    return withTenantTransaction(eid, async tx => {
      await authorizeOperations(tx, this.actor);
      const settings = await one<SettingsRow>(tx, sql`select enabled,daily_requests::text,daily_tokens::text,daily_cost_micros::text,budget_currency,retention_days
        from app.assistant_enterprise_settings where enterprise_id=${eid} for share`);
      if (!settings) fail('assistant_resource_not_found', 404);
      const queueRows = await rows<QueueRow>(tx, sql`select kind,
        count(*) filter(where status='queued')::text queued,
        count(*) filter(where status='running')::text running,
        coalesce(
          floor(greatest(extract(epoch from (now()-min(created_at) filter(where status in ('queued','running')))),0))::bigint::text,
          '0'
        ) oldest_age_seconds
        from app.assistant_jobs where enterprise_id=${eid} and status in ('queued','running') group by kind order by kind`);
      const answers = await one<Row>(tx, sql`select
        count(*)::text total_runs,
        count(*) filter(where status in ('succeeded','failed','cancelled','indeterminate'))::text terminal_runs,
        count(*) filter(where status='succeeded' and answer_kind='grounded')::text grounded_runs,
        count(*) filter(where status='succeeded' and answer_kind='insufficient_evidence')::text insufficient_runs,
        count(*) filter(where status in ('succeeded','failed','cancelled','indeterminate') and error_code='invalid_model_citation')::text citation_failures
        from app.assistant_runs where enterprise_id=${eid}
        and created_at>=${window.from}::date::timestamp at time zone 'UTC'
        and created_at<${window.to}::date::timestamp at time zone 'UTC'`);
      const latency = await one<Row>(tx, sql`select count(*)::text sample_count,
        count(*) filter(where started_at is not null and completed_at>=started_at)::text processing_sample_count,
        round(avg(extract(epoch from (completed_at-created_at))*1000))::bigint::text total_avg_ms,
        (percentile_cont(0.50) within group(order by extract(epoch from (completed_at-created_at))*1000))::bigint::text total_p50_ms,
        (percentile_cont(0.95) within group(order by extract(epoch from (completed_at-created_at))*1000))::bigint::text total_p95_ms,
        round(max(extract(epoch from (completed_at-created_at))*1000))::bigint::text total_max_ms,
        round(avg(case when started_at is not null and completed_at>=started_at then extract(epoch from (completed_at-started_at))*1000 end))::bigint::text processing_avg_ms,
        (percentile_cont(0.50) within group(order by case when started_at is not null and completed_at>=started_at then extract(epoch from (completed_at-started_at))*1000 end))::bigint::text processing_p50_ms,
        (percentile_cont(0.95) within group(order by case when started_at is not null and completed_at>=started_at then extract(epoch from (completed_at-started_at))*1000 end))::bigint::text processing_p95_ms,
        round(max(case when started_at is not null and completed_at>=started_at then extract(epoch from (completed_at-started_at))*1000 end))::bigint::text processing_max_ms
        from app.assistant_runs where enterprise_id=${eid}
        and status in ('succeeded','failed','cancelled','indeterminate') and completed_at is not null
        and completed_at>=created_at
        and created_at>=${window.from}::date::timestamp at time zone 'UTC'
        and created_at<${window.to}::date::timestamp at time zone 'UTC'`);
      const unknownCosts = await one<Row>(tx, sql`select
        count(*) filter(where status='reconciling')::text pending_reservations,
        coalesce(sum(reserved_tokens) filter(where status='reconciling'),0)::text reserved_tokens,
        coalesce(sum(reserved_cost_micros) filter(where status='reconciling'),0)::text reserved_cost_micros,
        coalesce(
          floor(greatest(extract(epoch from (now()-min(created_at) filter(where status='reconciling'))),0))::bigint::text,
          '0'
        ) oldest_age_seconds
        from app.assistant_quota_reservations where enterprise_id=${eid}`);

      const queue = {
        queued: sumStrings(queueRows.map(row => row.queued)),
        running: sumStrings(queueRows.map(row => row.running)),
        oldestAgeSeconds: maxString(queueRows.map(row => row.oldest_age_seconds)),
        byKind: queueRows.map(row => ({ kind: String(row.kind), queued: bigintString(row.queued), running: bigintString(row.running), oldestAgeSeconds: bigintString(row.oldest_age_seconds) })),
      };
      const terminalRuns = bigintString(answers?.terminal_runs);
      const groundedRuns = bigintString(answers?.grounded_runs);
      const insufficientRuns = bigintString(answers?.insufficient_runs);
      const answeredCount = sumStrings([groundedRuns, insufficientRuns]);
      const alerts = buildOperationsAlerts({
        queueBacklog: sumStrings([queue.queued, queue.running]),
        queueOldestAgeSeconds: queue.oldestAgeSeconds,
        answerLatencyP95Ms: optionalIntegerString(latency?.total_p95_ms),
        latencySamples: bigintString(latency?.sample_count),
        insufficientRatio: ratioString(insufficientRuns, answeredCount),
        answeredCount,
        citationFailures: bigintString(answers?.citation_failures),
        unknownCostBacklog: bigintString(unknownCosts?.pending_reservations),
        worker: runtime.heartbeat,
        thresholds,
      });
      const status = aggregateAlertStatus(alerts);
      return {
        schemaVersion: 'assistant-operations-v1',
        generatedAt: new Date().toISOString(),
        window: { ...window, timezone: 'UTC', endExclusive: true },
        status,
        statusMeaning: 'threshold_alert_status_not_process_health',
        configuration: {
          enabled: Boolean(settings.enabled),
          retentionDays: bigintString(settings.retention_days),
          limits: { requests: bigintString(settings.daily_requests), tokens: bigintString(settings.daily_tokens), costMicros: bigintString(settings.daily_cost_micros) },
          currency: String(settings.budget_currency),
        },
        queue: { ...queue, backlog: sumStrings([queue.queued, queue.running]) },
        answers: {
          totalRuns: bigintString(answers?.total_runs),
          terminalRuns,
          groundedRuns,
          insufficientEvidenceRuns: insufficientRuns,
          insufficientEvidenceRatio: ratioString(insufficientRuns, answeredCount),
          citationFailureRuns: bigintString(answers?.citation_failures),
          citationFailureRatio: ratioString(bigintString(answers?.citation_failures), terminalRuns),
          latency: {
            total: {
              sampleCount: bigintString(latency?.sample_count),
              avgMs: optionalIntegerString(latency?.total_avg_ms),
              p50Ms: optionalIntegerString(latency?.total_p50_ms),
              p95Ms: optionalIntegerString(latency?.total_p95_ms),
              maxMs: optionalIntegerString(latency?.total_max_ms),
            },
            processing: {
              sampleCount: bigintString(latency?.processing_sample_count),
              avgMs: optionalIntegerString(latency?.processing_avg_ms),
              p50Ms: optionalIntegerString(latency?.processing_p50_ms),
              p95Ms: optionalIntegerString(latency?.processing_p95_ms),
              maxMs: optionalIntegerString(latency?.processing_max_ms),
            },
            firstToken: { supported: false, status: 'unavailable', reason: 'non_streaming_gateway' },
          },
        },
        unknownCosts: {
          pendingReservations: bigintString(unknownCosts?.pending_reservations),
          reservedTokens: bigintString(unknownCosts?.reserved_tokens),
          reservedCostMicros: bigintString(unknownCosts?.reserved_cost_micros),
          oldestAgeSeconds: bigintString(unknownCosts?.oldest_age_seconds),
        },
        worker: runtime,
        thresholds: Object.fromEntries(Object.entries(thresholds).map(([key, value]) => [key, decimalString(value)])),
        alerts,
        definitions: {
          queue: 'Tenant-scoped queued/running assistant jobs; oldest age is measured from job creation.',
          latency: 'Total terminal run duration is measured from created_at to completed_at and includes queue wait; processing duration is started_at to completed_at. First-token latency is unavailable because the gateway is non-streaming.',
          insufficientEvidence: 'insufficient_evidence runs divided by succeeded runs with grounded or insufficient_evidence answer kinds.',
          citationFailures: 'Runs that ended with invalid_model_citation; historical citation withdrawal is not counted as a provider failure.',
          unknownCosts: 'Tenant quota reservations in reconciling state; amounts remain reserved until reviewed.',
          worker: 'Heartbeat freshness is derived from the worker success file; it is not a live process or provider probe.',
          retrieval: 'Embedding retrieval reports configuration presence only; health remains unknown because this snapshot does not probe the provider.',
        },
      };
    });
  }
}
