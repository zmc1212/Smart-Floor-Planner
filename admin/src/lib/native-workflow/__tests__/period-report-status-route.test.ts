import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { SignJWT } from 'jose';
import { GET } from '@/app/api/native-workflow/runs/[runId]/period-report-status/route';
import type { LiveOperationRecord, LiveRunRecord } from '@/lib/native-workflow/live/types';

// The route reads JWT_SECRET at request time; snapshot it so the offline cases
// never depend on (or leak) the operator's real secret.
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'b5-3-period-report-status-route-secret';

after(() => {
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

const ENTERPRISE_ID = '1454';
const FOREIGN_ENTERPRISE_ID = '9999';
const PROJECT_ID = '1454000004';
const PLATFORM_ADMIN_ID = '1454000001';
const PLATFORM_ADMIN_ROLE = 'super_admin';
const NOW = '2026-11-11T03:00:00.000Z';
const DIGEST = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// helpers (file store only; nothing here opens a database connection)
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
    .sign(new TextEncoder().encode(process.env.JWT_SECRET ?? ''));
}

async function callStatusRoute(runId: string, token?: string): Promise<Response> {
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

function saveReceipt(): Record<string, unknown> {
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
  };
}

interface RecordOptions {
  readonly runId: string;
  readonly enterpriseId?: string;
  readonly projectId?: string;
}

function makeRecord(options: RecordOptions): LiveRunRecord {
  const operations: LiveOperationRecord[] = [
    {
      nodeId: 'save-report',
      capabilityRef: 'save.period_report',
      effect: 'save',
      nodeVersion: 'save_result@1/save.period_report',
      idempotencyKey: `save:${options.runId}`,
      startedAt: NOW,
      finishedAt: NOW,
      outcome: 'succeeded',
      outputs: { saved: true, saveReceipt: saveReceipt() },
    },
  ];
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
// offline cases (no database is imported or contacted by this file)
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
