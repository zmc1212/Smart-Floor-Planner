import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError } from '@/lib/assistant/contracts';
import { canManageConstructionProject, type ConstructionActor } from '@/lib/construction/contracts';
import { constructionAccess } from '@/lib/construction/service';

export type ProjectLock = 'share' | 'update';

export interface ProjectAccess {
  readonly owner: boolean;
  readonly memberRole: string | null;
  readonly project: Row;
}

/**
 * Read the project and the current member role under one lock order. The
 * existing construction service uses the same rule: any active member may
 * read; only the owner or an active manager may write.
 */
export async function projectAccess(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  lock: ProjectLock,
  owner: boolean,
): Promise<ProjectAccess> {
  const projectLock = lock === 'update' ? sql`for update` : sql`for share`;
  const project = await one(
    tx,
    sql`select * from app.construction_projects
      where enterprise_id=${actor.enterpriseId} and id=${projectId} ${projectLock}`,
  );
  if (!project) throw new AssistantError('construction_not_found', 404);
  if (owner) return { owner, memberRole: null, project };
  const member = await one(
    tx,
    sql`select role from app.construction_members
      where enterprise_id=${actor.enterpriseId} and project_id=${projectId}
      and admin_id=${actor.adminId} and active for share`,
  );
  if (!member) throw new AssistantError('construction_not_found', 404);
  return { owner, memberRole: String(member.role), project };
}

export async function readProjectAccess(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  lock: ProjectLock,
): Promise<ProjectAccess> {
  return projectAccess(tx, actor, projectId, lock, await constructionAccess(tx, actor));
}

export function assertProjectWrite(access: ProjectAccess): void {
  if (!canManageConstructionProject(access.owner, access.memberRole)) {
    throw new AssistantError('construction_forbidden', 403);
  }
}

export async function writeProjectAccess(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  lock: ProjectLock,
): Promise<ProjectAccess> {
  const access = await readProjectAccess(tx, actor, projectId, lock);
  assertProjectWrite(access);
  return access;
}
