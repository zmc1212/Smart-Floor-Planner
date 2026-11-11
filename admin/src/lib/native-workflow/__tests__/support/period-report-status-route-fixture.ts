/** Ownership and restore control for the one admin row the live route test
 * temporarily disables.
 *
 * A fixed id is not ownership proof. Before any UPDATE the row must match the
 * B5.3 fixture enterprise, username, platform role and marker. Restore runs in
 * finally, re-checks ownership first, and reads the row back afterwards; any
 * restore or verification failure is thrown so the acceptance cannot pass.
 */
import { WorkflowOperationError } from '../../errors';
import { assertFixtureRowsOwned } from '../../live/fixture-ownership';

export const PERIOD_REPORT_STATUS_ROUTE_FIXTURE = {
  enterpriseId: '1454',
  adminId: '1454000010',
  username: 'b5-3-platform-1454',
  role: 'super_admin',
  displayName: '[B5.3] 平台管理员',
} as const;

export interface StatusRouteAdminRow {
  readonly id: string;
  readonly enterprise_id: string;
  readonly username: string;
  readonly role: string;
  readonly display_name: string;
  readonly status: string;
}

export interface StatusRouteAdminStore {
  read(): Promise<StatusRouteAdminRow | null>;
  /** Returns the number of affected rows. */
  updateStatus(status: 'active' | 'disabled'): Promise<number>;
}

function conflict(
  context: string,
  field: string,
  actual: unknown,
  expected: unknown,
): never {
  throw new WorkflowOperationError(
    'fixture_ownership_conflict',
    409,
    `Period-report status route fixture conflict (${context}): ${field}=`
      + `${JSON.stringify(actual)} does not match ${JSON.stringify(expected)} `
      + `for app.admin_users id=${PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId}.`,
    { context, table: 'app.admin_users', field, actual, expected },
  );
}

/** Pure ownership check; no clock, no database, no side effect. */
export function assertStatusRouteAdminOwned(
  row: StatusRouteAdminRow | null,
  context: string,
  expectedStatus?: string,
): asserts row is StatusRouteAdminRow {
  if (!row) conflict(context, 'row', null, PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId);
  if (row.id !== PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId) {
    conflict(context, 'id', row.id, PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId);
  }
  if (row.enterprise_id !== PERIOD_REPORT_STATUS_ROUTE_FIXTURE.enterpriseId) {
    conflict(context, 'enterprise_id', row.enterprise_id, PERIOD_REPORT_STATUS_ROUTE_FIXTURE.enterpriseId);
  }
  if (row.username !== PERIOD_REPORT_STATUS_ROUTE_FIXTURE.username) {
    conflict(context, 'username', row.username, PERIOD_REPORT_STATUS_ROUTE_FIXTURE.username);
  }
  if (row.role !== PERIOD_REPORT_STATUS_ROUTE_FIXTURE.role) {
    conflict(context, 'role', row.role, PERIOD_REPORT_STATUS_ROUTE_FIXTURE.role);
  }
  // Reuse the existing marker preflight instead of inventing another marker.
  assertFixtureRowsOwned(
    [{ table: 'app.admin_users', id: row.id, marker: row.display_name }],
    context,
    PERIOD_REPORT_STATUS_ROUTE_FIXTURE.displayName,
  );
  if (expectedStatus !== undefined && row.status !== expectedStatus) {
    conflict(context, 'status', row.status, expectedStatus);
  }
}

/**
 * Disable the fixture admin for one callback and restore it in finally.
 *
 * The preflight runs before the first UPDATE. The restore path re-reads and
 * re-checks ownership (without requiring a disabled status, so a failed UPDATE
 * is harmless), restores only when the row is still disabled, then reads it
 * back and verifies the original status. A restore failure throws; if the body
 * also failed, both errors are preserved in an AggregateError.
 */
export async function withControlledStatusRouteAdminDisabled<T>(
  store: StatusRouteAdminStore,
  run: () => Promise<T>,
  context = 'period report status route admin',
): Promise<T> {
  const original = await store.read();
  assertStatusRouteAdminOwned(original, `${context} preflight`, 'active');
  const originalStatus = original.status;

  let bodyError: unknown = null;
  try {
    const updated = await store.updateStatus('disabled');
    if (updated !== 1) {
      throw new WorkflowOperationError(
        'fixture_ownership_conflict',
        409,
        `${context}: disabling app.admin_users id=${PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId} affected ${updated} rows`,
        { context, table: 'app.admin_users', expected: 1, actual: updated },
      );
    }
    return await run();
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    try {
      const current = await store.read();
      assertStatusRouteAdminOwned(current, `${context} restore preflight`);
      if (current.status === 'disabled') {
        const restored = await store.updateStatus(originalStatus === 'disabled' ? 'disabled' : 'active');
        if (restored !== 1) {
          throw new WorkflowOperationError(
            'fixture_restore_failed',
            500,
            `${context}: restoring app.admin_users id=${PERIOD_REPORT_STATUS_ROUTE_FIXTURE.adminId} affected ${restored} rows`,
            { context, table: 'app.admin_users', expected: 1, actual: restored },
          );
        }
      }
      const verified = await store.read();
      assertStatusRouteAdminOwned(verified, `${context} restore verify`, originalStatus);
    } catch (restoreError) {
      if (bodyError) {
        throw new AggregateError(
          [bodyError, restoreError],
          `${context}: test body failed and fixture restore failed`,
        );
      }
      throw restoreError;
    }
  }
}
