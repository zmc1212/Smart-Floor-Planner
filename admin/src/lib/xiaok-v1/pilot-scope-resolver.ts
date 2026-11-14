import type { PostgresTransaction } from '@/db/transaction';
import { id, key } from '@/lib/assistant/contracts';
import { readPilotProjectScope, type PilotProjectScope } from './pilot-project-scope';

/** Reads the latest saved version for one enterprise and pilot. The result may
 * be inactive; the resolver below decides whether it can be used. */
export type PilotScopeRead = (enterpriseId: string, pilotId: string) => Promise<PilotProjectScope | null>;

/** The read-only view and trusted clock of the current business run. The read
 * is bound to the caller's existing tenant transaction, so reminder and weekly
 * report jobs do not open a second connection or write anything. */
export type PilotScopeRuntimeContext = {
  read: PilotScopeRead;
  now?: Date;
};

export type PilotScopeResolutionStatus = 'active' | 'inactive' | 'not_found' | 'empty';

export type PilotScopeResolution = {
  enterpriseId: string;
  pilotId: string;
  scopeVersion: number | null;
  projectIds: string[];
  status: PilotScopeResolutionStatus;
  resolvedAt: string;
};

/** Bind the resolver to the caller's existing tenant transaction. */
export function tenantPilotScopeRead(tx: PostgresTransaction): PilotScopeRead {
  return (enterpriseId, pilotId) => readPilotProjectScope(tx, enterpriseId, pilotId);
}

/** Resolve one pilot scope for the current business run.
 *
 * Only the latest saved version is considered: a newer inactive version never
 * falls back to an older active one, and an empty selection never expands to
 * the enterprise. Foreign or mismatched records are reported as `not_found`
 * without returning their project IDs. This function never writes. */
export async function resolvePilotScope(input: {
  enterpriseId: string;
  pilotId: string;
  context: PilotScopeRuntimeContext;
}): Promise<PilotScopeResolution> {
  const enterpriseId = id(input.enterpriseId);
  const pilotId = key(input.pilotId);
  const resolvedAt = (input.context.now ?? new Date()).toISOString();
  const scope = await input.context.read(enterpriseId, pilotId);

  if (!scope || String(scope.enterpriseId) !== enterpriseId || String(scope.pilotId) !== pilotId) {
    return { enterpriseId, pilotId, scopeVersion: null, projectIds: [], status: 'not_found', resolvedAt };
  }
  if (scope.status !== 'active') {
    return { enterpriseId, pilotId, scopeVersion: scope.scopeVersion, projectIds: [], status: 'inactive', resolvedAt };
  }
  const projectIds = [...scope.projectIds];
  if (!projectIds.length) {
    return { enterpriseId, pilotId, scopeVersion: scope.scopeVersion, projectIds: [], status: 'empty', resolvedAt };
  }
  return { enterpriseId, pilotId, scopeVersion: scope.scopeVersion, projectIds, status: 'active', resolvedAt };
}
