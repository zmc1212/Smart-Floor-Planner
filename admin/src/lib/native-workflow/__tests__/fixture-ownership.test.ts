import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import {
  INTEGRATION_MARKER,
  assertFixtureRowsOwned,
  canCleanupFixtureRows,
  runOwnedCleanup,
  type FixtureRowOwnership,
} from '../live/fixture-ownership';

const CONTEXT = 'B4.2 integration';

function row(overrides: Partial<FixtureRowOwnership> = {}): FixtureRowOwnership {
  return {
    table: 'app.leads',
    id: '1454900003',
    marker: `${INTEGRATION_MARKER} target`,
    ...overrides,
  };
}

test('absent rows pass the ownership check', () => {
  assert.doesNotThrow(() => assertFixtureRowsOwned([
    row({ marker: null }),
    row({ table: 'app.construction_projects', id: '1454900004', marker: null }),
  ], CONTEXT));
});

test('rows carrying the integration marker pass', () => {
  assert.doesNotThrow(() => assertFixtureRowsOwned([
    row(),
    row({ table: 'app.assistant_conversations', id: '1454900005', marker: INTEGRATION_MARKER }),
  ], CONTEXT));
});

test('a caller-supplied expected marker passes', () => {
  const marker = '[B4] 集成测试客户 目标';
  assert.doesNotThrow(() => assertFixtureRowsOwned([row({ marker })], CONTEXT, marker));
});

test('a foreign marker is rejected with 409 and row details', () => {
  const foreign = '[B4] 集成测试客户 目标';
  assert.throws(
    () => assertFixtureRowsOwned([row({ marker: foreign })], CONTEXT),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowOperationError, 'expected WorkflowOperationError');
      assert.equal(error.code, 'fixture_ownership_conflict');
      assert.equal(error.status, 409);
      assert.deepEqual(error.details, {
        context: CONTEXT,
        table: 'app.leads',
        id: '1454900003',
        marker: foreign,
        expectedMarker: INTEGRATION_MARKER,
      });
      return true;
    },
  );
});

test('a fixed record id or enterprise id alone is not ownership proof', () => {
  assert.throws(
    () => assertFixtureRowsOwned([row({ marker: '1454' })], CONTEXT),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'fixture_ownership_conflict',
  );
});

test('cleanup requires both the preflight and ownership', () => {
  assert.equal(canCleanupFixtureRows(true, true), true);
  assert.equal(canCleanupFixtureRows(true, false), false);
  assert.equal(canCleanupFixtureRows(false, true), false);
  assert.equal(canCleanupFixtureRows(false, false), false);
});

test('runOwnedCleanup never calls cleanup unless both flags are true', async () => {
  for (const [preflightOk, owned] of [
    [false, true],
    [true, false],
    [false, false],
  ] as const) {
    let calls = 0;
    const ran = await runOwnedCleanup(preflightOk, owned, async () => {
      calls += 1;
    });
    assert.equal(ran, false, `preflightOk=${preflightOk} owned=${owned}`);
    assert.equal(calls, 0, `preflightOk=${preflightOk} owned=${owned}`);
  }
});

test('runOwnedCleanup calls cleanup exactly once when both flags are true', async () => {
  let calls = 0;
  const ran = await runOwnedCleanup(true, true, async () => {
    calls += 1;
  });
  assert.equal(ran, true);
  assert.equal(calls, 1);
});

test('a throwing preflight leaves zero cleanup calls', async () => {
  let preflightOk = true;
  try {
    throw new Error('ownership preflight failed');
  } catch {
    preflightOk = false;
  }

  let calls = 0;
  const ran = await runOwnedCleanup(preflightOk, true, async () => {
    calls += 1;
  });
  assert.equal(ran, false);
  assert.equal(calls, 0);
});
