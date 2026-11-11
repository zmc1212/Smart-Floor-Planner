/** B5.6 designer acceptance driver: one real weekly report for one designer.
 *
 * Scope: one authorized B enterprise, one synthetic project, one designer
 * receiver (`admin_users` 1454000011) and one finished Shanghai week
 * 2026-11-02 -> 2026-11-09 with authorized raw construction records/photos.
 * The period task is created by the B native workflow through the existing
 * report lifecycle; the real assistant Worker endpoint claims and processes it.
 * No model call is made by this process and no new message channel, table or
 * Worker change is introduced.
 *
 * Required environment (from admin/):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:JWT_SECRET='<development signing secret>'
 *   $env:CRON_SECRET='<development worker secret>'
 *   npx tsx scripts/native-workflow-designer-report-acceptance.ts --development
 *
 * Stage boundary: add `--hold-after-positive` to stop after the positive API
 * reads. The process waits for `<outputDir>/positive-ui-done` so the positive
 * native UI/re-entry pass finishes before the real member revocation.
 *
 * MAIN_LIVE_DATABASE_URL is only needed when B has no enabled
 * `llm-settings-override` provider and platform LLM override yet.
 *
 * Evidence: tmp/b5-6-period-report-runs/<acceptanceId>/verification.json
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
import { resolveCliPeriod, type PeriodCliKind } from '@/lib/native-workflow/live/period-cli';
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
const DESIGNER_ADMIN_ID = '1454000011';
const DESIGNER_USER_ID = '1454000011';
const DESIGNER_USERNAME = 'b5-6-designer-user-1454';
const OUTSIDER_ADMIN_ID = '1454000012';
const OUTSIDER_USER_ID = '1454000012';
const OBSERVER_ADMIN_ID = '1454000009';
const WORKER_ADMIN_ID = '1454000008';
const PERIOD_KIND: PeriodCliKind = 'weekly';
const PERIOD_START = '2026-10-26';
const PERIOD_END = '2026-11-02';
const SCOPE = 'b5-6';
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
const acceptanceId = `${SCOPE}-designer-${runStamp}`;
const outputDir = path.resolve('tmp/b5-6-period-report-runs', acceptanceId);
const storeDir = path.resolve('tmp/b5-6-acceptance-store', acceptanceId);
const runDir = path.resolve('tmp/b5-6-acceptance-runs', acceptanceId);

let appUrl = '';
let fixtureUrl = '';
let mainUrl = '';
let appPool: pg.Pool | null = null;
let fixturePool: pg.Pool | null = null;
/** Explicit stage boundary: finish positive native UI before real revocation. */
const holdAfterPositive = process.argv.includes('--hold-after-positive');

interface WeekRecordResult {
  recordId: string;
  mediaId: string;
  version: number;
  publishedAt: string;
}

interface AcceptanceState {
  agentBefore: AgentSettingsSnapshot | null;
  reportPlanBefore: ReportPlanSnapshot | null;
  customerAccessBefore: boolean | null;
  customerAccessChanged: boolean;
  memberActiveBefore: boolean | null;
  memberActiveChanged: boolean;
  fixtureReady: boolean;
  designerContextVersion: number;
  workerServer: http.Server | null;
  workerProcess: ChildProcess | null;
  record: WeekRecordResult | null;
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
  designerContextVersion: 0,
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
  designerAdminId: DESIGNER_ADMIN_ID,
  designerUserId: DESIGNER_USER_ID,
  paths: { outputDir, storeDir, runDir },
  phaseOrder: [
    'positive-api-ui-reentry',
    'member-revoke',
    'negative-api-native-ui',
    'member-restore',
    'historical-unavailable',
  ],
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

async function designerWeekReports(pool: pg.Pool, bindingId: string): Promise<number> {
  if (!bindingId) return 0;
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from app.construction_reports
      where enterprise_id=$1::bigint and binding_id=$2::bigint and kind='weekly'
        and period_start=$3::timestamptz`,
    [ENTERPRISE_ID, bindingId, `${PERIOD_START}T00:00:00+08:00`],
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
 * designer/customer fixture before any provider, agent, record or plan mutation.
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
  if (resolved.periodEnd !== PERIOD_END) fail('the fixed B5.6 week must be 2026-11-02 -> 2026-11-09');
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
    fail(`the fixed B5.6 week must already be finished in Shanghai: ${messageOf(error)}`);
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

  const designer = await pool.query(
    `select id::text, username, role, status, must_change_password, user_id::text
       from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
    [DESIGNER_ADMIN_ID, ENTERPRISE_ID],
  );
  const designerRow = designer.rows[0];
  if (!designerRow
    || designerRow.username !== `b5-6-designer-${ENTERPRISE_ID}`
    || designerRow.role !== 'designer'
    || designerRow.status !== 'active'
    || designerRow.must_change_password !== false) {
    fail('fixture designer admin is not the active designer account; run the B5.6 designer fixture first');
  }
  if (designerRow.user_id !== DESIGNER_USER_ID) {
    fail(`fixture designer admin must link base user ${DESIGNER_USER_ID}; run the B5.6 designer fixture first`);
  }

