/** B5.8 four-receiver joint acceptance: one project, one ended week, one call.
 *
 * Fixed scope: B-isolated enterprise 1454, project 1454000004, the finished
 * Shanghai week 2026-10-19 -> 2026-10-26, and exactly four host-chosen
 * receivers: the project customer, worker 1454000008, designer 1454000011 and
 * enterprise boss 1454000013. Two marked raw records (one customer-visible,
 * one internal) are created through the existing construction service only
 * when the fixed week has no such fixture yet.
 *
 * The new host entry (`scripts/native-workflow-period-report-batch.ts`) runs
 * the existing single-receiver entry/ports for each receiver. The real
 * assistant Worker then processes the four independent facts/body jobs. The
 * driver reads every role's original XiaoK entry, records the delivery read
 * receipt and proves re-entry, same-request observation and new-request reuse.
 *
 * Required environment (from admin/):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:JWT_SECRET='<development signing secret>'
 *   $env:CRON_SECRET='<development worker secret>'
 *   npx tsx scripts/native-workflow-joint-report-acceptance.ts --development
 *
 * Evidence: tmp/b5-8-period-report-runs/<acceptanceId>/verification.json
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { loadEnvConfig } from '@next/env';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';
import {
  evaluateAcceptanceProviderReadiness,
  type AcceptancePlatformConfig,
  type AcceptanceProviderRow,
} from '@/lib/native-workflow/live/acceptance-provider';
import { parseFixedPeriod } from '@/lib/native-workflow/live/period-event';
import { resolveCliPeriod } from '@/lib/native-workflow/live/period-cli';
import { parseContextVersion } from '@/lib/native-workflow/live/worker-fixture';
import {
  agentSettingsSnapshot,
  reportPlanSnapshot,
  restoreAgentSettings,
  restoreReportPlan,
  runRestorations,
  verifyAgentSettings,
  verifyReportPlan,
  type AgentSettingsSnapshot,
  type ReportPlanSnapshot,
  type RestorationOutcome,
  type RestorationStep,
} from '@/lib/native-workflow/live/acceptance-state';
import {
  evaluateReportModelEvidence,
  type PeriodCounts,
  type ReportEvidenceAttempt,
  type ReportEvidenceSnapshot,
  type ReportEvidenceStep,
} from '@/lib/native-workflow/live/report-model-evidence';
import type { TriggerEvent } from '@/lib/native-workflow/types';

loadEnvConfig(process.cwd());

const ENTERPRISE_ID = '1454';
const EXECUTOR_ADMIN_ID = '1454000001';
const CUSTOMER_USER_ID = '1454000002';
const LEAD_ID = '1454000003';
const PROJECT_ID = '1454000004';
const WORKER_ADMIN_ID = '1454000008';
const DESIGNER_ADMIN_ID = '1454000011';
const DESIGNER_USER_ID = '1454000011';
const BOSS_ADMIN_ID = '1454000013';
const BOSS_USER_ID = '1454000013';
const SCOPE = 'b5-8';
const PERIOD_KIND = 'weekly' as const;
const PERIOD_START = '2026-10-19';
const PERIOD_END = '2026-10-26';
const CUSTOMER_OPENID = `b4-live-openid-${ENTERPRISE_ID}`;

const BINDINGS: Record<string, { bindingId: string; conversationId: string; audience: string }> = {
  customer: { bindingId: '1', conversationId: '1454000007', audience: 'customer' },
  worker: { bindingId: '2', conversationId: '1454000008', audience: 'worker' },
  designer: { bindingId: '3', conversationId: '1454000009', audience: 'designer' },
  boss: { bindingId: '4', conversationId: '1454000010', audience: 'boss' },
};
const KINDS = ['customer', 'worker', 'designer', 'boss'] as const;
type ReceiverKind = (typeof KINDS)[number];

class AcceptanceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcceptanceFailure';
  }
}

function fail(message: string): never {
  throw new AcceptanceFailure(message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function argvValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return !value || value.startsWith('--') ? '' : value;
}

const resumeId = argvValue('--resume') ?? '';
const resume = resumeId !== '';
const runStamp = new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 17);
const acceptanceId = resume ? resumeId : `${SCOPE}-joint-${runStamp}`;
const outputDir = path.resolve('tmp/b5-8-period-report-runs', acceptanceId);
const storeDir = path.resolve('tmp/b5-8-acceptance-store', acceptanceId);
const runDir = path.resolve('tmp/b5-8-acceptance-runs', acceptanceId);
const batchDir = path.resolve('tmp/b5-8-acceptance-batches', acceptanceId);

let appUrl = '';
let fixtureUrl = '';
let appPool: pg.Pool | null = null;
let fixturePool: pg.Pool | null = null;

interface MarkedRecord {
  readonly recordId: string;
  readonly mediaId: string;
  readonly version: number;
  readonly day: string;
  readonly reused: boolean;
}

interface BatchReceipt {
  readonly reportId: string;
  readonly revision: number;
  readonly runId: string;
  readonly reportKey: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly reused: boolean;
}

interface BatchEntryOutput {
  readonly kind: ReceiverKind;
  readonly adminId: string | null;
  readonly runId: string;
  readonly executed: boolean;
  readonly state: string;
  readonly reason: string | null;
  readonly errorCode: string | null;
  readonly saveReceipt: BatchReceipt | null;
  readonly deliveryReceipt: {
    readonly delivered: boolean;
    readonly status: string | null;
    readonly messageId: string | null;
    readonly conversationId: string | null;
  } | null;
  readonly observation: {
    readonly overall: string | null;
    readonly availability: string | null;
    readonly reasons: readonly string[];
  } | null;
}

interface BatchOutput {
  readonly success: boolean;
  readonly requestId: string;
  readonly created: boolean;
  readonly observedOnly: boolean;
  readonly status: string;
  readonly complete: boolean;
  readonly projectId: string;
  readonly period: { kind: string; periodStart: string; periodEnd: string };
  readonly published: {
    definitionId: string;
    revision: number;
    digest: string;
    nodeVersions: Record<string, string>;
  };
  readonly receivers: Array<{ kind: ReceiverKind; adminId: string | null; runId: string }>;
  readonly plan: {
    projectIds: string[];
    audiences: string[] | null;
    enabled: boolean;
    stageEnabled: boolean;
  } | null;
  readonly entries: BatchEntryOutput[];
  readonly reasons: string[];
}

interface AcceptanceState {
  agentBefore: AgentSettingsSnapshot | null;
  reportPlanBefore: ReportPlanSnapshot | null;
  customerAccessBefore: boolean | null;
  customerAccessChanged: boolean;
  fixtureReady: boolean;
  workerServer: http.Server | null;
  workerProcess: ChildProcess | null;
  customerRecord: MarkedRecord | null;
  internalRecord: MarkedRecord | null;
  batch: BatchOutput | null;
  reports: Partial<Record<ReceiverKind, LegacyReport>>;
  exitCode: number;
}

interface LegacyReport {
  readonly kind: ReceiverKind;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly reportId: string;
  readonly revision: number;
  readonly factsRunId: string;
  readonly bodyRunId: string | null;
  readonly messageId: string | null;
  readonly reuse: boolean;
  readonly recordIds: readonly string[];
  readonly photoMediaIds: readonly string[];
  readonly modelEvidence: { ok: boolean; reasons: readonly string[]; binding: unknown };
  readonly attempts: readonly ReportEvidenceAttempt[];
  readonly use: readonly { input: number | null; output: number | null }[];
}

const state: AcceptanceState = {
  agentBefore: null,
  reportPlanBefore: null,
  customerAccessBefore: null,
  customerAccessChanged: false,
  fixtureReady: false,
  workerServer: null,
  workerProcess: null,
  customerRecord: null,
  internalRecord: null,
  batch: null,
  reports: {},
  exitCode: 0,
};

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  acceptanceId,
  scope: SCOPE,
  periodKind: PERIOD_KIND,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  receivers: {
    customer: CUSTOMER_USER_ID,
    worker: WORKER_ADMIN_ID,
    designer: DESIGNER_ADMIN_ID,
    boss: BOSS_ADMIN_ID,
  },
  paths: { outputDir, storeDir, runDir, batchDir },
  checks: [],
  failures: [],
};
const checks = evidence.checks as Array<Record<string, unknown>>;
const failures = evidence.failures as Array<Record<string, unknown>>;

function save(): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'verification.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}

function check(name: string, passed: boolean, detail: Record<string, unknown> = {}): void {
  checks.push({ name, passed, ...detail });
  if (!passed) failures.push({ name, ...detail });
  save();
}

function fixture(): pg.Pool {
  if (!fixturePool) fail('the fixture database pool is not initialized');
  return fixturePool;
}

async function counter(pool: pg.Pool, table: string, where = 'true'): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${table} where ${where}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function usageSnapshot(pool: pg.Pool): Promise<PeriodCounts> {
  return {
    assistantUsageRecords: await counter(pool, 'app.assistant_usage_records'),
    aiProviderAttempts: await counter(pool, 'app.ai_provider_attempts'),
    assistantJobs: await counter(pool, 'app.assistant_jobs'),
    assistantRuns: await counter(pool, 'app.assistant_runs'),
    constructionReports: await counter(pool, 'app.construction_reports'),
    reportDeliveries: await counter(pool, 'app.construction_report_deliveries'),
    reportMessages: await counter(pool, 'app.assistant_messages', "purpose='construction.report.facts'"),
  };
}

async function weekReports(pool: pg.Pool, bindingId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from app.construction_reports
      where enterprise_id=$1::bigint and binding_id=$2::bigint and kind='weekly'
        and period_start=$3::timestamptz`,
    [ENTERPRISE_ID, bindingId, `${PERIOD_START}T00:00:00+08:00`],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function assertCalendarDate(value: string): void {
  const [year, month, day] = value.split('-').map(Number);
  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year
    || checkDate.getUTCMonth() !== month - 1
    || checkDate.getUTCDate() !== day
  ) {
    fail(`${value} is not a real calendar date`);
  }
}

async function bootstrap(): Promise<void> {
  if (!process.argv.includes('--development')) fail('--development is required');
  if (process.env.NODE_ENV === 'production') fail('refusing to run in production');
  if (!process.env.JWT_SECRET) fail('JWT_SECRET is required for real Mini Program tokens');
  if (!process.env.CRON_SECRET) fail('CRON_SECRET is required for the real Worker endpoint');
  if (resume) {
    const previous = path.join(outputDir, 'verification.json');
    if (fs.existsSync(previous)) {
      const archived = path.join(outputDir, 'verification.first-attempt.json');
      if (!fs.existsSync(archived)) fs.copyFileSync(previous, archived);
      evidence.resumedFrom = archived;
    }
  }

  assertCalendarDate(PERIOD_START);
  assertCalendarDate(PERIOD_END);
  const resolved = resolveCliPeriod({ kind: PERIOD_KIND, periodStart: PERIOD_START, periodEnd: PERIOD_END });
  if (resolved.periodEnd !== PERIOD_END) {
    fail(`the fixed B5.8 week must be ${PERIOD_START} -> ${PERIOD_END}`);
  }
  const event: TriggerEvent = {
    eventId: `${SCOPE}-${PERIOD_KIND}-${PERIOD_START}`,
    eventType: 'period_report',
    occurredAt: new Date().toISOString(),
    periodKind: PERIOD_KIND,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
  };
  try {
    parseFixedPeriod(event);
  } catch (error) {
    fail(`the fixed B5.8 week must already be finished in Shanghai: ${messageOf(error)}`);
  }

  const appTarget = resolveB4DatabaseTarget({ purpose: 'app' });
  const fixtureTarget = resolveB4DatabaseTarget({ purpose: 'fixture' });
  if (
    appTarget.host !== fixtureTarget.host
    || appTarget.port !== fixtureTarget.port
    || appTarget.database !== fixtureTarget.database
  ) {
    fail('the app and fixture database targets must be the same B host/port/database');
  }
  appPool = new pg.Pool({ connectionString: appTarget.url, max: 1 });
  fixturePool = new pg.Pool({ connectionString: fixtureTarget.url, max: 3 });
  const appIdentity = (await appPool.query<{ database: string; username: string }>(
    'select current_database() as database, current_user as username',
  )).rows[0];
  const fixtureIdentity = (await fixturePool.query<{ database: string; username: string }>(
    'select current_database() as database, current_user as username',
  )).rows[0];
  if (!appIdentity || !fixtureIdentity) fail('the database did not return a connection identity');
  assertB4ConnectionIdentity(appTarget, {
    database: String(appIdentity.database),
    username: String(appIdentity.username),
  });
  assertB4ConnectionIdentity(fixtureTarget, {
    database: String(fixtureIdentity.database),
    username: String(fixtureIdentity.username),
  });

  appUrl = appTarget.url;
  fixtureUrl = fixtureTarget.url;
  process.env.DATABASE_URL = appUrl;
  process.env.NATIVE_WORKFLOW_STORE_DIR = storeDir;
  process.env.NATIVE_WORKFLOW_RUN_DIR = runDir;
  process.env.NATIVE_WORKFLOW_BATCH_DIR = batchDir;
  evidence.databaseTargets = {
    app: describeB4DatabaseTarget(appTarget),
    fixture: describeB4DatabaseTarget(fixtureTarget),
  };
}

async function preflight(pool: pg.Pool): Promise<void> {
  const enterprise = (await pool.query(
    'select code, name, status from app.enterprises where id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  if (
    !enterprise
    || enterprise.code !== `B4-LIVE-${ENTERPRISE_ID}`
    || !String(enterprise.name).startsWith('[B4]')
    || enterprise.status !== 'active'
  ) {
    fail('fixture enterprise ownership mismatch; run the B4 fixture first');
  }
  const project = (await pool.query(
    'select name, status, customer_access from app.construction_projects where id=$1::bigint and enterprise_id=$2::bigint',
    [PROJECT_ID, ENTERPRISE_ID],
  )).rows[0];
  if (!project || !String(project.name).startsWith('[B4]') || project.status !== 'active') {
    fail('fixture project is not the active labelled project');
  }
  if (project.customer_access !== true) fail('fixture project must start with customer_access=true');
  state.customerAccessBefore = Boolean(project.customer_access);

  const executor = (await pool.query(
    'select id::text, username, role, status, must_change_password from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint',
    [EXECUTOR_ADMIN_ID, ENTERPRISE_ID],
  )).rows[0];
  if (
    !executor
    || executor.role !== 'enterprise_admin'
    || executor.status !== 'active'
    || executor.must_change_password !== false
  ) {
    fail('fixture management executor is not the active enterprise_admin account');
  }

  const worker = (await pool.query(
    `select id::text, username, role, status, user_id::text from app.admin_users
      where id=$1::bigint and enterprise_id=$2::bigint`,
    [WORKER_ADMIN_ID, ENTERPRISE_ID],
  )).rows[0];
  if (!worker || worker.role !== 'construction_staff' || worker.status !== 'active' || worker.user_id !== WORKER_ADMIN_ID) {
    fail('the B5.5 worker fixture is not available');
  }
  const designer = (await pool.query(
    `select id::text, username, role, status, user_id::text from app.admin_users
      where id=$1::bigint and enterprise_id=$2::bigint`,
    [DESIGNER_ADMIN_ID, ENTERPRISE_ID],
  )).rows[0];
  if (!designer || designer.role !== 'designer' || designer.status !== 'active' || designer.user_id !== DESIGNER_USER_ID) {
    fail('the B5.6 designer fixture is not available');
  }
  const boss = (await pool.query(
    `select id::text, username, role, status, user_id::text from app.admin_users
      where id=$1::bigint and enterprise_id=$2::bigint`,
    [BOSS_ADMIN_ID, ENTERPRISE_ID],
  )).rows[0];
  if (!boss || boss.role !== 'enterprise_admin' || boss.status !== 'active' || boss.user_id !== BOSS_USER_ID) {
    fail('the B5.7 boss fixture is not available');
  }
  const bossMember = (await pool.query(
    'select 1 from app.construction_members where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint',
    [ENTERPRISE_ID, PROJECT_ID, BOSS_ADMIN_ID],
  )).rows[0];
  if (bossMember) fail('the boss must not have a project membership row');

  const customer = (await pool.query(
    'select username, role from app.users where id=$1::bigint',
    [CUSTOMER_USER_ID],
  )).rows[0];
  if (!customer || !String(customer.username).startsWith('b4-live-customer-')) {
    fail('fixture customer ownership mismatch');
  }
  const identity = (await pool.query(
    'select openid from app.wechat_identities where user_id=$1::bigint',
    [CUSTOMER_USER_ID],
  )).rows[0];
  if (identity?.openid !== CUSTOMER_OPENID) fail('fixture WeChat identity mismatch');

  for (const kind of KINDS) {
    const expected = BINDINGS[kind];
    const binding = (await pool.query(
      `select id::text, principal_key, audience, project_id::text, scope_key, conversation_id::text, status
         from app.construction_followup_bindings
        where enterprise_id=$1::bigint and id=$2::bigint`,
      [ENTERPRISE_ID, expected.bindingId],
    )).rows[0];
    if (
      !binding
      || binding.audience !== expected.audience
      || binding.conversation_id !== expected.conversationId
      || binding.status !== 'enabled'
    ) {
      fail(`fixture ${kind} binding ${expected.bindingId} is not the expected enabled binding`);
    }
    if (kind === 'customer') {
      if (binding.principal_key !== `user:${CUSTOMER_USER_ID}` || binding.project_id !== PROJECT_ID) {
        fail('fixture customer binding identity mismatch');
      }
    } else if (
      binding.principal_key !== `admin:${expectedAdminId(kind)}`
      || binding.project_id !== null
      || binding.scope_key !== 'enterprise'
    ) {
      fail(`fixture ${kind} binding is not enterprise-scoped`);
    }
  }

  evidence.fixture = {
    enterprise,
    project,
    executor: { id: EXECUTOR_ADMIN_ID, role: executor.role },
    worker: { id: WORKER_ADMIN_ID, role: worker.role },
    designer: { id: DESIGNER_ADMIN_ID, role: designer.role },
    boss: { id: BOSS_ADMIN_ID, role: boss.role, member: null },
  };
}

function expectedAdminId(kind: Exclude<ReceiverKind, 'customer'>): string {
  if (kind === 'worker') return WORKER_ADMIN_ID;
  if (kind === 'designer') return DESIGNER_ADMIN_ID;
  return BOSS_ADMIN_ID;
}

/**
 * The fixed week must be fresh for all four targets. This read happens once
 * before any provider, agent, plan or record mutation.
 */
