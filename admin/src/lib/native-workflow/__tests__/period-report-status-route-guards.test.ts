/** Offline guards for the B5.3 period-report status route live test.
 *
 * Nothing here reads a database. The entry gate, the fixture ownership proof
 * and the disable/restore controller are exercised with a fake store, and the
 * real test sources are inspected so the wiring cannot silently drift.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WorkflowOperationError } from '../errors';
import { B4ConfigError } from '../live/dev-config';
import {
  PERIOD_REPORT_STATUS_ROUTE_FIXTURE,
  assertStatusRouteAdminOwned,
  withControlledStatusRouteAdminDisabled,
  type StatusRouteAdminRow,
  type StatusRouteAdminStore,
} from './support/period-report-status-route-fixture';
import {
  resolvePeriodReportStatusRouteLiveGate,
  type PeriodReportStatusRouteLiveGate,
} from './support/period-report-status-route-live';

// ---------------------------------------------------------------------------
// helpers: gate
// ---------------------------------------------------------------------------

const APP_URL = 'postgresql://sfp_app:b5-3-secret@127.0.0.1:55433/smart_floor_planner';

type Env = Record<string, string | undefined>;

function gateEnv(url: string, extra: Env = {}): Env {
  return { B4_LIVE_APP_DATABASE_URL: url, ...extra };
}

/** Counts connection attempts. The gate module cannot connect, so the counter
 * only proves that no connection was attempted after the gate decision. */
interface ConnectionProbe {
  readonly count: number;
  connect(): void;
}

function connectionProbe(): ConnectionProbe {
  let count = 0;
  return {
    get count() {
      return count;
    },
    connect() {
      count += 1;
    },
  };
}

function resolveGateWithProbe(
  env: Env,
  argv: readonly string[] = [],
): { gate: PeriodReportStatusRouteLiveGate; probe: ConnectionProbe } {
  const probe = connectionProbe();
  const gate = resolvePeriodReportStatusRouteLiveGate(env, argv);
  if (gate.enabled) probe.connect();
  return { gate, probe };
}

function expectGateRejection(env: Env, expectedCode: string, label: string): void {
  const probe = connectionProbe();
  let thrown: unknown = null;
  try {
    const gate = resolvePeriodReportStatusRouteLiveGate(env, []);
    if (gate.enabled) probe.connect();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof B4ConfigError, `${label}: expected B4ConfigError, got ${String(thrown)}`);
  assert.equal((thrown as B4ConfigError).code, expectedCode, label);
  assert.equal(probe.count, 0, `${label}: the gate must not open a connection`);
}

// ---------------------------------------------------------------------------
// helpers: fixture store
// ---------------------------------------------------------------------------

type StatusValue = 'active' | 'disabled';

function adminRow(overrides: Partial<StatusRouteAdminRow> = {}): StatusRouteAdminRow {
  return {
    id: PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId,
    enterprise_id: PERIOD_REPORT_STATUS_ROUTE_FIXTURE.enterpriseId,
    username: PERIOD_REPORT_STATUS_ROUTE_FIXTURE.username,
    role: PERIOD_REPORT_STATUS_ROUTE_FIXTURE.role,
    display_name: PERIOD_REPORT_STATUS_ROUTE_FIXTURE.displayName,
    status: 'active',
    ...overrides,
  };
}

function isOwnershipConflict(error: unknown): boolean {
  return error instanceof WorkflowOperationError && error.code === 'fixture_ownership_conflict';
}

interface FakeStore {
  readonly store: StatusRouteAdminStore;
  readonly updates: StatusValue[];
  readonly reads: () => number;
}

/** Reads come from a scripted sequence; the last entry repeats. */
function createFakeStore(options: {
  readonly reads: ReadonlyArray<StatusRouteAdminRow | null>;
  readonly update?: (status: StatusValue, call: number) => number;
}): FakeStore {
  const updates: StatusValue[] = [];
  let readCount = 0;
  const store: StatusRouteAdminStore = {
    async read() {
      const index = Math.min(readCount, options.reads.length - 1);
      readCount += 1;
      const row = options.reads[index];
      return row ? { ...row } : null;
    },
    async updateStatus(status) {
      const call = updates.length;
      updates.push(status);
      const behavior = options.update;
      return behavior ? behavior(status, call) : 1;
    },
  };
  return { store, updates, reads: () => readCount };
}