  const designerUser = await pool.query(
    'select username, role, context_version from app.users where id=$1::bigint',
    [DESIGNER_USER_ID],
  );
  const designerUserRow = designerUser.rows[0];
  if (!designerUserRow || designerUserRow.username !== DESIGNER_USERNAME || designerUserRow.role !== 'user') {
    fail('fixture designer base user mismatch; run the B5.6 designer fixture first');
  }
  try {
    state.designerContextVersion = parseContextVersion(
      designerUserRow.context_version,
      'designer base user context_version',
    );
  } catch (error) {
    fail(messageOf(error));
  }

  const member = await pool.query(
    `select role, active from app.construction_members
      where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
    [ENTERPRISE_ID, PROJECT_ID, DESIGNER_ADMIN_ID],
  );
  const memberRow = member.rows[0];
  if (!memberRow || memberRow.active !== true || memberRow.role !== 'designer') {
    fail('fixture designer membership must be active with role designer');
  }
  state.memberActiveBefore = Boolean(memberRow.active);

  const outsider = await pool.query(
    `select id::text, username, role, status, user_id::text from app.admin_users
      where id=$1::bigint and enterprise_id=$2::bigint`,
    [OUTSIDER_ADMIN_ID, ENTERPRISE_ID],
  );
  const outsiderRow = outsider.rows[0];
  if (!outsiderRow
    || outsiderRow.username !== `b5-6-outsider-${ENTERPRISE_ID}`
    || outsiderRow.role !== 'designer'
    || outsiderRow.status !== 'active'
    || outsiderRow.user_id !== OUTSIDER_USER_ID) {
    fail('fixture outsider designer mismatch; run the B5.6 designer fixture first');
  }
  const outsiderMember = await pool.query(
    `select 1 from app.construction_members
      where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint and active`,
    [ENTERPRISE_ID, PROJECT_ID, OUTSIDER_ADMIN_ID],
  );
  if (outsiderMember.rows[0]) fail('the outsider designer must not be a member of the target project');

  const worker = await pool.query(
    `select id::text, username, role, status, user_id::text from app.admin_users
      where id=$1::bigint and enterprise_id=$2::bigint`,
    [WORKER_ADMIN_ID, ENTERPRISE_ID],
  );
  const workerRow = worker.rows[0];
  if (!workerRow || workerRow.role !== 'construction_staff' || workerRow.status !== 'active'
    || workerRow.user_id !== WORKER_ADMIN_ID) {
    fail('the existing worker fixture is not available for the isolation checks');
  }

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
    designerAdmin: designerRow,
    designerUser: designerUserRow,
    designerMember: memberRow,
    outsiderAdmin: outsiderRow,
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
    probeVersion: `${SCOPE}-designer-acceptance`,
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

/** The designer receiver is bound by the existing enterprise-scoped staff rule. */
async function ensureDesignerBinding(): Promise<Record<string, unknown>> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { ensureFollowupBinding } = await import('@/lib/construction/report-store');
  const binding = await withTenantTransaction(ENTERPRISE_ID, (tx) => ensureFollowupBinding(tx, ENTERPRISE_ID, {
    kind: 'admin',
    id: DESIGNER_ADMIN_ID,
    audience: 'designer',
  }));
  if (binding.project_id !== null || binding.scope_key !== 'enterprise'
    || binding.principal_key !== `admin:${DESIGNER_ADMIN_ID}` || binding.audience !== 'designer') {
    fail('the designer followup binding is not the expected enterprise-scoped staff binding');
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

async function hasDesignerReportForPeriod(): Promise<boolean> {
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

/**
 * Select one real published record with an authorized photo inside the fixed
 * week. The designer reads it through project membership, not the customer
 * link; this acceptance creates no record, photo, approval or audit row.
 */
async function selectWeekRecord(): Promise<WeekRecordResult> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const row = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select r.id,r.published_version,a.media_id,r.published_at
      from app.construction_site_records r
      join app.construction_site_attachments a
        on a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id
      join app.construction_site_media m
        on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      where r.enterprise_id=${ENTERPRISE_ID} and r.project_id=${PROJECT_ID} and r.status='published'
        and r.published_at>=${`${PERIOD_START}T00:00:00+08:00`}::timestamptz
        and r.published_at<${`${PERIOD_END}T00:00:00+08:00`}::timestamptz
        and r.author_id=${EXECUTOR_ADMIN_ID}
        and m.deleted_at is null
      order by r.published_at desc, r.id desc limit 1`,
  ));
  if (!row) fail('the fixed week needs at least one published record with an authorized photo');
  return {
    recordId: String(row.id),
    mediaId: String(row.media_id),
    version: Number(row.published_version),
    publishedAt: new Date(String(row.published_at)).toISOString(),
  };
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
    [maxStageCursor, JSON.stringify([PROJECT_ID]), JSON.stringify(['customer', 'worker', 'designer']), ENTERPRISE_ID],
  );
  const during = (await owner.query(
    'select enabled,stage_enabled,next_daily_at,next_weekly_at,stage_cursor,project_ids,audiences from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  return { before, during };
}

interface CliResult {
  payload: Record<string, unknown> | null;
  errorPayload: Record<string, unknown> | null;
  exitCode: number;
  stdout: string;
  stderr: string;
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

function runWorkflowCli(
  runId: string,
  options: {
    receiver?: 'designer' | 'worker' | 'customer';
    designerId?: string;
    adminId?: string;
    periodStart?: string;
    periodEnd?: string;
    extraArgs?: string[];
  } = {},
): CliResult {
  const receiver = options.receiver ?? 'designer';
  const args = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    'scripts/native-workflow-period-report.ts',
    '--development',
    '--ensure-published',
    '--admin-id', options.adminId ?? EXECUTOR_ADMIN_ID,
    '--project-id', PROJECT_ID,
    '--receiver-kind', receiver,
    ...(receiver === 'designer' ? ['--designer-id', options.designerId ?? DESIGNER_ADMIN_ID] : []),
    ...(receiver === 'worker' ? ['--worker-id', WORKER_ADMIN_ID] : []),
    '--period-kind', PERIOD_KIND,
    '--period-start', options.periodStart ?? PERIOD_START,
    '--period-end', options.periodEnd ?? PERIOD_END,
    '--run-id', runId,
    ...(options.extraArgs ?? []),
  ];
  const result = spawnSync(process.execPath, args, {
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
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    payload: jsonObjectAt(stdout),
    // The CLI writes structured failures to stderr.
    errorPayload: jsonObjectAt(stderr),
    exitCode: result.status ?? -1,
    stdout,
    stderr,
  };
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

interface ReportRead {
  bindingId: string;
  conversationId: string;
  audience: unknown;
  reportListCount: number;
  detail: {
    revision: number;
    available: boolean;
    contentStatus: unknown;
    deliveryState: unknown;
    generationState: unknown;
    records: string[];
    recordCount: number;
    readToken: string | null;
  };
  record: { id: string; version: number; mediaIds: string[] };
  photo: { status: number; contentType: string; bytes: number; sha256: string };
}

interface DetailState {
  httpStatus: number;
  available: boolean;
  state?: unknown;
  contentStatus?: unknown;
  generationState?: unknown;
  error?: unknown;
}

async function staffSession(
  userId: string,
  staffId: string,
  role: 'designer',
): Promise<ApiSession> {
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const contextVersion = parseContextVersion((await fixture().query(
    'select context_version from app.users where id=$1::bigint',
    [userId],
  )).rows[0]?.context_version, `${role} base user context_version`);
  if (role === 'designer' && staffId === DESIGNER_ADMIN_ID) {
    state.designerContextVersion = contextVersion;
  }
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

async function workerSession(): Promise<ApiSession> {
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const contextVersion = parseContextVersion((await fixture().query(
    'select context_version from app.users where id=$1::bigint',
    [WORKER_ADMIN_ID],
  )).rows[0]?.context_version, 'worker base user context_version');
  const token = await signMiniProgramToken({
    sub: WORKER_ADMIN_ID,
    id: WORKER_ADMIN_ID,
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
async function readDesignerReport(session: ApiSession): Promise<ReportRead> {
  const { reportId, revision, bindingId } = state.result;
  const list = await apiRequest(session.token, ['followups']);
  assert.equal(list.status, 200, `designer followup list failed: ${JSON.stringify(list.body)}`);
  const items = ((list.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const own = items.find((item) => String(item.bindingId) === bindingId);
  assert.ok(own, 'the designer binding is missing from the staff followup list');
  assert.equal(own.audience, 'designer');

  const reports = await apiRequest(session.token, ['followups', bindingId, 'reports'], `?kind=${PERIOD_KIND}`);
  assert.equal(reports.status, 200, `designer report list failed: ${JSON.stringify(reports.body)}`);
  const reportItems = ((reports.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const listed = reportItems.find((item) => String(item.reportId) === reportId);
  assert.ok(listed, 'the saved designer weekly report is missing from the staff report list');

  const detail = await apiRequest(session.token, ['followups', bindingId, 'reports', reportId], `?revision=${revision}`);
  assert.equal(detail.status, 200, `designer report detail failed: ${JSON.stringify(detail.body)}`);
  const data = detail.body.data as Record<string, unknown>;
  assert.equal(data.available, true, 'the designer report detail must be available');
  const facts = data.facts as Record<string, unknown> | null;
  const projects = (facts?.projects ?? []) as Array<Record<string, unknown>>;
  const project = projects.find((item) => String(item.id) === PROJECT_ID);
  assert.ok(project, 'the designer report facts do not contain the synthetic project');
  const factsRecords = (project.records ?? []) as Array<Record<string, unknown>>;
  assert.ok(
    factsRecords.some((item) => String(item.id) === state.record?.recordId),
    'the designer report facts do not contain the internal designer record',
  );

  const record = await apiRequest(
    session.token,
    ['followups', bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId)],
    `?revision=${revision}`,
  );
  assert.equal(record.status, 200, `designer report record failed: ${JSON.stringify(record.body)}`);
  const recordData = record.body.data as Record<string, unknown>;
  const media = (recordData.media ?? []) as Array<Record<string, unknown>>;
  assert.ok(media.some((item) => String(item.id) === state.record?.mediaId), 'the designer record does not expose the photo');

  const image = await apiBinary(
    session.token,
    ['followups', bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId), 'media', String(state.record?.mediaId)],
    `?revision=${revision}`,
  );
  assert.equal(image.status, 200, 'the designer photo is not readable');
  assert.ok(image.bytes.byteLength > 0, 'the designer photo is empty');

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
      readToken: typeof data.readToken === 'string' ? data.readToken : null,
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

async function acknowledgeReport(session: ApiSession): Promise<Record<string, unknown>> {
  const { reportId, revision, bindingId } = state.result;
  const detail = await apiRequest(session.token, ['followups', bindingId, 'reports', reportId], `?revision=${revision}`);
  assert.equal(detail.status, 200, `designer report detail for acknowledge failed: ${JSON.stringify(detail.body)}`);
  const data = detail.body.data as Record<string, unknown>;
  const readToken = String(data.readToken ?? '');
  assert.ok(readToken, 'the designer report detail did not return a readToken');
  const ack = await apiRequest(session.token, ['followups', bindingId, 'reports', reportId, 'acknowledge'], '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${SCOPE}-ack-${reportId}-${revision}` },
    body: JSON.stringify({ revision, readToken }),
  });
  return { status: ack.status, body: ack.body };
}

async function detailState(session: ApiSession): Promise<DetailState> {
  const { reportId, revision, bindingId } = state.result;
  const detail = await apiRequest(session.token, ['followups', bindingId, 'reports', reportId], `?revision=${revision}`);
  if (detail.status === 404) {
    return { httpStatus: 404, available: false, state: 'source_unavailable', error: detail.body.error ?? null };
  }
  assert.equal(detail.status, 200, `designer report detail failed: ${JSON.stringify(detail.body)}`);
  const data = detail.body.data as Record<string, unknown>;
  return {
    httpStatus: detail.status,
    available: data.available === true,
    state: data.state,
    contentStatus: data.contentStatus,
    generationState: data.generationState,
  };
}

async function customerReportState(session: ApiSession): Promise<Record<string, unknown>> {
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

/** Read-only status observation for the exact designer run. */
async function readDesignerStatus(runId: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { readPeriodReportRunStatus } = await import('@/lib/native-workflow/live/period-report-status');
  return await readPeriodReportRunStatus({
    runId,
    viewer: { enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN_ID },
  }) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Minimum stage boundary: positive API/native UI/re-entry finishes first; the
 * process waits for `outputDir/positive-ui-done` before the real revocation.
 */
async function holdForPositiveUi(): Promise<void> {
  const marker = path.join(outputDir, 'positive-ui-done');
  fs.rmSync(marker, { force: true });
  const checkpoint = {
    stage: 'positive-complete',
    marker,
    reportId: state.result.reportId,
    revision: state.result.revision,
    bindingId: state.result.bindingId,
    conversationId: state.result.conversationId,
    recordId: state.record?.recordId ?? null,
    mediaId: state.record?.mediaId ?? null,
    waitingFor: 'native positive UI refresh/enter/exit/re-enter',
    startedAt: new Date().toISOString(),
  };
  evidence.checkpoint = checkpoint;
  save();
  console.log(JSON.stringify({ paused: true, checkpoint }, null, 2));
  const deadline = Date.now() + 30 * 60_000;
  while (!fs.existsSync(marker)) {
    if (Date.now() > deadline) {
      fail('the positive native UI checkpoint was not released within 30 minutes');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  evidence.checkpoint = { ...checkpoint, releasedAt: new Date().toISOString() };
  save();
}

/**
 * Second stage boundary: the member is really revoked and the negative API
 * reads are recorded; native UI sees that same revoked state before the member
 * is restored. The audit rows are never deleted or rewritten.
 */
async function holdForNegativeUi(): Promise<void> {
  const marker = path.join(outputDir, 'negative-ui-done');
  fs.rmSync(marker, { force: true });
  const checkpoint = {
    stage: 'member-revoked',
    marker,
    reportId: state.result.reportId,
    revision: state.result.revision,
    bindingId: state.result.bindingId,
    conversationId: state.result.conversationId,
    recordId: state.record?.recordId ?? null,
    mediaId: state.record?.mediaId ?? null,
    waitingFor: 'native revoked-state UI refresh/enter/exit/re-enter',
    startedAt: new Date().toISOString(),
  };
  evidence.checkpointRevoked = checkpoint;
  save();
  console.log(JSON.stringify({ paused: true, checkpoint }, null, 2));
  const deadline = Date.now() + 30 * 60_000;
  while (!fs.existsSync(marker)) {
    if (Date.now() > deadline) {
      fail('the negative native UI checkpoint was not released within 30 minutes');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  evidence.checkpointRevoked = { ...checkpoint, releasedAt: new Date().toISOString() };
  save();
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

  const binding = await ensureDesignerBinding();
  evidence.designerBinding = binding;
  check('enterprise-scoped designer binding ensured through the report service', true, binding);

  if (await hasDesignerReportForPeriod()) {
    fail('fresh B5.6 acceptance requires a week without an existing designer report; 2026-10-26 already has one');
  }
  check('fresh designer period has no report yet', true, { periodStart: PERIOD_START, periodEnd: PERIOD_END });

  const provider = await ensureProvider(pool);
  evidence.provider = provider;
  const agentConfig = await ensureAgentConfig(pool);
  evidence.agentConfig = agentConfig;

  // The fixed week already contains real published records with authorized
  // photos. The designer reads them through project membership, not through
  // the customer link; this acceptance creates no source row.
  const record = await selectWeekRecord();
  state.record = record;
  evidence.weekRecord = record;
  check('authorized published record with a photo exists in the target week', Boolean(
    record.recordId && record.mediaId && record.version > 0,
  ), record as unknown as Record<string, unknown>);

  const plan = await switchReportPlan(pool);
  evidence.reportPlan = plan;
  check('single path: plan enabled for the designer audience, legacy schedule parked', true, plan.during as Record<string, unknown>);

  const firstRunId = `${acceptanceId}-run-1`;
  const first = runWorkflowCli(firstRunId);
  evidence.firstRun = {
    runId: firstRunId,
    exitCode: first.exitCode,
    payload: first.payload,
    stderr: first.stderr.slice(-2000),
  };
  const firstSave = (first.payload?.saveReceipt ?? null) as Record<string, unknown> | null;
  if (!firstSave) fail(`the first designer workflow run produced no save receipt: ${first.stderr.slice(-1000)}`);
  if (firstSave.reused !== false) {
    fail('fresh acceptance requires a period without an existing designer report; choose another --period-start');
  }
  const reportId = String(firstSave.reportId);
  const revision = Number(firstSave.revision);
  const factsRunId = String(firstSave.runId);
  if (String(firstSave.bindingId) !== state.result.bindingId
    || String(firstSave.conversationId) !== state.result.conversationId
    || firstSave.receiverKind !== 'designer'
    || String(firstSave.receiverAdminId) !== DESIGNER_ADMIN_ID) {
    fail('the designer report receipt is not bound to the designer followup destination');
  }
  state.result = {
    ...state.result,
    reportId,
    revision,
    factsRunId,
  };
  evidence.report = { reportId, revision, factsRunId, reportKey: firstSave.reportKey };
  check('B workflow created the real designer report through enqueueReport', true, evidence.report as Record<string, unknown>);

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
  evidence.designerOutcome = {
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
  check('the existing report lifecycle produced facts and a body for the designer', Boolean(
    reportRow?.status === 'facts_ready'
    && reportRow?.knowledge_status === 'ready'
    && reportRow?.body_run_status === 'succeeded',
  ), { report: reportRow ?? null });
  check('report, version, facts run, body run and delivery are bound to the designer receiver', Boolean(
    String(reportRow?.binding_id) === state.result.bindingId
    && String(reportRow?.facts_conversation_id) === state.result.conversationId
    && String(deliveryRow?.delivery_binding_id) === state.result.bindingId
    && String(deliveryRow?.conversation_id) === state.result.conversationId
    && String(deliveryRow?.purpose) === 'construction.report.facts',
  ), {
    report: reportRow ?? null,
    delivery: deliveryRow ?? null,
    designerBinding: state.result.bindingId,
    designerConversation: state.result.conversationId,
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
  check('zero FastGPT attempts in the designer report chain', fastgptAttempts.length === 0, {
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
  check('fresh generation created this designer report and used this run\'s model call', fresh.ok, {
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
  check('repeat designer run reuses the same report/version/facts run', Boolean(
    second.payload?.success === true
    && secondSave?.reused === true
    && String(secondSave?.reportId) === reportId
    && Number(secondSave?.revision) === revision
    && String(secondSave?.runId) === factsRunId
    && String(secondSave?.reportKey) === String(firstSave.reportKey),
  ), { saveReceipt: secondSave });
  check('repeat designer run observes the real delivered receipt', Boolean(
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
  check('same-period designer replay reuses the report with no new calls or rows', replay.ok, {
    reasons: replay.reasons,
    saveReceipt: secondSave,
    deliveryReceipt: secondDelivery,
    countsBefore: countsAfterDelivery,
    countsAfter: countsAfterSecond,
  });

  // The read-only status contract must observe the same designer receiver and
  // the single-project facts scope persisted by this run.
  const statusCompleted = await readDesignerStatus(firstRunId);
  evidence.statusCompleted = statusCompleted;
  check('status reader binds the designer receiver and single-project scope', Boolean(
    statusCompleted.bound === true
    && statusCompleted.binding?.receiverKind === 'designer'
    && statusCompleted.binding?.receiverAdminId === DESIGNER_ADMIN_ID
    && Array.isArray(statusCompleted.binding?.projectScope)
    && statusCompleted.binding.projectScope.length === 1
    && statusCompleted.binding.projectScope[0] === PROJECT_ID
    && statusCompleted.progress?.overall === 'completed'
    && statusCompleted.progress?.availability?.state === 'available',
  ), statusCompleted);

  // Staff API reads through the original Mini Program entry.
  const designer = await staffSession(DESIGNER_USER_ID, DESIGNER_ADMIN_ID, 'designer');
  const designerRead = await readDesignerReport(designer);
  evidence.designerRead = designerRead;
  check('designer entry opens the designer binding, report, record and photo', Boolean(
    designerRead.detail.available === true
    && (designerRead.detail.contentStatus === 'composed' || designerRead.detail.contentStatus === 'facts_only')
    && designerRead.detail.deliveryState === 'delivered'
    && designerRead.record.mediaIds.includes(String(state.record?.mediaId))
    && designerRead.photo.bytes > 0,
  ), designerRead as unknown as Record<string, unknown>);
  check('designer report body is model-composed', designerRead.detail.contentStatus === 'composed',
    designerRead.detail as unknown as Record<string, unknown>);

  const readAtBefore = (await pool.query(
    'select read_at from app.construction_report_deliveries where report_id=$1::bigint and revision=$2 and binding_id=$3::bigint',
    [reportId, revision, state.result.bindingId],
  )).rows[0]?.read_at ?? null;
  const acknowledgement = await acknowledgeReport(designer);
  evidence.acknowledgement = acknowledgement;
  const readAtAfter = (await pool.query(
    'select read_at from app.construction_report_deliveries where report_id=$1::bigint and revision=$2 and binding_id=$3::bigint',
    [reportId, revision, state.result.bindingId],
  )).rows[0]?.read_at ?? null;
  evidence.readAt = {
    before: readAtBefore ? new Date(readAtBefore).toISOString() : null,
    after: readAtAfter ? new Date(readAtAfter).toISOString() : null,
  };
  check('designer read produced a real delivery read receipt', Boolean(
    acknowledgement.status === 200
    && (acknowledgement.body as Record<string, unknown>).success === true
    && readAtAfter !== null
    && (readAtBefore === null || new Date(readAtAfter).toISOString() === new Date(readAtBefore).toISOString()),
  ), evidence.readAt as Record<string, unknown>);

  const designerReentry = await readDesignerReport(await staffSession(DESIGNER_USER_ID, DESIGNER_ADMIN_ID, 'designer'));
  evidence.designerReentry = designerReentry;
  check('designer exit and re-enter opens the same report without a duplicate', Boolean(
    designerReentry.detail.available === true
    && designerReentry.detail.revision === revision
    && designerReentry.reportListCount === designerRead.reportListCount
    && designerReentry.record.id === designerRead.record.id
    && designerReentry.photo.sha256 === designerRead.photo.sha256,
  ), { first: designerRead, reentry: designerReentry });

  // Customer and worker isolation: neither list contains the designer binding,
  // and neither role can read the designer report or its record.
  const customer = await customerSession();
  const customerList = await apiRequest(customer.token, ['followups'], '', {
    headers: { 'X-Assistant-Entry': customer.entryToken ?? '' },
  });
  assert.equal(customerList.status, 200, `customer followup list failed: ${JSON.stringify(customerList.body)}`);
  const customerItems = ((customerList.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  check('customer list does not include the designer binding',
    !customerItems.some((item) => String(item.bindingId) === state.result.bindingId), {
      customerBindingIds: customerItems.map((item) => String(item.bindingId)),
      designerBindingId: state.result.bindingId,
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
  check('customer cannot read the designer report or internal record', [403, 404].includes(customerDetail.status)
    && [403, 404].includes(customerRecord.status), {
    reportStatus: customerDetail.status,
    reportError: customerDetail.body.error ?? null,
    recordStatus: customerRecord.status,
    recordError: customerRecord.body.error ?? null,
  });

  const worker = await workerSession();
  const workerList = await apiRequest(worker.token, ['followups']);
  const workerItems = ((workerList.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
  const workerDetail = await apiRequest(
    worker.token,
    ['followups', state.result.bindingId, 'reports', reportId],
    `?revision=${revision}`,
  );
  check('worker list does not include the designer binding and cannot read the designer report', Boolean(
    !workerItems.some((item) => String(item.bindingId) === state.result.bindingId)
    && [403, 404].includes(workerDetail.status),
  ), {
    workerBindingIds: workerItems.map((item) => String(item.bindingId)),
    reportStatus: workerDetail.status,
  });

  // A cross-enterprise viewer cannot read this run's status trace.
  const { readPeriodReportRunStatus } = await import('@/lib/native-workflow/live/period-report-status');
  const crossEnterprise = await readPeriodReportRunStatus({
    runId: firstRunId,
    viewer: { enterpriseId: '1455', adminId: EXECUTOR_ADMIN_ID },
  }).then(() => ({ status: 200 })).catch((error: unknown) => ({
    status: (error as { status?: number }).status ?? null,
    code: (error as { code?: string }).code ?? null,
  }));
  evidence.crossEnterprise = crossEnterprise;
  check('cross-enterprise status read is rejected', crossEnterprise.status === 403, crossEnterprise);

  // Designer detail must not depend on the customer access toggle.
  await pool.query(
    'update app.construction_projects set customer_access=false, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  );
  state.customerAccessChanged = true;
  const designerWithoutCustomerAccess = await detailState(designer);
  evidence.designerWithoutCustomerAccess = designerWithoutCustomerAccess;
  check('designer report detail still reads while customer_access is false', Boolean(
    designerWithoutCustomerAccess.available === true,
  ), designerWithoutCustomerAccess as unknown as Record<string, unknown>);
  const statusWithoutCustomerAccess = await readDesignerStatus(firstRunId);
  evidence.statusWithoutCustomerAccess = statusWithoutCustomerAccess;
  check('status reader does not gate the designer on customer_access', Boolean(
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
  check('customer_access restored after the designer read', true, {
    customerAccess: customerAccessBack.customer_access,
  });

  // Negative receiver/executor/period/template checks must fail before any
  // business write. Counts before and after must stay identical.
  const negativeCountsBefore = await usageSnapshot(pool);
  const wrongReceiver = runWorkflowCli(`${acceptanceId}-run-wrong-receiver`, {
    receiver: 'designer',
    designerId: OUTSIDER_ADMIN_ID,
  });
  evidence.wrongReceiver = {
    exitCode: wrongReceiver.exitCode,
    payload: wrongReceiver.payload,
    stderr: wrongReceiver.stderr.slice(-1000),
  };
  check('a designer without project membership is rejected before the binding write', Boolean(
    (wrongReceiver.payload?.code ?? wrongReceiver.errorPayload?.code) === 'designer_receiver_unavailable'
    && wrongReceiver.exitCode === 1,
  ), evidence.wrongReceiver as Record<string, unknown>);

  const observerReceiver = runWorkflowCli(`${acceptanceId}-run-observer-receiver`, {
    receiver: 'designer',
    designerId: OBSERVER_ADMIN_ID,
  });
  evidence.observerReceiver = {
    exitCode: observerReceiver.exitCode,
    payload: observerReceiver.payload,
    stderr: observerReceiver.stderr.slice(-1000),
  };
  check('a non-designer account as receiver is rejected', Boolean(
    (observerReceiver.payload?.code ?? observerReceiver.errorPayload?.code) === 'designer_receiver_unavailable',
  ), evidence.observerReceiver as Record<string, unknown>);

  const invalidExecutor = runWorkflowCli(`${acceptanceId}-run-invalid-executor`, {
    adminId: OBSERVER_ADMIN_ID,
  });
  evidence.invalidExecutor = {
    exitCode: invalidExecutor.exitCode,
    payload: invalidExecutor.payload,
    stderr: invalidExecutor.stderr.slice(-1000),
  };
  check('a non-management executor is rejected before any business write', Boolean(
    invalidExecutor.exitCode === 1
    && /construction_forbidden/u.test(invalidExecutor.stderr),
  ), evidence.invalidExecutor as Record<string, unknown>);

  const unfinished = runWorkflowCli(`${acceptanceId}-run-unfinished`, {
    extraArgs: ['--period-start', '2026-11-09', '--period-end', '2026-11-16'],
  });
  evidence.unfinishedPeriod = {
    exitCode: unfinished.exitCode,
    payload: unfinished.payload,
    stderr: unfinished.stderr.slice(-1000),
  };
  check('an unfinished week is rejected before the published target', Boolean(
    (unfinished.payload?.code ?? unfinished.errorPayload?.code) === 'period_not_ended',
  ), evidence.unfinishedPeriod as Record<string, unknown>);

  const wrongTemplate = runWorkflowCli(`${acceptanceId}-run-wrong-template`, {
    extraArgs: ['--definition-id', 'period-report-daily', '--revision', '1'],
  });
  evidence.wrongTemplate = {
    exitCode: wrongTemplate.exitCode,
    payload: wrongTemplate.payload,
    stderr: wrongTemplate.stderr.slice(-1000),
  };
  check('a weekly event on the daily template is rejected before business writes', Boolean(
    (wrongTemplate.payload?.code ?? wrongTemplate.errorPayload?.code) === 'live_event_type_unsupported',
  ), evidence.wrongTemplate as Record<string, unknown>);

  const negativeCountsAfter = await usageSnapshot(pool);
  evidence.negativeCounts = { before: negativeCountsBefore, after: negativeCountsAfter, afterSecond: countsAfterSecond };
  check('negative cases added no report, task, delivery, message, run or model call',
    JSON.stringify(negativeCountsAfter) === JSON.stringify(countsAfterSecond), {
      before: countsAfterSecond,
      after: negativeCountsAfter,
    });

  // Stage boundary: the positive API/native UI pass must complete before the
  // real member revocation starts.
  if (holdAfterPositive) await holdForPositiveUi();

  // Member revocation through the existing construction service. The revoke
  // audit is what keeps the saved designer report historically unavailable.
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
    adminId: DESIGNER_ADMIN_ID,
    role: 'designer',
    active: false,
  }, `${SCOPE}.member-revoke.${runStamp}`);
  evidence.memberRevoke = revoked;
  const revokeAudit = (await pool.query(
    `select action, snapshot from app.construction_audits
      where enterprise_id=$1::bigint and project_id=$2::bigint and action='member'
      order by id desc limit 1`,
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0];
  check('designer member revocation wrote the expected audit row', Boolean(
    revokeAudit
    && String(revokeAudit.snapshot?.adminId) === DESIGNER_ADMIN_ID
    && revokeAudit.snapshot?.active === false,
  ), { audit: revokeAudit ?? null });

  const revokedList = await apiRequest(designer.token, ['followups']);
  const revokedItems = ((revokedList.body.data as Record<string, unknown>)?.items ?? []) as Array<Record<string, unknown>>;
  const revokedDetail = await detailState(designer);
  const revokedRecord = await apiRequest(
    designer.token,
    ['followups', state.result.bindingId, 'reports', reportId, 'projects', PROJECT_ID, 'records', String(state.record?.recordId)],
    `?revision=${revision}`,
  );
  const revokedMedia = await apiBinary(
    designer.token,
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
  check('revoked designer list hides the binding', revokedList.status === 200
    && !revokedItems.some((item) => String(item.bindingId) === state.result.bindingId), evidence.memberRevokedReads as Record<string, unknown>);
  check('revoked designer detail, record and media are unavailable', revokedDetail.available !== true
    && revokedRecord.status === 404 && revokedMedia.status === 404, evidence.memberRevokedReads as Record<string, unknown>);
  const statusRevoked = await readDesignerStatus(firstRunId);
  evidence.statusRevoked = statusRevoked;
  check('status reader reports the revoked designer membership unavailable', Boolean(
    statusRevoked.progress?.overall === 'unavailable'
    && statusRevoked.progress?.availability?.state !== 'available',
  ), statusRevoked);

  // Stage boundary: native UI must see this same revoked state before the
  // member is restored. The revocation audit stays exactly as written.
  if (holdAfterPositive) await holdForNegativeUi();

  // Restore the member through the same service (new audit/key), then verify
  // the historical report does not resurrect while customer report 7 stays.
  const restoreVersion = Number((await pool.query<{ version: number }>(
    'select version from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint',
    [ENTERPRISE_ID, PROJECT_ID],
  )).rows[0]?.version);
  const restored = await management.execute('member', {
    projectId: PROJECT_ID,
    expectedVersion: restoreVersion,
    adminId: DESIGNER_ADMIN_ID,
    role: 'designer',
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
  check('designer member restore wrote a new audit row', Boolean(
    restoreAudit
    && String(restoreAudit.snapshot?.adminId) === DESIGNER_ADMIN_ID
    && restoreAudit.snapshot?.active === true,
  ), { audit: restoreAudit ?? null });

  const historical = await detailState(designer);
  const customerReportAfter = await customerReportState(customer);
  const customerWeekAfter = await customerWeekReports(pool);
  const designerWeekAfter = await designerWeekReports(pool, state.result.bindingId);
  evidence.historicalAfterRestore = historical;
  evidence.customerReportAfter = customerReportAfter;
  evidence.customerWeekReportsAfter = customerWeekAfter;
  evidence.designerWeekReportsAfter = designerWeekAfter;
  check('the old designer report remains historically unavailable after member restore', historical.available !== true,
    historical as unknown as Record<string, unknown>);
  const statusHistorical = await readDesignerStatus(firstRunId);
  evidence.statusHistorical = statusHistorical;
  check('status reader keeps the historical designer report unavailable after restore', Boolean(
    statusHistorical.progress?.overall === 'unavailable'
    && statusHistorical.progress?.availability?.state !== 'available',
  ), statusHistorical);
  check('customer weekly report 7 remains available', customerReportAfter.httpStatus === 200
    && customerReportAfter.available === true, customerReportAfter as Record<string, unknown>);
  check('no customer weekly report was generated for the fixed period', customerWeekAfter === customerWeekBefore, {
    before: customerWeekBefore,
    after: customerWeekAfter,
  });
  check('exactly one designer weekly report exists for the fixed period', designerWeekAfter === 1, {
    designerWeekReports: designerWeekAfter,
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
            adminId: DESIGNER_ADMIN_ID,
            role: 'designer',
            active: state.memberActiveBefore,
          }, `${SCOPE}.member-finalize.${runStamp}`);
        state.memberActiveChanged = false;
      },
      verify: async () => {
        if (state.memberActiveBefore === null) return [];
        const row = (await pool.query<{ active: boolean | null }>(
          'select active from app.construction_members where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint',
          [ENTERPRISE_ID, PROJECT_ID, DESIGNER_ADMIN_ID],
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
      designerAdminId: DESIGNER_ADMIN_ID,
      designerUserId: DESIGNER_USER_ID,
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
