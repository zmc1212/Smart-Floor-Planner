
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { customerProjects } from '@/lib/construction/customer';
import { delegationsEnabled } from '@/lib/native-workflow/live/delegation-config';
import type { ActorContext } from '../contracts';

export type PrivateMemoryScope = {
  enterpriseId: string;
  ownerId: string;
  conversationId: string;
  leadId: string | null;
  projectId: string | null;
  ambiguous: boolean;
};

export async function privateMemoryScope(tx: PostgresTransaction, actor: ActorContext, conversation: Row): Promise<PrivateMemoryScope | null> {
  const enterpriseId = actor.enterpriseId;
  if (actor.principal.kind !== 'user' || !delegationsEnabled(enterpriseId)
    || String(conversation.enterprise_id) !== enterpriseId || conversation.purpose !== 'customer_consultation'
    || conversation.status !== 'open' || conversation.mode !== 'ai') return null;
  const ownerId = actor.principal.userId, conversationId = String(conversation.id), entry = conversation.entry_snapshot as Row;
  if (!entry || entry.retentionRedacted || entry.activePublicSite || entry.kind === 'reference_content') return null;
  const allowed = await one(tx, sql`select p.user_id from app.assistant_participants p
    join app.enterprises e on e.id=p.enterprise_id and e.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=p.enterprise_id and s.enabled and s.retention_days>0
    where p.enterprise_id=${enterpriseId} and p.conversation_id=${conversationId} and p.user_id=${ownerId}
    and p.status='active' and p.participant_role='owner' for share of p,e,s`);
  if (!allowed) return null;
  // No implicit selection from the owner's other projects or public sites.
  if (entry.kind !== 'lead') return { enterpriseId, ownerId, conversationId, leadId: null, projectId: null, ambiguous: false };
  const leadId = String(entry.id);
  if (!/^[1-9]\d{0,17}$/.test(leadId)) return null;
  const lead = await one(tx, sql`select id from app.leads where enterprise_id=${enterpriseId} and id=${leadId}
    and customer_user_id=${ownerId} and archived_at is null for share`);
  if (!lead) return null;
  const projects = (await customerProjects(tx, enterpriseId, ownerId, leadId, true)).filter(project => project.status === 'active');
  return { enterpriseId, ownerId, conversationId, leadId, projectId: projects.length === 1 ? String(projects[0].id) : null, ambiguous: projects.length > 1 };
}
