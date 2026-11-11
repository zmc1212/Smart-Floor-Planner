/** Ownership proof for the B4.2 integration test fixtures.
 *
 * Row identity alone (enterprise id or a fixed record id) is never proof of
 * ownership. A row belongs to the integration run only when it carries the
 * integration marker, and cleanup may only run after both the ownership
 * preflight and the cleanup precondition succeed.
 */
import { WorkflowOperationError } from '../errors';

export const INTEGRATION_MARKER = '[B4.2-INTEGRATION]';

/** Identity of the shared B4 live fixture. A fixed id is never ownership
 * proof, so every row must also carry its documented marker. */
export const SHARED_FIXTURE = {
  enterpriseId: '1454',
  enterpriseCode: 'B4-LIVE-1454',
  namePrefix: '[B4]',
  ownerAdminId: '1454000001',
  managerAdminId: '1454000007',
  workerAdminId: '1454000008',
  observerAdminId: '1454000009',
  customerUserId: '1454000002',
  mainProjectId: '1454000004',
  mainConversationId: '1454000005',
} as const;

export const SHARED_FIXTURE_ADMINS = [
  { id: SHARED_FIXTURE.ownerAdminId, username: 'b4-live-admin-1454' },
  { id: SHARED_FIXTURE.managerAdminId, username: 'b4-live-manager-1454' },
  { id: SHARED_FIXTURE.workerAdminId, username: 'b4-live-worker-1454' },
  { id: SHARED_FIXTURE.observerAdminId, username: 'b4-live-observer-1454' },
] as const;

export const SHARED_FIXTURE_CUSTOMER_USERNAME = 'b4-live-customer-1454';

export interface SharedFixtureEvidence {
  readonly enterprise: { id: string; code: string | null; name: string | null } | null;
  readonly admins: ReadonlyArray<{
    id: string;
    username: string | null;
    enterpriseId: string | null;
    status: string | null;
  }>;
  readonly customer: { id: string; username: string | null; enterpriseId: string | null } | null;
  readonly project: { id: string; name: string | null } | null;
  readonly conversation: { id: string; title: string | null } | null;
}

export interface SharedFixtureQueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const SHARED_FIXTURE_QUERY = `select
  (select json_build_object('id', id::text, 'code', code, 'name', name)
     from app.enterprises where id = $1::bigint) as enterprise,
  (select coalesce(json_agg(json_build_object('id', id::text, 'username', username,
       'enterpriseId', enterprise_id::text, 'status', status) order by id), '[]'::json)
     from app.admin_users where enterprise_id = $1::bigint and id = any($2::bigint[])) as admins,
  (select json_build_object('id', id::text, 'username', username, 'enterpriseId', enterprise_id::text)
     from app.users where enterprise_id = $1::bigint and id = $3::bigint) as customer,
  (select json_build_object('id', id::text, 'name', name)
     from app.construction_projects where enterprise_id = $1::bigint and id = $4::bigint) as project,
  (select json_build_object('id', id::text, 'title', title)
     from app.assistant_conversations where enterprise_id = $1::bigint and id = $5::bigint) as conversation`;

function sharedConflict(contextLabel: string, detail: Record<string, unknown>): never {
  throw new WorkflowOperationError(
    'fixture_ownership_conflict',
    409,
    `Shared fixture ownership conflict (${contextLabel}): ${String(detail.field)}=`
      + `${JSON.stringify(detail.actual)} does not match ${JSON.stringify(detail.expected)} `
      + `for ${String(detail.table)} id=${String(detail.id)}.`,
    { context: contextLabel, ...detail },
  );
}

