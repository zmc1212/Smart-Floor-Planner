/** B5.2 acceptance: one real daily report for one synthetic project.
 *
 * Scope: one authorized B enterprise, one synthetic project, owner (customer)
 * perspective, one fixed historical Shanghai day, raw published construction
 * records and their authorized photo, read through the original XiaoK report
 * API. The period task is created by the B native workflow, then claimed and
 * processed by the real assistant Worker endpoint (claim + Lease), not by a
 * fabricated lease. The existing report lifecycle remains the only writer of
 * report/version/run/delivery/message.
 *
 * Usage (from admin/):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:MAIN_LIVE_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:5432/smart_floor_planner'
 *   $env:JWT_SECRET='<development signing secret>'
 *   $env:CRON_SECRET='<development worker secret>'
 *   npx tsx scripts/native-workflow-period-report-acceptance.ts --development --period-start 2026-11-03
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const ENTERPRISE_ID = '1454';
const ADMIN_ID = '1454000001';
const CUSTOMER_USER_ID = '1454000002';
const LEAD_ID = '1454000003';
const PROJECT_ID = '1454000004';
const CONVERSATION_ID = '1454000005';
const CUSTOMER_OPENID = `b4-live-openid-${ENTERPRISE_ID}`;
const FIXED_LABEL = '[B5.2]';

function fail(message: string): never {
  console.error(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

if (!process.argv.includes('--development')) fail('--development is required');
if (process.env.NODE_ENV === 'production') fail('refusing to run in production');

const appUrl = process.env.B4_LIVE_APP_DATABASE_URL?.trim();
const fixtureUrl = process.env.B4_LIVE_FIXTURE_DATABASE_URL?.trim();
if (!appUrl || !fixtureUrl) fail('B4_LIVE_APP_DATABASE_URL and B4_LIVE_FIXTURE_DATABASE_URL are required');
if (!process.env.JWT_SECRET) fail('JWT_SECRET is required so copied provider credentials can be decrypted');
if (!process.env.CRON_SECRET) fail('CRON_SECRET is required for the real Worker endpoint');
process.env.DATABASE_URL = appUrl;

const periodIndex = process.argv.indexOf('--period-start');
const periodStart = periodIndex > 0 ? process.argv[periodIndex + 1] : '2026-11-03';
if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) fail('--period-start must be YYYY-MM-DD');
const runStamp = new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 17);
const acceptanceId = `b5-2-daily-${runStamp}`;
const outputDir = path.resolve('tmp/b5-2-period-report-runs', acceptanceId);
const storeDir = path.resolve('tmp/b5-2-acceptance-store', acceptanceId);
const runDir = path.resolve('tmp/b5-2-acceptance-runs', acceptanceId);
process.env.NATIVE_WORKFLOW_STORE_DIR = storeDir;
process.env.NATIVE_WORKFLOW_RUN_DIR = runDir;

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  acceptanceId,
  periodStart,
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

function ownerPool(): pg.Pool {
  return new pg.Pool({ connectionString: fixtureUrl, max: 3 });
}

async function counter(pool: pg.Pool, table: string, where = 'true'): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${table} where ${where}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function usageSnapshot(pool: pg.Pool): Promise<Record<string, unknown>> {
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

async function preflight(pool: pg.Pool): Promise<void> {
  const enterprise = await pool.query('select code, name, status from app.enterprises where id=$1::bigint', [ENTERPRISE_ID]);
  const row = enterprise.rows[0];
  if (!row || row.code !== `B4-LIVE-${ENTERPRISE_ID}` || !String(row.name).startsWith('[B4]') || row.status !== 'active') {
    fail('fixture enterprise ownership mismatch; run the B4 fixture first');
  }
  const user = await pool.query('select username from app.users where id=$1::bigint', [CUSTOMER_USER_ID]);
  if (!user.rows[0] || !String(user.rows[0].username).startsWith('b4-live-customer-')) fail('fixture customer ownership mismatch');
  const identity = await pool.query('select openid from app.wechat_identities where user_id=$1::bigint', [CUSTOMER_USER_ID]);
  if (identity.rows[0]?.openid !== CUSTOMER_OPENID) fail('fixture WeChat identity mismatch');
  const project = await pool.query(
    'select name, status, current_stage_key, customer_access from app.construction_projects where id=$1::bigint and enterprise_id=$2::bigint',
    [PROJECT_ID, ENTERPRISE_ID],
  );
  const projectRow = project.rows[0];
  if (!projectRow || !String(projectRow.name).startsWith('[B4]') || projectRow.status !== 'active' || projectRow.customer_access !== true) {
    fail('fixture project is not the active labelled customer-access project');
  }
  const conversation = await pool.query(
    "select purpose, status, mode from app.assistant_conversations where id=$1::bigint and enterprise_id=$2::bigint",
    [CONVERSATION_ID, ENTERPRISE_ID],
  );
  if (!conversation.rows[0] || conversation.rows[0].purpose !== 'customer_consultation') fail('fixture conversation mismatch');
}

async function ensureProvider(owner: pg.Pool): Promise<Record<string, unknown>> {
  const sourceUrl = process.env.MAIN_LIVE_DATABASE_URL?.trim();
  if (!sourceUrl) fail('MAIN_LIVE_DATABASE_URL is required to copy the development chat provider into B');
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

    const current = (await owner.query(
      "select id,key,enabled,adapter_type,base_url,api_key_masked from app.ai_provider_configs where key='llm-settings-override'",
    )).rows[0];
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
    }
    const currentPlatform = (await owner.query(
      "select llm_config from app.platform_configs where key='default'",
    )).rows[0]?.llm_config;
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
      provider: { key: row.key, adapter_type: row.adapter_type, base_url: row.base_url, api_key_masked: row.api_key_masked },
      platform: { enabled: platform.enabled, providerKey: platform.providerKey, model: platform.model, apiKeyMasked: platform.apiKeyMasked },
    };
  } finally {
    await source.end().catch(() => undefined);
  }
}

async function ensureAgentConfig(owner: pg.Pool): Promise<Record<string, unknown>> {
  const current = (await owner.query(
    'select agent_config from app.assistant_enterprise_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  const config = {
    runtime: 'langgraph-v1',
    providerKey: 'dashscope',
    model: 'qwen3.7-flash',
    imageInput: false,
    tools: true,
    probeVersion: 'b5-2-daily-acceptance',
  };
  await owner.query(
    `update app.assistant_enterprise_settings set agent_config=$1::jsonb, enabled=true, updated_at=now()
      where enterprise_id=$2::bigint`,
    [JSON.stringify(config), ENTERPRISE_ID],
  );
  return { before: current?.agent_config ?? null, during: config };
}

async function ensureSyntheticRecord(): Promise<Record<string, unknown>> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { one } = await import('@/db/repositories/assistant-repository');
  const { sql } = await import('drizzle-orm');
  const { SiteChatService } = await import('@/lib/construction/site-chat');
  const { default: sharp } = await import('sharp');

  const existing = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select id,version,published_version,audience,published_customer_id,status,published_at
      from app.construction_site_records
      where enterprise_id=${ENTERPRISE_ID} and project_id=${PROJECT_ID}
        and data->>'title' like ${`${FIXED_LABEL}%`}
      order by id limit 1`,
  ));
  if (existing && existing.status === 'published' && existing.audience === 'customer'
    && String(existing.published_customer_id) === CUSTOMER_USER_ID) {
    const media = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
      tx,
      sql`select a.media_id from app.construction_site_attachments a
        join app.construction_site_media m on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
        where a.enterprise_id=${ENTERPRISE_ID} and a.project_id=${PROJECT_ID} and a.record_id=${String(existing.id)}
          and m.deleted_at is null order by a.position limit 1`,
    ));
    return {
      reused: true,
      recordId: String(existing.id),
      mediaId: media?.media_id ? String(media.media_id) : '',
      version: Number(existing.published_version ?? existing.version),
    };
  }

  const actor = { enterpriseId: ENTERPRISE_ID, adminId: ADMIN_ID };
  const site = new SiteChatService(actor);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
      <rect width="640" height="480" fill="#d9d2c3"/>
      <path d="M90 0v330h470M130 0v290h430" stroke="#bf543e" stroke-width="14" fill="none"/>
      <rect y="390" width="640" height="90" fill="#ffffff"/>
      <text x="28" y="445" font-size="26" fill="#1e4c41">TEST DATA B5.2 - NOT A REAL SITE</text>
    </svg>`,
  );
  const bytes = await sharp(svg).png().toBuffer();
  const media = await site.upload(PROJECT_ID, `b5-2-media-${runStamp}`, bytes);
  const sent = await site.send(PROJECT_ID, {
    text: `${FIXED_LABEL} 水电线管敷设完成，底盒待固定，等设计师核对点位。`,
    mediaIds: [media.id],
    capture: { kind: 'quick', workId: 'conduit', roomId: null, location: 'whole', progress: 'done' },
  }, `b5-2-send-${runStamp}`);
  if (!sent.recordId) fail('the construction service did not create the synthetic record');
  const current = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
    tx,
    sql`select version,status from app.construction_site_records
      where enterprise_id=${ENTERPRISE_ID} and project_id=${PROJECT_ID} and id=${String(sent.recordId)}`,
  ));
  const edited = await site.mutate(PROJECT_ID, String(sent.recordId), 'edit', {
    expectedVersion: Number(current!.version),
    data: {
      title: `${FIXED_LABEL} 水电线管敷设`,
      roomId: null,
      completed: '线管敷设完成，线盒位置已标记',
      pending: '底盒未固定，等待设计师核对接线点位',
      coordination: '本周内完成底盒固定与回路核对',
      note: '仅为功能验收的合成记录，不代表验收或正式批准',
    },
  }, `b5-2-edit-${runStamp}`);
  const published = await site.mutate(PROJECT_ID, String(sent.recordId), 'publish', {
    expectedVersion: Number(edited.version),
    audience: 'customer',
  }, `b5-2-publish-${runStamp}`);
  return {
    reused: false,
    recordId: String(sent.recordId),
    mediaId: String(media.id),
    version: Number(published.version),
    status: published.status,
    mediaBytes: bytes.byteLength,
  };
}

async function alignRecordToPeriod(owner: pg.Pool): Promise<void> {
  const at = `${periodStart}T04:00:00.000Z`;
  await owner.query(
    `update app.construction_site_records
        set published_at=$1::timestamptz, updated_at=now()
      where enterprise_id=$2::bigint and project_id=$3::bigint
        and data->>'title' like $4
        and status='published' and audience='customer' and published_customer_id=$5::bigint`,
    [at, ENTERPRISE_ID, PROJECT_ID, `${FIXED_LABEL}%`, CUSTOMER_USER_ID],
  );
}

async function ensureFollowupBinding(): Promise<Record<string, unknown>> {
  const { withTenantTransaction } = await import('@/db/transaction');
  const { ensureFollowupBinding } = await import('@/lib/construction/report-store');
  const binding = await withTenantTransaction(ENTERPRISE_ID, (tx) => ensureFollowupBinding(tx, ENTERPRISE_ID, {
    kind: 'user',
    id: CUSTOMER_USER_ID,
    audience: 'customer',
    projectId: PROJECT_ID,
  }));
  return { bindingId: String(binding.id), conversationId: String(binding.conversation_id), status: String(binding.status) };
}

async function switchReportPlan(owner: pg.Pool): Promise<Record<string, unknown>> {
  const before = (await owner.query(
    'select * from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  if (!before) fail('the B4 fixture report plan is missing');
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
    [maxStageCursor, JSON.stringify([PROJECT_ID]), JSON.stringify(['customer']), ENTERPRISE_ID],
  );
  const during = (await owner.query(
    'select enabled,stage_enabled,next_daily_at,next_weekly_at,stage_cursor,project_ids,audiences from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  )).rows[0];
  return { before, during };
}

async function restoreReportPlan(owner: pg.Pool, before: Record<string, unknown>): Promise<void> {
  await owner.query(
    `update app.construction_report_settings
        set enabled=$1::boolean, stage_enabled=$2::boolean, next_daily_at=$3::timestamptz, next_weekly_at=$4::timestamptz,
            stage_cursor=$5::bigint, project_ids=$6::jsonb, audiences=$7::jsonb, updated_at=now()
      where enterprise_id=$8::bigint`,
    [before.enabled, before.stage_enabled, before.next_daily_at, before.next_weekly_at, String(before.stage_cursor),
      JSON.stringify(before.project_ids ?? []), JSON.stringify(before.audiences ?? []), ENTERPRISE_ID],
  );
}

function runWorkflowCli(runId: string): { payload: Record<string, unknown> | null; exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/native-workflow-period-report.ts',
      '--development',
      '--ensure-published',
      '--admin-id', ADMIN_ID,
      '--project-id', PROJECT_ID,
      '--period-start', periodStart,
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
      response.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
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

async function main(): Promise<void> {
  const pool = ownerPool();
  let reportPlanBefore: Record<string, unknown> | null = null;
  let agentConfigBefore: Record<string, unknown> | null = null;
  let workerServer: http.Server | null = null;
  let workerProcess: ChildProcess | null = null;
  let customerAccessRevoked = false;
  let mediaDeleted = false;
  let savedRecordId = '';
  let savedMediaId = '';
  let savedMediaBytes: Buffer | null = null;

  const stopWorker = async (): Promise<void> => {
    if (workerProcess && workerProcess.exitCode === null) {
      workerProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (workerProcess.exitCode === null) workerProcess.kill('SIGKILL');
    }
    workerProcess = null;
    if (workerServer) {
      const server = workerServer;
      workerServer = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

  try {
    await preflight(pool);
    const countsBefore = await usageSnapshot(pool);
    evidence.countsBefore = countsBefore;
    check('preflight', true, { countsBefore });

    const provider = await ensureProvider(pool);
    evidence.provider = provider;
    const agentConfig = await ensureAgentConfig(pool);
    agentConfigBefore = (agentConfig.before ?? null) as Record<string, unknown> | null;
    evidence.agentConfig = agentConfig;

    const record = await ensureSyntheticRecord();
    savedRecordId = String(record.recordId);
    savedMediaId = String(record.mediaId ?? '');
    evidence.syntheticRecord = record;
    await alignRecordToPeriod(pool);
    check('synthetic published record and authorized photo', true, record);

    const binding = await ensureFollowupBinding();
    evidence.binding = binding;
    check('existing followup binding created through the report service', true, binding);

    const plan = await switchReportPlan(pool);
    reportPlanBefore = plan.before as Record<string, unknown>;
    evidence.reportPlan = plan;
    check('single path: plan enabled for the Worker, legacy schedule parked', true, plan.during as Record<string, unknown>);

    const firstRunId = `${acceptanceId}-run-1`;
    const first = runWorkflowCli(firstRunId);
    evidence.firstRun = {
      runId: firstRunId,
      exitCode: first.exitCode,
      payload: first.payload,
      stderr: first.stderr.slice(-2000),
    };
    const firstSave = (first.payload?.saveReceipt ?? null) as Record<string, unknown> | null;
    if (!firstSave) fail(`the first workflow run produced no save receipt: ${first.stderr.slice(-1000)}`);
    const reportId = String(firstSave.reportId);
    const revision = Number(firstSave.revision);
    const factsRunId = String(firstSave.runId);
    evidence.report = { reportId, revision, factsRunId, reportKey: firstSave.reportKey };
    check('B workflow created the real report through enqueueReport', true, evidence.report as Record<string, unknown>);

    const endpoint = await startWorkerEndpoint();
    workerServer = endpoint.server;
    const workerLog = path.join(outputDir, 'worker.log');
    workerProcess = startWorkerProcess(endpoint.port, workerLog);
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

    // The real Worker is no longer needed: the remaining checks are read-only
    // and a second workflow replay. Stop it before any repeat/config change.
    await stopWorker();

    const countsAfterDelivery = await usageSnapshot(pool);
    const reportRow = (await pool.query(
      `select r.id,r.report_key,r.period_start,r.period_end,r.latest_revision,v.status,v.knowledge_status,v.body_run_id,
        v.facts_hash,v.body_generated_at,run.id as facts_run_id,run.status as facts_run_status,
        body_run.id as body_run_id,body_run.status as body_run_status,body_run.error_code as body_run_error
       from app.construction_reports r
       join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
       join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
       left join app.assistant_runs body_run on body_run.enterprise_id=v.enterprise_id and body_run.id=v.body_run_id
       where r.enterprise_id=$1::bigint and r.id=$2::bigint`,
      [ENTERPRISE_ID, reportId],
    )).rows[0];
    const deliveryRow = (await pool.query(
      `select d.revision,d.state,d.message_id,d.delivered_at,m.seq,m.purpose,m.conversation_id
         from app.construction_report_deliveries d
         left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
        where d.enterprise_id=$1::bigint and d.report_id=$2::bigint order by d.revision desc limit 1`,
      [ENTERPRISE_ID, reportId],
    )).rows[0];
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
    const fastgptAttempts = attempts.filter((attempt) => /fastgpt/i.test(String(attempt.provider_key))
      || /fastgpt/i.test(String(attempt.adapter_type)));
    evidence.workerOutcome = {
      countsAfterDelivery,
      report: reportRow ?? null,
      delivery: deliveryRow ?? null,
      providerAttempts: attempts,
      usage,
      fastgptAttempts,
    };
    check('the existing report lifecycle produced facts and a body', Boolean(
      reportRow?.status === 'facts_ready'
      && reportRow?.knowledge_status === 'ready'
      && reportRow?.body_run_status === 'succeeded',
    ), { report: reportRow ?? null });
    check('a native model attempt and usage were recorded', attempts.length > 0 && usage.length > 0, {
      attempts: attempts.length,
      usage: usage.length,
      providerKeys: [...new Set(attempts.map((attempt) => String(attempt.provider_key)))],
      categories: [...new Set(usage.map((record) => String(record.category)))],
      statuses: [...new Set(usage.map((record) => String(record.status)))],
    });
    check('zero FastGPT calls in the daily report chain', fastgptAttempts.length === 0, {
      fastgptAttempts,
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
    check('repeat run reuses the same report/version/facts run', Boolean(
      second.payload?.success === true
      && secondSave?.reused === true
      && String(secondSave?.reportId) === reportId
      && Number(secondSave?.revision) === revision
      && String(secondSave?.runId) === factsRunId
      && String(secondSave?.reportKey) === String(firstSave.reportKey),
    ), { saveReceipt: secondSave });
    check('repeat run observes the real delivered receipt', Boolean(
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

    // Original XiaoK report entry: the customer's own followup binding, report
    // list/detail, original record and authorized photo.
    const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
    const contextVersion = Number((await pool.query(
      'select context_version from app.users where id=$1::bigint',
      [CUSTOMER_USER_ID],
    )).rows[0]?.context_version);
    const session = async () => {
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
    };
    const readOriginal = async (current: { token: string; entryToken: string }) => {
      const entryHeaders = { 'X-Assistant-Entry': current.entryToken };
      const followups = await apiRequest(current.token, ['followups'], '', {
        headers: entryHeaders,
      });
      assert.equal(followups.status, 200, `followups failed: ${JSON.stringify(followups.body)}`);
      const items = ((followups.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
      const own = items.find((item) => String(item.bindingId) === String(binding.bindingId));
      assert.ok(own, 'the customer binding is missing from the original followup list');
      const list = await apiRequest(current.token, ['followups', String(binding.bindingId), 'reports'], '?kind=daily', {
        headers: entryHeaders,
      });
      assert.equal(list.status, 200, `report list failed: ${JSON.stringify(list.body)}`);
      const reports = ((list.body.data as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;
      const listed = reports.find((item) => String(item.reportId) === reportId);
      assert.ok(listed, 'the saved daily report is missing from the original report list');
      const detail = await apiRequest(current.token, ['followups', String(binding.bindingId), 'reports', reportId], `?revision=${revision}`, {
        headers: entryHeaders,
      });
      assert.equal(detail.status, 200, `report detail failed: ${JSON.stringify(detail.body)}`);
      const data = detail.body.data as Record<string, unknown>;
      const facts = data.facts as Record<string, unknown> | null;
      const projects = (facts?.projects ?? []) as Array<Record<string, unknown>>;
      const project = projects.find((item) => String(item.id) === PROJECT_ID);
      assert.ok(project, 'the report facts do not contain the synthetic project');
      const records = (project.records ?? []) as Array<Record<string, unknown>>;
      assert.ok(records.some((item) => String(item.id) === savedRecordId), 'the report facts do not contain the published record');
      const body = (data.body ?? []) as Array<Record<string, unknown>>;
      const record = await apiRequest(
        current.token,
        ['followups', String(binding.bindingId), 'reports', reportId, 'projects', PROJECT_ID, 'records', savedRecordId],
        `?revision=${revision}`,
        { headers: { 'X-Assistant-Entry': current.entryToken } },
      );
      assert.equal(record.status, 200, `report record failed: ${JSON.stringify(record.body)}`);
      const recordData = record.body.data as Record<string, unknown>;
      const media = (recordData.media ?? []) as Array<Record<string, unknown>>;
      assert.ok(media.some((item) => String(item.id) === savedMediaId), 'the original record does not expose the authorized photo');
      const image = await apiBinary(
        current.token,
        ['followups', String(binding.bindingId), 'reports', reportId, 'projects', PROJECT_ID, 'records', savedRecordId, 'media', savedMediaId],
        `?revision=${revision}`,
        { 'X-Assistant-Entry': current.entryToken },
      );
      assert.equal(image.status, 200, 'the authorized photo is not readable');
      assert.ok(image.bytes.byteLength > 0, 'the authorized photo is empty');
      savedMediaBytes = image.bytes;
      return {
        bindingId: String(binding.bindingId),
        conversationId: String(binding.conversationId),
        reportListCount: reports.length,
        detail: {
          available: data.available,
          contentStatus: data.contentStatus,
          deliveryState: data.deliveryState,
          generationState: data.generationState,
          bodyProjects: body.map((item) => String(item.projectId)),
          records: records.map((item) => String(item.id)),
        },
        record: {
          id: String(recordData.id),
          version: Number(recordData.version),
          room: String(recordData.room ?? ''),
          mediaIds: media.map((item) => String(item.id)),
        },
        photo: {
          status: image.status,
          contentType: image.contentType,
          bytes: image.bytes.byteLength,
          sha256: createHash('sha256').update(image.bytes).digest('hex'),
        },
      };
    };

    const readReportState = async (current: { token: string; entryToken: string }) => {
      const entryHeaders = { 'X-Assistant-Entry': current.entryToken };
      const followups = await apiRequest(current.token, ['followups'], '', {
        headers: entryHeaders,
      });
      assert.equal(followups.status, 200, `followups failed: ${JSON.stringify(followups.body)}`);
      const list = await apiRequest(current.token, ['followups', String(binding.bindingId), 'reports'], '?kind=daily', {
        headers: entryHeaders,
      });
      if (list.status === 404) {
        return {
          available: false,
          state: 'source_unavailable',
          contentStatus: 'not_generated',
          httpStatus: 404,
          error: list.body.error ?? null,
        } as Record<string, unknown>;
      }
      assert.equal(list.status, 200, `report list failed: ${JSON.stringify(list.body)}`);
      const detail = await apiRequest(current.token, ['followups', String(binding.bindingId), 'reports', reportId], `?revision=${revision}`, {
        headers: entryHeaders,
      });
      assert.equal(detail.status, 200, `report detail failed: ${JSON.stringify(detail.body)}`);
      return detail.body.data as Record<string, unknown>;
    };

    const firstSession = await session();
    const firstRead = await readOriginal(firstSession);
    evidence.originalRead = firstRead;
    check('original XiaoK entry opens the same report, record and photo', Boolean(
      firstRead.detail.available === true
      && (firstRead.detail.contentStatus === 'composed' || firstRead.detail.contentStatus === 'facts_only')
      && firstRead.detail.deliveryState === 'delivered'
      && firstRead.record.mediaIds.includes(savedMediaId)
      && firstRead.photo.bytes > 0,
    ), firstRead);
    check('report body is model-composed', firstRead.detail.contentStatus === 'composed', firstRead.detail);

    const reentrySession = await session();
    const reentry = await readOriginal(reentrySession);
    evidence.reentry = reentry;
    check('exit and re-enter opens the same report without a duplicate', Boolean(
      reentry.detail.available === true
      && reentry.detail.bodyProjects.join(',') === firstRead.detail.bodyProjects.join(',')
      && reentry.record.id === firstRead.record.id
      && reentry.photo.sha256 === firstRead.photo.sha256
      && reentry.reportListCount === firstRead.reportListCount,
    ), { first: firstRead, reentry });

    // Revoking customer access or the source photo invalidates the existing
    // report/record projection under the original rules.
    await pool.query(
      'update app.construction_projects set customer_access=false, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, PROJECT_ID],
    );
    customerAccessRevoked = true;
    const revoked = await readReportState(firstSession);
    evidence.accessRevoked = {
      available: revoked.available,
      contentStatus: revoked.contentStatus,
      state: revoked.state,
      generationState: revoked.generationState,
    };
    check('customer-access revocation invalidates the report projection', revoked.available === false
      || revoked.contentStatus !== 'composed', evidence.accessRevoked as Record<string, unknown>);
    await pool.query(
      'update app.construction_projects set customer_access=true, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, PROJECT_ID],
    );
    customerAccessRevoked = false;

    await pool.query(
      'update app.construction_site_media set data=null, deleted_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
      [ENTERPRISE_ID, savedMediaId],
    );
    mediaDeleted = true;
    const deletedImage = await apiBinary(
      firstSession.token,
      ['followups', String(binding.bindingId), 'reports', reportId, 'projects', PROJECT_ID, 'records', savedRecordId, 'media', savedMediaId],
      `?revision=${revision}`,
      { 'X-Assistant-Entry': firstSession.entryToken },
    );
    evidence.mediaRevoked = { status: deletedImage.status, bytes: deletedImage.bytes.byteLength };
    check('source photo withdrawal blocks the original media', deletedImage.status === 404, evidence.mediaRevoked as Record<string, unknown>);
    await pool.query(
      'update app.construction_site_media set data=$1, deleted_at=null where enterprise_id=$2::bigint and id=$3::bigint',
      [savedMediaBytes, ENTERPRISE_ID, savedMediaId],
    );
    mediaDeleted = false;

    const restored = await readOriginal(firstSession);
    check('restoring access and media returns the same report and photo', Boolean(
      restored.detail.available === true
      && restored.photo.sha256 === firstRead.photo.sha256,
    ), restored.detail);

    evidence.finishedAt = new Date().toISOString();
    evidence.success = failures.length === 0;
    save();
    console.log(JSON.stringify({
      success: evidence.success,
      acceptanceId,
      periodStart,
      reportId,
      revision,
      factsRunId,
      bodyRunId: reportRow?.body_run_id ?? null,
      messageId: deliveryRow?.message_id ?? null,
      bindingId: binding.bindingId,
      conversationId: binding.conversationId,
      verificationFile: path.join(outputDir, 'verification.json'),
      checks: checks.map((entry) => ({ name: entry.name, passed: entry.passed })),
      failures,
    }, null, 2));
    if (!evidence.success) process.exitCode = 2;
  } catch (error) {
    failures.push({ error: error instanceof Error ? error.stack || error.message : String(error) });
    save();
    throw error;
  } finally {
    await stopWorker().catch(() => undefined);
    if (mediaDeleted) {
      if (savedMediaBytes) {
        await pool.query('update app.construction_site_media set data=$1, deleted_at=null where enterprise_id=$2::bigint and id=$3::bigint', [savedMediaBytes, ENTERPRISE_ID, savedMediaId]).catch(() => undefined);
      } else {
        await pool.query('update app.construction_site_media set deleted_at=null where enterprise_id=$1::bigint and id=$2::bigint', [ENTERPRISE_ID, savedMediaId]).catch(() => undefined);
      }
    }
    if (customerAccessRevoked) {
      await pool.query('update app.construction_projects set customer_access=true, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint', [ENTERPRISE_ID, PROJECT_ID]).catch(() => undefined);
    }
    if (reportPlanBefore) await restoreReportPlan(pool, reportPlanBefore).catch(() => undefined);
    if (agentConfigBefore) {
      await pool.query('update app.assistant_enterprise_settings set agent_config=$1::jsonb, updated_at=now() where enterprise_id=$2::bigint', [JSON.stringify(agentConfigBefore), ENTERPRISE_ID]).catch(() => undefined);
    }
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  evidence.success = false;
  evidence.finishedAt = new Date().toISOString();
  failures.push({ error: error instanceof Error ? error.stack || error.message : String(error) });
  save();
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    verificationFile: path.join(outputDir, 'verification.json'),
  }));
  process.exitCode = 1;
});
