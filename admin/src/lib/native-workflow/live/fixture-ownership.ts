/** Ownership proof for the B4.2 integration test fixtures.
 *
 * Row identity alone (enterprise id or a fixed record id) is never proof of
 * ownership. A row belongs to the integration run only when it carries the
 * integration marker, and cleanup may only run after both the ownership
 * preflight and the cleanup precondition succeed.
 */
import { WorkflowOperationError } from '../errors';

export const INTEGRATION_MARKER = '[B4.2-INTEGRATION]';

export interface FixtureRowOwnership {
  table: string;
  id: string;
  /** `null` means the row is absent; an absent row is always allowed. */
  marker: string | null;
}

function isOwnedMarker(marker: string, expectedMarker?: string): boolean {
  return marker.startsWith(INTEGRATION_MARKER)
    || (expectedMarker !== undefined && marker === expectedMarker);
}

export function assertFixtureRowsOwned(
  rows: readonly FixtureRowOwnership[],
  contextLabel: string,
  expectedMarker?: string,
): void {
  for (const row of rows) {
    if (row.marker === null) continue;
    if (isOwnedMarker(row.marker, expectedMarker)) continue;
    throw new WorkflowOperationError(
      'fixture_ownership_conflict',
      409,
      `Fixture ownership conflict (${contextLabel}): table=${row.table} id=${row.id} `
        + `marker=${JSON.stringify(row.marker)} does not belong to ${INTEGRATION_MARKER}.`,
      {
        context: contextLabel,
        table: row.table,
        id: row.id,
        marker: row.marker,
        expectedMarker: expectedMarker ?? INTEGRATION_MARKER,
      },
    );
  }
}

export function canCleanupFixtureRows(preflightOk: boolean, owned: boolean): boolean {
  return preflightOk && owned;
}

export async function runOwnedCleanup(
  preflightOk: boolean,
  owned: boolean,
  cleanup: () => Promise<void>,
): Promise<boolean> {
  if (!canCleanupFixtureRows(preflightOk, owned)) return false;
  await cleanup();
  return true;
}
