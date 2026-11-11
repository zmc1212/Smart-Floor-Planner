/**
 * Database-backed acceptance for the period-report status route.
 *
 * Nothing here opens a connection unless the operator opts into B4 live
 * development. When the gate is disabled every case is skipped and this file
 * neither writes DATABASE_URL nor imports the pool. When it is enabled the
 * resolved target is written to DATABASE_URL, the live connection identity is
 * proven against that target, and the shared fixture preflight must pass before
 * any business UPDATE.
 */
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { assertB4ConnectionIdentity } from '@/lib/native-workflow/live/dev-config';
import { runSharedFixturePreflight } from '@/lib/native-workflow/live/fixture-ownership';
import type { LiveOperationRecord, LiveRunRecord } from '@/lib/native-workflow/live/types';
import {
  PERIOD_REPORT_STATUS_ROUTE_FIXTURE,
  assertStatusRouteAdminOwned,
  withControlledStatusRouteAdminDisabled,
  type StatusRouteAdminRow,
  type StatusRouteAdminStore,
} from './support/period-report-status-route-fixture';
import { resolvePeriodReportStatusRouteLiveGate } from './support/period-report-status-route-live';

const gate = resolvePeriodReportStatusRouteLiveGate();
const SKIP = gate.enabled
  ? false
  : gate.reason;

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_RUN_DIR = process.env.NATIVE_WORKFLOW_RUN_DIR;

const ENTERPRISE_ID = '1454';
const PROJECT_ID = '1454000004';
const PLATFORM_ADMIN_ID = PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId;
const PLATFORM_ADMIN_ROLE = PERIOD_REPORT_STATUS_ROUTE_FIXTURE.role;
const TEST_JWT_SECRET = 'b5-3-period-report-status-route-live-secret';
const NOW = '2026-11-11T03:00:00.000Z';
const DIGEST = 'a'.repeat(64);
const BOUND_RUN_ID = 'b5-3-status-001';
const BOUND_RUN_FILE = path.resolve(
  process.cwd(),
  'tmp/b5-3-live/runs/runs/b5-3-status-001.json',
);

type StatusRouteGet = (
  request: Request,
  context: { params: Promise<{ runId: string }> },
) => Promise<Response>;

let routeGet: StatusRouteGet | null = null;
let platformTransaction:
  | typeof import('@/db/transaction')['withPlatformTransaction']
  | null = null;
let closePool: typeof import('@/lib/postgresql')['closePostgresPool'] | null = null;

if (gate.enabled) {
  const target = gate.target;

  before(async () => {
    // DATABASE_URL is written only after the gate resolved a verified target.
    process.env.DATABASE_URL = target.url;
    // The route reads JWT_SECRET at request time, so a per-run test secret is
    // enough; it is restored in after().
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    const [route, transaction, postgres] = await Promise.all([
      import('@/app/api/native-workflow/runs/[runId]/period-report-status/route'),
      import('@/db/transaction'),
      import('@/lib/postgresql'),
    ]);
    routeGet = route.GET;
    platformTransaction = transaction.withPlatformTransaction;
    closePool = postgres.closePostgresPool;

    const pool = postgres.getPostgresPool();
    const identity = await pool.query<{ database: string; username: string }>(
      'select current_database() as database, current_user as username',
    );
    // A mismatch throws before any test body can execute a business UPDATE.
    assertB4ConnectionIdentity(target, identity.rows[0]);

    // Prove the shared project/enterprise/session fixture before any write.
    // app.admin_users/users are RLS-protected, so the read runs in the same
    // platform scope the fixture store uses instead of an unscoped pool query.
    await transaction.withPlatformTransaction(async (tx) => {
      const client = (tx as unknown as {
        $client: {
          query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }).$client;
      await runSharedFixturePreflight(
        client,
        'period-report status route shared fixture',
      );
    });
  });
}

after(async () => {
  restoreEnv('DATABASE_URL', ORIGINAL_DATABASE_URL);
  restoreEnv('JWT_SECRET', ORIGINAL_JWT_SECRET);
  restoreEnv('NATIVE_WORKFLOW_RUN_DIR', ORIGINAL_RUN_DIR);
  if (closePool) await closePool();
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function signToken(claims: {
  id: string;
  role: string;
  enterpriseId: string;
}): Promise<string> {
  return new SignJWT({ ...claims, username: PERIOD_REPORT_STATUS_ROUTE_FIXTURE.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET ?? ''));
}

function platformToken(): Promise<string> {
  return signToken({
    id: PLATFORM_ADMIN_ID,
    role: PLATFORM_ADMIN_ROLE,
    enterpriseId: ENTERPRISE_ID,
  });
}

async function callStatusRoute(runId: string, token: string): Promise<Response> {
  assert.ok(routeGet, 'the status route module is not loaded');
  const request = new Request(
    `http://localhost/api/native-workflow/runs/${runId}/period-report-status`,
    { headers: { cookie: `auth_token=${token}` } },
  );
  return routeGet(request, { params: Promise.resolve({ runId }) });
}

type ApiBody = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: { bound?: boolean };
};

async function body(response: Response): Promise<ApiBody> {
  return (await response.json()) as ApiBody;
}

async function withRunDir<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const previous = process.env.NATIVE_WORKFLOW_RUN_DIR;
  process.env.NATIVE_WORKFLOW_RUN_DIR = dir;
  try {
    return await task();
  } finally {
    if (previous === undefined) delete process.env.NATIVE_WORKFLOW_RUN_DIR;
    else process.env.NATIVE_WORKFLOW_RUN_DIR = previous;
  }
}

async function makeRunDir(records: readonly LiveRunRecord[] = []): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-route-live-'));
  await mkdir(path.join(dir, 'runs'), { recursive: true });
  for (const record of records) {
    await writeRunRecord(dir, record);
  }
  return dir;
}

