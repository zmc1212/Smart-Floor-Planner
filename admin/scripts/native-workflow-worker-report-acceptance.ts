/** B5.5 acceptance driver (prepare only): one real weekly report for one worker.
 *
 * Scope: one authorized B enterprise, one synthetic project, one worker
 * receiver (`admin_users` 1454000008) and one marked internal construction
 * record with an authorized photo in the already-finished week
 * 2026-10-26 -> 2026-11-02. The period task is created by the B native
 * workflow through the existing report lifecycle; the real assistant Worker
 * endpoint claims and processes it. No model call is made by this process and
 * no new message channel, table or Worker change is introduced.
 *
 * This file is intentionally a prepared driver. It is NOT executed by the
 * implementation task; the main agent runs it later with the real B targets.
 *
 * Required environment (from admin/):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:JWT_SECRET='<development signing secret>'
 *   $env:CRON_SECRET='<development worker secret>'
 *   npx tsx scripts/native-workflow-worker-report-acceptance.ts --development
 *
 * MAIN_LIVE_DATABASE_URL is only needed when B has no enabled
 * `llm-settings-override` provider and platform LLM override yet.
 *
 * Evidence: tmp/b5-5-period-report-runs/<acceptanceId>/verification.json
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
import { parseFixedPeriod } from '@/lib/native-workflow/live/period-event';
import { addCalendarDays, resolveCliPeriod, type PeriodCliKind } from '@/lib/native-workflow/live/period-cli';
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
  evaluateFreshGeneration,
  evaluateReplay,
  evaluateReportModelEvidence,
  type PeriodCounts,
  type ReportEvidenceAttempt,
  type ReportEvidenceSnapshot,
  type ReportEvidenceStep,
  type WorkerJobState,
} from '@/lib/native-workflow/live/report-model-evidence';
import type { TriggerEvent } from '@/lib/native-workflow/types';

loadEnvConfig(process.cwd());

const ENTERPRISE_ID = '1454';
const EXECUTOR_ADMIN_ID = '1454000001';
const CUSTOMER_USER_ID = '1454000002';
const LEAD_ID = '1454000003';
const PROJECT_ID = '1454000004';
const CUSTOMER_BINDING_ID = '1';
const CUSTOMER_CONVERSATION_ID = '1454000007';
const CUSTOMER_REPORT_ID = '7';
const WORKER_ADMIN_ID = '1454000008';
const WORKER_USER_ID = '1454000008';
const WORKER_USERNAME = 'b5-5-worker-user-1454';
const PERIOD_KIND: PeriodCliKind = 'weekly';
const PERIOD_START = '2026-10-26';
const PERIOD_END = '2026-11-02';
const RECORD_TITLE = '[B5.5] 内部巡检记录';
const RECORD_TEXT = '[B5.5] 内部巡检记录：水电线管敷设已完成，底盒待固定，等待工长核对点位。';
const SCOPE = 'b5-5';
const CUSTOMER_OPENID = `b4-live-openid-${ENTERPRISE_ID}`;

/** Every acceptance failure must unwind through the shared finally block. */
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

const runStamp = new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 17);
const acceptanceId = `${SCOPE}-worker-${runStamp}`;
const outputDir = path.resolve('tmp/b5-5-period-report-runs', acceptanceId);
const storeDir = path.resolve('tmp/b5-5-acceptance-store', acceptanceId);
const runDir = path.resolve('tmp/b5-5-acceptance-runs', acceptanceId);

let appUrl = '';
let fixtureUrl = '';
let mainUrl = '';
let appPool: pg.Pool | null = null;
let fixturePool: pg.Pool | null = null;

interface InternalRecordResult {
  recordId: string;
  mediaId: string;
  version: number;
  reused: boolean;
  day: string;
}

interface AcceptanceState {
  agentBefore: AgentSettingsSnapshot | null;
  reportPlanBefore: ReportPlanSnapshot | null;
  customerAccessBefore: boolean | null;
  customerAccessChanged: boolean;
  memberActiveBefore: boolean | null;
  memberActiveChanged: boolean;
  fixtureReady: boolean;
  workerServer: http.Server | null;
  workerProcess: ChildProcess | null;
  record: InternalRecordResult | null;
  result: {
    reportId: string;
    revision: number;
    factsRunId: string;
    bodyRunId: string | null;
    messageId: string | null;
    bindingId: string;
    conversationId: string;
  };
  exitCode: number;
}

const state: AcceptanceState = {
  agentBefore: null,
  reportPlanBefore: null,
  customerAccessBefore: null,
  customerAccessChanged: false,
  memberActiveBefore: null,
  memberActiveChanged: false,
  fixtureReady: false,
  workerServer: null,
  workerProcess: null,
  record: null,
  result: {
    reportId: '',
    revision: 0,
    factsRunId: '',
    bodyRunId: null,
    messageId: null,
    bindingId: '',
    conversationId: '',
  },
  exitCode: 0,
};

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  acceptanceId,
  scope: SCOPE,
  periodKind: PERIOD_KIND,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  workerAdminId: WORKER_ADMIN_ID,
  workerUserId: WORKER_USER_ID,
  paths: { outputDir, storeDir, runDir },
  checks: [],
  failures: [],
  providerCalls: {},
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