async function assertFreshWeek(pool: pg.Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const kind of KINDS) {
    counts[kind] = await weekReports(pool, BINDINGS[kind].bindingId);
  }
  evidence.existingWeekReports = {
    ...counts,
    note: 'read before any fixture or plan mutation',
  };
  const existing = Object.entries(counts).filter(([, value]) => value !== 0);
  if (existing.length) {
    fail(
      `the fixed week ${PERIOD_START}->${PERIOD_END} already has reports for `
      + `${existing.map(([kind]) => kind).join(', ')}; choose a fresh ended week instead of reusing or deleting evidence`,
    );
  }
  return counts;
}

async function ensureProvider(owner: pg.Pool): Promise<Record<string, unknown>> {
  const current = (await owner.query(
    "select id,key,enabled,adapter_type,base_url,api_key_masked from app.ai_provider_configs where key='llm-settings-override'",
  )).rows[0] as AcceptanceProviderRow | undefined;
  const currentPlatform = (await owner.query(
    "select llm_config from app.platform_configs where key='default'",
  )).rows[0]?.llm_config as AcceptancePlatformConfig | undefined;
  const readiness = evaluateAcceptanceProviderReadiness({
    provider: current ?? null,
    platform: currentPlatform ?? null,
  });
  if (!readiness.ok) fail(readiness.error);
  return {
    copied: false,
    platformCopied: false,
    reused: true,
    provider: {
      key: readiness.provider.key,
      adapter_type: readiness.provider.adapter_type,
      base_url: readiness.provider.base_url,
      api_key_masked: readiness.provider.api_key_masked,
    },
    platform: {
      enabled: readiness.platform.enabled,
      providerKey: readiness.platform.providerKey,
      model: readiness.platform.model,
      apiKeyMasked: readiness.platform.apiKeyMasked,
    },
  };
}