async function writeRunRecord(rootDir: string, record: LiveRunRecord): Promise<void> {
  await mkdir(path.join(rootDir, 'runs'), { recursive: true });
  const file = path.join(rootDir, 'runs', `${record.binding.runId}.json`);
  await writeFile(file, `${JSON.stringify({ storeVersion: 1, record }, null, 2)}\n`, 'utf8');
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function saveReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receiptId: 'report:5:1',
    simulated: false,
    source: 'construction_reports',
    reportId: '5',
    revision: 1,
    runId: '9',
    reportKey: 'report-key',
    bindingId: '1',
    conversationId: '1454000007',
    reused: false,
    ...overrides,
  };
}

type SaveVariant = 'failed' | 'no-receipt' | 'no-binding-id';

function makeRecord(options: { readonly runId: string; readonly save: SaveVariant }): LiveRunRecord {
  const base = {
    nodeId: 'save-report',
    capabilityRef: 'save.period_report',
    effect: 'save',
    nodeVersion: 'save_result@1/save.period_report',
    idempotencyKey: `save:${options.runId}`,
    startedAt: NOW,
    finishedAt: NOW,
  } as const;
  const operation: LiveOperationRecord = options.save === 'failed'
    ? { ...base, outcome: 'failed' }
    : options.save === 'no-receipt'
      ? { ...base, outcome: 'succeeded', outputs: { saved: true } }
      : {
          ...base,
          outcome: 'succeeded',
          outputs: { saved: true, saveReceipt: saveReceipt({ bindingId: '' }) },
        };
  return {
    binding: {
      runId: options.runId,
      definitionId: 'period-report-daily',
      revision: 1,
      digest: DIGEST,
      nodeVersions: { 'trigger-1': 'trigger@1/trigger.period_report' },
      event: {
        eventId: `event-${options.runId}`,
        eventType: 'period_report',
        occurredAt: NOW,
        periodKind: 'daily',
        periodStart: '2026-11-10',
        periodEnd: '2026-11-10',
      },
      businessEvent: {
        outboxEventId: null,
        progressRevision: 0,
        stageKey: '',
        settingsVersion: 1,
        source: 'current_project_revision',
        periodKind: 'daily',
        periodStart: '2026-11-10',
        periodEnd: '2026-11-10',
      },
    },
    enterpriseId: ENTERPRISE_ID,
    projectId: PROJECT_ID,
    status: 'completed',
    state: {
      runId: options.runId,
      definitionId: 'period-report-daily',
      revision: 1,
      digest: DIGEST,
      mode: 'live',
      status: 'completed',
      currentNodeId: null,
      pendingNodeId: null,
      visitedNodeIds: [],
      outputs: {},
      processedEventIds: [],
      error: null,
      outcome: 'delivered',
      stepCount: 1,
      traceSeq: 1,
    },
    trace: [],
    operations: [operation],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const UNBOUND_RUNS = [
  'run-live-unbound-save-failed',
  'run-live-unbound-no-receipt',
  'run-live-unbound-no-binding-id',
] as const;

function unboundRecords(): LiveRunRecord[] {
  return [
    makeRecord({ runId: UNBOUND_RUNS[0], save: 'failed' }),
    makeRecord({ runId: UNBOUND_RUNS[1], save: 'no-receipt' }),
    makeRecord({ runId: UNBOUND_RUNS[2], save: 'no-binding-id' }),
  ];
}

/**
 * Store over the fixture admin row. The app role cannot update app.admin_users
 * (RLS filters it to zero rows), so every read/write runs in a platform scope.
 */
function createAdminStore(): StatusRouteAdminStore {
  const run = <T>(callback: Parameters<NonNullable<typeof platformTransaction>>[0]) => {
    assert.ok(platformTransaction, 'platform transaction is not available');
    return platformTransaction(callback) as Promise<T>;
  };
  return {
    async read(): Promise<StatusRouteAdminRow | null> {
      const rows = await run<StatusRouteAdminRow[]>((tx) => tx.execute(sql`
        select id::text as id, enterprise_id::text as enterprise_id,
          username, role, display_name, status
        from app.admin_users
        where id=${PLATFORM_ADMIN_ID}::bigint
      `).then((result) => result.rows as unknown as StatusRouteAdminRow[]));
      return rows[0] ?? null;
    },
    async updateStatus(status: 'active' | 'disabled'): Promise<number> {
      const expectedCurrent = status === 'disabled' ? 'active' : 'disabled';
      const result = await run<{ rowCount: number | null }>((tx) => tx.execute(sql`
        update app.admin_users set status=${status}
        where id=${PLATFORM_ADMIN_ID}::bigint and enterprise_id=${ENTERPRISE_ID}::bigint
          and username=${PERIOD_REPORT_STATUS_ROUTE_FIXTURE.username}
          and role=${PERIOD_REPORT_STATUS_ROUTE_FIXTURE.role}
          and display_name=${PERIOD_REPORT_STATUS_ROUTE_FIXTURE.displayName}
          and status=${expectedCurrent}
      `));
      return Number(result.rowCount ?? 0);
    },
  };
}

// ---------------------------------------------------------------------------
// live cases
// ---------------------------------------------------------------------------

test(
  'live: a real bound run is returned as 200 with bound:true',
  { skip: SKIP },
  async (t) => {
    if (!(await fileExists(BOUND_RUN_FILE))) {
      t.skip(`missing fixture ${BOUND_RUN_FILE}`);
      return;
    }
    const dir = await makeRunDir();
    try {
      await copyFile(BOUND_RUN_FILE, path.join(dir, 'runs', `${BOUND_RUN_ID}.json`));
      await withRunDir(dir, async () => {
        const response = await callStatusRoute(BOUND_RUN_ID, await platformToken());
        assert.equal(response.status, 200);
        const payload = await body(response);
        assert.equal(payload.success, true);
        assert.equal(payload.data?.bound, true);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'live: unbound runs (failed save, missing receipt, missing binding id) are 200 with bound:false',
  { skip: SKIP },
  async () => {
    const dir = await makeRunDir(unboundRecords());
    try {
      await withRunDir(dir, async () => {
        const token = await platformToken();
        for (const runId of UNBOUND_RUNS) {
          const response = await callStatusRoute(runId, token);
          assert.equal(response.status, 200);
          const payload = await body(response);
          assert.equal(payload.success, true);
          assert.equal(payload.data?.bound, false);
        }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'live: a disabled platform admin gets 403 construction_forbidden for unbound and old-receipt runs',
  { skip: SKIP },
  async (t) => {
    const store = createAdminStore();
    const current = await store.read();
    if (!current) {
      t.skip(`missing fixture admin app.admin_users id=${PLATFORM_ADMIN_ID}`);
      return;
    }
    assertStatusRouteAdminOwned(current, 'period report status route live preflight', 'active');

    const dir = await makeRunDir(unboundRecords());
    try {
      const token = await platformToken();
      await withRunDir(dir, async () => {
        await withControlledStatusRouteAdminDisabled(store, async () => {
          // No successful save receipt and an old receipt without bindingId
          // must both be denied by the same project rule.
          for (const runId of UNBOUND_RUNS) {
            const response = await callStatusRoute(runId, token);
            assert.equal(response.status, 403, runId);
            const payload = await body(response);
            assert.equal(payload.error, 'construction_forbidden', runId);
            assert.equal(payload.message, 'construction_forbidden', runId);
          }
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    // The helper already restores and verifies in finally; read back again so a
    // silently skipped restore cannot pass this acceptance.
    const restored = await store.read();
    assertStatusRouteAdminOwned(restored, 'period report status route restore', 'active');
  },
);

test(
  'live: a disabled platform admin gets 403 construction_forbidden for a complete binding',
  { skip: SKIP },
  async (t) => {
    const store = createAdminStore();
    const current = await store.read();
    if (!current) {
      t.skip(`missing fixture admin app.admin_users id=${PLATFORM_ADMIN_ID}`);
      return;
    }
    assertStatusRouteAdminOwned(current, 'period report status route live preflight', 'active');
    if (!(await fileExists(BOUND_RUN_FILE))) {
      t.skip(`missing bound fixture ${BOUND_RUN_FILE}; bound revocation is unverified`);
      return;
    }

    const dir = await makeRunDir();
    try {
      await copyFile(BOUND_RUN_FILE, path.join(dir, 'runs', `${BOUND_RUN_ID}.json`));
      const token = await platformToken();
      await withRunDir(dir, async () => {
        await withControlledStatusRouteAdminDisabled(store, async () => {
          const response = await callStatusRoute(BOUND_RUN_ID, token);
          assert.equal(response.status, 403);
          const payload = await body(response);
          assert.equal(payload.error, 'construction_forbidden');
          assert.equal(payload.message, 'construction_forbidden');
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const restored = await store.read();
    assertStatusRouteAdminOwned(restored, 'period report status route restore', 'active');
  },
);
