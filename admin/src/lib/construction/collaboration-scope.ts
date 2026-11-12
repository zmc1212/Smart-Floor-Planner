import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { nativeWorkflowEnterpriseIds } from '@/lib/native-workflow/live/tenant-allowlist';
import type { ActorContext } from '@/lib/assistant/contracts';

export function collaborationEnabled(enterpriseId: string) {
  return nativeWorkflowEnterpriseIds(process.env.NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS).includes(enterpriseId);
}

/** Professional and review authority follows a live project assignment. */
export async function collaborationMember(tx: PostgresTransaction, eid: string, pid: string, adminId: string) {
  const row = await one(tx, sql`select m.role,app.construction_actor_access(a.id,m.enterprise_id) as web_access,
    case when a.user_id is not null then app.construction_miniprogram_access(a.id,m.enterprise_id,a.user_id,u.context_version) end as mini_access
    from app.construction_members m join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
    left join app.users u on u.id=a.user_id where m.enterprise_id=${eid} and m.project_id=${pid}
    and m.admin_id=${adminId} and m.active and a.status='active' for share of a,m`);
  return row && (row.web_access || row.mini_access) ? String(row.role) : null;
}

/** Read-only participants never inherit the project owner's consent authority. */
export async function isConsultationOwner(tx: PostgresTransaction, actor: ActorContext, cid: string) {
  return actor.principal.kind === 'user' && !!await one(tx, sql`select id from app.assistant_participants
    where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and user_id=${actor.principal.userId}
      and status='active' and participant_role='owner' for share`);
}