async function ensureAgentConfig(owner: pg.Pool): Promise<Record<string, unknown>> {
  const current = (await owner.query<Record<string, unknown>>(
    'select agent_config, enabled from app.assistant_enterprise_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  if (!current) fail('the assistant enterprise settings row is missing; create the B4 fixture first');
  state.agentBefore = agentSettingsSnapshot(current);
  const config = {
    runtime: 'langgraph-v1',
    providerKey: 'dashscope',
    model: 'qwen3.7-flash',
    imageInput: false,
    tools: true,
    probeVersion: `${SCOPE}-joint-acceptance`,
  };
  await owner.query(
    `update app.assistant_enterprise_settings set agent_config=$1::jsonb, enabled=true, updated_at=now()
      where enterprise_id=$2::bigint`,
    [JSON.stringify(config), ENTERPRISE_ID],
  );
  return { before: state.agentBefore, during: config };
}

async function switchReportPlan(owner: pg.Pool): Promise<Record<string, unknown>> {
  const beforeRow = (await owner.query<Record<string, unknown>>(
    'select * from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  if (!beforeRow) fail('the B4 fixture report plan is missing');
  const before = reportPlanSnapshot(beforeRow);
  state.reportPlanBefore = before;
  const maxStageCursor = (await owner.query(
    `select coalesce(max(id),0)::text as id from app.domain_event_outbox
      where enterprise_id=$1::bigint and type='construction.stage.updated.v1'`,
    [ENTERPRISE_ID],
  )).rows[0]?.id ?? '0';
  // One plan row for the whole action: single project, all four audiences,
  // enabled for the existing Worker, legacy schedules parked, stage off.
  await owner.query(
    `update app.construction_report_settings
        set enabled=true, stage_enabled=false,
            next_daily_at='2099-01-01T00:00:00Z', next_weekly_at='2099-01-01T00:00:00Z',
            stage_cursor=$1::bigint, project_ids=$2::jsonb, audiences=$3::jsonb, updated_at=now()
      where enterprise_id=$4::bigint`,
    [maxStageCursor, JSON.stringify([PROJECT_ID]), JSON.stringify([...KINDS]), ENTERPRISE_ID],
  );
  const during = (await owner.query(
    'select enabled,stage_enabled,next_daily_at,next_weekly_at,stage_cursor,project_ids,audiences from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  return { before, during };
}

function markedMedia(scope: string): Buffer {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
      <rect width="640" height="480" fill="#d9d2c3"/>
      <path d="M90 0v330h470M130 0v290h430" stroke="#bf543e" stroke-width="14" fill="none"/>
      <rect y="390" width="640" height="90" fill="#ffffff"/>
      <text x="28" y="445" font-size="24" fill="#1e4c41">TEST DATA ${scope} - NOT A REAL SITE</text>
    </svg>`,
  );
  return svg;
}

async function ensureCustomerRecord(): Promise<MarkedRecord> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const { SiteChatService } = await import('@/lib/construction/site-chat');
  const { default: sharp } = await import('sharp');

  const title = `${SCOPE} 客户可见进度记录`;
  const text = `${SCOPE} 客户可见进度记录：水电线管敷设完成，底盒待固定。`;
  const day = '2026-10-21';
  const site = new SiteChatService({ enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID });
  const existing = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select r.id,r.version,r.published_version from app.construction_site_records r
      where r.enterprise_id=${ENTERPRISE_ID} and r.project_id=${PROJECT_ID}
        and r.author_id=${EXECUTOR_ADMIN_ID} and r.status='published' and r.audience='customer'
        and r.published_customer_id=${CUSTOMER_USER_ID} and r.data->>'title'=${title}
        and exists(select 1 from app.construction_site_attachments a
          join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
          where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id and m.deleted_at is null)
      order by r.id desc limit 1`,
  ));
  if (existing) {
    const media = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
      tx,
      sql`select a.media_id from app.construction_site_attachments a
        join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
        where a.enterprise_id=${ENTERPRISE_ID} and a.project_id=${PROJECT_ID} and a.record_id=${String(existing.id)}
          and m.deleted_at is null order by a.position limit 1`,
    ));
    if (media?.media_id) {
      return {
        recordId: String(existing.id),
        mediaId: String(media.media_id),
        version: Number(existing.published_version ?? existing.version),
        day,
        reused: true,
      };
    }
  }

  const bytes = await sharp(markedMedia(`${SCOPE} CUSTOMER`)).png().toBuffer();
  const media = await site.upload(PROJECT_ID, `${SCOPE}.customer-photo.${runStamp}`, bytes);
  const sent = await site.send(PROJECT_ID, {
    text,
    mediaIds: [String(media.id)],
    capture: { kind: 'quick', workId: 'conduit', roomId: null, location: 'whole', progress: 'done' },
  }, `${SCOPE}.customer-send.${runStamp}`);
  if (!sent.recordId) fail('the construction service did not create the customer fixture record');
  const current = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select version from app.construction_site_records
      where enterprise_id=${ENTERPRISE_ID} and project_id=${PROJECT_ID} and id=${String(sent.recordId)}`,
  ));
  const edited = await site.mutate(PROJECT_ID, String(sent.recordId), 'edit', {
    expectedVersion: Number(current!.version),
    data: {
      title,
      roomId: null,
      completed: '客户可见：线管敷设完成，线盒位置已标记',
      pending: '底盒未固定',
      coordination: '本周内完成底盒固定',
      note: 'B5.8 四端联合验收的客户可见合成记录，不代表验收或正式批准',
    },
  }, `${SCOPE}.customer-edit.${runStamp}`);
  const published = await site.mutate(PROJECT_ID, String(sent.recordId), 'publish', {
    expectedVersion: Number(edited.version),
    audience: 'customer',
  }, `${SCOPE}.customer-publish.${runStamp}`);
  const aligned = await alignRecord(String(sent.recordId), day, 'customer', EXECUTOR_ADMIN_ID);
  if (!aligned) fail('the customer fixture record could not be aligned into the fixed week');
  return {
    recordId: String(sent.recordId),
    mediaId: String(media.id),
    version: Number(published.version),
    day,
    reused: false,
  };
}

async function ensureInternalRecord(): Promise<MarkedRecord> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const { SiteChatService } = await import('@/lib/construction/site-chat');
  const { default: sharp } = await import('sharp');

  const title = `${SCOPE} 内部施工记录`;
  const text = `${SCOPE} 内部施工记录：底盒固定与回路核对完成，面板待安装。`;
  const day = '2026-10-23';
  const workerSite = new SiteChatService({ enterpriseId: ENTERPRISE_ID, adminId: WORKER_ADMIN_ID });
  const ownerSite = new SiteChatService({ enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID });
  const existing = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select r.id,r.version,r.published_version from app.construction_site_records r
      where r.enterprise_id=${ENTERPRISE_ID} and r.project_id=${PROJECT_ID}
        and r.author_id=${WORKER_ADMIN_ID} and r.status='published' and r.audience='internal'
        and r.data->>'title'=${title}
        and exists(select 1 from app.construction_site_attachments a
          join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
          where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id and m.deleted_at is null)
      order by r.id desc limit 1`,
  ));
  if (existing) {
    const media = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
      tx,
      sql`select a.media_id from app.construction_site_attachments a
        join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
        where a.enterprise_id=${ENTERPRISE_ID} and a.project_id=${PROJECT_ID} and a.record_id=${String(existing.id)}
          and m.deleted_at is null order by a.position limit 1`,
    ));
    if (media?.media_id) {
      return {
        recordId: String(existing.id),
        mediaId: String(media.media_id),
        version: Number(existing.published_version ?? existing.version),
        day,
        reused: true,
      };
    }
  }

  const bytes = await sharp(markedMedia(`${SCOPE} INTERNAL`)).png().toBuffer();
  const media = await workerSite.upload(PROJECT_ID, `${SCOPE}.internal-photo.${runStamp}`, bytes);
  const sent = await workerSite.send(PROJECT_ID, {
    text,
    mediaIds: [String(media.id)],
    capture: { kind: 'quick', workId: 'conduit', roomId: null, location: 'whole', progress: 'done' },
  }, `${SCOPE}.internal-send.${runStamp}`);
  if (!sent.recordId) fail('the construction service did not create the internal fixture record');
  const current = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select version from app.construction_site_records
      where enterprise_id=${ENTERPRISE_ID} and project_id=${PROJECT_ID} and id=${String(sent.recordId)}`,
  ));
  const edited = await ownerSite.mutate(PROJECT_ID, String(sent.recordId), 'edit', {
    expectedVersion: Number(current!.version),
    data: {
      title,
      roomId: null,
      completed: '内部可见：底盒固定完成，回路逐路核对',
      pending: '面板未安装',
      coordination: '等待面板到货',
      note: 'B5.8 四端联合验收的内部合成记录，不代表验收或正式批准',
    },
  }, `${SCOPE}.internal-edit.${runStamp}`);
  const published = await ownerSite.mutate(PROJECT_ID, String(sent.recordId), 'publish', {
    expectedVersion: Number(edited.version),
    audience: 'internal',
  }, `${SCOPE}.internal-publish.${runStamp}`);
  const aligned = await alignRecord(String(sent.recordId), day, 'internal', WORKER_ADMIN_ID);
  if (!aligned) fail('the internal fixture record could not be aligned into the fixed week');
  return {
    recordId: String(sent.recordId),
    mediaId: String(media.id),
    version: Number(published.version),
    day,
    reused: false,
  };
}

async function alignRecord(
  recordId: string,
  day: string,
  audience: 'customer' | 'internal',
  authorId: string,
): Promise<boolean> {
  const updated = await fixture().query(
    `update app.construction_site_records
        set published_at=$1::timestamptz, updated_at=now()
      where enterprise_id=$2::bigint and project_id=$3::bigint and id=$4::bigint
        and status='published' and audience=$5 and author_id=$6::bigint`,
    [`${day}T04:00:00.000Z`, ENTERPRISE_ID, PROJECT_ID, recordId, audience, authorId],
  );
  return updated.rowCount === 1;
}

/** Read the two marked records back for a resumed run; never creates new ones. */
async function loadMarkedRecord(kind: 'customer' | 'internal'): Promise<MarkedRecord> {
  const title = kind === 'customer'
    ? `${SCOPE} 客户可见进度记录`
    : `${SCOPE} 内部施工记录`;
  const audience = kind === 'customer' ? 'customer' : 'internal';
  const authorId = kind === 'customer' ? EXECUTOR_ADMIN_ID : WORKER_ADMIN_ID;
  const day = kind === 'customer' ? '2026-10-21' : '2026-10-23';
  const row = (await fixture().query(
    `select r.id::text as id,r.version,r.published_version,
            (select a.media_id::text from app.construction_site_attachments a
               join app.construction_site_media m
                 on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
              where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id
                and m.deleted_at is null order by a.position limit 1) as media_id
       from app.construction_site_records r
      where r.enterprise_id=$1::bigint and r.project_id=$2::bigint
        and r.author_id=$3::bigint and r.status='published' and r.audience=$4
        and r.data->>'title'=$5
      order by r.id desc limit 1`,
    [ENTERPRISE_ID, PROJECT_ID, authorId, audience, title],
  )).rows[0];
  if (!row?.media_id) {
    fail(`the marked ${kind} fixture record is missing; run the fresh acceptance first`);
  }
  return {
    recordId: String(row.id),
    mediaId: String(row.media_id),
    version: Number(row.published_version ?? row.version),
    day,
    reused: true,
  };
}

/** In a resumed run the queued jobs must be exactly this batch's facts jobs. */
async function assertQueuedJobsAreOurs(pool: pg.Pool, payload: BatchOutput): Promise<void> {
  const expected = new Set(payload.entries.map((entry) => entry.saveReceipt!.runId));
  const jobs = (await pool.query(
    `select id::text as id,run_id::text as run_id,status from app.assistant_jobs
      where enterprise_id=$1::bigint and status in ('queued','running') order by id`,
    [ENTERPRISE_ID],
  )).rows;
  const foreign = jobs.filter((job) => !expected.has(String(job.run_id)));
  if (foreign.length) {
    fail(`unrelated queued/running jobs would be consumed by this resume: ${JSON.stringify(foreign)}`);
  }
  check('only this batch\'s four facts jobs are waiting for the Worker', jobs.length <= 4, {
    jobs,
    expectedRunIds: [...expected],
  });
}

function jsonObjectAt(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runBatchCli(requestId: string, extraArgs: string[] = []): {
  payload: BatchOutput | null;
  errorPayload: Record<string, unknown> | null;
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    'scripts/native-workflow-period-report-batch.ts',
    '--development',
    '--ensure-published',
    '--admin-id', EXECUTOR_ADMIN_ID,
    '--project-id', PROJECT_ID,
    '--worker-id', WORKER_ADMIN_ID,
    '--designer-id', DESIGNER_ADMIN_ID,
    '--boss-id', BOSS_ADMIN_ID,
    '--period-kind', PERIOD_KIND,
    '--period-start', PERIOD_START,
    '--period-end', PERIOD_END,
    '--event-id', `${SCOPE}-${PERIOD_KIND}-${PERIOD_START}`,
    '--request-id', requestId,
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 240_000,
    env: {
      ...process.env,
      B4_LIVE_APP_DATABASE_URL: appUrl,
      B4_LIVE_FIXTURE_DATABASE_URL: fixtureUrl,
      NATIVE_WORKFLOW_STORE_DIR: storeDir,
      NATIVE_WORKFLOW_RUN_DIR: runDir,
      NATIVE_WORKFLOW_BATCH_DIR: batchDir,
    },
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    payload: jsonObjectAt(stdout) as BatchOutput | null,
    errorPayload: jsonObjectAt(stderr),
    exitCode: result.status ?? -1,
    stdout,
    stderr,
  };
}

function assertBatchEntries(payload: BatchOutput): void {
  assert.equal(payload.projectId, PROJECT_ID);
  assert.deepEqual(payload.receivers.map((receiver) => receiver.kind), [...KINDS]);
  for (const kind of KINDS) {
    const entry = payload.entries.find((candidate) => candidate.kind === kind);
    assert.ok(entry, `the ${kind} entry is missing`);
    assert.equal(entry.executed, true, `the ${kind} entry was not executed`);
    assert.ok(entry.saveReceipt, `the ${kind} entry has no save receipt`);
    assert.equal(entry.saveReceipt!.bindingId, BINDINGS[kind].bindingId);
    assert.equal(entry.saveReceipt!.conversationId, BINDINGS[kind].conversationId);
  }
  const reportIds = payload.entries.map((entry) => entry.saveReceipt!.reportId);
  assert.equal(new Set(reportIds).size, 4, 'the four receivers must not share a report');
}

async function runJointBatch(): Promise<BatchOutput> {
  const requestId = `${acceptanceId}-request-1`;
  const first = runBatchCli(requestId);
  evidence.firstBatch = {
    requestId,
    exitCode: first.exitCode,
    payload: first.payload,
    stderr: first.stderr.slice(-2000),
  };
  if (!first.payload) fail(`the joint batch produced no JSON output: ${first.stderr.slice(-1500)}`);
  assertBatchEntries(first.payload);
  if (first.payload.status === 'failed' || first.payload.status === 'unknown') {
    fail(`the joint batch did not complete dispatch: ${JSON.stringify(first.payload.reasons)}`);
  }
  if (resume) {
    check('the resumed request observes the four existing saved reports without a second round', Boolean(
      first.payload.created === false
      && first.payload.observedOnly === true
      && first.payload.entries.every((entry) => entry.state === 'processing' || entry.state === 'completed'),
    ), {
      created: first.payload.created,
      observedOnly: first.payload.observedOnly,
      status: first.payload.status,
    });
  } else {
    check('one host call created four independent saved reports', first.payload.entries.every(
      (entry) => entry.state === 'processing' || entry.state === 'completed',
    ), {
      status: first.payload.status,
      entries: first.payload.entries.map((entry) => ({
        kind: entry.kind,
        state: entry.state,
        reason: entry.reason,
        reportId: entry.saveReceipt?.reportId,
        bindingId: entry.saveReceipt?.bindingId,
        conversationId: entry.saveReceipt?.conversationId,
      })),
    });
  }
  check('the four receivers use one selected published revision and event', Boolean(
    first.payload.published.definitionId === 'period-report-weekly'
    && first.payload.published.revision >= 1
    && first.payload.published.digest,
  ), first.payload.published);
  const planDuring = (evidence.reportPlan as Record<string, unknown> | undefined)?.during as
    | Record<string, unknown>
    | undefined;
  const sharedPlan = first.payload.plan ?? (planDuring
    ? {
        projectIds: planDuring.project_ids,
        audiences: planDuring.audiences,
        enabled: planDuring.enabled,
        stageEnabled: planDuring.stage_enabled,
      }
    : null);
  check('the shared plan contains exactly the one project and all four audiences', Boolean(
    sharedPlan
    && JSON.stringify(sharedPlan.projectIds) === JSON.stringify([PROJECT_ID])
    && sharedPlan.enabled === true
    && sharedPlan.stageEnabled === false
    && (sharedPlan.audiences === null
      || JSON.stringify(sharedPlan.audiences) === JSON.stringify([...KINDS])),
  ), sharedPlan ?? {});

  // Read the four B-owned run files: the same revision/digest/event must back
  // every receiver, and each binding must name its own receiver.
  const runFiles = first.payload.entries.map((entry) => {
    const file = path.join(runDir, 'runs', `${entry.runId}.json`);
    if (!fs.existsSync(file)) fail(`the sub-run file ${file} was not written`);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      record: {
        binding: {
          definitionId: string;
          revision: number;
          digest: string;
          nodeVersions: Record<string, string>;
          event: TriggerEvent;
          businessEvent: { receiver?: { kind: string; adminId?: string } };
        };
        projectId: string;
        enterpriseId: string;
      };
    };
    return { entry, binding: parsed.record.binding, record: parsed.record };
  });
  const firstBinding = runFiles[0].binding;
  const manifestFile = path.join(batchDir, 'requests', `${first.payload.requestId}.json`);
  if (!fs.existsSync(manifestFile)) fail(`the host batch manifest ${manifestFile} was not written`);
  const manifestEvent = (JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as {
    manifest: { event: TriggerEvent };
  }).manifest.event;
  for (const candidate of runFiles) {
    assert.equal(candidate.binding.definitionId, firstBinding.definitionId);
    assert.equal(candidate.binding.revision, firstBinding.revision);
    assert.equal(candidate.binding.digest, firstBinding.digest);
    assert.deepEqual(candidate.binding.nodeVersions, firstBinding.nodeVersions);
    assert.deepEqual(candidate.binding.event, firstBinding.event);
    assert.deepEqual(candidate.binding.event, manifestEvent);
    assert.equal(candidate.record.projectId, PROJECT_ID);
    assert.equal(candidate.record.enterpriseId, ENTERPRISE_ID);
  }
  check('the four sub-runs share one published revision, digest, node versions and event', true, {
    definitionId: firstBinding.definitionId,
    revision: firstBinding.revision,
    digest: firstBinding.digest,
    event: firstBinding.event,
    runIds: runFiles.map((candidate) => candidate.entry.runId),
  });
  const receiverKinds = runFiles.map((candidate) => candidate.binding.businessEvent.receiver?.kind ?? 'customer');
  check('each sub-run is bound to its own host receiver, never another role', JSON.stringify(receiverKinds) === JSON.stringify([...KINDS]), {
    receiverKinds,
  });
  return first.payload;
}

async function startWorkerEndpoint(): Promise<{ server: http.Server; port: number }> {
  const { POST } = await import('@/app/api/internal/assistant/jobs/run/route');
  const server = http.createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${request.url}`;
      const forwarded = new Request(url, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const result = await POST(forwarded);
      const body = await result.text();
      response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') ?? 'application/json' });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false, error: messageOf(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as { port: number }).port };
}

