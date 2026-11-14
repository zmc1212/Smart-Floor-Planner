import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { fail, id, key } from '@/lib/assistant/contracts';
import { object, type ConstructionActor } from '@/lib/construction/contracts';
import { constructionAccess } from '@/lib/construction/service';

export const pilotScopeTable = 'xiaok_pilot_project_scopes';

export type PilotProjectScope = {
  enterpriseId: string;
  pilotId: string;
  projectIds: string[];
  createdBy: string;
  createdAt: string;
  scopeVersion: number;
  status: 'active' | 'inactive';
};

const scopeColumns = sql`enterprise_id::text as "enterpriseId",pilot_id as "pilotId",
  project_ids::text[] as "projectIds",created_by::text as "createdBy",created_at as "createdAt",
  scope_version as "scopeVersion",status`;
const scopeDto = (row: PilotProjectScope): PilotProjectScope => ({ ...row, createdAt: new Date(row.createdAt).toISOString() });

export function pilotProjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) fail('pilot_scope_invalid', 422);
  const ids = value.map(id);
  if (new Set(ids).size !== ids.length) fail('pilot_scope_invalid', 422);
  return ids;
}

export async function readPilotProjectScope(tx: PostgresTransaction, enterpriseId: string, pilotId: string) {
  const row = await one<PilotProjectScope>(tx, sql`select ${scopeColumns} from app.xiaok_pilot_project_scopes
    where enterprise_id=${enterpriseId} and pilot_id=${pilotId}
    order by scope_version desc limit 1`);
  return row ? scopeDto(row) : null;
}

function configurationError(error: unknown): never {
  const cause = (error as { cause?: { constraint?: string } })?.cause;
  if (cause?.constraint === 'xiaok_pilot_projects_available') fail('pilot_project_unavailable', 404);
  throw error;
}

/** The browser session supplies the selected enterprise and admin identity. */
export class PilotProjectScopeService {
  constructor(private readonly actor: Pick<ConstructionActor, 'enterpriseId' | 'adminId'>) {}

  read(pilotId: string) {
    return this.manage(pilotId, async (tx, enterpriseId) => {
      const scope = await readPilotProjectScope(tx, enterpriseId, pilotId);
      if (!scope) fail('pilot_scope_not_found', 404);
      return scope;
    });
  }

  save(pilotId: string, body: unknown) {
    const input = object(body, ['projectIds', 'expectedVersion', 'status']);
    const projectIds = pilotProjectIds(input.projectIds);
    const { expectedVersion, status } = input;
    if (!projectIds.length || typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion)
      || expectedVersion < 0 || expectedVersion >= 2147483647 || (status !== 'active' && status !== 'inactive')) {
      fail('pilot_scope_invalid', 422);
    }

    return this.manage(pilotId, async (tx, enterpriseId) => {
      // Lock the first save as well as updates. Each version keeps its author and selection.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'xiaok-pilot:' + enterpriseId + ':' + pilotId},0))`);
      const current = await readPilotProjectScope(tx, enterpriseId, pilotId);
      if ((current?.scopeVersion ?? 0) !== expectedVersion) fail('version_conflict', 409);
      if (status === 'inactive' && (!current || projectIds.length !== current.projectIds.length
        || projectIds.some((projectId, index) => projectId !== current.projectIds[index]))) fail('pilot_scope_invalid', 422);
      const saved = await one<PilotProjectScope>(tx, sql`insert into app.xiaok_pilot_project_scopes
        (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
        values(${enterpriseId},${pilotId},array[${sql.join(projectIds.map(projectId => sql`${projectId}::bigint`), sql`,`)}],
          ${this.actor.adminId},${expectedVersion + 1},${status})
        returning ${scopeColumns}`);
      return scopeDto(saved!);
    }).catch(configurationError);
  }

  private manage<T>(pilotId: string, action: (tx: PostgresTransaction, enterpriseId: string) => Promise<T>) {
    key(pilotId);
    const enterpriseId = id(this.actor.enterpriseId);
    return withTenantTransaction(enterpriseId, async tx => {
      if (!await constructionAccess(tx, this.actor)) fail('pilot_scope_forbidden', 403);
      return action(tx, enterpriseId);
    });
  }
}