// ---------------------------------------------------------------------------
// 1. live entry gate
// ---------------------------------------------------------------------------

test('a leftover B4 URL alone leaves the gate closed', () => {
  const { gate, probe } = resolveGateWithProbe(gateEnv(APP_URL));
  assert.equal(gate.enabled, false);
  assert.match(gate.enabled === false ? gate.reason : '', /B4_LIVE_DEVELOPMENT=1/);
  assert.equal(probe.count, 0);
});

test('B4_LIVE_DEVELOPMENT=0 is not an opt-in', () => {
  const { gate, probe } = resolveGateWithProbe(
    gateEnv(APP_URL, { B4_LIVE_DEVELOPMENT: '0' }),
  );
  assert.equal(gate.enabled, false);
  assert.equal(probe.count, 0);
});

test('the --development argv flag enables the gate on its own', () => {
  const { gate, probe } = resolveGateWithProbe(gateEnv(APP_URL), ['--development']);
  assert.equal(gate.enabled, true);
  assert.equal(probe.count, 1, 'only an explicitly enabled gate may connect');
});

test('production is rejected before any connection', () => {
  expectGateRejection(
    gateEnv(APP_URL, { B4_LIVE_DEVELOPMENT: '1', NODE_ENV: 'production' }),
    'production',
    'production',
  );
});

test('every non-B target is rejected with its own code and no connection', () => {
  const cases: ReadonlyArray<{ label: string; url: string; code: string }> = [
    { label: 'port', url: APP_URL.replace(':55433', ':5432'), code: 'B4_LIVE_APP_DATABASE_URL.port' },
    { label: 'missing port', url: 'postgresql://sfp_app:b5-3-secret@127.0.0.1/smart_floor_planner', code: 'B4_LIVE_APP_DATABASE_URL.port.missing' },
    { label: 'database', url: 'postgresql://sfp_app:b5-3-secret@127.0.0.1:55433/other_db', code: 'B4_LIVE_APP_DATABASE_URL.database' },
    { label: 'role', url: 'postgresql://sfp_owner:b5-3-secret@127.0.0.1:55433/smart_floor_planner', code: 'B4_LIVE_APP_DATABASE_URL.username' },
    { label: 'query', url: `${APP_URL}?sslmode=disable`, code: 'B4_LIVE_APP_DATABASE_URL.query' },
    { label: 'fragment', url: `${APP_URL}#fragment`, code: 'B4_LIVE_APP_DATABASE_URL.hash' },
    { label: 'remote host', url: 'postgresql://sfp_app:b5-3-secret@10.1.2.3:55433/smart_floor_planner', code: 'B4_LIVE_APP_DATABASE_URL.host' },
    { label: 'localhost alias', url: 'postgresql://sfp_app:b5-3-secret@db.local:55433/smart_floor_planner', code: 'B4_LIVE_APP_DATABASE_URL.host' },
  ];
  for (const entry of cases) {
    expectGateRejection(
      gateEnv(entry.url, { B4_LIVE_DEVELOPMENT: '1' }),
      entry.code,
      entry.label,
    );
  }
});

test('an opted-in B URL resolves the exact isolated target', () => {
  const gate = resolvePeriodReportStatusRouteLiveGate(
    gateEnv(APP_URL, { B4_LIVE_DEVELOPMENT: '1' }),
    [],
  );
  assert.equal(gate.enabled, true);
  if (!gate.enabled) return;
  assert.equal(gate.target.host, '127.0.0.1');
  assert.equal(gate.target.port, '55433');
  assert.equal(gate.target.database, 'smart_floor_planner');
  assert.equal(gate.target.username, 'sfp_app');
  assert.equal(gate.target.purpose, 'app');
});

// ---------------------------------------------------------------------------
// 2. fixture ownership
// ---------------------------------------------------------------------------

