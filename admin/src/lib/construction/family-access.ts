import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';

/** The owner-authorised family progress grant is the single source of family access. */
export const familyGrantType = 'construction.family.progress-access.v1';
export const familyGrantAggregate = 'construction_family_viewer';
export const familyAggregateId = (projectId: string, viewerId: string) => projectId + ':' + viewerId;

export async function latestFamilyGrant(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
  viewerId: string
) {
  return one(tx, sql`select id::text,aggregate_version,payload,correlation_id
    from app.domain_event_outbox
    where enterprise_id=${enterpriseId} and type=${familyGrantType} and aggregate_type=${familyGrantAggregate}
      and aggregate_id=${familyAggregateId(projectId, viewerId)}
    order by aggregate_version desc limit 1`);
}

/**
 * A family grant only applies while the current primary customer is the one who
 * issued it. Ownership changes therefore revoke old family access without
 * deleting the audit trail.
 */
export async function familyViewerAllowed(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
  viewerId: string,
  ownerId?: string
) {
  const grant = await latestFamilyGrant(tx, enterpriseId, projectId, viewerId);
  const policy = grant?.payload as Row | undefined;
  if (policy?.allowed !== true) return false;
  return ownerId === undefined || String(policy.ownerId) === String(ownerId);
}
