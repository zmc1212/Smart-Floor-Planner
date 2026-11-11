import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { GET } from '@/app/api/native-workflow/runs/[runId]/period-report-status/route';
import { one } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction } from '@/db/transaction';
import { closePostgresPool, getPostgresPool } from '@/lib/postgresql';
import type { LiveOperationRecord, LiveRunRecord } from '@/lib/native-workflow/live/types';

const LIVE_DB_URL = process.env.B4_LIVE_APP_DATABASE_URL?.trim() ?? '';
// The pool is created lazily on the first getPostgresPool() call, so writing
// DATABASE_URL here is still early enough for the live cases below.
if (LIVE_DB_URL) process.env.DATABASE_URL = LIVE_DB_URL;

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
// The route reads JWT_SECRET at request time, so the same process sees this.
process.env.JWT_SECRET = 'b5-3-period-report-status-route-secret';

const ENTERPRISE_ID = '1454';
const FOREIGN_ENTERPRISE_ID = '9999';
const PROJECT_ID = '1454000004';
const PLATFORM_ADMIN_ID = '1454000001';
const PLATFORM_ADMIN_ROLE = 'super_admin';
const REVOKED_ADMIN_ID = '1454000010';
const NOW = '2026-11-11T03:00:00.000Z';
const DIGEST = 'a'.repeat(64);

/** A real B5.3 bound run, copied into a temp store instead of being mutated. */
const LIVE_BOUND_RUN_FILE = path.resolve(
  process.cwd(),
  'tmp/b5-3-live/runs/runs/b5-3-status-001.json',
);
const LIVE_BOUND_RUN_ID = 'b5-3-status-001';

const DB_SKIP = LIVE_DB_URL
  ? false
  : 'set B4_LIVE_APP_DATABASE_URL to run the live database cases';

if (LIVE_DB_URL) {
  before(async () => {
    const result = await getPostgresPool().query<{ database_name: string; user_name: string }>(
      'select current_database() as database_name, current_user as user_name',
    );
    const identity = result.rows[0];
    assert.match(String(identity?.database_name), /smart_floor_planner/);
    assert.match(String(identity?.user_name), /sfp_app/);
  });
}