test('the documented B5.3 platform admin row passes ownership', () => {
  assert.doesNotThrow(() => assertStatusRouteAdminOwned(adminRow(), 'guard test', 'active'));
});

test('each ownership field mismatch is a fixture_ownership_conflict', () => {
  const cases: ReadonlyArray<{ label: string; row: StatusRouteAdminRow | null; status?: string }> = [
    { label: 'id', row: adminRow({ id: '1454000011' }) },
    { label: 'enterprise', row: adminRow({ enterprise_id: '1455' }) },
    { label: 'username', row: adminRow({ username: 'b5-3-platform-1455' }) },
    { label: 'role', row: adminRow({ role: 'admin' }) },
    { label: 'display_name marker', row: adminRow({ display_name: '[B5.3] 其他管理员' }) },
    { label: 'missing row', row: null },
    { label: 'status', row: adminRow({ status: 'disabled' }), status: 'active' },
  ];
  for (const entry of cases) {
    assert.throws(
      () => assertStatusRouteAdminOwned(entry.row, 'guard test', entry.status),
      isOwnershipConflict,
      entry.label,
    );
  }
});

test('a non-fixture row fails before the disable UPDATE runs', async () => {
  const fake = createFakeStore({
    reads: [adminRow({ username: 'someone-else-1454' })],
  });
  await assert.rejects(
    withControlledStatusRouteAdminDisabled(fake.store, async () => 'unreachable'),
    isOwnershipConflict,
  );
  assert.equal(fake.updates.length, 0, 'no UPDATE may run before ownership is proven');
});

// ---------------------------------------------------------------------------
// 3. disable and restore
// ---------------------------------------------------------------------------

test('the happy path disables, restores and verifies the admin', async () => {
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ status: 'disabled' }), adminRow()],
  });
  const result = await withControlledStatusRouteAdminDisabled(fake.store, async () => 'ok');
  assert.equal(result, 'ok');
  assert.deepEqual(fake.updates, ['disabled', 'active']);
  assert.ok(fake.reads() >= 3, `expected at least 3 reads, got ${fake.reads()}`);
});

test('a throwing body still restores the admin and rethrows the original error', async () => {
  const bodyError = new Error('body failed');
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ status: 'disabled' }), adminRow()],
  });
  let caught: unknown = null;
  try {
    await withControlledStatusRouteAdminDisabled(fake.store, async () => {
      throw bodyError;
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, bodyError, 'the original body error must surface unchanged');
  assert.equal(caught instanceof AggregateError, false);
  assert.deepEqual(fake.updates, ['disabled', 'active']);
});

test('a restore UPDATE that affects zero rows fails the run', async () => {
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ status: 'disabled' })],
    update: (status) => (status === 'disabled' ? 1 : 0),
  });
  await assert.rejects(
    withControlledStatusRouteAdminDisabled(fake.store, async () => 'ok'),
    (error: unknown) =>
      error instanceof WorkflowOperationError && error.code === 'fixture_restore_failed',
  );
  assert.deepEqual(fake.updates, ['disabled', 'active']);
});

test('a throwing restore UPDATE is surfaced, never swallowed', async () => {
  const restoreError = new Error('restore transport failed');
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ status: 'disabled' })],
    update: (status) => {
      if (status === 'active') throw restoreError;
      return 1;
    },
  });
  let caught: unknown = null;
  try {
    await withControlledStatusRouteAdminDisabled(fake.store, async () => 'ok');
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, restoreError, 'the restore failure must not be swallowed');
});

test('a row replaced before restore is never overwritten', async () => {
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ username: 'replaced-1454', status: 'disabled' })],
  });
  await assert.rejects(
    withControlledStatusRouteAdminDisabled(fake.store, async () => 'ok'),
    isOwnershipConflict,
  );
  assert.deepEqual(fake.updates, ['disabled'], 'the restore UPDATE must not run');
});