function startWorkerProcess(port: number, logFile: string): ChildProcess {
  const log = fs.openSync(logFile, 'a');
  return spawn(process.execPath, ['scripts/assistant-worker.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ASSISTANT_WORKER_ENDPOINT: `http://127.0.0.1:${port}/api/internal/assistant/jobs/run`,
      ASSISTANT_WORKER_HEALTH_FILE: path.join(outputDir, 'worker-health.json'),
      CRON_SECRET: process.env.CRON_SECRET!,
    },
    stdio: ['ignore', log, log],
  });
}

async function stopWorker(): Promise<void> {
  const worker = state.workerProcess;
  state.workerProcess = null;
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
  const server = state.workerServer;
  state.workerServer = null;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function assertNoForeignJobs(pool: pg.Pool): Promise<void> {
  const foreign = await pool.query(
    `select id::text, status, kind from app.assistant_jobs
      where enterprise_id=$1::bigint and status in ('queued','running') order by id limit 20`,
    [ENTERPRISE_ID],
  );
  if (foreign.rows.length) {
    fail(`the B worker has unrelated queued/running jobs: ${JSON.stringify(foreign.rows)}; process them before this acceptance`);
  }
}

async function waitForAllDeliveries(
  pool: pg.Pool,
  payload: BatchOutput,
  timeoutMs = 900_000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const reportIds = payload.entries.map((entry) => entry.saveReceipt!.reportId);
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const rows = (await pool.query(
      `select r.id::text as report_id,r.binding_id::text as binding_id,
        v.revision,v.status,v.knowledge_status,v.body_run_id::text as body_run_id,
        d.state as delivery_state,d.message_id::text as message_id,d.delivered_at
       from app.construction_reports r
       join app.construction_report_versions v
         on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
       left join app.construction_report_deliveries d
         on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision and d.binding_id=r.binding_id
      where r.enterprise_id=$1::bigint and r.id = any($2::bigint[])
      order by r.id`,
      [ENTERPRISE_ID, reportIds],
    )).rows;
    const bodyRuns = (await pool.query(
      `select id::text as id,status,error_code from app.assistant_runs
        where enterprise_id=$1::bigint and purpose='construction.report.compose'
          and id = any($2::bigint[])
        order by id`,
      [ENTERPRISE_ID, rows.map((row) => row.body_run_id).filter(Boolean)],
    )).rows;
    last = { reports: rows, bodyRuns };
    const complete = rows.length === reportIds.length && rows.every((row) => {
      const bodyRun = bodyRuns.find((run) => String(run.id) === String(row.body_run_id));
      return row.status === 'facts_ready'
        && row.knowledge_status === 'ready'
        && row.delivery_state === 'delivered'
        && row.message_id
        && bodyRun?.status === 'succeeded';
    });
    if (complete) return last;
    const stopped = rows.some((row) => row.delivery_state === 'revoked'
      || (row.body_run_id && bodyRuns.find((run) => String(run.id) === String(row.body_run_id))?.status === 'failed'));
    if (stopped) return { ...last, stopped: true };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ...last, timedOut: true };
}