after(async () => {
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  if (LIVE_DB_URL) await closePostgresPool();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function signToken(claims: {
  id: string;
  role: string;
  enterpriseId: string | null;
}): Promise<string> {
  return new SignJWT({ ...claims, username: `test-${claims.id}` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

async function callStatusRoute(
  runId: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `auth_token=${token}`;
  const request = new Request(
    `http://localhost/api/native-workflow/runs/${runId}/period-report-status`,
    { headers },
  );
  return GET(request, { params: Promise.resolve({ runId }) });
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-route-'));
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

type SaveVariant = 'ok' | 'missing' | 'no-receipt' | 'no-binding-id';

interface RecordOptions {
  readonly runId: string;
  readonly enterpriseId?: string;
  readonly projectId?: string;
  readonly save?: SaveVariant;
}

function makeRecord(options: RecordOptions): LiveRunRecord {
  const save = options.save ?? 'ok';
  const operations: LiveOperationRecord[] = [];
  if (save !== 'missing') {
    operations.push({
      nodeId: 'save-report',
      capabilityRef: 'save.period_report',
      effect: 'save',
      nodeVersion: 'save_result@1/save.period_report',
      idempotencyKey: `save:${options.runId}`,
      startedAt: NOW,
      finishedAt: NOW,
      outcome: 'succeeded',
      outputs: save === 'no-receipt'
        ? { saved: true }
        : {
            saved: true,
            saveReceipt: saveReceipt(
              save === 'no-binding-id' ? { bindingId: '' } : {},
            ),
          },
    });
  }
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
    enterpriseId: options.enterpriseId ?? ENTERPRISE_ID,
    projectId: options.projectId ?? PROJECT_ID,
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
    operations,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function platformToken(): Promise<string> {
  return signToken({
    id: PLATFORM_ADMIN_ID,
    role: PLATFORM_ADMIN_ROLE,
    enterpriseId: ENTERPRISE_ID,
  });
}

// ---------------------------------------------------------------------------
// offline cases (no database)
// ---------------------------------------------------------------------------

test('route rejects an anonymous caller with 401 Unauthorized', async () => {
  const dir = await makeRunDir();
  try {
    await withRunDir(dir, async () => {
      const response = await callStatusRoute('run-any');
      assert.equal(response.status, 401);
      assert.deepEqual(await body(response), { success: false, error: 'Unauthorized' });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route rejects non-platform roles with 403 Forbidden', async () => {
  const dir = await makeRunDir();
  try {
    await withRunDir(dir, async () => {
      for (const role of ['viewer', 'salesperson']) {
        const token = await signToken({ id: '1454000002', role, enterpriseId: ENTERPRISE_ID });
        const response = await callStatusRoute('run-any', token);
        assert.equal(response.status, 403);
        assert.deepEqual(await body(response), { success: false, error: 'Forbidden' });
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route reports a missing run as 404 run_not_found', async () => {
  const dir = await makeRunDir();
  try {
    await withRunDir(dir, async () => {
      const response = await callStatusRoute('run-does-not-exist', await platformToken());
      assert.equal(response.status, 404);
      assert.equal((await body(response)).error, 'run_not_found');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route refuses a run owned by another enterprise with 403 run_enterprise_forbidden', async () => {
  const dir = await makeRunDir([
    makeRecord({ runId: 'run-foreign', enterpriseId: FOREIGN_ENTERPRISE_ID }),
  ]);
  try {
    await withRunDir(dir, async () => {
      const response = await callStatusRoute('run-foreign', await platformToken());
      assert.equal(response.status, 403);
      assert.equal((await body(response)).error, 'run_enterprise_forbidden');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route reports a run without project scope as 404 run_scope_unavailable', async () => {
  const dir = await makeRunDir([
    makeRecord({ runId: 'run-no-scope', projectId: '' }),
  ]);
  try {
    await withRunDir(dir, async () => {
      const response = await callStatusRoute('run-no-scope', await platformToken());
      assert.equal(response.status, 404);
      assert.equal((await body(response)).error, 'run_scope_unavailable');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// database-gated cases (skipped unless B4_LIVE_APP_DATABASE_URL is set)
// ---------------------------------------------------------------------------

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

test(
  'live: the default reader authorizes and returns a real bound run',
  { skip: DB_SKIP },
  async (t) => {
    if (!(await fileExists(LIVE_BOUND_RUN_FILE))) {
      t.skip(`missing fixture ${LIVE_BOUND_RUN_FILE}`);
      return;
    }
    const dir = await makeRunDir();
    try {
      await copyFile(LIVE_BOUND_RUN_FILE, path.join(dir, 'runs', `${LIVE_BOUND_RUN_ID}.json`));
      await withRunDir(dir, async () => {
        const response = await callStatusRoute(LIVE_BOUND_RUN_ID, await platformToken());
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
  'live: unbound runs are authorized before the raw trace is returned',
  { skip: DB_SKIP },
  async () => {
    const dir = await makeRunDir([
      makeRecord({ runId: 'run-live-unbound-save', save: 'missing' }),
      makeRecord({ runId: 'run-live-unbound-receipt', save: 'no-receipt' }),
      makeRecord({ runId: 'run-live-unbound-binding', save: 'no-binding-id' }),
    ]);
    try {
      await withRunDir(dir, async () => {
        const token = await platformToken();
        for (const runId of [
          'run-live-unbound-save',
          'run-live-unbound-receipt',
          'run-live-unbound-binding',
        ]) {
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
  'live: revoked platform access on bound and unbound runs is 403 construction_forbidden',
  { skip: DB_SKIP },
  async (t) => {
    const admin = await withPlatformTransaction((tx) =>
      one<{ id: string; role: string; status: string }>(
        tx,
        sql`select id::text as id, role, status from app.admin_users
          where id=${REVOKED_ADMIN_ID}::bigint`,
      ),
    );
    if (!admin || !['super_admin', 'admin'].includes(String(admin.role))) {
      t.skip(`no controlled platform admin ${REVOKED_ADMIN_ID}`);
      return;
    }

    const dir = await makeRunDir([
      makeRecord({ runId: 'run-live-revoked-unbound', save: 'missing' }),
    ]);
    try {
      if (await fileExists(LIVE_BOUND_RUN_FILE)) {
        await copyFile(
          LIVE_BOUND_RUN_FILE,
          path.join(dir, 'runs', `${LIVE_BOUND_RUN_ID}.json`),
        );
      }
      const token = await signToken({
        id: REVOKED_ADMIN_ID,
        role: String(admin.role),
        enterpriseId: ENTERPRISE_ID,
      });
      await withPlatformTransaction((tx) =>
        tx.execute(sql`update app.admin_users set status='disabled' where id=${REVOKED_ADMIN_ID}::bigint`),
      );
      try {
        await withRunDir(dir, async () => {
          const runIds = ['run-live-revoked-unbound'];
          if (await fileExists(path.join(dir, 'runs', `${LIVE_BOUND_RUN_ID}.json`))) {
            runIds.push(LIVE_BOUND_RUN_ID);
          }
          for (const runId of runIds) {
            const response = await callStatusRoute(runId, token);
            assert.equal(response.status, 403);
            const payload = await body(response);
            assert.equal(payload.error, 'construction_forbidden');
            assert.equal(payload.message, 'construction_forbidden');
          }
        });
      } finally {
        await withPlatformTransaction((tx) =>
          tx.execute(
            sql`update app.admin_users set status=${String(admin.status)}
              where id=${REVOKED_ADMIN_ID}::bigint`,
          ),
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