async function customerWeekReports(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from app.construction_reports
      where enterprise_id=$1::bigint and binding_id=$2::bigint and kind='weekly'
        and period_start=$3::timestamptz`,
    [ENTERPRISE_ID, CUSTOMER_BINDING_ID, `${PERIOD_START}T00:00:00+08:00`],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Worker job states prove the real claim loop processed this run's tasks. */
async function jobStates(
  pool: pg.Pool,
  runIds: readonly string[],
): Promise<Record<string, WorkerJobState>> {
  const ids = runIds.filter((id) => /^[1-9]\d*$/u.test(id));
  if (!ids.length) return {};
  const result = await pool.query<{ run_id: string; status: string; attempts: number }>(
    `select run_id::text as run_id, status, attempts
       from app.assistant_jobs
      where enterprise_id=$1::bigint and run_id = any($2::bigint[])`,
    [ENTERPRISE_ID, ids],
  );
  return Object.fromEntries(result.rows.map((row) => [
    String(row.run_id),
    { status: String(row.status), attempts: Number(row.attempts) },
  ]));
}

function assertCalendarDate(value: string): void {
  const [year, month, day] = value.split('-').map(Number);
  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year
    || checkDate.getUTCMonth() !== month - 1
    || checkDate.getUTCDate() !== day
  ) {
    fail('--period-start must be a real calendar date');
  }
}

/**
 * Validate the CLI, both database identities, the fixed finished week and the
 * worker/customer fixture before any provider, agent, record or plan mutation.
 */
async function bootstrap(): Promise<void> {
  if (!process.argv.includes('--development')) fail('--development is required');
  if (process.env.NODE_ENV === 'production') fail('refusing to run in production');
  if (!process.env.JWT_SECRET) fail('JWT_SECRET is required so copied provider credentials can be decrypted');
  if (!process.env.CRON_SECRET) fail('CRON_SECRET is required for the real Worker endpoint');
  mainUrl = process.env.MAIN_LIVE_DATABASE_URL?.trim() ?? '';

  assertCalendarDate(PERIOD_START);
  assertCalendarDate(PERIOD_END);
  const resolved = resolveCliPeriod({ kind: PERIOD_KIND, periodStart: PERIOD_START, periodEnd: PERIOD_END });
  if (resolved.periodEnd !== PERIOD_END) fail('the fixed B5.5 week must be 2026-10-26 -> 2026-11-02');
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
    fail(`the fixed B5.5 week must already be finished in Shanghai: ${messageOf(error)}`);
  }

  const appTarget = resolveB4DatabaseTarget({ purpose: 'app' });
  const fixtureTarget = resolveB4DatabaseTarget({ purpose: 'fixture' });
  if (
    appTarget.host !== fixtureTarget.host
    || appTarget.port !== fixtureTarget.port
    || appTarget.database !== fixtureTarget.database
  ) {
    fail(
      'B4_LIVE_APP_DATABASE_URL and B4_LIVE_FIXTURE_DATABASE_URL must point at the same host/port/database '
      + `(app=${appTarget.host}:${appTarget.port}/${appTarget.database}, `
      + `fixture=${fixtureTarget.host}:${fixtureTarget.port}/${fixtureTarget.database})`,
    );
  }

  appPool = new pg.Pool({ connectionString: appTarget.url, max: 1 });
  fixturePool = new pg.Pool({ connectionString: fixtureTarget.url, max: 3 });

  const appIdentity = (await appPool.query<{ database: string; username: string }>(
    'select current_database() as database, current_user as username',
  )).rows[0];
  if (!appIdentity) fail('the app database did not return a connection identity');
  assertB4ConnectionIdentity(appTarget, {
    database: String(appIdentity.database),
    username: String(appIdentity.username),
  });

  const fixtureIdentity = (await fixturePool.query<{ database: string; username: string }>(
    'select current_database() as database, current_user as username',
  )).rows[0];
  if (!fixtureIdentity) fail('the fixture database did not return a connection identity');
  assertB4ConnectionIdentity(fixtureTarget, {
    database: String(fixtureIdentity.database),
    username: String(fixtureIdentity.username),
  });

  appUrl = appTarget.url;
  fixtureUrl = fixtureTarget.url;
  process.env.DATABASE_URL = appUrl;
  process.env.NATIVE_WORKFLOW_STORE_DIR = storeDir;
  process.env.NATIVE_WORKFLOW_RUN_DIR = runDir;
  evidence.databaseTargets = {
    app: describeB4DatabaseTarget(appTarget),
    fixture: describeB4DatabaseTarget(fixtureTarget),
    host: appTarget.host,
    port: appTarget.port,
    database: appTarget.database,
  };
}

async function preflight(pool: pg.Pool): Promise<void> {
  const enterprise = await pool.query('select code, name, status from app.enterprises where id=$1::bigint', [ENTERPRISE_ID]);
  const enterpriseRow = enterprise.rows[0];
  if (!enterpriseRow
    || enterpriseRow.code !== `B4-LIVE-${ENTERPRISE_ID}`
    || !String(enterpriseRow.name).startsWith('[B4]')
    || enterpriseRow.status !== 'active') {
    fail('fixture enterprise ownership mismatch; run the B4 fixture first');
  }

  const project = await pool.query(
    'select name, status, customer_access, version from app.construction_projects where id=$1::bigint and enterprise_id=$2::bigint',
    [PROJECT_ID, ENTERPRISE_ID],
  );
  const projectRow = project.rows[0];
  if (!projectRow || !String(projectRow.name).startsWith('[B4]') || projectRow.status !== 'active') {
    fail('fixture project is not the active labelled project');
  }
  if (projectRow.customer_access !== true) fail('fixture project must start with customer_access=true');
  state.customerAccessBefore = Boolean(projectRow.customer_access);

  const worker = await pool.query(
    `select id::text, username, role, status, must_change_password, user_id::text
       from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
    [WORKER_ADMIN_ID, ENTERPRISE_ID],
  );
  const workerRow = worker.rows[0];
  if (!workerRow
    || workerRow.username !== `b4-live-worker-${ENTERPRISE_ID}`
    || workerRow.role !== 'construction_staff'
    || workerRow.status !== 'active'
    || workerRow.must_change_password !== false) {
    fail('fixture worker admin is not the active construction_staff account; run the B5.5 worker fixture first');
  }
  if (workerRow.user_id !== WORKER_USER_ID) {
    fail(`fixture worker admin must be linked to base user ${WORKER_USER_ID}; run the B5.5 worker fixture first`);
  }

  const workerUser = await pool.query(
    'select username, role, nickname, phone, context_version from app.users where id=$1::bigint',
    [WORKER_USER_ID],
  );
  const workerUserRow = workerUser.rows[0];
  if (!workerUserRow
    || workerUserRow.username !== WORKER_USERNAME
    || workerUserRow.role !== 'user'
    || Number(workerUserRow.context_version) !== 1) {
    fail('fixture worker base user mismatch; run the B5.5 worker fixture first');
  }

  const member = await pool.query(
    `select role, active from app.construction_members
      where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
    [ENTERPRISE_ID, PROJECT_ID, WORKER_ADMIN_ID],
  );
  const memberRow = member.rows[0];
  if (!memberRow || memberRow.active !== true || memberRow.role !== 'worker') {
    fail('fixture worker membership must be active with role worker');
  }
  state.memberActiveBefore = Boolean(memberRow.active);

  const customer = await pool.query('select username, role from app.users where id=$1::bigint', [CUSTOMER_USER_ID]);
  const customerRow = customer.rows[0];
  if (!customerRow || !String(customerRow.username).startsWith('b4-live-customer-')) {
    fail('fixture customer ownership mismatch');
  }
  const identity = await pool.query('select openid from app.wechat_identities where user_id=$1::bigint', [CUSTOMER_USER_ID]);
  if (identity.rows[0]?.openid !== CUSTOMER_OPENID) fail('fixture WeChat identity mismatch');

  const binding = await pool.query(
    `select id::text, principal_key, audience, user_id::text, project_id::text, scope_key,
            conversation_id::text, status
       from app.construction_followup_bindings
      where enterprise_id=$1::bigint and id=$2::bigint`,
    [ENTERPRISE_ID, CUSTOMER_BINDING_ID],
  );
  const bindingRow = binding.rows[0];
  if (!bindingRow
    || bindingRow.audience !== 'customer'
    || bindingRow.user_id !== CUSTOMER_USER_ID
    || bindingRow.project_id !== PROJECT_ID
    || bindingRow.principal_key !== `user:${CUSTOMER_USER_ID}`
    || bindingRow.conversation_id !== CUSTOMER_CONVERSATION_ID
    || bindingRow.status !== 'enabled') {
    fail('fixture customer binding 1 is not the enabled project customer binding on conversation 1454000007');
  }

  const conversation = await pool.query(
    'select purpose, status from app.assistant_conversations where id=$1::bigint and enterprise_id=$2::bigint',
    [CUSTOMER_CONVERSATION_ID, ENTERPRISE_ID],
  );
  if (!conversation.rows[0] || conversation.rows[0].purpose !== 'construction_followup') {
    fail('fixture customer conversation 1454000007 is not a construction followup conversation');
  }

  const customerReport = await pool.query(
    'select id::text, kind, latest_revision from app.construction_reports where enterprise_id=$1::bigint and id=$2::bigint and binding_id=$3::bigint',
    [ENTERPRISE_ID, CUSTOMER_REPORT_ID, CUSTOMER_BINDING_ID],
  );
  if (!customerReport.rows[0] || customerReport.rows[0].kind !== 'weekly') {
    fail('the existing customer weekly report 7 was not found on customer binding 1');
  }
  evidence.customerReport = customerReport.rows[0];

  evidence.fixture = {
    enterprise: enterpriseRow,
    project: projectRow,
    workerAdmin: workerRow,
    workerUser: workerUserRow,
    workerMember: memberRow,
    customerBinding: bindingRow,
    customerReport: customerReport.rows[0],
  };
}

async function ensureProvider(owner: pg.Pool): Promise<Record<string, unknown>> {
  // A B tenant that already has an enabled development provider does not need
  // the main database at all; only a missing/incomplete B setup copies from MAIN.
  const current = (await owner.query(
    "select id,key,enabled,adapter_type,base_url,api_key_masked from app.ai_provider_configs where key='llm-settings-override'",
  )).rows[0];
  const currentPlatform = (await owner.query(
    "select llm_config from app.platform_configs where key='default'",
  )).rows[0]?.llm_config;
  if (current?.enabled === true && currentPlatform?.enabled) {
    return {
      copied: false,
      platformCopied: false,
      reused: true,
      provider: {
        key: current.key,
        adapter_type: current.adapter_type,
        base_url: current.base_url,
        api_key_masked: current.api_key_masked,
      },
      platform: {
        enabled: currentPlatform.enabled,
        providerKey: currentPlatform.providerKey,
        model: currentPlatform.model,
        apiKeyMasked: currentPlatform.apiKeyMasked,
      },
    };
  }

  const sourceUrl = mainUrl;
  if (!sourceUrl) {
    fail('MAIN_LIVE_DATABASE_URL is required because B has no enabled llm-settings-override provider/platform override');
  }
  const source = new pg.Pool({ connectionString: sourceUrl, max: 1 });
  try {
    const row = (await source.query(
      `select key,name,adapter_type,base_url,api_key_encrypted,api_key_masked,credentials_encrypted,credentials_masked,
        adapter_config,capabilities,model_mappings,priority,timeout_ms,enabled,cost_rules,operational_state
       from app.ai_provider_configs where key='llm-settings-override'`,
    )).rows[0];
    if (!row) fail('the development chat provider was not found in MAIN_LIVE_DATABASE_URL');
    const platform = (await source.query(
      "select llm_config from app.platform_configs where key='default'",
    )).rows[0]?.llm_config;
    if (!platform?.enabled) fail('the development platform LLM override is not enabled');

    if (!current) {
      await owner.query(
        `insert into app.ai_provider_configs(key,name,adapter_type,base_url,api_key_encrypted,api_key_masked,
           credentials_encrypted,credentials_masked,adapter_config,capabilities,model_mappings,priority,timeout_ms,enabled,cost_rules,operational_state)
         values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16::jsonb)`,
        [row.key, row.name, row.adapter_type, row.base_url, row.api_key_encrypted, row.api_key_masked,
          JSON.stringify(row.credentials_encrypted), JSON.stringify(row.credentials_masked), JSON.stringify(row.adapter_config),
          row.capabilities, JSON.stringify(row.model_mappings), row.priority, row.timeout_ms, row.enabled,
          JSON.stringify(row.cost_rules), JSON.stringify(row.operational_state)],
      );
    } else if (current.enabled !== true) {
      fail('the B provider llm-settings-override exists but is disabled; remove or enable it before re-running');
    }
    if (!currentPlatform?.enabled) {
      await owner.query(
        `insert into app.platform_configs(key,llm_config) values('default',$1::jsonb)
         on conflict(key) do update set llm_config=excluded.llm_config, updated_at=now()`,
        [JSON.stringify(platform)],
      );
    }
    return {
      copied: !current,
      platformCopied: !currentPlatform?.enabled,
      reused: false,
      provider: { key: row.key, adapter_type: row.adapter_type, base_url: row.base_url, api_key_masked: row.api_key_masked },
      platform: { enabled: platform.enabled, providerKey: platform.providerKey, model: platform.model, apiKeyMasked: platform.apiKeyMasked },
    };
  } finally {
    await source.end().catch(() => undefined);
  }
}

async function ensureAgentConfig(owner: pg.Pool): Promise<Record<string, unknown>> {
  const current = (await owner.query<Record<string, unknown>>(
    'select agent_config, enabled from app.assistant_enterprise_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  if (!current) fail('the assistant enterprise settings row is missing; create the B4 fixture first');
  const config = {
    runtime: 'langgraph-v1',
    providerKey: 'dashscope',
    model: 'qwen3.7-flash',
    imageInput: false,
    tools: true,
    probeVersion: `${SCOPE}-worker-acceptance`,
  };
  // Snapshot before the update so a later failure still restores the original
  // agent_config (null stays null) and enabled flag (false stays false).
  state.agentBefore = agentSettingsSnapshot(current);
  await owner.query(
    `update app.assistant_enterprise_settings set agent_config=$1::jsonb, enabled=true, updated_at=now()
      where enterprise_id=$2::bigint`,
    [JSON.stringify(config), ENTERPRISE_ID],
  );
  return { before: state.agentBefore, during: config };
}

/** The worker receiver is bound by the existing enterprise-scoped staff rule. */
async function ensureWorkerBinding(): Promise<Record<string, unknown>> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { ensureFollowupBinding } = await import('@/lib/construction/report-store');
  const binding = await withTenantTransaction(ENTERPRISE_ID, (tx) => ensureFollowupBinding(tx, ENTERPRISE_ID, {
    kind: 'admin',
    id: WORKER_ADMIN_ID,
    audience: 'worker',
  }));
  if (binding.project_id !== null || binding.scope_key !== 'enterprise'
    || binding.principal_key !== `admin:${WORKER_ADMIN_ID}` || binding.audience !== 'worker') {
    fail('the worker followup binding is not the expected enterprise-scoped staff binding');
  }
  state.result.bindingId = String(binding.id);
  state.result.conversationId = String(binding.conversation_id);
  return {
    bindingId: String(binding.id),
    conversationId: String(binding.conversation_id),
    principalKey: String(binding.principal_key),
    audience: String(binding.audience),
    scopeKey: String(binding.scope_key),
    projectId: binding.project_id === null ? null : String(binding.project_id),
    status: String(binding.status),
  };
}

async function hasWorkerReportForPeriod(): Promise<boolean> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const row = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select id from app.construction_reports
      where enterprise_id=${ENTERPRISE_ID} and binding_id=${state.result.bindingId}
        and kind='weekly' and period_start=${`${PERIOD_START}T00:00:00+08:00`}::timestamptz limit 1`,
  ));
  return Boolean(row);
}