async function readReportRows(
  pool: pg.Pool,
  reportId: string,
): Promise<{
  report: Record<string, unknown>;
  version: Record<string, unknown>;
  delivery: Record<string, unknown>;
  factsRun: Record<string, unknown>;
  bodyRun: Record<string, unknown> | null;
  facts: Record<string, unknown>;
}> {
  const report = (await pool.query(
    `select r.id::text as report_id,r.binding_id::text as binding_id,r.latest_revision,
      r.period_start,r.period_end,v.revision,
      v.status,v.knowledge_status,v.body_run_id::text as body_run_id,
      v.facts,v.run_id::text as facts_run_id
     from app.construction_reports r
     join app.construction_report_versions v
       on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
     where r.enterprise_id=$1::bigint and r.id=$2::bigint`,
    [ENTERPRISE_ID, reportId],
  )).rows[0];
  if (!report) fail(`report ${reportId} was not found`);
  const delivery = (await pool.query(
    `select d.*,m.conversation_id::text as message_conversation_id,m.purpose as message_purpose
       from app.construction_report_deliveries d
       left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
      where d.enterprise_id=$1::bigint and d.report_id=$2::bigint order by d.revision desc limit 1`,
    [ENTERPRISE_ID, reportId],
  )).rows[0];
  if (!delivery) fail(`report ${reportId} has no delivery`);
  const factsRun = (await pool.query(
    `select id::text as id,status,purpose,conversation_id::text as conversation_id,policy_snapshot
       from app.assistant_runs where enterprise_id=$1::bigint and id=$2::bigint`,
    [ENTERPRISE_ID, String(report.facts_run_id)],
  )).rows[0];
  if (!factsRun) fail(`report ${reportId} has no facts run`);
  const bodyRun = report.body_run_id
    ? (await pool.query(
        `select id::text as id,status,purpose from app.assistant_runs
          where enterprise_id=$1::bigint and id=$2::bigint`,
        [ENTERPRISE_ID, String(report.body_run_id)],
      )).rows[0] ?? null
    : null;
  return {
    report,
    version: report,
    delivery,
    factsRun,
    bodyRun,
    facts: report.facts as Record<string, unknown>,
  };
}

async function readModelEvidence(
  pool: pg.Pool,
  reportId: string,
  revision: number,
  factsRunId: string,
  bodyRunId: string | null,
): Promise<{
  evidence: { ok: boolean; reasons: readonly string[]; binding: unknown };
  attempts: ReportEvidenceAttempt[];
  usage: Array<{ input: number | null; output: number | null }>;
}> {
  const steps = bodyRunId
    ? (await pool.query<ReportEvidenceStep>(
        `select run_id::text as run_id, step_seq, kind, status, provider_attempt_id::text as provider_attempt_id
           from app.assistant_run_steps
          where enterprise_id=$1::bigint and run_id=$2::bigint order by step_seq`,
        [ENTERPRISE_ID, bodyRunId],
      )).rows
    : [];
  const attempts = bodyRunId
    ? (await pool.query<ReportEvidenceAttempt>(
        `select id::text as id, assistant_run_id::text as assistant_run_id,
           provider_key, adapter_type, status, accepted
           from app.ai_provider_attempts
          where enterprise_id=$1::bigint and assistant_run_id=$2::bigint order by id`,
        [ENTERPRISE_ID, bodyRunId],
      )).rows
    : [];
  const usageRows = bodyRunId
    ? (await pool.query<{
        id: string; run_id: string; provider_attempt_id: string | null; category: string;
        measurement_kind: string; quantity: string | null; input_tokens: string | null; output_tokens: string | null;
      }>(
        `select id::text as id, run_id::text as run_id, provider_attempt_id::text as provider_attempt_id,
           category, measurement_kind, quantity::text as quantity,
           input_tokens::text as input_tokens, output_tokens::text as output_tokens
           from app.assistant_usage_records
          where enterprise_id=$1::bigint and run_id=$2::bigint order by id`,
        [ENTERPRISE_ID, bodyRunId],
      )).rows
    : [];
  const usage = usageRows.map((row) => ({
    id: String(row.id),
    run_id: String(row.run_id),
    provider_attempt_id: row.provider_attempt_id == null ? null : String(row.provider_attempt_id),
    category: String(row.category),
    measurement_kind: String(row.measurement_kind),
    quantity: row.quantity == null ? null : Number(row.quantity),
    input_tokens: row.input_tokens == null ? null : Number(row.input_tokens),
    output_tokens: row.output_tokens == null ? null : Number(row.output_tokens),
  }));
  const snapshot: ReportEvidenceSnapshot = {
    report: { id: reportId, latest_revision: revision },
    version: {
      report_id: reportId,
      revision,
      run_id: factsRunId,
      body_run_id: bodyRunId,
      status: 'facts_ready',
      knowledge_status: 'ready',
    },
    factsRun: { id: factsRunId, purpose: 'construction.report.facts', status: 'succeeded' },
    bodyRun: bodyRunId
      ? { id: bodyRunId, purpose: 'construction.report.compose', status: 'succeeded' }
      : null,
    steps,
    attempts,
    usage,
  };
  const model = evaluateReportModelEvidence({ reportId, revision, factsRunId }, snapshot);
  return {
    evidence: { ok: model.ok, reasons: model.reasons, binding: model.binding },
    attempts,
    usage: usage
      .filter((row) => row.category === 'tokens' && row.measurement_kind === 'observed')
      .map((row) => ({ input: row.input_tokens, output: row.output_tokens })),
  };
}

async function collectReportEvidence(
  pool: pg.Pool,
  payload: BatchOutput,
): Promise<Partial<Record<ReceiverKind, LegacyReport>>> {
  const reports: Partial<Record<ReceiverKind, LegacyReport>> = {};
  for (const entry of payload.entries) {
    const receipt = entry.saveReceipt!;
    const rows = await readReportRows(pool, receipt.reportId);
    const bodyRunId = rows.report.body_run_id == null ? null : String(rows.report.body_run_id);
    const model = await readModelEvidence(
      pool,
      receipt.reportId,
      receipt.revision,
      String(rows.report.facts_run_id),
      bodyRunId,
    );
    const projects = Array.isArray(rows.facts?.projects) ? rows.facts.projects as Array<Record<string, unknown>> : [];
    const project = projects.find((candidate) => String(candidate.id) === PROJECT_ID);
    const records = Array.isArray(project?.records) ? project!.records as Array<Record<string, unknown>> : [];
    const recordIds = records.map((record) => String(record.id));
    const photoRows = (await pool.query(
      `select a.media_id::text as media_id from app.construction_site_attachments a
        join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
       where a.enterprise_id=$1::bigint and a.project_id=$2::bigint and m.deleted_at is null
         and a.record_id = any($3::bigint[]) order by a.record_id,a.position`,
      [ENTERPRISE_ID, PROJECT_ID, recordIds.filter((id) => /^[1-9]\d*$/u.test(id))],
    )).rows;
    reports[entry.kind] = {
      kind: entry.kind,
      bindingId: String(rows.report.binding_id),
      conversationId: String(rows.factsRun.conversation_id),
      reportId: String(rows.report.report_id),
      revision: Number(rows.report.latest_revision),
      factsRunId: String(rows.report.facts_run_id),
      bodyRunId,
      messageId: rows.delivery.message_id == null ? null : String(rows.delivery.message_id),
      reuse: receipt.reused,
      recordIds,
      photoMediaIds: photoRows.map((row) => String(row.media_id)),
      modelEvidence: model.evidence,
      attempts: model.attempts,
      use: model.usage,
    };
  }
  return reports;
}

function factsProjectIds(rows: { factsRun: Record<string, unknown> }): string[] {
  const policy = rows.factsRun.policy_snapshot as Record<string, unknown> | undefined;
  const scope = policy?.scope as Record<string, unknown> | undefined;
  const ids = scope?.project_ids;
  return Array.isArray(ids) ? ids.map(String) : [];
}

/**
 * The authoritative expected record set for one receiver, computed with the
 * existing report-facts service (customer audience, membership, source and
 * media rules). This is the oracle the frozen report facts must match.
 */
async function expectedFactsRecords(bindingId: string): Promise<string[]> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const { collectReportFacts } = await import('@/lib/construction/report-scope');
  return withTenantTransaction(ENTERPRISE_ID, async (tx) => {
    const binding = await one(
      tx,
      sql`select * from app.construction_followup_bindings
        where enterprise_id=${ENTERPRISE_ID} and id=${bindingId}`,
    );
    if (!binding) fail(`binding ${bindingId} was not found`);
    const settings = await one(
      tx,
      sql`select * from app.construction_report_settings where enterprise_id=${ENTERPRISE_ID}`,
    );
    if (!settings) fail('the report plan is missing');
    const facts = await collectReportFacts(tx, ENTERPRISE_ID, binding, {
      kind: 'weekly',
      period_start: new Date('2026-10-19T00:00:00+08:00'),
      period_end: new Date('2026-10-26T00:00:00+08:00'),
      cutoff_at: new Date('2026-10-26T00:00:00+08:00'),
      stage_event_id: null,
      stage_event: null,
    }, settings);
    const project = facts.projects.find((candidate) => String(candidate.id) === PROJECT_ID);
    return (project?.records ?? []).map((record) => String(record.id));
  });
}

