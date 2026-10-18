import { sql, type SQL } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { fail, type ActorContext } from '@/lib/assistant/contracts';
import { authorizeKnowledgeManager } from '@/lib/assistant/knowledge/manager';

export type Row = Record<string, unknown>;
export function assistantWritesEnabled(settings: Row | undefined) {
  return Boolean(settings?.enabled && Number(settings.retention_days) >= 1
    && Number(settings.daily_requests) >= 1 && Number(settings.daily_tokens) >= 1
    && Number(settings.daily_cost_micros) >= 1);
}
export async function rows<T = Row>(tx: PostgresTransaction, query: SQL): Promise<T[]> {
  return (await tx.execute(query)).rows as T[];
}
export async function one<T = Row>(tx: PostgresTransaction, query: SQL): Promise<T | undefined> {
  return (await rows<T>(tx, query))[0];
}
/** All business access is through an explicitly scoped tenant transaction. */
export class AssistantRepository {
  constructor(readonly tx: PostgresTransaction, readonly actor: ActorContext) {}
  async identity() {
    const a = this.actor;
    const enterprise = await one(this.tx, sql`select id from app.enterprises where id=${a.enterpriseId} and status='active' for share`);
    if (!enterprise) fail('assistant_resource_not_found', 404);
    if (a.principal.kind === 'admin') {
      if (a.capabilities.includes('assistant.project.shared')) {
        const scope = a.entry || {};
        const current = await one(this.tx, sql`select app.assistant_shared_actor_access(${a.principal.adminId}::bigint,${a.enterpriseId}::bigint,
          ${scope.miniProgramUserId || null}::bigint,${scope.miniProgramContextVersion ?? 0}::integer) as allowed`);
        if (!current?.allowed) fail('assistant_capability_forbidden', 403);
        return;
      }
      if (a.capabilities.includes('assistant.handoff.staff')) {
        const staff = await one(this.tx, sql`select id from app.admin_users where enterprise_id=${a.enterpriseId} and id=${a.principal.adminId}
          and status='active' and role in ('designer','enterprise_admin') and must_change_password=false for share`);
        if (!staff) fail('assistant_capability_forbidden',403);
        return;
      }
      if (!a.capabilities.includes('assistant.preview.self')) fail('assistant_capability_forbidden',403);
      await authorizeKnowledgeManager(this.tx,a.enterpriseId,a.principal.adminId);return;
    }
    const user = await one(this.tx, sql`select app.assistant_identity_is_current(${a.principal.userId}::bigint,${a.contextVersion}::integer) as valid`);
    if (!user?.valid) fail('identity_context_invalid', 401);
  }
  async settings(write = false) {
    await this.identity();
    const settings = await one(this.tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId} for update`);
    if (write && !assistantWritesEnabled(settings)) fail('assistant_disabled', 403);
    return settings;
  }
  async conversation(conversationId: string) {
    const a = this.actor;
    if (a.principal.kind === 'admin' && a.capabilities.includes('assistant.project.shared')) {
      const conversation = await one(this.tx, sql`select * from app.assistant_conversations where enterprise_id=${a.enterpriseId}
        and id=${conversationId} and purpose='project_collaboration' for update`);
      if (!conversation || !(await one(this.tx, sql`select app.assistant_shared_conversation_access(${a.principal.adminId}::bigint,
        ${a.enterpriseId}::bigint,${conversationId}::bigint,${a.entry?.miniProgramUserId || null}::bigint,${a.entry?.miniProgramContextVersion ?? 0}::integer) as allowed`))?.allowed) fail('assistant_resource_not_found', 404);
      return conversation;
    }
    const conversation = await one(this.tx, sql`select c.* from app.assistant_conversations c
      join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
      where c.enterprise_id=${a.enterpriseId} and c.id=${conversationId}
      and c.purpose=${a.principal.kind==='user'?'customer_consultation':'knowledge_preview'}
      and ${a.principal.kind==='user'?sql`p.user_id=${a.principal.userId}`:sql`p.admin_id=${a.principal.adminId}`}
      and p.status='active' for update of c,p`);
    if (!conversation) fail('assistant_resource_not_found', 404);
    return conversation;
  }
}