/** Pure check: every shared B4 fixture row must keep its documented marker. */
export function assertSharedFixtureOwned(
  evidence: SharedFixtureEvidence,
  contextLabel: string,
): void {
  const enterprise = evidence.enterprise;
  if (!enterprise || enterprise.id !== SHARED_FIXTURE.enterpriseId) {
    sharedConflict(contextLabel, {
      table: 'app.enterprises',
      id: SHARED_FIXTURE.enterpriseId,
      field: 'row',
      actual: enterprise,
      expected: 'present',
    });
  }
  if (enterprise.code !== SHARED_FIXTURE.enterpriseCode) {
    sharedConflict(contextLabel, {
      table: 'app.enterprises',
      id: enterprise.id,
      field: 'code',
      actual: enterprise.code,
      expected: SHARED_FIXTURE.enterpriseCode,
    });
  }
  if (!(enterprise.name ?? '').startsWith(SHARED_FIXTURE.namePrefix)) {
    sharedConflict(contextLabel, {
      table: 'app.enterprises',
      id: enterprise.id,
      field: 'name',
      actual: enterprise.name,
      expected: `${SHARED_FIXTURE.namePrefix}*`,
    });
  }

  for (const expected of SHARED_FIXTURE_ADMINS) {
    const admin = evidence.admins.find((row) => row.id === expected.id);
    if (!admin) {
      sharedConflict(contextLabel, {
        table: 'app.admin_users',
        id: expected.id,
        field: 'row',
        actual: null,
        expected: expected.username,
      });
    }
    if (admin.username !== expected.username) {
      sharedConflict(contextLabel, {
        table: 'app.admin_users',
        id: admin.id,
        field: 'username',
        actual: admin.username,
        expected: expected.username,
      });
    }
    if (admin.enterpriseId !== SHARED_FIXTURE.enterpriseId) {
      sharedConflict(contextLabel, {
        table: 'app.admin_users',
        id: admin.id,
        field: 'enterprise_id',
        actual: admin.enterpriseId,
        expected: SHARED_FIXTURE.enterpriseId,
      });
    }
    if (admin.status !== 'active') {
      sharedConflict(contextLabel, {
        table: 'app.admin_users',
        id: admin.id,
        field: 'status',
        actual: admin.status,
        expected: 'active',
      });
    }
  }

  const customer = evidence.customer;
  if (!customer || customer.id !== SHARED_FIXTURE.customerUserId) {
    sharedConflict(contextLabel, {
      table: 'app.users',
      id: SHARED_FIXTURE.customerUserId,
      field: 'row',
      actual: customer,
      expected: SHARED_FIXTURE.customerUserId,
    });
  }
  if (customer.username !== SHARED_FIXTURE_CUSTOMER_USERNAME) {
    sharedConflict(contextLabel, {
      table: 'app.users',
      id: customer.id,
      field: 'username',
      actual: customer.username,
      expected: SHARED_FIXTURE_CUSTOMER_USERNAME,
    });
  }
  if (customer.enterpriseId !== SHARED_FIXTURE.enterpriseId) {
    sharedConflict(contextLabel, {
      table: 'app.users',
      id: customer.id,
      field: 'enterprise_id',
      actual: customer.enterpriseId,
      expected: SHARED_FIXTURE.enterpriseId,
    });
  }

  const project = evidence.project;
  if (!project || project.id !== SHARED_FIXTURE.mainProjectId) {
    sharedConflict(contextLabel, {
      table: 'app.construction_projects',
      id: SHARED_FIXTURE.mainProjectId,
      field: 'row',
      actual: project,
      expected: SHARED_FIXTURE.mainProjectId,
    });
  }
  if (!(project.name ?? '').startsWith(SHARED_FIXTURE.namePrefix)) {
    sharedConflict(contextLabel, {
      table: 'app.construction_projects',
      id: project.id,
      field: 'name',
      actual: project.name,
      expected: `${SHARED_FIXTURE.namePrefix}*`,
    });
  }

  const conversation = evidence.conversation;
  if (!conversation || conversation.id !== SHARED_FIXTURE.mainConversationId) {
    sharedConflict(contextLabel, {
      table: 'app.assistant_conversations',
      id: SHARED_FIXTURE.mainConversationId,
      field: 'row',
      actual: conversation,
      expected: SHARED_FIXTURE.mainConversationId,
    });
  }
  if (!(conversation.title ?? '').startsWith(SHARED_FIXTURE.namePrefix)) {
    sharedConflict(contextLabel, {
      table: 'app.assistant_conversations',
      id: conversation.id,
      field: 'title',
      actual: conversation.title,
      expected: `${SHARED_FIXTURE.namePrefix}*`,
    });
  }
}

/** Reads the shared fixture rows. This is a read-only select. */
export async function readSharedFixtureEvidence(
  client: SharedFixtureQueryClient,
): Promise<SharedFixtureEvidence> {
  const result = await client.query(SHARED_FIXTURE_QUERY, [
    SHARED_FIXTURE.enterpriseId,
    SHARED_FIXTURE_ADMINS.map((admin) => admin.id),
    SHARED_FIXTURE.customerUserId,
    SHARED_FIXTURE.mainProjectId,
    SHARED_FIXTURE.mainConversationId,
  ]);
  const row = result.rows[0];
  return {
    enterprise: (row?.enterprise ?? null) as SharedFixtureEvidence['enterprise'],
    admins: (row?.admins ?? []) as SharedFixtureEvidence['admins'],
    customer: (row?.customer ?? null) as SharedFixtureEvidence['customer'],
    project: (row?.project ?? null) as SharedFixtureEvidence['project'],
    conversation: (row?.conversation ?? null) as SharedFixtureEvidence['conversation'],
  };
}

/** Read-only preflight that must pass before any reset/delete/write. */
export async function runSharedFixturePreflight(
  client: SharedFixtureQueryClient,
  contextLabel = 'shared fixture preflight',
): Promise<SharedFixtureEvidence> {
  const evidence = await readSharedFixtureEvidence(client);
  assertSharedFixtureOwned(evidence, contextLabel);
  return evidence;
}

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