async function findPhotoMedia(recordId: string): Promise<string> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const media = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select a.media_id from app.construction_site_attachments a
      join app.construction_site_media m
        on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      where a.enterprise_id=${ENTERPRISE_ID} and a.project_id=${PROJECT_ID} and a.record_id=${recordId}
        and m.deleted_at is null order by a.position limit 1`,
  ));
  return media?.media_id ? String(media.media_id) : '';
}

/**
 * Reuse one matching published internal record, or create it with the worker:
 * upload one synthetic photo, send a quick capture (no site.record run/model),
 * let the authorized owner edit the draft, publish it to the internal audience,
 * then align its published time into the fixed week. The worker stays the
 * record author so the later member revocation invalidates this record.
 */
async function ensureInternalRecord(): Promise<InternalRecordResult> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const { SiteChatService } = await import('@/lib/construction/site-chat');
  const { default: sharp } = await import('sharp');

  const day = addCalendarDays(PERIOD_START, 2);
  const workerActor = { enterpriseId: ENTERPRISE_ID, adminId: WORKER_ADMIN_ID };
  const ownerActor = { enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID };
  const workerSite = new SiteChatService(workerActor);
  const ownerSite = new SiteChatService(ownerActor);

  const existing = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select r.id,r.version,r.published_version from app.construction_site_records r
      where r.enterprise_id=${ENTERPRISE_ID} and r.project_id=${PROJECT_ID}
        and r.author_id=${WORKER_ADMIN_ID} and r.status='published' and r.audience='internal'
        and r.data->>'title'=${RECORD_TITLE}
        and exists(select 1 from app.construction_site_attachments a
          join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
          where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id and m.deleted_at is null)
      order by r.id desc limit 1`,
  ));
  if (existing) {
    const mediaId = await findPhotoMedia(String(existing.id));
    if (mediaId) {
      return {
        recordId: String(existing.id),
        mediaId,
        version: Number(existing.published_version ?? existing.version),
        reused: true,
        day,
      };
    }
  }

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
      <rect width="640" height="480" fill="#d9d2c3"/>
      <path d="M90 0v330h470M130 0v290h430" stroke="#bf543e" stroke-width="14" fill="none"/>
      <rect y="390" width="640" height="90" fill="#ffffff"/>
      <text x="28" y="445" font-size="26" fill="#1e4c41">TEST DATA [B5.5] WORKER - NOT A REAL SITE</text>
    </svg>`,
  );
  const bytes = await sharp(svg).png().toBuffer();
  const media = await workerSite.upload(PROJECT_ID, `${SCOPE}.internal-photo.${runStamp}`, bytes);
  const mediaId = String(media.id);

  // A quick capture creates the record as a draft authored by the worker with
  // no assistant run or model call. The owner, who has manage permission, then
  // edits and publishes that captured draft to the internal audience.
  const sent = await workerSite.send(PROJECT_ID, {
    text: RECORD_TEXT,
    mediaIds: [mediaId],
    capture: { kind: 'quick', workId: 'conduit', roomId: null, location: 'whole', progress: 'done' },
  }, `${SCOPE}.internal-send.${runStamp}`);
  if (!sent.recordId) fail('the construction service did not create the internal worker record');

  const current = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select version from app.construction_site_records
      where enterprise_id=${ENTERPRISE_ID} and project_id=${PROJECT_ID} and id=${String(sent.recordId)}`,
  ));
  const edited = await ownerSite.mutate(PROJECT_ID, String(sent.recordId), 'edit', {
    expectedVersion: Number(current!.version),
    data: {
      title: RECORD_TITLE,
      roomId: null,
      completed: '水电线管敷设完成，线盒位置已标记',
      pending: '底盒未固定，等待工长核对点位',
      coordination: '本周内完成底盒固定与回路核对',
      note: '仅为 B5.5 工人周报功能验收的合成内部记录，不代表验收或正式批准',
    },
  }, `${SCOPE}.internal-edit.${runStamp}`);
  const published = await ownerSite.mutate(PROJECT_ID, String(sent.recordId), 'publish', {
    expectedVersion: Number(edited.version),
    audience: 'internal',
  }, `${SCOPE}.internal-publish.${runStamp}`);

  return {
    recordId: String(sent.recordId),
    mediaId,
    version: Number(published.version),
    reused: false,
    day,
  };
}