async function expectedFactsByReceiver(): Promise<Record<ReceiverKind, string[]>> {
  const result = {} as Record<ReceiverKind, string[]>;
  for (const kind of KINDS) {
    result[kind] = await expectedFactsRecords(BINDINGS[kind].bindingId);
  }
  evidence.expectedFacts = result;
  return result;
}

async function assertIndependentFacts(
  pool: pg.Pool,
  payload: BatchOutput,
  expected: Record<ReceiverKind, string[]>,
): Promise<void> {
  const internalId = state.internalRecord!.recordId;
  for (const entry of payload.entries) {
    const rows = await readReportRows(pool, entry.saveReceipt!.reportId);
    const projects = Array.isArray(rows.facts?.projects) ? rows.facts.projects as Array<Record<string, unknown>> : [];
    const project = projects.find((candidate) => String(candidate.id) === PROJECT_ID);
    const recordIds = (Array.isArray(project?.records) ? project!.records as Array<Record<string, unknown>> : [])
      .map((record) => String(record.id));
    const projectIds = factsProjectIds(rows);
    check(`the ${entry.kind} facts scope is exactly the one project`, JSON.stringify(projectIds) === JSON.stringify([PROJECT_ID]), {
      projectIds,
    });
    check(`the ${entry.kind} facts match the existing rules' authorized record set`, Boolean(
      JSON.stringify([...recordIds].sort()) === JSON.stringify([...expected[entry.kind]].sort()),
    ), {
      recordIds,
      expected: expected[entry.kind],
    });
    if (entry.kind === 'customer') {
      check('the customer facts never contain the internal record', recordIds.includes(internalId) === false, {
        recordIds,
        internalRecordId: internalId,
      });
    }
  }
  // The worker-authored internal fixture is covered by the pre-existing
  // audit-125 revocation rule, which excludes it from every non-customer
  // facts set. This is the existing rule, not a B5.8 receiver failure.
  check('the existing audit-125 rule keeps the worker-authored internal record out of staff facts', KINDS
    .filter((kind) => kind !== 'customer')
    .every((kind) => expected[kind].includes(internalId) === false), {
    internalRecordId: internalId,
    expected,
  });
  check('the customer and staff reports are four independent report rows', Boolean(
    new Set(payload.entries.map((entry) => entry.saveReceipt!.reportId)).size === 4
    && payload.entries.find((entry) => entry.kind === 'customer')!.saveReceipt!.bindingId
      !== payload.entries.find((entry) => entry.kind === 'worker')!.saveReceipt!.bindingId,
  ), {
    reportIds: payload.entries.map((entry) => entry.saveReceipt!.reportId),
    bindingIds: payload.entries.map((entry) => entry.saveReceipt!.bindingId),
  });
}

async function apiRequest(
  token: string,
  apiPath: string[],
  query = '',
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { assistantHttp } = await import('@/lib/assistant/application/http');
  const request = new Request(`http://127.0.0.1:3006/api/miniprogram/assistant/${apiPath.join('/')}${query}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> || {}),
    },
  });
  const response = await assistantHttp(request, apiPath);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function apiBinary(
  session: ApiSession,
  apiPath: string[],
  query = '',
): Promise<{ status: number; bytes: Buffer; contentType: string }> {
  const { assistantHttp } = await import('@/lib/assistant/application/http');
  const request = new Request(`http://127.0.0.1:3006/api/miniprogram/assistant/${apiPath.join('/')}${query}`, {
    headers: { Authorization: `Bearer ${session.token}`, ...headersOf(session) },
  });
  const response = await assistantHttp(request, apiPath);
  return {
    status: response.status,
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  };
}

interface ApiSession {
  token: string;
  entryToken?: string;
}

async function staffSession(
  userId: string,
  staffId: string,
  role: 'designer' | 'construction_staff' | 'enterprise_admin',
): Promise<ApiSession> {
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const contextVersion = parseContextVersion((await fixture().query(
    'select context_version from app.users where id=$1::bigint',
    [userId],
  )).rows[0]?.context_version, `${role} base user context_version`);
  const token = await signMiniProgramToken({
    sub: userId,
    id: userId,
    mode: 'staff',
    role,
    staffId,
    enterpriseId: ENTERPRISE_ID,
    contextVersion,
    source: 'password',
  });
  return { token };
}

async function customerSession(): Promise<ApiSession> {
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const contextVersion = Number((await fixture().query(
    'select context_version from app.users where id=$1::bigint',
    [CUSTOMER_USER_ID],
  )).rows[0]?.context_version);
  const token = await signMiniProgramToken({
    sub: CUSTOMER_USER_ID,
    id: CUSTOMER_USER_ID,
    mode: 'customer',
    role: 'user',
    enterpriseId: ENTERPRISE_ID,
    contextVersion,
    source: 'wechat',
  });
  const entry = await apiRequest(token, ['entry-context'], '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: LEAD_ID }),
  });
  assert.equal(entry.status, 200, `entry-context failed: ${JSON.stringify(entry.body)}`);
  return { token, entryToken: String((entry.body.data as Record<string, unknown>).entryToken) };
}

async function sessionFor(kind: ReceiverKind): Promise<ApiSession> {
  if (kind === 'customer') return customerSession();
  if (kind === 'worker') return staffSession(WORKER_ADMIN_ID, WORKER_ADMIN_ID, 'construction_staff');
  if (kind === 'designer') return staffSession(DESIGNER_USER_ID, DESIGNER_ADMIN_ID, 'designer');
  return staffSession(BOSS_USER_ID, BOSS_ADMIN_ID, 'enterprise_admin');
}

function headersOf(session: ApiSession): Record<string, string> {
  return session.entryToken ? { 'X-Assistant-Entry': session.entryToken } : {};
}

interface RoleRead {
  readonly kind: ReceiverKind;
  readonly bindingIds: string[];
  readonly reportListCount: number;
  readonly title: string;
  readonly detail: Record<string, unknown>;
  readonly records: string[];
  readonly record: { id: string; version: number; mediaIds: string[] };
  readonly photo: { status: number; bytes: number; sha256: string };
}