test('a failing body plus a failing restore keeps both errors', async () => {
  const bodyError = new Error('body boom');
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ status: 'disabled' })],
    update: (status) => (status === 'disabled' ? 1 : 0),
  });
  let caught: unknown = null;
  try {
    await withControlledStatusRouteAdminDisabled(fake.store, async () => {
      throw bodyError;
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AggregateError, `expected AggregateError, got ${String(caught)}`);
  assert.equal(caught.errors.length, 2);
  assert.equal(caught.errors[0], bodyError);
  assert.ok(
    caught.errors[1] instanceof WorkflowOperationError
      && caught.errors[1].code === 'fixture_restore_failed',
  );
});

test('a restore that does not read back as active fails the run', async () => {
  const fake = createFakeStore({
    reads: [adminRow(), adminRow({ status: 'disabled' }), adminRow({ status: 'disabled' })],
  });
  await assert.rejects(
    withControlledStatusRouteAdminDisabled(fake.store, async () => 'ok'),
    isOwnershipConflict,
  );
  assert.deepEqual(fake.updates, ['disabled', 'active']);
});

// ---------------------------------------------------------------------------
// 4. static wiring of the real test entry points
// ---------------------------------------------------------------------------

function testSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

test('the offline route test keeps the database out of its imports and env', () => {
  const source = testSource('./period-report-status-route.test.ts');
  for (const forbidden of ['B4_LIVE', 'DATABASE_URL', 'getPostgresPool', 'withPlatformTransaction']) {
    assert.equal(
      source.includes(forbidden),
      false,
      `the offline route test must not reference ${forbidden}`,
    );
  }
  assert.equal(/\bpg\b/.test(source), false, 'the offline route test must not import pg');
});

test('the live route test gates, verifies identity and restores in order', () => {
  const livePath = fileURLToPath(
    new URL('./period-report-status-route.live.test.ts', import.meta.url),
  );
  assert.ok(existsSync(livePath), 'period-report-status-route.live.test.ts must exist');
  const source = readFileSync(livePath, 'utf8');

  const gateIndex = source.indexOf('resolvePeriodReportStatusRouteLiveGate(');
  assert.ok(gateIndex >= 0, 'the live entry must call resolvePeriodReportStatusRouteLiveGate');

  const databaseUrlWrite = /process\.env\.DATABASE_URL\s*=/.exec(source);
  if (databaseUrlWrite?.index !== undefined) {
    assert.ok(gateIndex < databaseUrlWrite.index, 'the gate must run before DATABASE_URL is written');
  }

  const poolIndex = source.indexOf('getPostgresPool(');
  assert.ok(poolIndex >= 0, 'the live test must open its pool explicitly');
  assert.ok(gateIndex < poolIndex, 'the gate must run before the pool is created');

  const identityIndex = source.indexOf('assertB4ConnectionIdentity(');
  assert.ok(identityIndex >= 0, 'the live test must assert the connected identity');
  assert.ok(identityIndex > poolIndex, 'the identity check must follow the connection');

  const preflightIndex = source.indexOf('runSharedFixturePreflight(');
  assert.ok(preflightIndex >= 0, 'the live test must run the shared fixture preflight');
  assert.ok(preflightIndex > gateIndex, 'the shared fixture preflight must follow the gate');

  assert.ok(
    source.indexOf('withControlledStatusRouteAdminDisabled(') >= 0,
    'the live test must disable through the controlled fixture helper',
  );

  // Only the SQL statement counts; prose that names the table is not a write.
  const updateIndexes = [...source.matchAll(/\bupdate\s+app\.admin_users\s+set\b/gi)]
    .map((match) => match.index ?? -1);
  assert.equal(updateIndexes.length, 1, 'exactly one admin UPDATE may exist, inside the store adapter');
  const updateIndex = updateIndexes[0];
  assert.ok(identityIndex < updateIndex, 'identity must be verified before the admin UPDATE');
  assert.ok(preflightIndex < updateIndex, 'the fixture preflight must run before the admin UPDATE');

  const adapterWindow = source.slice(Math.max(0, updateIndex - 800), updateIndex);
  assert.match(adapterWindow, /updateStatus/, 'the admin UPDATE must live in the store adapter');
  assert.equal(
    adapterWindow.includes('callStatusRoute('),
    false,
    'the admin UPDATE must not sit inside the route call helper',
  );
});