/** Put the internal record on its own day inside the fixed weekly window. */
async function alignInternalRecord(owner: pg.Pool, record: InternalRecordResult): Promise<Record<string, unknown>> {
  const at = `${record.day}T04:00:00.000Z`;
  const updated = await owner.query(
    `update app.construction_site_records
        set published_at=$1::timestamptz, updated_at=now()
      where enterprise_id=$2::bigint and project_id=$3::bigint and id=$4::bigint
        and status='published' and audience='internal' and author_id=$5::bigint`,
    [at, ENTERPRISE_ID, PROJECT_ID, record.recordId, WORKER_ADMIN_ID],
  );
  if (updated.rowCount !== 1) fail('the internal worker record could not be aligned into the target week');
  return { recordId: record.recordId, day: record.day, publishedAt: at };
}

async function switchReportPlan(owner: pg.Pool): Promise<Record<string, unknown>> {
  const beforeRow = (await owner.query<Record<string, unknown>>(
    'select * from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  if (!beforeRow) fail('the B4 fixture report plan is missing');
  const before = reportPlanSnapshot(beforeRow);
  // Keep the snapshot before the mutation so an exception later in the run
  // still reaches the restoration path.
  state.reportPlanBefore = before;
  const maxStageCursor = (await owner.query(
    `select coalesce(max(id),0)::text as id from app.domain_event_outbox
      where enterprise_id=$1::bigint and type='construction.stage.updated.v1'`,
    [ENTERPRISE_ID],
  )).rows[0]?.id ?? '0';
  await owner.query(
    `update app.construction_report_settings
        set enabled=true, stage_enabled=false,
            next_daily_at='2099-01-01T00:00:00Z', next_weekly_at='2099-01-01T00:00:00Z',
            stage_cursor=$1::bigint, project_ids=$2::jsonb, audiences=$3::jsonb, updated_at=now()
      where enterprise_id=$4::bigint`,
    [maxStageCursor, JSON.stringify([PROJECT_ID]), JSON.stringify(['customer', 'worker']), ENTERPRISE_ID],
  );
  const during = (await owner.query(
    'select enabled,stage_enabled,next_daily_at,next_weekly_at,stage_cursor,project_ids,audiences from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  return { before, during };
}

function runWorkflowCli(runId: string): { payload: Record<string, unknown> | null; exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/native-workflow-period-report.ts',
      '--development',
      '--ensure-published',
      '--admin-id', EXECUTOR_ADMIN_ID,
      '--project-id', PROJECT_ID,
      '--receiver-kind', 'worker',
      '--worker-id', WORKER_ADMIN_ID,
      '--period-kind', PERIOD_KIND,
      '--period-start', PERIOD_START,
      '--period-end', PERIOD_END,
      '--run-id', runId,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 180_000,
      env: {
        ...process.env,
        B4_LIVE_APP_DATABASE_URL: appUrl,
        B4_LIVE_FIXTURE_DATABASE_URL: fixtureUrl,
        NATIVE_WORKFLOW_STORE_DIR: storeDir,
        NATIVE_WORKFLOW_RUN_DIR: runDir,
      },
    },
  );
  const stdout = result.stdout ?? '';
  const start = stdout.indexOf('{');
  let payload: Record<string, unknown> | null = null;
  if (start >= 0) {
    try { payload = JSON.parse(stdout.slice(start)) as Record<string, unknown>; } catch { payload = null; }
  }
  return { payload, exitCode: result.status ?? -1, stdout, stderr: result.stderr ?? '' };
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

async function waitForDelivery(pool: pg.Pool, reportId: string, timeoutMs = 600_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const version = (await pool.query(
      `select revision,status,knowledge_status,body_run_id,facts_hash from app.construction_report_versions
        where enterprise_id=$1::bigint and report_id=$2::bigint order by revision desc limit 1`,
      [ENTERPRISE_ID, reportId],
    )).rows[0];
    const delivery = (await pool.query(
      `select revision,state,message_id,delivered_at from app.construction_report_deliveries
        where enterprise_id=$1::bigint and report_id=$2::bigint order by revision desc limit 1`,
      [ENTERPRISE_ID, reportId],
    )).rows[0];
    const runs = await pool.query(
      `select id,purpose,status,error_code,policy_snapshot->>'localWorkflow' as local_workflow
        from app.assistant_runs
        where enterprise_id=$1::bigint
          and (policy_snapshot->>'reportId'=$2 or policy_snapshot->'reportComposition'->>'reportId'=$2)
        order by id desc limit 8`,
      [ENTERPRISE_ID, reportId],
    );
    last = { version: version ?? null, delivery: delivery ?? null, runs: runs.rows };
    const bodyRun = runs.rows.find((run) => String(run.purpose) === 'construction.report.compose');
    if (delivery?.state === 'delivered' && delivery.message_id
      && version?.knowledge_status === 'ready' && bodyRun?.status === 'succeeded') {
      return last;
    }
    if (runs.rows.some((run) => ['failed', 'indeterminate'].includes(String(run.status))
      && ['construction.report.facts', 'construction.report.compose'].includes(String(run.purpose)))) {
      return { ...last, stopped: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ...last, timedOut: true };
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
  token: string,
  apiPath: string[],
  query = '',
  headers: Record<string, string> = {},
): Promise<{ status: number; bytes: Buffer; contentType: string }> {
  const { assistantHttp } = await import('@/lib/assistant/application/http');
  const request = new Request(`http://127.0.0.1:3006/api/miniprogram/assistant/${apiPath.join('/')}${query}`, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
  const response = await assistantHttp(request, apiPath);
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? '' };
}

interface ApiSession {
  token: string;
  entryToken?: string;
}

interface WorkerReportDetail {
  revision: number;
  available: boolean;
  contentStatus: unknown;
  deliveryState: unknown;
  generationState: unknown;
  records: string[];
  recordCount: number;
}

interface WorkerReportRead {
  bindingId: string;
  conversationId: string;
  audience: unknown;
  reportListCount: number;
  detail: WorkerReportDetail;
  record: { id: string; version: number; mediaIds: string[] };
  photo: { status: number; contentType: string; bytes: number; sha256: string };
}

interface WorkerDetailState {
  httpStatus: number;
  available: boolean;
  state?: unknown;
  contentStatus?: unknown;
  generationState?: unknown;
  error?: unknown;
}

interface CustomerReportState {
  httpStatus: number;
  available: boolean;
  state?: unknown;
  contentStatus?: unknown;
  error?: unknown;
}

async function workerSession(): Promise<ApiSession> {
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const contextVersion = Number((await fixture().query(
    'select context_version from app.users where id=$1::bigint',
    [WORKER_USER_ID],
  )).rows[0]?.context_version);
  if (contextVersion !== 1) fail('the worker base user context_version must be 1');
  const token = await signMiniProgramToken({
    sub: WORKER_USER_ID,
    id: WORKER_USER_ID,
    mode: 'staff',
    role: 'construction_staff',
    staffId: WORKER_ADMIN_ID,
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

/** One staff read: binding list, weekly report list, detail, record and photo. */
async function readWorkerReport(session: ApiSession): Promise<WorkerReportRead> {
  const { reportId, revision, bindingId } = state.result;
  const list = await apiRequest(session.token, ['followups']);
  assert.equal(list.status, 200, `worker followup list failed: ${JSON.stringify(list.body)}`);
  const items = ((list.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const own = items.find((item) => String(item.bindingId) === bindingId);
  assert.ok(own, 'the worker binding is missing from the staff followup list');
  assert.equal(own.audience, 'worker');

  const reports = await apiRequest(session.token, ['followups', bindingId, 'reports'], `?kind=${PERIOD_KIND}`);
  assert.equal(reports.status, 200, `worker report list failed: ${JSON.stringify(reports.body)}`);
  const reportItems = ((reports.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const listed = reportItems.find((item) => String(item.reportId) === reportId);
  assert.ok(listed, 'the saved worker weekly report is missing from the staff report list');

  const detail = await apiRequest(session.token, ['followups', bindingId, 'reports', reportId], `?revision=${revision}`);
  assert.equal(detail.status, 200, `worker report detail failed: ${JSON.stringify(detail.body)}`);
  const data = detail.body.data as Record<string, unknown>;
  assert.equal(data.available, true, 'the worker report detail must be available');
  const facts = data.facts as Record<string, unknown> | null;
  const projects = (facts?.projects ?? []) as Array<Record<string, unknown>>;
  const project = projects.find((item) => String(item.id) === PROJECT_ID);
  assert.ok(project, 'the worker report facts do not contain the synthetic project');
  const factsRecords = (project.records ?? []) as Array<Record<string, unknown>>;
  assert.ok(
    factsRecords.some((item) => String(item.id) === state.record?.recordId),
    'the worker report facts do not contain the internal worker record',
  );

  const record = await apiRequest(
    session.token,
    ['followups', bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId)],
    `?revision=${revision}`,
  );
  assert.equal(record.status, 200, `worker report record failed: ${JSON.stringify(record.body)}`);
  const recordData = record.body.data as Record<string, unknown>;
  const media = (recordData.media ?? []) as Array<Record<string, unknown>>;
  assert.ok(media.some((item) => String(item.id) === state.record?.mediaId), 'the worker record does not expose the photo');

  const image = await apiBinary(
    session.token,
    ['followups', bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId), 'media', String(state.record?.mediaId)],
    `?revision=${revision}`,
  );
  assert.equal(image.status, 200, 'the worker photo is not readable');
  assert.ok(image.bytes.byteLength > 0, 'the worker photo is empty');

  return {
    bindingId,
    conversationId: state.result.conversationId,
    audience: own.audience,
    reportListCount: reportItems.length,
    detail: {
      revision: Number(data.revision),
      available: data.available,
      contentStatus: data.contentStatus,
      deliveryState: data.deliveryState,
      generationState: data.generationState,
      records: factsRecords.map((item) => String(item.id)),
      recordCount: factsRecords.length,
    },
    record: {
      id: String(recordData.id),
      version: Number(recordData.version),
      mediaIds: media.map((item) => String(item.id)),
    },
    photo: {
      status: image.status,
      contentType: image.contentType,
      bytes: image.bytes.byteLength,
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
    },
  };
}

async function workerDetailState(session: ApiSession): Promise<WorkerDetailState> {
  const { reportId, revision, bindingId } = state.result;
  const detail = await apiRequest(session.token, ['followups', bindingId, 'reports', reportId], `?revision=${revision}`);
  if (detail.status === 404) {
    return { httpStatus: 404, available: false, state: 'source_unavailable', error: detail.body.error ?? null };
  }
  assert.equal(detail.status, 200, `worker report detail failed: ${JSON.stringify(detail.body)}`);
  const data = detail.body.data as Record<string, unknown>;
  return {
    httpStatus: detail.status,
    available: data.available === true,
    state: data.state,
    contentStatus: data.contentStatus,
    generationState: data.generationState,
  };
}

async function customerReportState(session: ApiSession): Promise<CustomerReportState> {
  const detail = await apiRequest(
    session.token,
    ['followups', CUSTOMER_BINDING_ID, 'reports', CUSTOMER_REPORT_ID],
    '',
    { headers: { 'X-Assistant-Entry': session.entryToken ?? '' } },
  );
  if (detail.status !== 200) {
    return { httpStatus: detail.status, available: false, error: detail.body.error ?? null };
  }
  const data = detail.body.data as Record<string, unknown>;
  return {
    httpStatus: detail.status,
    available: data.available === true,
    state: data.state,
    contentStatus: data.contentStatus,
  };
}

/** Read-only status observation for the exact worker run. */
async function readWorkerStatus(runId: string): Promise<Record<string, unknown>> {
  const { readPeriodReportRunStatus } = await import('@/lib/native-workflow/live/period-report-status');
  return await readPeriodReportRunStatus({
    runId,
    viewer: { enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID },
  }) as unknown as Record<string, unknown>;
}

async function runAcceptance(): Promise<void> {
  const pool = fixture();
  await preflight(pool);
  state.fixtureReady = true;

  const countsBefore = await usageSnapshot(pool);
  const customerWeekBefore = await customerWeekReports(pool);
  evidence.countsBefore = countsBefore;
  evidence.customerWeekReportsBefore = customerWeekBefore;
  check('preflight', true, {
    countsBefore,
    customerWeekReportsBefore: customerWeekBefore,
    customerReport: evidence.customerReport,
  });

  const binding = await ensureWorkerBinding();
  evidence.workerBinding = binding;
  check('enterprise-scoped worker binding ensured through the report service', true, binding);

  if (await hasWorkerReportForPeriod()) {
    fail('fresh B5.5 acceptance requires a week without an existing worker report; 2026-10-26 already has one');
  }
  check('fresh worker period has no report yet', true, { periodStart: PERIOD_START, periodEnd: PERIOD_END });

  const provider = await ensureProvider(pool);
  evidence.provider = provider;
  const agentConfig = await ensureAgentConfig(pool);
  evidence.agentConfig = agentConfig;

  const record = await ensureInternalRecord();
  state.record = record;
  const aligned = await alignInternalRecord(pool, record);
  evidence.internalRecord = { ...record, aligned };
  check('marked internal worker record with authorized photo in the target week', Boolean(
    record.mediaId && record.version > 0,
  ), { record, aligned });

  const plan = await switchReportPlan(pool);
  evidence.reportPlan = plan;
  check('single path: plan enabled for worker audience, legacy schedule parked', true, plan.during as Record<string, unknown>);

  const firstRunId = `${acceptanceId}-run-1`;
  const first = runWorkflowCli(firstRunId);
  evidence.firstRun = {
    runId: firstRunId,
    exitCode: first.exitCode,
    payload: first.payload,
    stderr: first.stderr.slice(-2000),
  };
  const firstSave = (first.payload?.saveReceipt ?? null) as Record<string, unknown> | null;
  if (!firstSave) fail(`the first worker workflow run produced no save receipt: ${first.stderr.slice(-1000)}`);
  if (firstSave.reused !== false) {
    fail('fresh acceptance requires a period without an existing worker report; choose another --period-start');
  }
  const reportId = String(firstSave.reportId);
  const revision = Number(firstSave.revision);
  const factsRunId = String(firstSave.runId);
  if (String(firstSave.bindingId) !== state.result.bindingId
    || String(firstSave.conversationId) !== state.result.conversationId) {
    fail('the worker report receipt is not bound to the worker followup destination');
  }
  state.result = {
    ...state.result,
    reportId,
    revision,
    factsRunId,
  };
  evidence.report = { reportId, revision, factsRunId, reportKey: firstSave.reportKey };
  check('B workflow created the real worker report through enqueueReport', true, evidence.report as Record<string, unknown>);

  const jobsBeforeWorker = await jobStates(pool, [factsRunId]);
  evidence.jobsBeforeWorker = jobsBeforeWorker;
  check('the facts task is queued before the real Worker starts', Boolean(
    jobsBeforeWorker[factsRunId] && jobsBeforeWorker[factsRunId].status === 'queued',
  ), { jobsBeforeWorker });

  const endpoint = await startWorkerEndpoint();
  state.workerServer = endpoint.server;
  const workerLog = path.join(outputDir, 'worker.log');
  state.workerProcess = startWorkerProcess(endpoint.port, workerLog);
  const delivery = await waitForDelivery(pool, reportId);
  evidence.deliveryWait = delivery;
  const bodyRun = (delivery.runs as Array<Record<string, unknown>> | undefined)
    ?.find((run) => String(run.purpose) === 'construction.report.compose');
  const delivered = (delivery.delivery as Record<string, unknown> | undefined)?.state === 'delivered'
    && Boolean((delivery.delivery as Record<string, unknown> | undefined)?.message_id);
  const bodyReady = (delivery.version as Record<string, unknown> | undefined)?.knowledge_status === 'ready'
    && bodyRun?.status === 'succeeded';
  check('real Worker claim, facts and delivery', delivered, {
    version: delivery.version,
    delivery: delivery.delivery,
    runs: delivery.runs,
    stopped: delivery.stopped ?? false,
    timedOut: delivery.timedOut ?? false,
  });
  check('native report body composed', bodyReady, {
    knowledgeStatus: (delivery.version as Record<string, unknown> | undefined)?.knowledge_status ?? null,
    bodyRun: bodyRun ?? null,
  });
  if (!delivered) {
    throw new Error(`the worker did not deliver the report: ${JSON.stringify(delivery).slice(0, 2000)}`);
  }

  // The real Worker is no longer needed: the remaining checks are read-only,
  // a replay and permission/config toggles.
  await stopWorker();

  const countsAfterDelivery = await usageSnapshot(pool);
  const reportRow = (await pool.query(
    `select r.id,r.report_key,r.period_start,r.period_end,r.latest_revision,r.binding_id,
      v.status,v.knowledge_status,v.body_run_id as version_body_run_id,
      v.facts_hash,v.body_generated_at,
      run.id as facts_run_id,run.status as facts_run_status,run.purpose as facts_run_purpose,
      run.conversation_id as facts_conversation_id,run.policy_snapshot as facts_policy,
      body_run.id as body_run_id,body_run.status as body_run_status,
      body_run.purpose as body_run_purpose,body_run.error_code as body_run_error
     from app.construction_reports r
     join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
     join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
     left join app.assistant_runs body_run on body_run.enterprise_id=v.enterprise_id and body_run.id=v.body_run_id
     where r.enterprise_id=$1::bigint and r.id=$2::bigint`,
    [ENTERPRISE_ID, reportId],
  )).rows[0];
  const deliveryRow = (await pool.query(
    `select d.revision,d.state,d.message_id,d.delivered_at,d.binding_id as delivery_binding_id,
      m.seq,m.purpose,m.conversation_id
       from app.construction_report_deliveries d
       left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
      where d.enterprise_id=$1::bigint and d.report_id=$2::bigint order by d.revision desc limit 1`,
    [ENTERPRISE_ID, reportId],
  )).rows[0];
  const bodyRunId = reportRow?.version_body_run_id == null ? null : String(reportRow.version_body_run_id);
  state.result.bodyRunId = bodyRunId;
  state.result.messageId = deliveryRow?.message_id == null ? null : String(deliveryRow.message_id);

  const attempts = (await pool.query(
    `select id,provider_key,adapter_type,capability,logical_model_key,remote_model,status,accepted,
      estimated_cost,actual_cost,error_code,duration_ms,created_at
       from app.ai_provider_attempts where enterprise_id=$1::bigint order by id`,
    [ENTERPRISE_ID],
  )).rows;
  const usage = (await pool.query(
    `select run_id,provider_attempt_id,category,quantity,cost_micros,measurement_kind,input_tokens,output_tokens
       from app.assistant_usage_records where enterprise_id=$1::bigint order by id`,
    [ENTERPRISE_ID],
  )).rows;
  const modelSteps = bodyRunId
    ? (await pool.query<ReportEvidenceStep>(
        `select run_id::text as run_id, step_seq, kind, status, provider_attempt_id::text as provider_attempt_id
           from app.assistant_run_steps
          where enterprise_id=$1::bigint and run_id=$2::bigint
          order by step_seq`,
        [ENTERPRISE_ID, bodyRunId],
      )).rows
    : [];
  const scopedAttempts = bodyRunId
    ? (await pool.query<ReportEvidenceAttempt>(
        `select id::text as id, assistant_run_id::text as assistant_run_id,
           provider_key, adapter_type, status, accepted
           from app.ai_provider_attempts
          where enterprise_id=$1::bigint and assistant_run_id=$2::bigint
          order by id`,
        [ENTERPRISE_ID, bodyRunId],
      )).rows
    : [];
  const scopedUsageRows = bodyRunId
    ? (await pool.query<{
        id: string;
        run_id: string;
        provider_attempt_id: string | null;
        category: string;
        measurement_kind: string;
        quantity: string | null;
        input_tokens: string | null;
        output_tokens: string | null;
      }>(
        `select id::text as id, run_id::text as run_id, provider_attempt_id::text as provider_attempt_id,
           category, measurement_kind, quantity::text as quantity,
           input_tokens::text as input_tokens, output_tokens::text as output_tokens
           from app.assistant_usage_records
          where enterprise_id=$1::bigint and run_id=$2::bigint
          order by id`,
        [ENTERPRISE_ID, bodyRunId],
      )).rows
    : [];
  const scopedUsage = scopedUsageRows.map((row) => ({
    id: String(row.id),
    run_id: String(row.run_id),
    provider_attempt_id: row.provider_attempt_id == null ? null : String(row.provider_attempt_id),
    category: String(row.category),
    measurement_kind: String(row.measurement_kind),
    quantity: row.quantity == null ? null : Number(row.quantity),
    input_tokens: row.input_tokens == null ? null : Number(row.input_tokens),
    output_tokens: row.output_tokens == null ? null : Number(row.output_tokens),
  }));
  const modelSnapshot: ReportEvidenceSnapshot = {
    report: reportRow
      ? { id: String(reportRow.id), latest_revision: Number(reportRow.latest_revision) }
      : null,
    version: reportRow
      ? {
          report_id: String(reportRow.id),
          revision: Number(reportRow.latest_revision),
          run_id: String(reportRow.facts_run_id),
          body_run_id: bodyRunId,
          status: String(reportRow.status),
          knowledge_status: String(reportRow.knowledge_status),
        }
      : null,
    factsRun: reportRow
      ? {
          id: String(reportRow.facts_run_id),
          purpose: String(reportRow.facts_run_purpose),
          status: String(reportRow.facts_run_status),
        }
      : null,
    bodyRun: reportRow && bodyRunId
      ? {
          id: bodyRunId,
          purpose: String(reportRow.body_run_purpose),
          status: String(reportRow.body_run_status),
        }
      : null,
    steps: modelSteps,
    attempts: scopedAttempts,
    usage: scopedUsage,
  };
  const modelEvidence = evaluateReportModelEvidence(
    { reportId, revision, factsRunId },
    modelSnapshot,
  );
  const jobsAfterWorker = await jobStates(pool, [factsRunId, ...(bodyRunId ? [bodyRunId] : [])]);
  const fastgptAttempts = scopedAttempts.filter((attempt) => /fastgpt/i.test(String(attempt.provider_key))
    || /fastgpt/i.test(String(attempt.adapter_type)));
  const policyScope = reportRow?.facts_policy?.scope as Record<string, unknown> | undefined;
  const policyProjectIds = Array.isArray(policyScope?.project_ids)
    ? (policyScope!.project_ids as unknown[]).map(String)
    : [];
  const succeededAttempts = scopedAttempts.filter((attempt) => attempt.status === 'succeeded' && attempt.accepted === true);
  const observedUsage = scopedUsage.filter((row) => row.category === 'tokens'
    && row.measurement_kind === 'observed' && row.input_tokens !== null && row.output_tokens !== null);
  evidence.workerOutcome = {
    countsAfterDelivery,
    report: reportRow ?? null,
    delivery: deliveryRow ?? null,
    providerAttempts: attempts,
    usage,
    scopedAttempts,
    scopedUsage,
    modelEvidence,
    jobsAfterWorker,
    fastgptAttempts,
    policyScope: policyScope ?? null,
    policyProjectIds,
    succeededAttempts,
    observedUsage,
  };
  check('the existing report lifecycle produced facts and a body for the worker', Boolean(
    reportRow?.status === 'facts_ready'
    && reportRow?.knowledge_status === 'ready'
    && reportRow?.body_run_status === 'succeeded',
  ), { report: reportRow ?? null });
  check('report, version, facts run, body run and delivery are bound to the worker receiver', Boolean(
    String(reportRow?.binding_id) === state.result.bindingId
    && String(reportRow?.facts_conversation_id) === state.result.conversationId
    && String(deliveryRow?.delivery_binding_id) === state.result.bindingId
    && String(deliveryRow?.conversation_id) === state.result.conversationId
    && String(deliveryRow?.purpose) === 'construction.report.facts',
  ), {
    report: reportRow ?? null,
    delivery: deliveryRow ?? null,
    workerBinding: state.result.bindingId,
    workerConversation: state.result.conversationId,
  });
  check('policy scope is the single synthetic project', JSON.stringify(policyProjectIds) === JSON.stringify([PROJECT_ID]), {
    policyProjectIds,
  });
  check('native model evidence is bound to this report and body run', modelEvidence.ok, {
    reasons: modelEvidence.reasons,
    binding: modelEvidence.binding,
    steps: modelSteps,
    attempts: scopedAttempts,
    usage: scopedUsage,
  });
  check('exactly one succeeded model attempt with observed usage', succeededAttempts.length === 1
    && scopedAttempts.length === 1 && observedUsage.length > 0, {
    succeededAttempts,
    scopedAttempts,
    observedUsage,
  });
  check('zero FastGPT attempts in the worker report chain', fastgptAttempts.length === 0, {
    fastgptAttempts,
  });
  const fresh = evaluateFreshGeneration({
    saveReceipt: firstSave,
    evidence: modelEvidence,
    countsBefore,
    countsAfter: countsAfterDelivery,
    worker: {
      factsJob: jobsAfterWorker[factsRunId] ?? null,
      bodyJob: bodyRunId ? jobsAfterWorker[bodyRunId] ?? null : null,
    },
  });
  evidence.freshAcceptance = fresh;
  check('fresh generation created this worker report and used this run\'s model call', fresh.ok, {
    reasons: fresh.reasons,
    binding: modelEvidence.binding,
    jobsBeforeWorker,
    jobsAfterWorker,
  });

  // A second workflow run with a new runId must reuse the real report/version/
  // facts run and observe the existing delivery receipt instead of creating a
  // second report, task or message.
  const secondRunId = `${acceptanceId}-run-2`;
  const second = runWorkflowCli(secondRunId);
  const secondSave = (second.payload?.saveReceipt ?? null) as Record<string, unknown> | null;
  const secondDelivery = (second.payload?.deliveryReceipt ?? null) as Record<string, unknown> | null;
  evidence.secondRun = {
    runId: secondRunId,
    exitCode: second.exitCode,
    payload: second.payload,
    stderr: second.stderr.slice(-2000),
  };
  check('repeat worker run reuses the same report/version/facts run', Boolean(
    second.payload?.success === true
    && secondSave?.reused === true
    && String(secondSave?.reportId) === reportId
    && Number(secondSave?.revision) === revision
    && String(secondSave?.runId) === factsRunId
    && String(secondSave?.reportKey) === String(firstSave.reportKey),
  ), { saveReceipt: secondSave });
  check('repeat worker run observes the real delivered receipt', Boolean(
    secondDelivery?.status === 'delivered'
    && String(secondDelivery?.messageId) === String(deliveryRow?.message_id)
    && String(secondDelivery?.conversationId) === String(deliveryRow?.conversation_id),
  ), { deliveryReceipt: secondDelivery });
  const countsAfterSecond = await usageSnapshot(pool);
  evidence.countsAfterSecond = countsAfterSecond;
  check('repeat run added no report, delivery, message, job or run', JSON.stringify(countsAfterSecond) === JSON.stringify(countsAfterDelivery), {
    before: countsAfterDelivery,
    after: countsAfterSecond,
  });
  const replay = evaluateReplay({
    expected: {
      reportId,
      revision,
      factsRunId,
      reportKey: String(firstSave.reportKey),
    },
    saveReceipt: secondSave,
    deliveryReceipt: secondDelivery,
    expectedDelivery: deliveryRow?.message_id == null
      ? null
      : {
          messageId: String(deliveryRow.message_id),
          conversationId: String(deliveryRow.conversation_id),
        },
    countsBefore: countsAfterDelivery,
    countsAfter: countsAfterSecond,
  });
  evidence.replayAcceptance = replay;
  check('same-period worker replay reuses the report with no new calls or rows', replay.ok, {
    reasons: replay.reasons,
    saveReceipt: secondSave,
    deliveryReceipt: secondDelivery,
    countsBefore: countsAfterDelivery,
    countsAfter: countsAfterSecond,
  });

  // The read-only status contract must observe the same worker receiver and the
  // single-project facts scope persisted by this run.
  const statusCompleted = await readWorkerStatus(firstRunId);
  evidence.statusCompleted = statusCompleted;
  check('status reader binds the worker receiver and single-project scope', Boolean(
    statusCompleted.bound === true
    && statusCompleted.binding?.receiverKind === 'worker'
    && statusCompleted.binding?.receiverAdminId === WORKER_ADMIN_ID
    && Array.isArray(statusCompleted.binding?.projectScope)
    && statusCompleted.binding.projectScope.length === 1
    && statusCompleted.binding.projectScope[0] === PROJECT_ID
    && statusCompleted.progress?.overall === 'completed'
    && statusCompleted.progress?.availability?.state === 'available',
  ), statusCompleted);

  // Staff API reads through the original Mini Program entry.
  const worker = await workerSession();
  const workerRead = await readWorkerReport(worker);
  evidence.workerRead = workerRead;
  check('staff entry opens the worker binding, report, record and photo', Boolean(
    workerRead.detail.available === true
    && (workerRead.detail.contentStatus === 'composed' || workerRead.detail.contentStatus === 'facts_only')
    && workerRead.detail.deliveryState === 'delivered'
    && workerRead.record.mediaIds.includes(String(state.record?.mediaId))
    && workerRead.photo.bytes > 0,
  ), workerRead as unknown as Record<string, unknown>);
  check('worker report body is model-composed', workerRead.detail.contentStatus === 'composed',
    workerRead.detail as unknown as Record<string, unknown>);

  const workerReentry = await readWorkerReport(await workerSession());
  evidence.workerReentry = workerReentry;
  check('worker exit and re-enter opens the same report without a duplicate', Boolean(
    workerReentry.detail.available === true
    && workerReentry.detail.revision === revision
    && workerReentry.reportListCount === workerRead.reportListCount
    && workerReentry.record.id === workerRead.record.id
    && workerReentry.photo.sha256 === workerRead.photo.sha256,
  ), { first: workerRead, reentry: workerReentry });

  // Customer isolation: the worker binding must not leak into the customer
  // list, and worker report/record ids must not be readable through the
  // customer binding. No customer report is generated by this run.
  const customer = await customerSession();
  const customerList = await apiRequest(customer.token, ['followups'], '', {
    headers: { 'X-Assistant-Entry': customer.entryToken ?? '' },
  });
  assert.equal(customerList.status, 200, `customer followup list failed: ${JSON.stringify(customerList.body)}`);
  const customerItems = ((customerList.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const customerLeak = customerItems.find((item) => String(item.bindingId) === state.result.bindingId);
  check('customer list does not include the worker binding', customerLeak === undefined, {
    customerBindingIds: customerItems.map((item) => String(item.bindingId)),
    workerBindingId: state.result.bindingId,
  });

  const customerDetail = await apiRequest(
    customer.token,
    ['followups', CUSTOMER_BINDING_ID, 'reports', reportId],
    `?revision=${revision}`,
    { headers: { 'X-Assistant-Entry': customer.entryToken ?? '' } },
  );
  const customerRecord = await apiRequest(
    customer.token,
    ['followups', CUSTOMER_BINDING_ID, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId)],
    `?revision=${revision}`,
    { headers: { 'X-Assistant-Entry': customer.entryToken ?? '' } },
  );
  check('customer cannot read the worker report or internal record', [403, 404].includes(customerDetail.status)
    && [403, 404].includes(customerRecord.status), {
    reportStatus: customerDetail.status,
    reportError: customerDetail.body.error ?? null,
    recordStatus: customerRecord.status,
    recordError: customerRecord.body.error ?? null,
  });

  // Worker detail must not depend on the customer access toggle.
  await pool.query(
    'update app.construction_projects set customer_access=false, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  );
  state.customerAccessChanged = true;
  const workerWithoutCustomerAccess = await workerDetailState(worker);
  evidence.workerWithoutCustomerAccess = workerWithoutCustomerAccess;
  check('worker report detail still reads while customer_access is false', Boolean(
    workerWithoutCustomerAccess.available === true,
  ), workerWithoutCustomerAccess as unknown as Record<string, unknown>);
  const statusWithoutCustomerAccess = await readWorkerStatus(firstRunId);
  evidence.statusWithoutCustomerAccess = statusWithoutCustomerAccess;
  check('status reader does not gate the worker on customer_access', Boolean(
    statusWithoutCustomerAccess.progress?.overall === 'completed'
    && statusWithoutCustomerAccess.progress?.availability?.state === 'available',
  ), statusWithoutCustomerAccess);
  await pool.query(
    'update app.construction_projects set customer_access=true, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  );
  const customerAccessBack = (await pool.query<{ customer_access: boolean }>(
    'select customer_access from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0];
  if (customerAccessBack?.customer_access !== true) {
    fail('customer_access restore did not take effect');
  }
  state.customerAccessChanged = false;
  check('customer_access restored after the worker read', true, {
    customerAccess: customerAccessBack.customer_access,
  });

  // Member revocation through the existing construction service. The revoke
  // audit is what keeps the saved worker report historically unavailable.
  state.memberActiveChanged = true;
  const projectVersion = Number((await pool.query<{ version: number }>(
    'select version from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0]?.version);
  const { ConstructionService } = await import('@/lib/construction/service');
  const management = new ConstructionService({ enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID });
  const revoked = await management.execute('member', {
    projectId: PROJECT_ID,
    expectedVersion: projectVersion,
    adminId: WORKER_ADMIN_ID,
    role: 'worker',
    active: false,
  }, `${SCOPE}.member-revoke.${runStamp}`);
  evidence.memberRevoke = revoked;
  const revokeAudit = (await pool.query(
    `select action, snapshot from app.construction_audits
      where enterprise_id=$1::bigint and project_id=$2::bigint and action='member'
      order by id desc limit 1`,
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0];
  check('member revocation wrote the expected audit row', Boolean(
    revokeAudit
    && String(revokeAudit.snapshot?.adminId) === WORKER_ADMIN_ID
    && revokeAudit.snapshot?.active === false,
  ), { audit: revokeAudit ?? null });

  const revokedList = await apiRequest(worker.token, ['followups']);
  const revokedItems = ((revokedList.body.data as Record<string, unknown>)?.items ?? []) as Array<Record<string, unknown>>;
  const revokedDetail = await workerDetailState(worker);
  const revokedRecord = await apiRequest(
    worker.token,
    ['followups', state.result.bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId)],
    `?revision=${revision}`,
  );
  const revokedMedia = await apiBinary(
    worker.token,
    ['followups', state.result.bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId), 'media', String(state.record?.mediaId)],
    `?revision=${revision}`,
  );
  evidence.memberRevokedReads = {
    listStatus: revokedList.status,
    bindingVisible: revokedItems.some((item) => String(item.bindingId) === state.result.bindingId),
    detail: revokedDetail,
    recordStatus: revokedRecord.status,
    mediaStatus: revokedMedia.status,
  };
  check('revoked worker list hides the binding', revokedList.status === 200
    && !revokedItems.some((item) => String(item.bindingId) === state.result.bindingId), evidence.memberRevokedReads as Record<string, unknown>);
  check('revoked worker detail, record and media are unavailable', revokedDetail.available !== true
    && revokedRecord.status === 404 && revokedMedia.status === 404, evidence.memberRevokedReads as Record<string, unknown>);
  const statusRevoked = await readWorkerStatus(firstRunId);
  evidence.statusRevoked = statusRevoked;
  check('status reader reports the revoked worker membership unavailable', Boolean(
    statusRevoked.progress?.overall === 'unavailable'
    && statusRevoked.progress?.availability?.state !== 'available',
  ), statusRevoked);

  // Restore the member through the same service (new audit/key), then verify
  // the historical report does not resurrect while customer report 7 stays.
  const restoreVersion = Number((await pool.query<{ version: number }>(
    'select version from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0]?.version);
  const restored = await management.execute('member', {
    projectId: PROJECT_ID,
    expectedVersion: restoreVersion,
    adminId: WORKER_ADMIN_ID,
    role: 'worker',
    active: true,
  }, `${SCOPE}.member-restore.${runStamp}`);
  state.memberActiveChanged = false;
  evidence.memberRestore = restored;
  const restoreAudit = (await pool.query(
    `select action, snapshot from app.construction_audits
      where enterprise_id=$1::bigint and project_id=$2::bigint and action='member'
      order by id desc limit 1`,
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0];
  check('member restore wrote a new audit row', Boolean(
    restoreAudit
    && String(restoreAudit.snapshot?.adminId) === WORKER_ADMIN_ID
    && restoreAudit.snapshot?.active === true,
  ), { audit: restoreAudit ?? null });

  const historical = await workerDetailState(worker);
  const customerReportAfter = await customerReportState(customer);
  const customerWeekAfter = await customerWeekReports(pool);
  evidence.historicalAfterRestore = historical;
  evidence.customerReportAfter = customerReportAfter;
  evidence.customerWeekReportsAfter = customerWeekAfter;
  check('the old worker report remains historically unavailable after member restore', historical.available !== true,
    historical as unknown as Record<string, unknown>);
  const statusHistorical = await readWorkerStatus(firstRunId);
  evidence.statusHistorical = statusHistorical;
  check('status reader keeps the historical worker report unavailable after restore', Boolean(
    statusHistorical.progress?.overall === 'unavailable'
    && statusHistorical.progress?.availability?.state !== 'available',
  ), statusHistorical);
  check('customer weekly report 7 remains available', customerReportAfter.httpStatus === 200
    && customerReportAfter.available === true, customerReportAfter as unknown as Record<string, unknown>);
  check('no customer weekly report was generated for the fixed period', customerWeekAfter === customerWeekBefore, {
    before: customerWeekBefore,
    after: customerWeekAfter,
  });

  // Replay, staff reads, revocation and permission checks must not add rows or
  // model calls. Two deliberate audits are expected from the member toggles.
  const countsAfterReads = await usageSnapshot(pool);
  evidence.countsAfterReads = countsAfterReads;
  check('replay, UI and permission checks added no rows or model calls', JSON.stringify(countsAfterReads) === JSON.stringify(countsAfterSecond), {
    before: countsAfterSecond,
    after: countsAfterReads,
  });

  state.result = {
    ...state.result,
    reportId,
    revision,
    factsRunId,
    bodyRunId,
    messageId: deliveryRow?.message_id == null ? null : String(deliveryRow.message_id),
  };
}

/**
 * Stop the Worker and restore every mutation. Restoration never short-circuits:
 * each step and each post-restore check contributes its own outcome.
 */
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
    steps.push({
      name: 'member',
      run: async () => {
        if (!state.memberActiveChanged || state.memberActiveBefore === null) return;
        const { ConstructionService } = await import('@/lib/construction/service');
        const currentVersion = Number((await pool.query<{ version: number }>(
          'select version from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
          [ENTERPRISE_ID, PROJECT_ID],
        )).rows[0]?.version);
        await new ConstructionService({ enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID })
          .execute('member', {
            projectId: PROJECT_ID,
            expectedVersion: currentVersion,
            adminId: WORKER_ADMIN_ID,
            role: 'worker',
            active: state.memberActiveBefore,
          }, `${SCOPE}.member-finalize.${runStamp}`);
        state.memberActiveChanged = false;
      },
      verify: async () => {
        if (state.memberActiveBefore === null) return [];
        const row = (await pool.query<{ active: boolean | null }>(
          'select active from app.construction_members where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint',
          [ENTERPRISE_ID, PROJECT_ID, WORKER_ADMIN_ID],
        )).rows[0];
        if (!row) return ['member row is missing'];
        return row.active === state.memberActiveBefore ? [] : [`active is ${String(row.active)}`];
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

  let outcomes: RestorationOutcome[];
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
    await pool.end().catch((error) => {
      failures.push({ name: 'close:app', error: messageOf(error) });
    });
  }
  if (fixturePool) {
    const pool = fixturePool;
    fixturePool = null;
    await pool.end().catch((error) => {
      failures.push({ name: 'close:fixture', error: messageOf(error) });
    });
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
    // Every mutation unwinds through this single finally block: stop the
    // Worker, restore the snapshots, verify them and decide the exit code.
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
      workerAdminId: WORKER_ADMIN_ID,
      workerUserId: WORKER_USER_ID,
      recordId: state.record?.recordId ?? null,
      mediaId: state.record?.mediaId ?? null,
      reportId: state.result.reportId,
      revision: state.result.revision,
      factsRunId: state.result.factsRunId,
      bodyRunId: state.result.bodyRunId,
      messageId: state.result.messageId,
      bindingId: state.result.bindingId,
      conversationId: state.result.conversationId,
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
