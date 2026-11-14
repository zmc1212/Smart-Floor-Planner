import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { answerStageQuestion, type StageAudience } from './stage-answer';

function questionInput(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail('invalid_construction', 422);
  return value.trim();
}

async function audienceFor(tx: PostgresTransaction, actor: ActorContext): Promise<StageAudience> {
  if (actor.principal.kind === 'user') return 'owner';
  const staff = await one(tx, sql`select role,construction_trades from app.admin_users
    where enterprise_id=${actor.enterpriseId} and id=${actor.principal.adminId} and status='active' for share`);
  if (!staff) fail('construction_forbidden', 403);
  if (staff.role === 'enterprise_admin' || staff.role === 'admin' || staff.role === 'super_admin') return 'boss';
  if (staff.role === 'designer') return 'designer';
  if (staff.role === 'construction_staff') return 'worker';
  return 'owner';
}

/** Project-scoped stage knowledge. The same Construction membership rules that
 * govern progress reads decide whether the question can be answered. */
export async function stageAnswerForProject(actor: ActorContext, input: { projectId?: unknown; question?: unknown }) {
  const pid = id(input.projectId), question = questionInput(input.question);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const project = await one(tx, sql`select p.id,p.name,p.current_stage_key,p.customer_access,l.customer_user_id
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      where p.enterprise_id=${actor.enterpriseId} and p.id=${pid} and p.status<>'archived' and l.archived_at is null for share of p,l`);
    if (!project) fail('construction_not_found', 404);
    const audience = await audienceFor(tx, actor);
    if (actor.principal.kind === 'user') {
      if (!project.customer_access || String(project.customer_user_id || '') !== actor.principal.userId) fail('construction_not_found', 404);
    } else {
      const access = await one(tx, sql`select app.construction_actor_access(${actor.principal.adminId}::bigint,${actor.enterpriseId}::bigint) as role`);
      if (!access?.role) fail('construction_forbidden', 403);
      if (access.role !== 'owner') {
        const member = await one(tx, sql`select role from app.construction_members where enterprise_id=${actor.enterpriseId}
          and project_id=${pid} and admin_id=${actor.principal.adminId} and active for share`);
        if (!member) fail('construction_not_found', 404);
      }
    }
    const answer = answerStageQuestion({ constructionStageKey: project.current_stage_key as string | null, question, audience });
    return { projectId: String(project.id), projectName: String(project.name), stageKey: project.current_stage_key as string | null, answer };
  });
}