async function readRoleReport(
  kind: ReceiverKind,
  session: ApiSession,
  report: LegacyReport,
  expectedRecords: readonly string[],
): Promise<RoleRead> {
  const list = await apiRequest(session.token, ['followups'], '', { headers: headersOf(session) });
  assert.equal(list.status, 200, `${kind} followup list failed: ${JSON.stringify(list.body)}`);
  const items = ((list.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const own = items.find((item) => String(item.bindingId) === report.bindingId);
  assert.ok(own, `the ${kind} binding is missing from the followup list`);
  assert.equal(own!.audience, BINDINGS[kind].audience);

  const reports = await apiRequest(
    session.token,
    ['followups', report.bindingId, 'reports'],
    `?kind=${PERIOD_KIND}`,
    { headers: headersOf(session) },
  );
  assert.equal(reports.status, 200, `${kind} report list failed: ${JSON.stringify(reports.body)}`);
  const reportItems = ((reports.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const listed = reportItems.find((item) => String(item.reportId) === report.reportId);
  assert.ok(listed, `the ${kind} weekly report is missing from the list`);

  const detail = await apiRequest(
    session.token,
    ['followups', report.bindingId, 'reports', report.reportId],
    `?revision=${report.revision}`,
    { headers: headersOf(session) },
  );
  assert.equal(detail.status, 200, `${kind} report detail failed: ${JSON.stringify(detail.body)}`);
  const data = detail.body.data as Record<string, unknown>;
  assert.equal(data.available, true, `${kind} report must be available`);
  assert.equal(data.contentStatus, 'composed', `${kind} report must have a model body`);
  assert.equal(data.deliveryState, 'delivered', `${kind} report must be delivered`);
  const facts = data.facts as Record<string, unknown> | null;
  const projects = (facts?.projects ?? []) as Array<Record<string, unknown>>;
  assert.deepEqual(projects.map((project) => String(project.id)), [PROJECT_ID]);
  const project = projects[0]!;
  const factsRecords = (project.records ?? []) as Array<Record<string, unknown>>;
  const recordIds = factsRecords.map((record) => String(record.id));
  assert.deepEqual(new Set(recordIds), new Set(expectedRecords), `${kind} facts records mismatch`);

  const recordId = expectedRecords[0]!;
  const recordResponse = await apiRequest(
    session.token,
    ['followups', report.bindingId, 'reports', report.reportId, 'projects', PROJECT_ID, 'records', recordId],
    `?revision=${report.revision}`,
    { headers: headersOf(session) },
  );
  assert.equal(recordResponse.status, 200, `${kind} record read failed: ${JSON.stringify(recordResponse.body)}`);
  const recordData = recordResponse.body.data as Record<string, unknown>;
  const media = (recordData.media ?? []) as Array<Record<string, unknown>>;
  const mediaId = media.length ? String(media[0]!.id) : '';
  assert.ok(mediaId, `${kind} record must expose a photo`);
  const image = await apiBinary(
    session,
    ['followups', report.bindingId, 'reports', report.reportId, 'projects', PROJECT_ID, 'records', recordId, 'media', mediaId],
    `?revision=${report.revision}`,
  );
  if (image.status !== 200) {
    console.log(JSON.stringify({
      kind,
      bindingId: report.bindingId,
      reportId: report.reportId,
      revision: report.revision,
      recordId,
      mediaId,
      media,
      status: image.status,
      body: image.bytes.toString('utf8').slice(0, 500),
    }, null, 2));
  }
  assert.equal(image.status, 200, `${kind} photo read failed`);
  assert.ok(image.bytes.byteLength > 0, `${kind} photo is empty`);

  return {
    kind,
    bindingIds: items.map((item) => String(item.bindingId)),
    reportListCount: reportItems.length,
    title: String(own!.title ?? ''),
    detail: {
      revision: Number(data.revision),
      available: data.available === true,
      contentStatus: data.contentStatus,
      deliveryState: data.deliveryState,
      generationState: data.generationState,
      factProjectIds: projects.map((project) => String(project.id)),
      records: recordIds,
      readToken: typeof data.readToken === 'string' ? data.readToken : null,
    },
    records: recordIds,
    record: {
      id: String(recordData.id),
      version: Number(recordData.version),
      mediaIds: media.map((item) => String(item.id)),
    },
    photo: {
      status: image.status,
      bytes: image.bytes.byteLength,
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
    },
  };
}

async function acknowledge(
  session: ApiSession,
  report: LegacyReport,
  requestKey: string,
): Promise<Record<string, unknown>> {
  const detail = await apiRequest(
    session.token,
    ['followups', report.bindingId, 'reports', report.reportId],
    `?revision=${report.revision}`,
    { headers: headersOf(session) },
  );
  assert.equal(detail.status, 200, `acknowledge detail failed: ${JSON.stringify(detail.body)}`);
  const readToken = String((detail.body.data as Record<string, unknown>).readToken ?? '');
  assert.ok(readToken, 'the report detail did not return a readToken');
  const ack = await apiRequest(
    session.token,
    ['followups', report.bindingId, 'reports', report.reportId, 'acknowledge'],
    '',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey,
        ...headersOf(session),
      },
      body: JSON.stringify({ revision: report.revision, readToken }),
    },
  );
  return { status: ack.status, body: ack.body };
}

async function readAtOf(bindingId: string, reportId: string, revision: number): Promise<string | null> {
  const row = (await fixture().query(
    'select read_at from app.construction_report_deliveries where enterprise_id=$1::bigint and binding_id=$2::bigint and report_id=$3::bigint and revision=$4',
    [ENTERPRISE_ID, bindingId, reportId, revision],
  )).rows[0];
  return row?.read_at ? new Date(row.read_at).toISOString() : null;
}

async function runAcceptance(): Promise<void> {
  const pool = fixture();
  await preflight(pool);
  state.fixtureReady = true;
  let countsBefore: PeriodCounts;
  if (resume) {
    state.customerRecord = await loadMarkedRecord('customer');
    state.internalRecord = await loadMarkedRecord('internal');
    const existingWeek: Record<string, number> = {};
    for (const kind of KINDS) existingWeek[kind] = await weekReports(pool, BINDINGS[kind].bindingId);
    evidence.resume = {
      acceptanceId,
      requestId: `${acceptanceId}-request-1`,
      existingWeek,
      archivedVerification: path.join(outputDir, 'verification.first-attempt.json'),
    };
    if (!KINDS.every((kind) => existingWeek[kind] === 1)) {
      fail(`a resumed request requires exactly one report per receiver: ${JSON.stringify(existingWeek)}`);
    }
    const previousFile = path.join(outputDir, 'verification.first-attempt.json');
    const previous = fs.existsSync(previousFile)
      ? JSON.parse(fs.readFileSync(previousFile, 'utf8')) as Record<string, unknown>
      : null;
    const previousCounts = previous?.countsBefore as PeriodCounts | undefined;
    countsBefore = previousCounts ?? await usageSnapshot(pool);
    evidence.countsBefore = countsBefore;
    evidence.countsAtResume = await usageSnapshot(pool);
    check('the resumed fixed week already owns exactly one report per receiver', true, {
      existingWeek,
      countsBefore,
      countsAtResume: evidence.countsAtResume,
    });
  } else {
    const existingWeek = await assertFreshWeek(pool);
    countsBefore = await usageSnapshot(pool);
    evidence.countsBefore = countsBefore;
    check('fixed week is fresh for all four receivers before any mutation', true, {
      existingWeek,
      countsBefore,
    });
  }

  const provider = await ensureProvider(pool);
  evidence.provider = provider;
  check('the B provider and platform are preconfigured and reused without a MAIN copy', true, provider);

  const agent = await ensureAgentConfig(pool);
  evidence.agentConfig = agent;
  const plan = await switchReportPlan(pool);
  evidence.reportPlan = plan;
  check('one plan row enables the four audiences and parks the legacy scheduler', true, plan.during as Record<string, unknown>);
  const expectedFacts = await expectedFactsByReceiver();
  check('the expected record scope is fixed from the existing facts rules before the role reads', true, expectedFacts);

  if (!resume) {
    state.customerRecord = await ensureCustomerRecord();
    state.internalRecord = await ensureInternalRecord();
  }
  evidence.markedRecords = {
    customer: state.customerRecord,
    internal: state.internalRecord,
  };
  check('marked customer and internal records are published and aligned to the fixed week', true, {
    customer: state.customerRecord,
    internal: state.internalRecord,
  });

  if (!resume) await assertNoForeignJobs(pool);
  const batch = await runJointBatch();
  state.batch = batch;
  if (resume) await assertQueuedJobsAreOurs(pool, batch);
  evidence.firstBatchSummary = {
    requestId: batch.requestId,
    status: batch.status,
    entries: batch.entries.map((entry) => ({
      kind: entry.kind,
      runId: entry.runId,
      state: entry.state,
      reason: entry.reason,
      saveReceipt: entry.saveReceipt,
      deliveryReceipt: entry.deliveryReceipt,
    })),
  };

  const endpoint = await startWorkerEndpoint();
  state.workerServer = endpoint.server;
  state.workerProcess = startWorkerProcess(endpoint.port, path.join(outputDir, 'worker.log'));
  const delivery = await waitForAllDeliveries(pool, batch);
  evidence.deliveryWait = delivery;
  if ((delivery as { timedOut?: boolean }).timedOut) {
    fail(`the real Worker did not deliver all four reports: ${JSON.stringify(delivery).slice(0, 2000)}`);
  }
  check('the real Worker delivered all four independent reports', (delivery as { reports: Array<Record<string, unknown>> }).reports.every(
    (row) => row.delivery_state === 'delivered' && row.message_id && row.knowledge_status === 'ready',
  ), delivery as Record<string, unknown>);

  await assertIndependentFacts(pool, batch, expectedFacts);

  const reports = await collectReportEvidence(pool, batch);
  state.reports = reports;
  for (const kind of KINDS) {
    const report = reports[kind];
    if (!report) fail(`the ${kind} report evidence is missing`);
    check(`the ${kind} report has an independent binding, conversation, message and body`, Boolean(
      report.bindingId === BINDINGS[kind].bindingId
      && report.conversationId === BINDINGS[kind].conversationId
      && report.messageId
      && report.bodyRunId
      && report.reuse === false,
    ), {
      bindingId: report.bindingId,
      conversationId: report.conversationId,
      messageId: report.messageId,
      bodyRunId: report.bodyRunId,
      reuse: report.reuse,
    });
    check(`the ${kind} report has model evidence bound to this report and body run`, report.modelEvidence.ok, {
      reasons: report.modelEvidence.reasons,
      binding: report.modelEvidence.binding,
      attempts: report.attempts,
      usage: report.use,
    });
    check(`the ${kind} model chain used exactly one succeeded accepted attempt`, Boolean(
      report.attempts.length === 1
      && report.attempts[0]!.status === 'succeeded'
      && report.attempts[0]!.accepted === true
      && report.use.length > 0,
    ), {
      attempts: report.attempts,
      usage: report.use,
    });
  }
  const allAttempts = Object.values(reports).flatMap((report) => report!.attempts);
  check('zero FastGPT attempts in the four report chains', allAttempts.every(
    (attempt) => !/fastgpt/i.test(String(attempt.provider_key)) && !/fastgpt/i.test(String(attempt.adapter_type)),
  ), { allAttempts });

  const countsAfterDelivery = await usageSnapshot(pool);
  evidence.countsAfterDelivery = countsAfterDelivery;
  check('fresh generation increased the real business counters', Boolean(
    countsAfterDelivery.constructionReports >= countsBefore.constructionReports + 4
    && countsAfterDelivery.reportDeliveries >= countsBefore.reportDeliveries + 4
    && countsAfterDelivery.assistantRuns >= countsBefore.assistantRuns + 8,
  ), { before: countsBefore, after: countsAfterDelivery });

  // The original XiaoK entry for each receiver: the customer sees only the
  // customer record; every staff/boss receiver sees the internal record too.
  const roleReads: Partial<Record<ReceiverKind, RoleRead>> = {};
  for (const kind of KINDS) {
    const report = reports[kind]!;
    const expected = expectedFacts[kind];
    const session = await sessionFor(kind);
    const read = await readRoleReport(kind, session, report, expected);
    roleReads[kind] = read;
    check(`the ${kind} original XiaoK entry opens its own report, record and photo`, Boolean(
      read.detail.available === true
      && read.detail.revision === report.revision
      && JSON.stringify(read.detail.factProjectIds) === JSON.stringify([PROJECT_ID])
      && read.record.mediaIds.length > 0
      && read.photo.bytes > 0,
    ), read as unknown as Record<string, unknown>);
  }
  evidence.roleReads = roleReads;

  const readAts: Partial<Record<ReceiverKind, string | null>> = {};
  for (const kind of KINDS) {
    const report = reports[kind]!;
    const session = await sessionFor(kind);
    const before = await readAtOf(report.bindingId, report.reportId, report.revision);
    const ack = await acknowledge(session, report, `${SCOPE}-ack-${kind}-${report.reportId}`);
    const after = await readAtOf(report.bindingId, report.reportId, report.revision);
    const repeat = await acknowledge(session, report, `${SCOPE}-ack-${kind}-${report.reportId}-repeat`);
    const repeated = await readAtOf(report.bindingId, report.reportId, report.revision);
    readAts[kind] = after;
    check(`${kind} read writes its own delivery read receipt and a repeat never rewrites it`, Boolean(
      (ack.body as Record<string, unknown>).success === true
      && after !== null
      && (before === null || after === before)
      && repeated !== null
      && repeated === after,
    ), {
      before,
      after,
      repeated,
      ack,
      repeatAck: repeat,
    });
  }
  const nonNullReadAts = KINDS.map((kind) => readAts[kind]);
  check('each receiver owns its own delivery read state', Boolean(
    nonNullReadAts.every((value) => value !== null)
    && new Set(KINDS.map((kind) => reports[kind]!.bindingId)).size === KINDS.length,
  ), {
    readAts,
  });
  evidence.readAts = readAts;

  // Exit and re-enter each role: same report/records/photo and the same read state.
  for (const kind of KINDS) {
    const report = reports[kind]!;
    const session = await sessionFor(kind);
    const reentry = await readRoleReport(
      kind,
      session,
      report,
      expectedFacts[kind],
    );
    const reentryReadAt = await readAtOf(report.bindingId, report.reportId, report.revision);
    check(`${kind} exit/re-entry returns the same report without a duplicate`, Boolean(
      reentry.detail.revision === report.revision
      && reentry.record.id === roleReads[kind]!.record.id
      && reentry.photo.sha256 === roleReads[kind]!.photo.sha256
      && reentry.reportListCount === roleReads[kind]!.reportListCount
      && reentryReadAt === readAts[kind],
    ), { first: roleReads[kind], reentry });
  }

  // Isolation: each role can list only its own binding and cannot read another.
  const sessions = await Promise.all(KINDS.map((kind) => sessionFor(kind)));
  for (let index = 0; index < KINDS.length; index += 1) {
    const kind = KINDS[index];
    const session = sessions[index];
    const otherKinds = KINDS.filter((candidate) => candidate !== kind);
    const denied: Array<{ other: ReceiverKind; reportStatus: number | null; recordStatus: number | null }> = [];
    for (const other of otherKinds) {
      const otherReport = reports[other]!;
      const reportRead = await apiRequest(
        session.token,
        ['followups', otherReport.bindingId, 'reports', otherReport.reportId],
        `?revision=${otherReport.revision}`,
        { headers: headersOf(session) },
      );
      const recordRead = await apiRequest(
        session.token,
        ['followups', otherReport.bindingId, 'reports', otherReport.reportId, 'projects', PROJECT_ID, 'records', expectedFacts.worker[0]],
        `?revision=${otherReport.revision}`,
        { headers: headersOf(session) },
      );
      denied.push({ other, reportStatus: reportRead.status, recordStatus: recordRead.status });
    }
    check(`${kind} cannot read another receiver's binding/report/record`, denied.every(
      (entry) => [403, 404].includes(entry.reportStatus ?? 0) && [403, 404].includes(entry.recordStatus ?? 0),
    ), { denied });
  }
  const customerInternal = await apiRequest(
    sessions[0].token,
    ['followups', BINDINGS.customer.bindingId, 'reports', reports.customer!.reportId, 'projects', PROJECT_ID, 'records', state.internalRecord!.recordId],
    `?revision=${reports.customer!.revision}`,
    { headers: headersOf(sessions[0]) },
  );
  check('the customer cannot read the internal record directly', [403, 404].includes(customerInternal.status), {
    status: customerInternal.status,
  });

  // Same request re-entry: observe only, no second round and no new business rows.
  const second = runBatchCli(`${acceptanceId}-request-1`);
  evidence.reentry = {
    exitCode: second.exitCode,
    payload: second.payload,
    stderr: second.stderr.slice(-1500),
  };
  if (!second.payload) fail('the re-entry produced no JSON output');
  assertBatchEntries(second.payload);
  check('the same host request only observes the four existing sub-runs', Boolean(
    second.payload.created === false
    && second.payload.observedOnly === true
    && JSON.stringify(second.payload.receivers.map((receiver) => receiver.runId))
      === JSON.stringify(batch.receivers.map((receiver) => receiver.runId))
    && second.payload.status === 'completed',
  ), {
    created: second.payload.created,
    observedOnly: second.payload.observedOnly,
    status: second.payload.status,
    runIds: second.payload.receivers.map((receiver) => receiver.runId),
  });
  for (const kind of KINDS) {
    const entry = second.payload.entries.find((candidate) => candidate.kind === kind)!;
    check(`the re-entry reports ${kind} completed from read-only business status`, Boolean(
      entry.saveReceipt?.reportId === reports[kind]!.reportId
      && entry.observation?.overall === 'completed'
      && entry.deliveryReceipt?.messageId === reports[kind]!.messageId,
    ), entry as unknown as Record<string, unknown>);
  }

  // A new host request for the same period/targets reuses the business rows.
  const secondRequestId = `${acceptanceId}-request-2-${runStamp}`;
  const third = runBatchCli(secondRequestId);
  evidence.newRequest = {
    requestId: secondRequestId,
    exitCode: third.exitCode,
    payload: third.payload,
    stderr: third.stderr.slice(-1500),
  };
  if (!third.payload) fail('the new request produced no JSON output');
  assertBatchEntries(third.payload);
  check('a new host request reuses the same four reports and deliveries', Boolean(
    third.payload.created === true
    && third.payload.status === 'completed'
    && third.payload.entries.every((entry, index) => {
      const previous = reports[KINDS[index]]!;
      return entry.saveReceipt?.reportId === previous.reportId
        && entry.saveReceipt.revision === previous.revision
        && entry.saveReceipt.reused === true
        && entry.deliveryReceipt?.messageId === previous.messageId;
    }),
  ), {
    status: third.payload.status,
    entries: third.payload.entries.map((entry) => ({
      kind: entry.kind,
      reportId: entry.saveReceipt?.reportId,
      reused: entry.saveReceipt?.reused,
      messageId: entry.deliveryReceipt?.messageId,
    })),
  });

  const countsAfterReuse = await usageSnapshot(pool);
  evidence.countsAfterReuse = countsAfterReuse;
  check('re-entry, new-request reuse, role reads and acknowledgements added no business rows or model calls', JSON.stringify(countsAfterReuse) === JSON.stringify(countsAfterDelivery), {
    before: countsAfterDelivery,
    after: countsAfterReuse,
  });

  // Repeated read-only observation must not change anything.
  const fourth = runBatchCli(`${acceptanceId}-request-1`);
  const countsAfterObservation = await usageSnapshot(pool);
  check('repeated read-only observation keeps every counter and the same manifest', Boolean(
    fourth.payload?.observedOnly === true
    && fourth.payload.status === 'completed'
    && JSON.stringify(countsAfterObservation) === JSON.stringify(countsAfterReuse),
  ), {
    status: fourth.payload?.status ?? null,
    before: countsAfterReuse,
    after: countsAfterObservation,
  });

  check('exactly one weekly report exists for each receiver in the fixed week', Boolean(
    await weekReports(pool, BINDINGS.customer.bindingId) === 1
    && await weekReports(pool, BINDINGS.worker.bindingId) === 1
    && await weekReports(pool, BINDINGS.designer.bindingId) === 1
    && await weekReports(pool, BINDINGS.boss.bindingId) === 1,
  ), {
    customer: await weekReports(pool, BINDINGS.customer.bindingId),
    worker: await weekReports(pool, BINDINGS.worker.bindingId),
    designer: await weekReports(pool, BINDINGS.designer.bindingId),
    boss: await weekReports(pool, BINDINGS.boss.bindingId),
  });
}

async function finalize(fatal: unknown): Promise<void> {
  const steps: RestorationStep[] = [{ name: 'worker', run: stopWorker }];
  if (state.fixtureReady && fixturePool) {
    const pool = fixturePool;
    steps.push({
      name: 'customer_access',
      run: async () => {
        if (!state.customerAccessChanged) return;
        await pool.query(
          'update app.construction_projects set customer_access=$1::boolean, version=version+1, updated_at=now() where enterprise_id=$2::bigint and id=$3::bigint',
          [state.customerAccessBefore, ENTERPRISE_ID, PROJECT_ID],
        );
        state.customerAccessChanged = false;
      },
      verify: async () => {
        if (state.customerAccessBefore === null) return [];
        const row = (await pool.query<{ customer_access: boolean | null }>(
          'select customer_access from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
          [ENTERPRISE_ID, PROJECT_ID],
        )).rows[0];
        if (!row) return ['project row is missing'];
        return row.customer_access === state.customerAccessBefore
          ? []
          : [`customer_access is ${String(row.customer_access)}`];
      },
    });
  }
  if (state.reportPlanBefore && fixturePool) {
    const pool = fixturePool;
    const snapshot = state.reportPlanBefore;
    steps.push({
      name: 'report_plan',
      run: () => restoreReportPlan(pool, ENTERPRISE_ID, snapshot),
      verify: () => verifyReportPlan(pool, ENTERPRISE_ID, snapshot),
    });
  }
  if (state.agentBefore && fixturePool) {
    const pool = fixturePool;
    const snapshot = state.agentBefore;
    steps.push({
      name: 'agent_settings',
      run: () => restoreAgentSettings(pool, ENTERPRISE_ID, snapshot),
      verify: () => verifyAgentSettings(pool, ENTERPRISE_ID, snapshot),
    });
  }
  let outcomes: RestorationOutcome[] = [];
  try {
    outcomes = await runRestorations(steps);
  } catch (error) {
    outcomes = [{ name: 'restoration', restored: false, error: messageOf(error), mismatches: [] }];
  }
  evidence.restoration = outcomes;
  for (const outcome of outcomes) {
    if (!outcome.restored) {
      failures.push({ name: `restore:${outcome.name}`, error: outcome.error, mismatches: outcome.mismatches });
    }
  }
  if (appPool) {
    const pool = appPool;
    appPool = null;
    await pool.end().catch((error) => failures.push({ name: 'close:app', error: messageOf(error) }));
  }
  if (fixturePool) {
    const pool = fixturePool;
    fixturePool = null;
    await pool.end().catch((error) => failures.push({ name: 'close:fixture', error: messageOf(error) }));
  }
  const restorationFailed = outcomes.some((outcome) => !outcome.restored);
  if (fatal !== null) failures.push({ name: 'fatal', error: detailOf(fatal) });
  evidence.success = fatal === null && failures.length === 0;
  evidence.finishedAt = new Date().toISOString();
  save();
  if (fatal !== null) state.exitCode = 1;
  else if (restorationFailed) state.exitCode = 1;
  else if (failures.length > 0) state.exitCode = 2;
  else state.exitCode = 0;
}

async function main(): Promise<void> {
  let fatal: unknown = null;
  try {
    await bootstrap();
    await runAcceptance();
  } catch (error) {
    fatal = error;
  } finally {
    await finalize(fatal);
  }
  const verificationFile = path.join(outputDir, 'verification.json');
  if (fatal !== null) {
    console.error(JSON.stringify({ success: false, error: messageOf(fatal), verificationFile }));
  } else {
    console.log(JSON.stringify({
      success: evidence.success,
      acceptanceId,
      periodKind: PERIOD_KIND,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      requestIds: [`${acceptanceId}-request-1`, `${acceptanceId}-request-2`],
      reports: Object.fromEntries(KINDS.map((kind) => [kind, {
        reportId: state.reports[kind]?.reportId ?? null,
        revision: state.reports[kind]?.revision ?? null,
        factsRunId: state.reports[kind]?.factsRunId ?? null,
        bodyRunId: state.reports[kind]?.bodyRunId ?? null,
        messageId: state.reports[kind]?.messageId ?? null,
        bindingId: state.reports[kind]?.bindingId ?? null,
        conversationId: state.reports[kind]?.conversationId ?? null,
        records: state.reports[kind]?.recordIds ?? [],
      }])),
      customerRecord: state.customerRecord,
      internalRecord: state.internalRecord,
      verificationFile,
      checks: checks.map((entry) => ({ name: entry.name, passed: entry.passed })),
      failures,
    }, null, 2));
  }
  if (state.exitCode !== 0) process.exitCode = state.exitCode;
}

main().catch((error) => {
  evidence.success = false;
  evidence.finishedAt = new Date().toISOString();
  failures.push({ name: 'finalize', error: detailOf(error) });
  try { save(); } catch { /* the failure is already reported below */ }
  console.error(JSON.stringify({
    success: false,
    error: messageOf(error),
    verificationFile: path.join(outputDir, 'verification.json'),
  }));
  process.exitCode = 1;
});
